import { eq, inArray } from "drizzle-orm";
import type { AttachmentMetadata, ChatSharedCategory, ChatSharedItem, MessageType } from "@melon/shared";
import { db, users } from "../db";
import { toPublicProfile } from "../lib/userDto";
import { signAttachmentMetadata, signMediaPath, signUserMedia } from "./mediaAccess";
import { getMessages as scyllaGetMessages } from "./scylla";

const URL_RE = /(?:https?:\/\/|www\.)[^\s<]+/gi;

function extractUrls(text: string): string[] {
  const urls: string[] = [];
  const re = new RegExp(URL_RE.source, "gi");
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const raw = match[0].replace(/[.,;:!?)\]}>]+$/, "");
    if (raw) urls.push(raw.startsWith("www.") ? `https://${raw}` : raw);
  }
  return urls;
}

function parseAttachmentMetadata(raw: string | null | undefined): AttachmentMetadata | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AttachmentMetadata;
  } catch {
    return null;
  }
}

type RawSharedItem = {
  messageId: string;
  messageType: MessageType;
  attachmentUrl: string | null;
  attachmentMetadata: AttachmentMetadata | null;
  content: string;
  createdAt: string;
  senderId: string;
  links?: string[];
};

function expandMessage(
  row: {
    message_id: string;
    sender_id: string;
    content: string;
    created_at: Date;
    message_type?: string | null;
    attachment_url?: string | null;
    attachment_metadata?: string | null;
  },
  category: ChatSharedCategory
): RawSharedItem[] {
  const mt = (row.message_type as MessageType) ?? "text";
  const meta = parseAttachmentMetadata(row.attachment_metadata);
  const base = {
    messageId: row.message_id,
    content: row.content,
    createdAt: row.created_at?.toISOString?.() ?? new Date().toISOString(),
    senderId: row.sender_id,
    attachmentMetadata: meta,
  };

  if (category === "links") {
    const urls = extractUrls(row.content);
    if (urls.length === 0) return [];
    return urls.map((url) => ({
      ...base,
      messageType: "text" as MessageType,
      attachmentUrl: null,
      links: [url],
    }));
  }

  if (category === "voice") {
    if (mt !== "voice" && mt !== "circle") return [];
    return [
      {
        ...base,
        messageType: mt,
        attachmentUrl: row.attachment_url ?? null,
      },
    ];
  }

  if (category === "files") {
    if (mt !== "file") return [];
    return [
      {
        ...base,
        messageType: mt,
        attachmentUrl: row.attachment_url ?? null,
      },
    ];
  }

  if (category === "media") {
    if (mt === "circle") return [];
    if (mt === "video") {
      return [
        {
          ...base,
          messageType: mt,
          attachmentUrl: row.attachment_url ?? null,
        },
      ];
    }
    if (mt === "image") {
      const album = meta?.attachments;
      if (album?.length) {
        return album.map((a) => ({
          ...base,
          messageType: "image" as MessageType,
          attachmentUrl: a.url,
          attachmentMetadata: {
            ...meta,
            fileName: a.fileName ?? meta?.fileName,
            mimeType: a.mimeType ?? meta?.mimeType,
            size: a.size ?? meta?.size,
          },
        }));
      }
      if (row.attachment_url) {
        return [
          {
            ...base,
            messageType: mt,
            attachmentUrl: row.attachment_url,
          },
        ];
      }
    }
  }

  return [];
}

async function toSharedItem(
  raw: RawSharedItem,
  viewerId: string,
  sender?: Awaited<ReturnType<typeof signUserMedia<ReturnType<typeof toPublicProfile>>>>
): Promise<ChatSharedItem> {
  const attachmentUrl = raw.attachmentUrl
    ? (await signMediaPath(raw.attachmentUrl, viewerId)) ?? raw.attachmentUrl
    : null;
  const attachmentMetadata =
    (await signAttachmentMetadata(raw.attachmentMetadata, viewerId)) ?? raw.attachmentMetadata;
  return {
    messageId: raw.messageId,
    messageType: raw.messageType,
    attachmentUrl,
    attachmentMetadata,
    content: raw.content,
    createdAt: raw.createdAt,
    sender,
    links: raw.links,
  };
}

export async function getChatSharedItems(
  chatId: string,
  viewerId: string,
  category: ChatSharedCategory,
  limit: number,
  beforeMessageId?: string
): Promise<{ items: ChatSharedItem[]; hasMore: boolean }> {
  const cap = Math.min(Math.max(limit, 1), 60);
  const collected: RawSharedItem[] = [];
  let cursor = beforeMessageId;
  const batchSize = 80;
  const maxScan = 2400;
  let scanned = 0;
  let exhausted = false;

  while (collected.length < cap && scanned < maxScan) {
    const rows = await scyllaGetMessages(chatId, batchSize, cursor);
    if (rows.length === 0) {
      exhausted = true;
      break;
    }
    scanned += rows.length;
    for (const row of rows) {
      const expanded = expandMessage(row, category);
      for (const item of expanded) {
        collected.push(item);
        if (collected.length >= cap) break;
      }
      if (collected.length >= cap) break;
    }
    cursor = rows[rows.length - 1]?.message_id;
    if (rows.length < batchSize) {
      exhausted = true;
      break;
    }
  }

  const senderIds = [...new Set(collected.map((c) => c.senderId))];
  const senderRows =
    senderIds.length > 0 ? await db.select().from(users).where(inArray(users.id, senderIds)) : [];
  const senderById = new Map(
    await Promise.all(
      senderRows.map(async (u) => [u.id, await signUserMedia(toPublicProfile(u), viewerId)] as const)
    )
  );

  const items = await Promise.all(
    collected.map((raw) => toSharedItem(raw, viewerId, senderById.get(raw.senderId)))
  );

  return { items, hasMore: !exhausted && items.length >= cap };
}
