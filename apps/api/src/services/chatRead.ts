import { getMessage as scyllaGetMessage } from "./scylla";
import { upsertReadCursor } from "./readReceipts";
import { resetUnreadCount } from "./chatUnread";

export async function advanceReadCursor(
  chatId: string,
  userId: string,
  messageId?: string | null
): Promise<{ advanced: boolean; messageId: string | null }> {
  const target = messageId?.trim().toLowerCase() || null;
  if (!target) {
    return { advanced: false, messageId: null };
  }
  const row = await scyllaGetMessage(chatId, target);
  if (!row) {
    return { advanced: false, messageId: null };
  }
  const advanced = await upsertReadCursor(chatId, userId, target);
  if (advanced) {
    await resetUnreadCount(chatId, userId);
  }
  return { advanced, messageId: target };
}
