import type { User } from "@melon/shared";
import { compareMessageId } from "./chatUnread";

export function isMessageReadByCursor(
  messageId: string,
  lastReadMessageId: string | null | undefined,
  lastReadUpdatedAt?: string | null,
  messageCreatedAt?: string | null
): boolean {
  if (!lastReadMessageId?.trim()) return false;
  if (compareMessageId(lastReadMessageId, messageId) < 0) return false;
  if (messageCreatedAt && lastReadUpdatedAt) {
    const msgAt = Date.parse(messageCreatedAt);
    const curAt = Date.parse(lastReadUpdatedAt);
    if (Number.isFinite(msgAt) && Number.isFinite(curAt) && msgAt > curAt) {
      return false;
    }
  }
  return true;
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
  const senderKey = senderId.toLowerCase();
  return members
    .filter((m) => m.id.toLowerCase() !== senderKey)
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
