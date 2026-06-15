import type { Message } from "@melon/shared";

export type UnreadBounds = {
  first: Message | null;
  last: Message | null;
  count: number;
};

export function compareMessageId(a: string, b: string): number {
  return a.toLowerCase().localeCompare(b.toLowerCase());
}

export function isCountableMessage(m: Message): boolean {
  return (m.messageType ?? "text") !== "system";
}

export function isUnreadIncoming(
  m: Message,
  lastReadMessageId: string | null | undefined,
  userId: string
): boolean {
  if (!isCountableMessage(m)) return false;
  if (m.senderId === userId) return false;
  if (!lastReadMessageId) return false;
  return compareMessageId(m.id, lastReadMessageId) > 0;
}

function listUnreadMessages(
  messages: Message[],
  lastReadMessageId: string | null | undefined,
  userId: string,
  serverUnreadCount: number
): Message[] {
  if (serverUnreadCount <= 0) return [];
  if (!lastReadMessageId) {
    return messages.filter((m) => isCountableMessage(m) && m.senderId !== userId);
  }
  return messages.filter((m) => isUnreadIncoming(m, lastReadMessageId, userId));
}

export function findUnreadBounds(
  messages: Message[],
  lastReadMessageId: string | null | undefined,
  userId: string,
  serverUnreadCount = 0
): UnreadBounds {
  const unread = listUnreadMessages(messages, lastReadMessageId, userId, serverUnreadCount);
  return {
    first: unread[0] ?? null,
    last: unread[unread.length - 1] ?? null,
    count: unread.length,
  };
}

export function countUnreadBelowViewport(
  listEl: HTMLElement,
  messages: Message[],
  lastReadMessageId: string | null | undefined,
  userId: string,
  serverUnreadCount = 0
): number {
  if (serverUnreadCount <= 0) return 0;
  const listBottom = listEl.getBoundingClientRect().bottom - 12;
  let count = 0;
  for (const m of listUnreadMessages(messages, lastReadMessageId, userId, serverUnreadCount)) {
    const el = listEl.querySelector(`[data-message-id="${m.id}"]`);
    if (!el) continue;
    const rect = el.getBoundingClientRect();
    if (rect.top >= listBottom) count += 1;
  }
  return count;
}

export function isMessageBelowViewport(listEl: HTMLElement, messageId: string, margin = 12): boolean {
  const el = listEl.querySelector(`[data-message-id="${messageId}"]`);
  if (!el) return false;
  const listBottom = listEl.getBoundingClientRect().bottom - margin;
  return el.getBoundingClientRect().bottom > listBottom;
}

export function scrollListToMessage(
  listEl: HTMLElement,
  messageId: string,
  block: "start" | "center" | "end" | "nearest" = "center",
  margin = 12
): boolean {
  const el = listEl.querySelector(`[data-message-id="${messageId}"]`) as HTMLElement | null;
  if (!el) return false;

  const listRect = listEl.getBoundingClientRect();
  const elRect = el.getBoundingClientRect();
  const relativeTop = elRect.top - listRect.top + listEl.scrollTop;
  const elHeight = elRect.height;

  if (block === "nearest") {
    if (elRect.top < listRect.top + margin) {
      listEl.scrollTop = Math.max(0, relativeTop - margin);
    } else if (elRect.bottom > listRect.bottom - margin) {
      listEl.scrollTop = Math.max(0, relativeTop + elHeight - listEl.clientHeight + margin);
    }
    return true;
  }

  let target: number;
  if (block === "start") target = relativeTop - margin;
  else if (block === "end") target = relativeTop + elHeight - listEl.clientHeight + margin;
  else target = relativeTop - (listEl.clientHeight - elHeight) / 2;
  listEl.scrollTop = Math.max(0, target);
  return true;
}
