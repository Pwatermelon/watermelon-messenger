import { MAX_BLOB_CACHE_BYTES, MAX_BLOB_CACHE_ITEM_BYTES } from "@melon/shared";
import { canonicalStoragePath, mediaUrl } from "./mediaUrl";
import { fetchAuthenticatedMedia } from "./mediaFetch";

const blobCache = new Map<string, string>();
const blobSizes = new Map<string, number>();
const largeBlobCache = new Map<string, string>();
const inflight = new Map<string, Promise<string>>();
let cacheBytes = 0;

const MAX_LARGE_BLOB_CACHE_ITEMS = 16;

function cacheKey(path: string): string {
  if (path.startsWith("blob:")) return path;
  const canonical = canonicalStoragePath(path);
  if (canonical.startsWith("/uploads/")) return canonical;
  const m = path.match(/\/media\/([^/?#]+)/);
  if (m?.[1]) {
    try {
      return `/uploads/${decodeURIComponent(m[1])}`;
    } catch {
      return `/uploads/${m[1]}`;
    }
  }
  return canonical || path;
}

function evictOldestLarge(): void {
  const oldest = largeBlobCache.keys().next().value;
  if (!oldest) return;
  const url = largeBlobCache.get(oldest);
  largeBlobCache.delete(oldest);
  if (url?.startsWith("blob:")) URL.revokeObjectURL(url);
}

function touchLargeCache(key: string, blobUrl: string): void {
  if (largeBlobCache.has(key)) largeBlobCache.delete(key);
  largeBlobCache.set(key, blobUrl);
  while (largeBlobCache.size > MAX_LARGE_BLOB_CACHE_ITEMS) evictOldestLarge();
}

/** Уже загруженный blob (просмотр/лайтбокс) — без повторного fetch. */
export function peekCachedMediaBlobUrl(path: string | null | undefined): string | null {
  if (!path || path.startsWith("blob:")) return path?.startsWith("blob:") ? path : null;
  const key = cacheKey(path);
  return blobCache.get(key) ?? largeBlobCache.get(key) ?? null;
}

function evictOldest(): void {
  const oldest = blobCache.keys().next().value;
  if (!oldest) return;
  const url = blobCache.get(oldest);
  cacheBytes -= blobSizes.get(oldest) ?? 0;
  blobSizes.delete(oldest);
  blobCache.delete(oldest);
  if (url?.startsWith("blob:")) URL.revokeObjectURL(url);
}

function touchCache(key: string, blobUrl: string, sizeBytes: number): void {
  if (blobCache.has(key)) {
    cacheBytes -= blobSizes.get(key) ?? 0;
    blobCache.delete(key);
    blobSizes.delete(key);
  }
  blobCache.set(key, blobUrl);
  blobSizes.set(key, sizeBytes);
  cacheBytes += sizeBytes;
  while (cacheBytes > MAX_BLOB_CACHE_BYTES) {
    if (blobCache.size <= 1) break;
    evictOldest();
  }
}

/**
 * Мелкие картинки — blob в RAM. Крупные (видео) — session-кэш, чтобы не качать дважды при просмотре и скачивании.
 */
export async function resolveMediaBlobUrl(path: string): Promise<string> {
  if (!path) return "";
  if (path.startsWith("blob:")) return path;

  const key = cacheKey(path);
  const directUrl = mediaUrl(path);
  const hit = blobCache.get(key) ?? largeBlobCache.get(key);
  if (hit) {
    if (blobCache.has(key)) touchCache(key, hit, blobSizes.get(key) ?? 0);
    else touchLargeCache(key, hit);
    return hit;
  }

  const pending = inflight.get(key);
  if (pending) return pending;

  const task = fetchAuthenticatedMedia(directUrl)
    .then((res) => {
      if (!res.ok) throw new Error(`media ${res.status}`);
      return res.blob();
    })
    .then((blob) => {
      const blobUrl = URL.createObjectURL(blob);
      if (blob.size <= MAX_BLOB_CACHE_ITEM_BYTES) {
        touchCache(key, blobUrl, blob.size);
      } else {
        touchLargeCache(key, blobUrl);
      }
      inflight.delete(key);
      return blobUrl;
    })
    .catch(() => {
      inflight.delete(key);
      return "";
    });

  inflight.set(key, task);
  return task;
}

export function prefetchMedia(paths: Array<string | null | undefined>): void {
  const seen = new Set<string>();
  for (const p of paths) {
    if (!p || p.startsWith("blob:")) continue;
    const key = cacheKey(p);
    if (seen.has(key) || blobCache.has(key) || largeBlobCache.has(key) || inflight.has(key)) continue;
    seen.add(key);
    void resolveMediaBlobUrl(p);
  }
}
