import type { Message, User } from "@melon/shared";
import { compareMessageId } from "@melon/shared";
import { isMessageReadByAnyPeer } from "./messageRead";
import { isMessageVisibleInViewport } from "./chatUnread";
import { isPinnedToBottom } from "./messageListScroll";

function isCountable(m: Message): boolean {
  return (m.messageType ?? "text") !== "system";
}

/** Последнее сообщение в ленте (любой отправитель), без system. */
export function lastCountableMessageId(messages: Message[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (!isCountable(m)) continue;
    return m.id;
  }
  return null;
}

/**
 * До какого сообщения помечать чат прочитанным.
 * Внизу — всё видно → курсор на последнее сообщение в чате.
 * При скролле вверх — только видимые входящие.
 */
export function resolveMarkReadTarget(
  messages: Message[],
  listEl: HTMLElement,
  userId: string,
  bottomSlack = 16,
  viewportMargin = 8
): string | null {
  if (!messages.length) return null;
  const userKey = userId.toLowerCase();

  if (isPinnedToBottom(listEl, bottomSlack)) {
    return lastCountableMessageId(messages);
  }

  let best: string | null = null;
  for (const m of messages) {
    if (!isCountable(m)) continue;
    if (m.senderId.toLowerCase() === userKey) continue;
    if (!isMessageVisibleInViewport(listEl, m.id, viewportMargin)) continue;
    if (!best || compareMessageId(m.id, best) > 0) best = m.id;
  }
  return best;
}

export function chatMembersForReadReceipts(
  chat: { type?: string; members?: User[] } | null | undefined,
  selfUser: Pick<User, "id" | "username" | "avatarUrl"> | null | undefined,
  readCursors: Record<string, string>
): User[] {
  if (chat?.members?.length) return chat.members;
  if (chat?.type === "dm" && selfUser?.id) {
    const selfKey = selfUser.id.toLowerCase();
    const peerKey = Object.keys(readCursors).find((k) => k !== selfKey);
    if (peerKey) {
      return [
        {
          id: selfUser.id,
          username: selfUser.username ?? "?",
          avatarUrl: selfUser.avatarUrl ?? null,
        } as User,
        { id: peerKey, username: "?", avatarUrl: null } as User,
      ];
    }
  }
  return chat?.members ?? [];
}

/** 🍉 на своём сообщении: peer cursor >= id сообщения (TimeUUID). */
export function isOwnMessageReadByPeers(
  message: Message,
  senderId: string,
  members: User[],
  readCursors: Record<string, string>
): boolean {
  if (message.clientPending || message.id.startsWith("pending-")) return false;
  return isMessageReadByAnyPeer(message.id, senderId, members, readCursors);
}
