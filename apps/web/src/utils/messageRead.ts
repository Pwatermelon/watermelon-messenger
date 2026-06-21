import type { User } from "@melon/shared";
import { compareMessageId } from "./chatUnread";

const READ_SKEW_MS = 2500;

export function isMessageReadByCursor(
  messageId: string,
  lastReadMessageId: string | null | undefined,
  lastReadUpdatedAt?: string | null,
  messageCreatedAt?: string | null
): boolean {
  if (!lastReadMessageId?.trim()) return false;
  const cmp = compareMessageId(lastReadMessageId, messageId);
  if (cmp < 0) return false;

  // Cursor sits on this message — peer explicitly read through it.
  if (cmp === 0) return true;

  // Cursor is ahead: count older messages as read only when read time
  // proves they already existed (guards stale id backfill after retention clamp).
  if (!messageCreatedAt || !lastReadUpdatedAt) return false;
  const msgAt = Date.parse(messageCreatedAt);
  const curAt = Date.parse(lastReadUpdatedAt);
  if (!Number.isFinite(msgAt) || !Number.isFinite(curAt)) return false;
  return curAt + READ_SKEW_MS >= msgAt;
}

export type MessageReader = {
  id: string;
  username: string;
  avatarUrl?: string | null;
};

function readCursorForUser(readCursors: Record<string, string>, userId: string): string | undefined {
  return readCursors[userId] ?? readCursors[userId.toLowerCase()];
}

function readCursorTimeForUser(
  readCursorTimes: Record<string, string> | undefined,
  userId: string
): string | undefined {
  if (!readCursorTimes) return undefined;
  return readCursorTimes[userId] ?? readCursorTimes[userId.toLowerCase()];
}

/** Peers who read the message; the sender is never counted as a reader. */
export function getMessageReaders(
  messageId: string,
  senderId: string,
  members: User[],
  readCursors: Record<string, string>,
  readCursorTimes?: Record<string, string>,
  messageCreatedAt?: string | null
): MessageReader[] {
  const senderKey = senderId.trim().toLowerCase();
  if (!senderKey) return [];
  return members
    .filter((m) => m.id.trim().toLowerCase() !== senderKey)
    .filter((m) =>
      isMessageReadByCursor(
        messageId,
        readCursorForUser(readCursors, m.id),
        readCursorTimeForUser(readCursorTimes, m.id),
        messageCreatedAt
      )
    )
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
  readCursors: Record<string, string>,
  readCursorTimes?: Record<string, string>,
  messageCreatedAt?: string | null
): boolean {
  return (
    getMessageReaders(
      messageId,
      senderId,
      members,
      readCursors,
      readCursorTimes,
      messageCreatedAt
    ).length > 0
  );
}
