import type { Message } from "@melon/shared";
import { canonicalStoragePath } from "./mediaUrl";

function normContent(s: string): string {
  return s.trim();
}

function pendingHasAttachment(m: Message): boolean {
  return Boolean(m.attachmentUrl?.trim() || (m.attachmentMetadata?.attachments?.length ?? 0) > 0);
}

function serverAttachmentKey(m: Message): string | null {
  const url = m.attachmentUrl?.trim();
  if (!url) return null;
  return canonicalStoragePath(url) || url;
}

/** Найти pending-сообщение, которое соответствует ответу сервера (не «первое попавшееся»). */
export function findPendingMessageForServer(prev: Message[], serverMsg: Message): number {
  const senderKey = serverMsg.senderId.trim().toLowerCase();
  const smt = serverMsg.messageType ?? "text";
  const serverAttach = serverAttachmentKey(serverMsg);

  let fallback = -1;

  for (let i = 0; i < prev.length; i++) {
    const m = prev[i]!;
    if (!m.clientPending) continue;
    if (m.senderId.trim().toLowerCase() !== senderKey) continue;
    if (fallback < 0) fallback = i;

    const mt = m.messageType ?? "text";
    if (mt !== smt) continue;

    if (smt === "text" && !serverAttach && !pendingHasAttachment(m)) {
      if (normContent(m.content) === normContent(serverMsg.content)) return i;
      continue;
    }

    if (smt === "sticker" || smt === "location") {
      if (normContent(m.content) === normContent(serverMsg.content)) return i;
      continue;
    }

    if (smt === "image" && (serverMsg.attachmentMetadata?.attachments?.length ?? 0) > 1) {
      if (normContent(m.content) === normContent(serverMsg.content)) return i;
      continue;
    }

    if (serverAttach || pendingHasAttachment(m)) {
      const pendingPath = m.attachmentUrl?.startsWith("blob:")
        ? null
        : m.attachmentUrl
          ? canonicalStoragePath(m.attachmentUrl) || m.attachmentUrl
          : null;
      if (pendingPath && serverAttach && pendingPath === serverAttach) return i;
      if (!pendingPath || m.attachmentUrl?.startsWith("blob:")) return i;
    }
  }

  return fallback;
}
