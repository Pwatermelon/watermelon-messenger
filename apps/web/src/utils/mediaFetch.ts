import { authMediaHeaders } from "./authToken";
import { mediaDownloadUrl, mediaUrl } from "./mediaUrl";

function resolveFetchUrl(pathOrUrl: string): string {
  if (pathOrUrl.startsWith("blob:")) return pathOrUrl;
  const normalized = mediaUrl(pathOrUrl);
  if (normalized) return normalized;
  if (pathOrUrl.startsWith("http://") || pathOrUrl.startsWith("https://")) return pathOrUrl;
  throw new Error("Invalid media URL");
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
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = fileName?.trim() || "download";
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
}
