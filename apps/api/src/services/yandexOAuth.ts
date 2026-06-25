import * as jose from "jose";
import { eq } from "drizzle-orm";
import { db, users } from "../db";
import { toPrivateProfile } from "../lib/userDto";
import { signUserMedia } from "./mediaAccess";
import { parseYandexBirthday } from "@melon/shared";

export const YANDEX_CLIENT_ID = process.env.YANDEX_CLIENT_ID ?? "";
export const YANDEX_CLIENT_SECRET = process.env.YANDEX_CLIENT_SECRET ?? "";
export const YANDEX_REDIRECT_URI =
  process.env.YANDEX_REDIRECT_URI ?? "http://localhost:3000/auth/yandex/callback";
export const YANDEX_NATIVE_REDIRECT_URI =
  process.env.YANDEX_NATIVE_REDIRECT_URI ?? "watermelon://oauth/yandex";
const JWT_SECRET = process.env.JWT_SECRET ?? "watermelon-dev-secret-change-in-prod";

const ADMIN_YANDEX_IDS = (process.env.ADMIN_YANDEX_IDS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const ADMIN_YANDEX_LOGINS = (process.env.ADMIN_YANDEX_LOGINS ?? "platinumwatermelon")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

const ALLOWED_REDIRECT_URIS = new Set(
  [
    YANDEX_REDIRECT_URI,
    YANDEX_NATIVE_REDIRECT_URI,
    ...(process.env.YANDEX_ALLOWED_REDIRECT_URIS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
  ].filter(Boolean)
);

interface YandexTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

export interface YandexUserInfo {
  id: string;
  login?: string;
  display_name?: string;
  default_email?: string;
  default_avatar_id?: string;
  real_name?: string;
  birthday?: string | null;
}

/** Verified inbox from Yandex, or null when the account has no linked mail. */
export function resolveVerifiedYandexEmail(info: Pick<YandexUserInfo, "default_email">): string | null {
  const email = info.default_email?.trim().toLowerCase();
  return email || null;
}

export type YandexOAuthErrorCode = "no_email" | "email_conflict";

export class YandexOAuthError extends Error {
  readonly code: YandexOAuthErrorCode;

  constructor(code: YandexOAuthErrorCode, message: string) {
    super(message);
    this.name = "YandexOAuthError";
    this.code = code;
  }
}

export function isYandexOAuthError(error: unknown): error is YandexOAuthError {
  return error instanceof YandexOAuthError;
}

export function parseYandexAccountId(raw: unknown): string {
  if (raw === null || raw === undefined) throw new Error("Yandex account id missing");
  const id = String(raw).trim();
  if (!id || id === "undefined" || id === "null") throw new Error("Yandex account id invalid");
  return id;
}

function isAdminYandex(info: YandexUserInfo): boolean {
  const yandexId = String(info.id);
  if (ADMIN_YANDEX_IDS.includes(yandexId)) return true;
  const login = info.login?.trim().toLowerCase();
  if (login && ADMIN_YANDEX_LOGINS.includes(login)) return true;
  return false;
}

function yandexAvatarUrl(avatarId?: string): string | null {
  if (!avatarId) return null;
  return `https://avatars.yandex.net/get-yapic/${avatarId}/islands-200`;
}

function normalizeYandexLogin(login?: string): string | null {
  const trimmed = login?.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, 64);
}

export function isYandexConfigured(): boolean {
  return Boolean(YANDEX_CLIENT_ID && YANDEX_CLIENT_SECRET);
}

export function resolveRedirectUri(requested?: string | null): string {
  const uri = requested?.trim() || YANDEX_REDIRECT_URI;
  if (!ALLOWED_REDIRECT_URIS.has(uri)) {
    throw new Error("redirect_uri not allowed");
  }
  return uri;
}

export function buildYandexAuthorizeUrl(redirectUri: string, state?: string): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: YANDEX_CLIENT_ID,
    redirect_uri: redirectUri,
  });
  if (state) params.set("state", state);
  params.set("force_confirm", "yes");
  return `https://oauth.yandex.ru/authorize?${params}`;
}

export async function createOAuthState(): Promise<string> {
  const secret = new TextEncoder().encode(JWT_SECRET);
  return new jose.SignJWT({ purpose: "yandex_oauth", rnd: crypto.randomUUID() })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("15m")
    .sign(secret);
}

export async function verifyOAuthState(state: string | null | undefined): Promise<boolean> {
  if (!state) return false;
  try {
    const secret = new TextEncoder().encode(JWT_SECRET);
    const { payload } = await jose.jwtVerify(state, secret);
    return payload.purpose === "yandex_oauth";
  } catch {
    return false;
  }
}

export async function signAppJwt(userId: string): Promise<string> {
  const secret = new TextEncoder().encode(JWT_SECRET);
  return new jose.SignJWT({ sub: userId })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("30d")
    .sign(secret);
}

export async function exchangeYandexCode(
  code: string,
  redirectUri: string
): Promise<{ token: string; user: ReturnType<typeof toPrivateProfile> }> {
  if (!isYandexConfigured()) throw new Error("Yandex OAuth not configured");

  const tokenRes = await fetch("https://oauth.yandex.ru/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: YANDEX_CLIENT_ID,
      client_secret: YANDEX_CLIENT_SECRET,
      redirect_uri: redirectUri,
    }),
  });
  if (!tokenRes.ok) {
    const text = await tokenRes.text();
    console.error("[Yandex OAuth] token exchange failed:", text);
    throw new Error("Token exchange failed");
  }
  const tokenData = (await tokenRes.json()) as YandexTokenResponse;

  const infoRes = await fetch("https://login.yandex.ru/info?format=json", {
    headers: { Authorization: `OAuth ${tokenData.access_token}` },
  });
  if (!infoRes.ok) throw new Error("User info failed");
  const info = (await infoRes.json()) as YandexUserInfo;

  const yandexId = parseYandexAccountId(info.id);
  const yandexLogin = normalizeYandexLogin(info.login);
  const verifiedEmail = resolveVerifiedYandexEmail(info);
  const username = (info.display_name ?? info.real_name ?? info.login ?? `user_${yandexId.slice(0, 8)}`).slice(
    0,
    100
  );
  const avatarUrl = yandexAvatarUrl(info.default_avatar_id);
  const birthday = parseYandexBirthday(info.birthday);
  const makeAdmin = isAdminYandex(info);

  const insertYandexUser = async (registrationEmail: string) =>
    db
      .insert(users)
      .values({
        email: registrationEmail,
        username,
        yandexId,
        yandexLogin,
        avatarUrl,
        birthday,
        subscriptionTier: "free",
        betaApproved: makeAdmin,
        isAdmin: makeAdmin,
      })
      .returning();

  let [user] = await db.select().from(users).where(eq(users.yandexId, yandexId)).limit(1);
  if (!user) {
    if (!verifiedEmail) {
      throw new YandexOAuthError(
        "no_email",
        "В Яндекс ID не привязана почта. Создайте или привяжите email в настройках Яндекса и войдите снова."
      );
    }

    const [byEmail] = await db.select().from(users).where(eq(users.email, verifiedEmail)).limit(1);
    if (byEmail) {
      if (byEmail.yandexId && byEmail.yandexId !== yandexId) {
        throw new YandexOAuthError(
          "email_conflict",
          "Эта почта уже привязана к другому аккаунту Watermelon."
        );
      }
      [user] = await db
        .update(users)
        .set({
          yandexId,
          username,
          yandexLogin: yandexLogin ?? byEmail.yandexLogin,
          avatarUrl: avatarUrl ?? byEmail.avatarUrl,
          birthday: birthday ?? byEmail.birthday,
          isAdmin: makeAdmin || byEmail.isAdmin,
          betaApproved: makeAdmin || byEmail.betaApproved,
        })
        .where(eq(users.id, byEmail.id))
        .returning();
    } else {
      [user] = await insertYandexUser(verifiedEmail);
    }
  } else {
    const updates: Partial<typeof users.$inferInsert> = {};
    if (yandexLogin && yandexLogin !== user.yandexLogin) updates.yandexLogin = yandexLogin;
    if (avatarUrl && !user.avatarUrl) updates.avatarUrl = avatarUrl;
    if (birthday && birthday !== user.birthday) updates.birthday = birthday;
    if (makeAdmin && !user.isAdmin) {
      updates.isAdmin = true;
      updates.betaApproved = true;
    }
    if (Object.keys(updates).length > 0) {
      [user] = await db.update(users).set(updates).where(eq(users.id, user.id)).returning();
    }
  }

  const token = await signAppJwt(user!.id);
  return { token, user: await signUserMedia(toPrivateProfile(user!), user!.id) };
}

export function getOAuthConfig() {
  return {
    clientId: YANDEX_CLIENT_ID || null,
    webRedirectUri: YANDEX_REDIRECT_URI,
    nativeRedirectUri: YANDEX_NATIVE_REDIRECT_URI,
    configured: isYandexConfigured(),
  };
}
