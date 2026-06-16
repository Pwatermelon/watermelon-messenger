import { sql } from "drizzle-orm";
import { db } from "../db";
import type { MessageReaction } from "@melon/shared";

export type ReactionRow = {
  message_id: string;
  user_id: string;
  emoji: string;
  username?: string;
};

function rowsFromExecute<T>(result: unknown): T[] {
  const rows = (result as { rows?: T[] }).rows ?? result;
  return Array.isArray(rows) ? (rows as T[]) : [];
}

export async function setMessageReaction(
  chatId: string,
  messageId: string,
  userId: string,
  emoji: string | null
): Promise<MessageReaction[]> {
  const normalized = messageId.trim().toLowerCase();
  if (emoji) {
    const e = emoji.trim();
    if (!e) {
      await db.execute(sql`
        DELETE FROM message_reactions
        WHERE chat_id = ${chatId}::uuid AND message_id = ${normalized} AND user_id = ${userId}::uuid
      `);
    } else {
      await db.execute(sql`
        INSERT INTO message_reactions (chat_id, message_id, user_id, emoji, created_at)
        VALUES (${chatId}::uuid, ${normalized}, ${userId}::uuid, ${e}, now())
        ON CONFLICT (message_id, user_id) DO UPDATE SET emoji = EXCLUDED.emoji, created_at = now()
      `);
    }
  } else {
    await db.execute(sql`
      DELETE FROM message_reactions
      WHERE chat_id = ${chatId}::uuid AND message_id = ${normalized} AND user_id = ${userId}::uuid
    `);
  }
  return getMessageReactions(normalized);
}

export async function getMessageReactions(messageId: string): Promise<MessageReaction[]> {
  const normalized = messageId.trim().toLowerCase();
  const result = await db.execute<{ message_id: string; user_id: string; emoji: string; username: string }>(sql`
    SELECT r.message_id, r.user_id, r.emoji, u.username
    FROM message_reactions r
    INNER JOIN users u ON u.id = r.user_id
    WHERE r.message_id = ${normalized}
    ORDER BY r.created_at ASC
  `);
  return rowsFromExecute(result).map((r) => ({
    emoji: String(r.emoji),
    userId: String(r.user_id),
    username: String(r.username),
  }));
}

export async function getReactionsForMessages(
  messageIds: string[]
): Promise<Record<string, MessageReaction[]>> {
  const ids = [...new Set(messageIds.map((id) => id.trim().toLowerCase()).filter(Boolean))];
  const out: Record<string, MessageReaction[]> = {};
  await Promise.all(
    ids.map(async (id) => {
      const reactions = await getMessageReactions(id);
      if (reactions.length) out[id] = reactions;
    })
  );
  return out;
}
