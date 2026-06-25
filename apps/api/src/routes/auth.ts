import { Elysia } from "elysia";
import { jwt } from "@elysiajs/jwt";
import * as jose from "jose";
import { db, users } from "../db";
import { eq } from "drizzle-orm";
import { toPrivateProfile, parseAvatarHistory, parseProfilePhotos } from "../lib/userDto";
import {
  canonicalUploadsPath,
  ensureProfileMediaRegistered,
  normalizeMediaPathList,
  signUserMedia,
} from "../services/mediaAccess";
import {
  buildYandexAuthorizeUrl,
  createOAuthState,
  exchangeYandexCode,
  getOAuthConfig,
  isYandexConfigured,
  isYandexOAuthError,
  resolveRedirectUri,
  verifyOAuthState,
  YANDEX_REDIRECT_URI,
} from "../services/yandexOAuth";

const WEB_URL = process.env.WEB_URL ?? "http://localhost:5173";
const JWT_SECRET = process.env.JWT_SECRET ?? "watermelon-dev-secret-change-in-prod";

export async function verifyBearerUser(request: Request): Promise<typeof users.$inferSelect | null> {
  const authHeader = request.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return null;
  try {
    const secret = new TextEncoder().encode(JWT_SECRET);
    const { payload } = await jose.jwtVerify(token, secret);
    const userId = payload.sub as string;
    if (!userId) return null;
    const [u] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    return u ?? null;
  } catch {
    return null;
  }
}

export const authRoutes = new Elysia({ prefix: "/auth" })
  .use(jwt({ name: "jwt", secret: JWT_SECRET, exp: "30d" }))
  .get("/yandex/config", () => getOAuthConfig())
  .get("/yandex", async ({ query, set }) => {
    if (!isYandexConfigured()) {
      set.status = 503;
      return { error: "Yandex OAuth не настроен (YANDEX_CLIENT_ID)" };
    }
    try {
      const q = query as { redirect_uri?: string; platform?: string };
      const redirectUri = resolveRedirectUri(q.redirect_uri);
      const state = await createOAuthState();
      const url = buildYandexAuthorizeUrl(redirectUri, state);

      if (q.platform === "native") {
        return { authorizeUrl: url, redirectUri, state };
      }

      return Response.redirect(url, 302);
    } catch (e) {
      set.status = 400;
      return { error: e instanceof Error ? e.message : "Invalid redirect_uri" };
    }
  })
  .post("/yandex/exchange", async ({ request, set }) => {
    if (!isYandexConfigured()) {
      set.status = 503;
      return { error: "Yandex OAuth не настроен" };
    }
    const body = (await request.json()) as { code?: string; redirect_uri?: string; state?: string };
    if (!body.code?.trim()) {
      set.status = 400;
      return { error: "code required" };
    }
    try {
      const redirectUri = resolveRedirectUri(body.redirect_uri);
      if (body.state && !(await verifyOAuthState(body.state))) {
        set.status = 400;
        return { error: "Invalid state" };
      }
      return await exchangeYandexCode(body.code.trim(), redirectUri);
    } catch (e) {
      console.error("[Yandex OAuth exchange]", e);
      if (isYandexOAuthError(e)) {
        set.status = 400;
        return { error: e.message, code: e.code };
      }
      set.status = 401;
      return { error: e instanceof Error ? e.message : "OAuth failed" };
    }
  })
  .get("/yandex/callback", async ({ query }) => {
    const q = query as { code?: string; state?: string; error?: string };
    if (q.error || !q.code) {
      return Response.redirect(`${WEB_URL}/login?error=yandex_denied`, 302);
    }
    if (!(await verifyOAuthState(q.state))) {
      return Response.redirect(`${WEB_URL}/login?error=yandex_failed`, 302);
    }
    if (!isYandexConfigured()) {
      return Response.redirect(`${WEB_URL}/login?error=yandex_not_configured`, 302);
    }
    try {
      const { token } = await exchangeYandexCode(q.code, YANDEX_REDIRECT_URI);
      return Response.redirect(`${WEB_URL}/auth/callback?token=${encodeURIComponent(token)}`, 302);
    } catch (e) {
      console.error("[Yandex OAuth callback]", e);
      if (isYandexOAuthError(e)) {
        return Response.redirect(`${WEB_URL}/login?error=yandex_${e.code}`, 302);
      }
      return Response.redirect(`${WEB_URL}/login?error=yandex_failed`, 302);
    }
  })
  .get("/me", async ({ request, set }) => {
    const u = await verifyBearerUser(request);
    if (!u) {
      set.status = 401;
      return { error: "Unauthorized" };
    }
    const dto = toPrivateProfile(u);
    await ensureProfileMediaRegistered(u.id, [
      dto.avatarUrl,
      dto.coverUrl,
      ...dto.profilePhotos,
      ...dto.avatarHistory,
    ]);
    return signUserMedia(dto, u.id);
  })
  .put("/me", async ({ request, set }) => {
    const u = await verifyBearerUser(request);
    if (!u) {
      set.status = 401;
      return { error: "Unauthorized" };
    }
    const body = (await request.json()) as {
      username?: string;
      avatarUrl?: string | null;
      coverUrl?: string | null;
      bio?: string | null;
      profilePhotos?: string[];
      avatarHistory?: string[];
      birthdayVisible?: boolean;
    };
    const updates: Partial<typeof users.$inferInsert> = {};
    if (typeof body.username === "string" && body.username.trim().length > 0) {
      updates.username = body.username.trim().slice(0, 100);
    }
    if (body.avatarUrl !== undefined) {
      const raw = typeof body.avatarUrl === "string" ? body.avatarUrl.trim() : "";
      updates.avatarUrl = raw ? canonicalUploadsPath(raw) : null;
    }
    if (Array.isArray(body.avatarHistory)) {
      updates.avatarHistory = JSON.stringify(
        normalizeMediaPathList(body.avatarHistory.filter((p) => typeof p === "string")).slice(0, 24)
      );
    }
    if (body.coverUrl !== undefined) {
      const raw = typeof body.coverUrl === "string" ? body.coverUrl.trim() : "";
      updates.coverUrl = raw ? canonicalUploadsPath(raw) : null;
    }
    if (body.bio !== undefined) {
      updates.bio = typeof body.bio === "string" ? body.bio.trim().slice(0, 500) || null : null;
    }
    if (Array.isArray(body.profilePhotos)) {
      updates.profilePhotos = JSON.stringify(
        normalizeMediaPathList(body.profilePhotos.filter((p) => typeof p === "string")).slice(0, 12)
      );
    }
    if (typeof body.birthdayVisible === "boolean") {
      updates.birthdayVisible = body.birthdayVisible;
    }
    if (Object.keys(updates).length === 0) return signUserMedia(toPrivateProfile(u), u.id);
    const [updated] = await db.update(users).set(updates).where(eq(users.id, u.id)).returning();
    await ensureProfileMediaRegistered(updated!.id, [
      updated!.avatarUrl,
      updated!.coverUrl,
      ...parseProfilePhotos(updated!.profilePhotos),
      ...parseAvatarHistory(updated!.avatarHistory),
    ]);
    return signUserMedia(toPrivateProfile(updated!), updated!.id);
  })
  .post("/logout", () => ({ ok: true }));
