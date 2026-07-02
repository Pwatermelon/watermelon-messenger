import { SignJWT, jwtVerify } from "jose";
import { and, eq } from "drizzle-orm";
import { db, mediaChatGrants, mediaFiles, chatMembers } from "../db";
import { uploadsPathFromKey } from "./mediaStorage";
import { sanitizeOriginalFilename } from "../lib/contentDisposition";

const JWT_SECRET_BYTES = new TextEncoder().encode(
  process.env.MEDIA_SIGNING_SECRET ?? process.env.JWT_SECRET ?? "watermelon-dev-secret-change-in-prod"
);
const ACCESS_TTL_SEC = Number(process.env.MEDIA_ACCESS_TTL_SEC) || 3600;

export type MediaVisibility = "chat" | "profile";

export function filenameFromPath(path: string | null | undefined): string | null {
  if (!path) return null;
  const p = path.trim();
  let m = p.match(/\/uploads\/([^/?#]+)/) ?? p.match(/^uploads\/([^/?#]+)/);
  if (m?.[1]) return sanitizeMediaFilename(m[1]);
  m = p.match(/\/media\/([^/?#]+)/);
  if (m?.[1]) {
    try {
      return sanitizeMediaFilename(decodeURIComponent(m[1]));
    } catch {
      return sanitizeMediaFilename(m[1]);
    }
  }
  if (!p.includes("/") && !p.startsWith("http")) return sanitizeMediaFilename(p);
  return null;
}

function sanitizeMediaFilename(name: string): string {
  return name.replace(/\.\./g, "").replace(/\//g, "");
}

/** Canonical storage path — always `/uploads/{filename}`, never signed URLs. */
export function canonicalUploadsPath(path: string | null | undefined): string | null {
  const filename = filenameFromPath(path);
  if (!filename) return null;
  return uploadsPathFromKey(filename);
}

export function normalizeMediaPathList(paths: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of paths) {
    const canonical = canonicalUploadsPath(raw);
    if (!canonical || seen.has(canonical)) continue;
    seen.add(canonical);
    out.push(canonical);
  }
  return out;
}

export async function registerMediaFile(
  filename: string,
  ownerId: string,
  visibility: MediaVisibility = "chat",
  originalName?: string | null
): Promise<void> {
  const storedName = originalName ? sanitizeOriginalFilename(originalName) : null;
  await db
    .insert(mediaFiles)
    .values({ filename, ownerId, visibility, originalName: storedName })
    .onConflictDoNothing();
  if (storedName) {
    await db.update(mediaFiles).set({ originalName: storedName }).where(eq(mediaFiles.filename, filename));
  }
}

export async function grantMediaToChat(filename: string, chatId: string): Promise<void> {
  await db.insert(mediaChatGrants).values({ filename, chatId }).onConflictDoNothing();
}

import type { AttachmentMetadata } from "@melon/shared";

export async function grantMediaFromAttachment(
  attachmentUrl: string | null | undefined,
  chatId: string,
  attachmentMetadata?: AttachmentMetadata | null
): Promise<void> {
  const paths = new Set<string>();
  const primary = attachmentUrl ? canonicalUploadsPath(attachmentUrl) : null;
  if (primary) paths.add(primary);
  for (const item of attachmentMetadata?.attachments ?? []) {
    if (!item.url) continue;
    const canonical = canonicalUploadsPath(item.url);
    if (canonical) paths.add(canonical);
  }
  const poster = attachmentMetadata?.posterUrl ? canonicalUploadsPath(attachmentMetadata.posterUrl) : null;
  if (poster) paths.add(poster);
  for (const path of paths) {
    const filename = filenameFromPath(path);
    if (filename) await grantMediaToChat(filename, chatId);
  }
}

export async function canAccessMedia(userId: string, filename: string): Promise<boolean> {
  const [row] = await db.select().from(mediaFiles).where(eq(mediaFiles.filename, filename)).limit(1);
  if (!row) return false;
  if (row.ownerId === userId) return true;
  if (row.visibility === "profile") return true;

  const [grant] = await db
    .select({ chatId: mediaChatGrants.chatId })
    .from(mediaChatGrants)
    .innerJoin(chatMembers, and(eq(chatMembers.chatId, mediaChatGrants.chatId), eq(chatMembers.userId, userId)))
    .where(eq(mediaChatGrants.filename, filename))
    .limit(1);
  return Boolean(grant);
}

/** Profile / group avatars visible to any authenticated user */
export async function registerProfileMedia(filename: string, ownerId: string, originalName?: string | null): Promise<void> {
  await registerMediaFile(filename, ownerId, "profile", originalName);
}

export async function signMediaAccess(userId: string, filename: string): Promise<string> {
  const token = await new SignJWT({ file: filename })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setExpirationTime(`${ACCESS_TTL_SEC}s`)
    .sign(JWT_SECRET_BYTES);
  return token;
}

export async function verifyMediaAccessToken(
  token: string,
  filename: string
): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET_BYTES);
    const sub = payload.sub;
    const file = payload.file;
    if (typeof sub !== "string" || file !== filename) return null;
    return sub;
  } catch {
    return null;
  }
}

export async function signMediaPath(path: string | null | undefined, userId: string): Promise<string | null> {
  if (!path) return null;
  const canonical = canonicalUploadsPath(path);
  if (!canonical) {
    if (path.startsWith("http://") || path.startsWith("https://")) return path;
    return null;
  }
  const filename = filenameFromPath(canonical);
  if (!filename) return null;
  const ok = await canAccessMedia(userId, filename);
  if (!ok) return null;
  const access = await signMediaAccess(userId, filename);
  const base = (process.env.API_PUBLIC_URL ?? "").replace(/\/$/, "") || "";
  const prefix = base || "";
  return `${prefix}/media/${encodeURIComponent(filename)}?access=${access}`;
}

export function normalizeAttachmentMetadataForStorage(
  metadata: AttachmentMetadata | null | undefined
): AttachmentMetadata | null {
  if (!metadata) return null;
  const next: AttachmentMetadata = { ...metadata };
  if (next.attachments?.length) {
    next.attachments = next.attachments
      .map((a) => ({
        ...a,
        url: (a.url ? canonicalUploadsPath(a.url) : null) ?? a.url,
        ...(a.posterUrl ? { posterUrl: canonicalUploadsPath(a.posterUrl) ?? a.posterUrl } : {}),
      }))
      .filter((a): a is typeof a & { url: string } => Boolean(a.url));
  }
  if (next.posterUrl) {
    next.posterUrl = canonicalUploadsPath(next.posterUrl) ?? next.posterUrl;
  }
  return next;
}

export function normalizeMessageAttachmentUrl(
  attachmentUrl: string | null | undefined,
  metadata: AttachmentMetadata | null | undefined
): string | null {
  if (attachmentUrl) {
    const canonical = canonicalUploadsPath(attachmentUrl);
    if (canonical) return canonical;
  }
  for (const item of metadata?.attachments ?? []) {
    if (!item.url) continue;
    const canonical = canonicalUploadsPath(item.url);
    if (canonical) return canonical;
  }
  return attachmentUrl ?? null;
}

export async function signMediaPaths(
  paths: Array<string | null | undefined>,
  userId: string
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const canonicalSet = new Set<string>();
  const originals: string[] = [];
  for (const raw of paths) {
    const trimmed = raw?.trim();
    if (!trimmed) continue;
    originals.push(trimmed);
    const canonical = canonicalUploadsPath(trimmed);
    if (canonical) canonicalSet.add(canonical);
  }
  await Promise.all(
    [...canonicalSet].map(async (path) => {
      const signed = await signMediaPath(path, userId);
      if (signed) out[path] = signed;
    })
  );
  for (const original of originals) {
    const signed = resolveSignedMediaPath(original, out);
    if (signed) out[original] = signed;
  }
  return out;
}

export async function signAttachmentMetadata(
  metadata: AttachmentMetadata | null | undefined,
  viewerId: string
): Promise<AttachmentMetadata | null | undefined> {
  if (!metadata) return metadata;
  const paths: string[] = [];
  for (const a of metadata.attachments ?? []) {
    if (a.url) paths.push(a.url);
    if (a.posterUrl) paths.push(a.posterUrl);
  }
  if (metadata.posterUrl) paths.push(metadata.posterUrl);
  if (!paths.length) return metadata;
  const signed = await signMediaPaths(paths, viewerId);
  const next: AttachmentMetadata = { ...metadata };
  if (next.attachments?.length) {
    next.attachments = next.attachments.map((a) => ({
      ...a,
      url: resolveSignedMediaPath(a.url, signed) ?? a.url,
      ...(a.posterUrl ? { posterUrl: resolveSignedMediaPath(a.posterUrl, signed) ?? a.posterUrl } : {}),
    }));
  }
  if (next.posterUrl) {
    next.posterUrl = resolveSignedMediaPath(next.posterUrl, signed) ?? next.posterUrl;
  }
  return next;
}

function resolveSignedMediaPath(path: string | null | undefined, signed: Record<string, string>): string | null {
  if (!path) return null;
  const canonical = canonicalUploadsPath(path);
  if (canonical && signed[canonical]) return signed[canonical];
  return signed[path] ?? null;
}

export function collectUserMediaPaths(u: {
  avatarUrl?: string | null;
  coverUrl?: string | null;
  profilePhotos?: string[] | null;
  avatarHistory?: string[] | null;
}): string[] {
  const paths: string[] = [];
  if (u.avatarUrl) paths.push(u.avatarUrl);
  if (u.coverUrl) paths.push(u.coverUrl);
  for (const p of u.profilePhotos ?? []) paths.push(p);
  for (const p of u.avatarHistory ?? []) paths.push(p);
  return paths;
}

/** Sign avatar/cover paths on a user object for a viewer */
export async function signUserMedia<T extends Record<string, unknown>>(user: T, viewerId: string): Promise<T> {
  const paths = collectUserMediaPaths(user as Parameters<typeof collectUserMediaPaths>[0]);
  const signed = await signMediaPaths(paths, viewerId);
  const mapPath = (p: string) => resolveSignedMediaPath(p, signed) ?? p;
  const next = { ...user } as T & {
    avatarUrl?: string | null;
    coverUrl?: string | null;
    profilePhotos?: string[];
    avatarHistory?: string[];
  };
  if (typeof next.avatarUrl === "string") next.avatarUrl = mapPath(next.avatarUrl);
  if (typeof next.coverUrl === "string") next.coverUrl = mapPath(next.coverUrl);
  if (Array.isArray(next.profilePhotos)) {
    next.profilePhotos = next.profilePhotos.map(mapPath);
  }
  if (Array.isArray(next.avatarHistory)) {
    next.avatarHistory = next.avatarHistory.map(mapPath);
  }
  return next as T;
}

export async function ensureProfileMediaRegistered(
  ownerId: string,
  paths: Array<string | null | undefined>
): Promise<void> {
  for (const path of paths) {
    const filename = filenameFromPath(path);
    if (filename) await registerProfileMedia(filename, ownerId);
  }
}

export async function ensureChatAvatarRegistered(chatId: string, avatarUrl: string | null | undefined): Promise<void> {
  const filename = filenameFromPath(avatarUrl);
  if (!filename) return;
  const [admin] = await db
    .select({ userId: chatMembers.userId })
    .from(chatMembers)
    .where(and(eq(chatMembers.chatId, chatId), eq(chatMembers.role, "admin")))
    .limit(1);
  await registerMediaFile(filename, admin?.userId ?? chatId, "profile");
}

export { uploadsPathFromKey };
