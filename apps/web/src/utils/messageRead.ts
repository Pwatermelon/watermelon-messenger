import type { User } from "@melon/shared";
import { compareMessageId } from "@melon/shared";

/** Прочитано, если курсор peer >= id сообщения (как в Telegram/WhatsApp). */
export function isMessageReadByCursor(
  messageId: string,
  lastReadMessageId: string | null | undefined
): boolean {
  if (!lastReadMessageId?.trim()) return false;
  return compareMessageId(lastReadMessageId, messageId) >= 0;
}

export type MessageReader = {
  id: string;
  username: string;
  avatarUrl?: string | null;
};

function readCursorForUser(readCursors: Record<string, string>, userId: string): string | undefined {
  const key = userId.trim().toLowerCase();
  return readCursors[key] ?? readCursors[userId];
}

export function getMessageReaders(
  messageId: string,
  senderId: string,
  members: User[],
  readCursors: Record<string, string>
): MessageReader[] {
  const senderKey = senderId.trim().toLowerCase();
  if (!senderKey) return [];
  return members
    .filter((m) => m.id.trim().toLowerCase() !== senderKey)
    .filter((m) => isMessageReadByCursor(messageId, readCursorForUser(readCursors, m.id)))
    .map((m) => ({
      id: m.id,
      username: m.username,
      avatarUrl: m.avatarUrl,
    }));
}

export function isMessageReadByAnyPeer(
  messageId: string,
  senderId: string,
  members: User[],
  readCursors: Record<string, string>
): boolean {
  return getMessageReaders(messageId, senderId, members, readCursors).length > 0;
}

/** Обновить курсор только если incoming >= current. */
export function mergeReadCursor(
  current: string | undefined,
  incoming: string
): string {
  const inc = incoming.trim().toLowerCase();
  if (!current) return inc;
  return compareMessageId(inc, current) >= 0 ? inc : current.trim().toLowerCase();
}
