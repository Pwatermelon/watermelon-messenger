import type { User } from "@melon/shared";
import { compareMessageId } from "./chatUnread";

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
  return readCursors[userId] ?? readCursors[userId.toLowerCase()];
}

/** Peers who read the message; the sender is never counted as a reader. */
export function getMessageReaders(
  messageId: string,
  senderId: string,
  members: User[],
  readCursors: Record<string, string>
): MessageReader[] {
  const senderKey = senderId.toLowerCase();
  return members
    .filter((m) => m.id.toLowerCase() !== senderKey)
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
