import type { Message, MessageAttachment } from "@melon/shared";
import { canonicalStoragePath } from "./mediaUrl";

export const MAX_ATTACHMENTS_PER_MESSAGE = 5;

export function isGifAttachment(a: Pick<MessageAttachment, "url" | "mimeType">): boolean {
  return a.mimeType === "image/gif" || /\.gif$/i.test(a.url.split("?")[0] ?? "");
}

export function isVideoAttachment(a: Pick<MessageAttachment, "url" | "mimeType">): boolean {
  if (a.mimeType?.startsWith("video/")) return true;
  return /\.(mp4|webm|mov|m4v|mkv)(\?|$)/i.test(a.url.split("?")[0] ?? "");
}

export function isAlbumImageFile(file: File): boolean {
  if (file.type === "image/gif" || /\.gif$/i.test(file.name)) return true;
  if (!file.type.startsWith("image/")) return false;
  return !file.type.includes("svg");
}

export function isVideoFile(file: File): boolean {
  return file.type.startsWith("video/");
}

/** Фото, GIF и видео из модалки отправки — одним сообщением (до 5 вложений). */
export function isMediaAlbumFile(file: File): boolean {
  return isAlbumImageFile(file) || isVideoFile(file);
}

export async function fileLooksLikeGif(file: File): Promise<boolean> {
  if (file.type === "image/gif" || /\.gif$/i.test(file.name)) return true;
  try {
    const head = new Uint8Array(await file.slice(0, 3).arrayBuffer());
    return head[0] === 0x47 && head[1] === 0x49 && head[2] === 0x46;
  } catch {
    return false;
  }
}

export function getMessageAttachments(m: Pick<Message, "attachmentUrl" | "attachmentMetadata">): MessageAttachment[] {
  const list = m.attachmentMetadata?.attachments;
  if (list?.length) return list;
  if (m.attachmentUrl) {
    return [
      {
        url: m.attachmentUrl,
        fileName: m.attachmentMetadata?.fileName,
        mimeType: m.attachmentMetadata?.mimeType,
        size: m.attachmentMetadata?.size,
        width: m.attachmentMetadata?.width,
        height: m.attachmentMetadata?.height,
        posterUrl: m.attachmentMetadata?.posterUrl ?? undefined,
        duration: m.attachmentMetadata?.duration,
      },
    ];
  }
  return [];
}

export function collectMessageMediaPaths(m: Pick<Message, "attachmentUrl" | "attachmentMetadata">): string[] {
  const paths: string[] = [];
  for (const a of getMessageAttachments(m)) {
    if (a.url && !paths.includes(a.url)) paths.push(a.url);
    if (a.posterUrl && !paths.includes(a.posterUrl)) paths.push(a.posterUrl);
  }
  const poster = m.attachmentMetadata?.posterUrl;
  if (poster && !paths.includes(poster)) paths.push(poster);
  return paths;
}

export function applySignedPathsToMessage(m: Message, signed: Record<string, string>): Message {
  const resolve = (path: string | null | undefined): string | null | undefined => {
    if (!path) return path;
    if (signed[path]) return signed[path];
    const canonical = canonicalStoragePath(path);
    if (signed[canonical]) return signed[canonical];
    return path;
  };

  let attachmentUrl = resolve(m.attachmentUrl) ?? m.attachmentUrl;

  let attachmentMetadata = m.attachmentMetadata;
  if (attachmentMetadata) {
    attachmentMetadata = {
      ...attachmentMetadata,
      ...(attachmentMetadata.posterUrl
        ? { posterUrl: resolve(attachmentMetadata.posterUrl) ?? attachmentMetadata.posterUrl }
        : {}),
      ...(attachmentMetadata.attachments?.length
        ? {
            attachments: attachmentMetadata.attachments.map((a) => ({
              ...a,
              url: resolve(a.url) ?? a.url,
              ...(a.posterUrl ? { posterUrl: resolve(a.posterUrl) ?? a.posterUrl } : {}),
            })),
          }
        : {}),
    };
  }

  return { ...m, attachmentUrl, attachmentMetadata };
}

export function chunkFiles<T>(files: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < files.length; i += size) out.push(files.slice(i, i + size));
  return out;
}

export function mediaBatchFallbackLabel(files: File[]): string {
  if (files.length === 0) return "Медиа";
  if (files.length === 1) {
    const f = files[0]!;
    if (isVideoFile(f)) return "Видео";
    if (f.type === "image/gif" || /\.gif$/i.test(f.name)) return "GIF";
    if (isAlbumImageFile(f)) return "Фотография";
    return f.name || "Файл";
  }
  let photos = 0;
  let videos = 0;
  for (const f of files) {
    if (isVideoFile(f)) videos += 1;
    else if (isAlbumImageFile(f)) photos += 1;
  }
  if (photos && videos) {
    const parts: string[] = [];
    if (photos) parts.push(`${photos} фото`);
    if (videos) parts.push(`${videos} видео`);
    return parts.join(" и ");
  }
  if (videos) return `${videos} видео`;
  if (photos) return `${photos} фото`;
  return `${files.length} медиа`;
}

export type MediaBatchPart =
  | { kind: "album"; files: File[]; withReply: boolean; caption?: string }
  | { kind: "single"; file: File; withReply: boolean; caption?: string };

/** Фото и видео из одной модалки — одно сообщение (до 5 вложений), порядок выбора сохраняется. */
export function planMediaBatchParts(files: File[], caption?: string): MediaBatchPart[] {
  const media: File[] = [];
  const other: File[] = [];
  for (const f of files) {
    if (isMediaAlbumFile(f)) media.push(f);
    else other.push(f);
  }
  const trimmedCaption = caption?.trim() || undefined;
  const parts: MediaBatchPart[] = [];
  const chunks = chunkFiles(media, MAX_ATTACHMENTS_PER_MESSAGE);
  let first = true;
  for (const chunk of chunks) {
    if (chunk.length === 0) continue;
    parts.push({
      kind: "album",
      files: chunk,
      withReply: first,
      caption: first ? trimmedCaption : undefined,
    });
    first = false;
  }
  for (const file of other) {
    parts.push({
      kind: "single",
      file,
      withReply: first,
      caption: first ? trimmedCaption : undefined,
    });
    first = false;
  }
  return parts;
}
