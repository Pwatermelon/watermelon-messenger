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

export function getMessageReaders(
  messageId: string,
  members: User[],
  readCursors: Record<string, string>,
  excludeUserId?: string
): MessageReader[] {
  return members
    .filter((m) => m.id !== excludeUserId)
    .filter((m) => isMessageReadByCursor(messageId, readCursors[m.id]))
    .map((m) => ({
      id: m.id,
      username: m.username,
      avatarUrl: m.avatarUrl,
    }));
}

export function isMessageReadByAnyPeer(
  messageId: string,
  members: User[],
  readCursors: Record<string, string>,
  excludeUserId?: string
): boolean {
  return getMessageReaders(messageId, members, readCursors, excludeUserId).length > 0;
}
