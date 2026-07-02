import { authMediaHeaders } from "./authToken";
import { canonicalStoragePath, mediaDownloadUrl, mediaUrl } from "./mediaUrl";
import { peekCachedMediaBlobUrl, resolveMediaBlobUrl } from "./mediaImageCache";

function resolveFetchUrl(pathOrUrl: string): string {
  if (pathOrUrl.startsWith("blob:")) return pathOrUrl;
  const normalized = mediaUrl(pathOrUrl);
  if (normalized) return normalized;
  if (pathOrUrl.startsWith("http://") || pathOrUrl.startsWith("https://")) return pathOrUrl;
  throw new Error("Invalid media URL");
}

function triggerBlobDownload(blobUrl: string, fileName?: string | null): void {
  const a = document.createElement("a");
  a.href = blobUrl;
  a.download = fileName?.trim() || "download";
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** Загрузка медиа только с Bearer-сессией; сервер проверяет membership в чате. */
export async function fetchAuthenticatedMedia(pathOrUrl: string, init?: RequestInit): Promise<Response> {
  const url = resolveFetchUrl(pathOrUrl);
  return fetch(url, {
    ...init,
    credentials: "same-origin",
    headers: {
      ...authMediaHeaders(),
      ...(init?.headers ?? {}),
    },
  });
}

export async function downloadMediaFile(pathOrUrl: string, fileName?: string | null): Promise<void> {
  if (pathOrUrl.startsWith("blob:")) {
    triggerBlobDownload(pathOrUrl, fileName);
    return;
  }

  const cached = peekCachedMediaBlobUrl(pathOrUrl);
  if (cached) {
    triggerBlobDownload(cached, fileName);
    return;
  }

  const storagePath = canonicalStoragePath(pathOrUrl);
  const resolved = storagePath.startsWith("/uploads/") ? await resolveMediaBlobUrl(storagePath) : "";
  if (resolved) {
    triggerBlobDownload(resolved, fileName);
    return;
  }

  let url: string;
  if (pathOrUrl.startsWith("http://") || pathOrUrl.startsWith("https://")) {
    url = pathOrUrl.includes("download=") ? pathOrUrl : mediaDownloadUrl(pathOrUrl, fileName) || pathOrUrl;
  } else {
    const base = resolveFetchUrl(pathOrUrl);
    url = mediaDownloadUrl(base, fileName) || base;
  }
  const res = await fetchAuthenticatedMedia(url);
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  const blob = await res.blob();
  const blobUrl = URL.createObjectURL(blob);
  try {
    triggerBlobDownload(blobUrl, fileName);
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
}
