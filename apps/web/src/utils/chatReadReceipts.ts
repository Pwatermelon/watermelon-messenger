import type { Message, User } from "@melon/shared";
import { compareMessageId } from "@melon/shared";
import { isMessageReadByCursor } from "./messageRead";
import { isMessageVisibleInViewport } from "./chatUnread";
import { isPinnedToBottom } from "./messageListScroll";

function isCountable(m: Message): boolean {
  return (m.messageType ?? "text") !== "system";
}

/** Последнее входящее сообщение — курсор «прочитано» не должен прыгать на своё. */
export function lastIncomingMessageId(messages: Message[], userId: string): string | null {
  const userKey = userId.toLowerCase();
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (!isCountable(m)) continue;
    if (m.senderId.toLowerCase() === userKey) continue;
    return m.id;
  }
  return null;
}

/**
 * До какого сообщения помечать чат прочитанным (только СВОЙ курсор, не влияет на 🍉).
 * Внизу — последнее входящее. При скролле вверх — видимые входящие.
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
    return lastIncomingMessageId(messages, userId);
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

export function resolveDmPeerId(
  chat: { type?: string; members?: User[] } | null | undefined,
  selfUserId: string | null | undefined
): string | null {
  if (chat?.type !== "dm" || !selfUserId) return null;
  const selfKey = selfUserId.toLowerCase();
  return chat.members?.find((m) => m.id.toLowerCase() !== selfKey)?.id ?? null;
}

export function chatMembersForReadReceipts(
  chat: { type?: string; members?: User[] } | null | undefined,
  selfUser: Pick<User, "id" | "username" | "avatarUrl"> | null | undefined,
  peerReadCursors: Record<string, string>
): User[] {
  if (chat?.members?.length) return chat.members;
  if (chat?.type === "dm" && selfUser?.id) {
    const selfKey = selfUser.id.toLowerCase();
    const peerKey = Object.keys(peerReadCursors).find((k) => k !== selfKey);
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

function peerCursorUpdatedAfterMessage(
  message: Message,
  peerKey: string,
  peerCursorTimes: Record<string, string>
): boolean {
  const cursorTime = peerCursorTimes[peerKey];
  const msgAt = message.createdAt ? Date.parse(message.createdAt) : NaN;
  if (!cursorTime || !Number.isFinite(msgAt)) return true;
  const curAt = Date.parse(cursorTime);
  if (!Number.isFinite(curAt)) return true;
  return curAt >= msgAt;
}

/** 🍉 в DM: только курсор собеседника с сервера + время обновления >= времени сообщения. */
export function isOwnMessageReadByDmPeer(
  message: Message,
  peerId: string,
  peerReadCursors: Record<string, string>,
  peerReadCursorTimes: Record<string, string>
): boolean {
  if (message.clientPending || message.id.startsWith("pending-")) return false;
  const peerKey = peerId.toLowerCase();
  const cursor = peerReadCursors[peerKey] ?? peerReadCursors[peerId];
  if (!isMessageReadByCursor(message.id, cursor)) return false;
  return peerCursorUpdatedAfterMessage(message, peerKey, peerReadCursorTimes);
}

/** 🍉 в группе: любой другой участник прочитал (с проверкой времени). */
export function isOwnMessageReadByAnyPeer(
  message: Message,
  senderId: string,
  members: User[],
  peerReadCursors: Record<string, string>,
  peerReadCursorTimes: Record<string, string>
): boolean {
  if (message.clientPending || message.id.startsWith("pending-")) return false;
  const senderKey = senderId.toLowerCase();
  for (const mem of members) {
    const memKey = mem.id.toLowerCase();
    if (memKey === senderKey) continue;
    const cursor = peerReadCursors[memKey] ?? peerReadCursors[mem.id];
    if (!isMessageReadByCursor(message.id, cursor)) continue;
    if (!peerCursorUpdatedAfterMessage(message, memKey, peerReadCursorTimes)) continue;
    return true;
  }
  return false;
}
