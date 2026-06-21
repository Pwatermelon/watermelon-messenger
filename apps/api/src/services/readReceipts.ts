import { isMessageIdNewer } from "@melon/shared";
import { db } from "../db";
import { sql } from "drizzle-orm";

export type ReadCursorRow = { userId: string; lastReadMessageId: string; updatedAt: string };

function rowsFromExecute<T>(result: unknown): T[] {
  const rows = (result as { rows?: T[] }).rows ?? result;
  return Array.isArray(rows) ? (rows as T[]) : [];
}

function normalizeMessageId(id: string): string {
  return id.trim().toLowerCase();
}

export async function getReadCursors(chatId: string): Promise<ReadCursorRow[]> {
  const result = await db.execute<{
    user_id: string;
    last_read_message_id: string;
    updated_at: Date | string;
  }>(sql`
    SELECT user_id, last_read_message_id, updated_at FROM chat_read_cursors WHERE chat_id = ${chatId}::uuid
  `);
  const list = rowsFromExecute(result);
  return list.map((r) => ({
    userId: String(r.user_id).toLowerCase(),
    lastReadMessageId: String(r.last_read_message_id).trim().toLowerCase(),
    updatedAt:
      r.updated_at instanceof Date
        ? r.updated_at.toISOString()
        : new Date(String(r.updated_at)).toISOString(),
  }));
}

/** Returns whether cursor was advanced and its current state (caller should broadcast). */
export async function upsertReadCursor(
  chatId: string,
  userId: string,
  messageId: string
): Promise<{ advanced: boolean; messageId: string; updatedAt: string }> {
  const normalized = normalizeMessageId(messageId);
  const existing = await db.execute<{ last_read_message_id: string; updated_at: Date | string }>(sql`
    SELECT last_read_message_id, updated_at FROM chat_read_cursors
    WHERE chat_id = ${chatId}::uuid AND user_id = ${userId}::uuid
    LIMIT 1
  `);
  const rows = rowsFromExecute(existing);
  const prev = rows[0] ? String(rows[0].last_read_message_id) : null;
  const prevUpdatedAt = rows[0]?.updated_at
    ? rows[0].updated_at instanceof Date
      ? rows[0].updated_at.toISOString()
      : new Date(String(rows[0].updated_at)).toISOString()
    : new Date().toISOString();

  if (prev && !isMessageIdNewer(normalized, prev)) {
    return { advanced: false, messageId: normalizeMessageId(prev), updatedAt: prevUpdatedAt };
  }

  const updatedAt = new Date().toISOString();
  await db.execute(sql`
    INSERT INTO chat_read_cursors (chat_id, user_id, last_read_message_id, updated_at)
    VALUES (${chatId}::uuid, ${userId}::uuid, ${normalized}, ${updatedAt}::timestamptz)
    ON CONFLICT (chat_id, user_id) DO UPDATE SET
      last_read_message_id = EXCLUDED.last_read_message_id,
      updated_at = EXCLUDED.updated_at
  `);
  return { advanced: !prev || isMessageIdNewer(normalized, prev), messageId: normalized, updatedAt };
}

export async function getUserReadCursorsByChat(userId: string): Promise<Map<string, string>> {
  const result = await db.execute<{ chat_id: string; last_read_message_id: string }>(sql`
    SELECT chat_id, last_read_message_id FROM chat_read_cursors WHERE user_id = ${userId}::uuid
  `);
  const list = rowsFromExecute(result);
  const map = new Map<string, string>();
  for (const r of list) {
    map.set(String(r.chat_id), String(r.last_read_message_id).trim().toLowerCase());
  }
  return map;
}

/** After message retention prune: bump cursors that pointed at deleted messages. */
export async function clampReadCursorsAfterPrune(chatId: string, keepFromMessageId: string): Promise<void> {
  const keep = normalizeMessageId(keepFromMessageId);
  await db.execute(sql`
    UPDATE chat_read_cursors
    SET last_read_message_id = ${keep}
    WHERE chat_id = ${chatId}::uuid
      AND last_read_message_id < ${keep}
  `);
}
