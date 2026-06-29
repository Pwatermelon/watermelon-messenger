import { Elysia } from "elysia";
import { eq, sql } from "drizzle-orm";
import { db, users } from "../db";
import { verifyBearerUser } from "./auth";
import { hmacSha256Hex, timingSafeEqualHex } from "../lib/hmac";
import { toPrivateProfile } from "../lib/userDto";
import { fetchCoinBalance, isMelonPaymentConfigured } from "../services/melonPayment";
import { ensureProfileMediaRegistered, signUserMedia } from "../services/mediaAccess";

const WEBHOOK_SECRET = process.env.MELON_PAYMENT_WEBHOOK_SECRET ?? "";
const DONATION_ALERTS_URL = process.env.DONATION_ALERTS_URL ?? "";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type WebhookPayload = {
  event?: string;
  externalUserId?: string;
  coinsAdded?: number;
  balance?: number;
};

async function verifyMelonInternal(request: Request, userId: string): Promise<boolean> {
  if (!WEBHOOK_SECRET) return false;
  const sig = request.headers.get("x-melon-signature") ?? "";
  const expected = await hmacSha256Hex(WEBHOOK_SECRET, userId);
  return timingSafeEqualHex(sig, expected);
}

async function verifyWebhook(request: Request, rawBody: string): Promise<boolean> {
  if (!WEBHOOK_SECRET) return false;
  const sig = request.headers.get("x-melon-signature") ?? "";
  const expected = await hmacSha256Hex(WEBHOOK_SECRET, rawBody);
  return timingSafeEqualHex(sig, expected);
}

export const coinRoutes = new Elysia()
  .get("/internal/coins/user-exists/:userId", async ({ request, params, set }) => {
    if (!UUID_RE.test(params.userId)) {
      set.status = 400;
      return { exists: false, error: "Invalid user id" };
    }
    if (!(await verifyMelonInternal(request, params.userId))) {
      set.status = 401;
      return { exists: false, error: "Invalid signature" };
    }

    const [user] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, params.userId))
      .limit(1);

    if (!user) {
      set.status = 404;
      return { exists: false };
    }

    return { exists: true };
  })
  .post("/internal/coins/webhook", async ({ request, set }) => {
    const rawBody = await request.text();
    if (!(await verifyWebhook(request, rawBody))) {
      set.status = 401;
      return { error: "Invalid signature" };
    }

    let payload: WebhookPayload;
    try {
      payload = JSON.parse(rawBody) as WebhookPayload;
    } catch {
      set.status = 400;
      return { error: "Invalid JSON" };
    }

    if (payload.event !== "coins.credited" || !payload.externalUserId) {
      return { ok: true, ignored: true };
    }

    if (!UUID_RE.test(payload.externalUserId)) {
      set.status = 400;
      return { error: "Invalid user id" };
    }

    const [user] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, payload.externalUserId))
      .limit(1);
    if (!user) {
      set.status = 404;
      return { error: "User not found" };
    }

    const balance =
      typeof payload.balance === "number"
        ? Math.floor(payload.balance)
        : typeof payload.coinsAdded === "number"
          ? undefined
          : undefined;

    if (typeof balance === "number") {
      await db
        .update(users)
        .set({ coinBalance: balance })
        .where(eq(users.id, payload.externalUserId));
    } else if (typeof payload.coinsAdded === "number" && payload.coinsAdded > 0) {
      await db
        .update(users)
        .set({ coinBalance: sql`${users.coinBalance} + ${Math.floor(payload.coinsAdded)}` })
        .where(eq(users.id, payload.externalUserId));
    }

    return { ok: true };
  })
  .get("/coins/balance", async ({ request, set }) => {
    const u = await verifyBearerUser(request);
    if (!u) {
      set.status = 401;
      return { error: "Unauthorized" };
    }

    let coins = u.coinBalance ?? 0;
    if (isMelonPaymentConfigured()) {
      const remote = await fetchCoinBalance(u.id);
      if (remote !== null && remote !== coins) {
        coins = remote;
        await db.update(users).set({ coinBalance: remote }).where(eq(users.id, u.id));
      }
    }

    const dto = toPrivateProfile({ ...u, coinBalance: coins });
    await ensureProfileMediaRegistered(u.id, [
      dto.avatarUrl,
      dto.coverUrl,
      ...dto.profilePhotos,
      ...dto.avatarHistory,
    ]);
    return { coins, user: await signUserMedia(dto, u.id) };
  })
  .get("/coins/topup-info", async ({ request, set }) => {
    const u = await verifyBearerUser(request);
    if (!u) {
      set.status = 401;
      return { error: "Unauthorized" };
    }

    return {
      donationAlertsUrl: DONATION_ALERTS_URL || null,
    };
  });
