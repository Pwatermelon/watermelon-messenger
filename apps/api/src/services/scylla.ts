/**
 * ScyllaDB/Cassandra client for message storage.
 * Messages are append-only, time-ordered — ideal for ScyllaDB.
 */
import { Client, types } from "cassandra-driver";
import type { MessageType, AttachmentMetadata } from "@melon/shared";
import { decryptAtRest, encryptAtRest } from "../crypto/atRest";

const contactPoints = (process.env.SCYLLA_CONTACT_POINTS ?? "127.0.0.1").split(",");
const keyspace = process.env.SCYLLA_KEYSPACE ?? "melon";

export const scyllaClient = new Client({
  contactPoints,
  localDataCenter: process.env.SCYLLA_DATACENTER ?? "datacenter1",
  keyspace,
});

const MESSAGES_TABLE = "messages";

export async function initScylla(): Promise<void> {
  const adminClient = new Client({
    contactPoints,
    localDataCenter: process.env.SCYLLA_DATACENTER ?? "datacenter1",
  });
  await adminClient.execute(`
    CREATE KEYSPACE IF NOT EXISTS ${keyspace}
    WITH replication = {'class': 'SimpleStrategy', 'replication_factor': 1}
  `);
  await adminClient.execute(`
    CREATE TABLE IF NOT EXISTS ${keyspace}.${MESSAGES_TABLE} (
      chat_id uuid,
      message_id timeuuid,
      sender_id uuid,
      content text,
      created_at timestamp,
      message_type text,
      attachment_url text,
      attachment_metadata text,
      encrypted boolean,
      PRIMARY KEY (chat_id, message_id)
    ) WITH CLUSTERING ORDER BY (message_id DESC)
  `);
  try {
    await adminClient.execute(`ALTER TABLE ${keyspace}.${MESSAGES_TABLE} ADD message_type text`);
  } catch {}
  try {
    await adminClient.execute(`ALTER TABLE ${keyspace}.${MESSAGES_TABLE} ADD attachment_url text`);
  } catch {}
  try {
    await adminClient.execute(`ALTER TABLE ${keyspace}.${MESSAGES_TABLE} ADD attachment_metadata text`);
  } catch {}
  try {
    await adminClient.execute(`ALTER TABLE ${keyspace}.${MESSAGES_TABLE} ADD encrypted boolean`);
  } catch {}
  try {
    await adminClient.execute(`ALTER TABLE ${keyspace}.${MESSAGES_TABLE} ADD edited_at timestamp`);
  } catch {}
  await adminClient.shutdown();
}

export interface MessageRow {
  chat_id: string;
  message_id: string;
  sender_id: string;
  content: string;
  created_at: Date;
  message_type?: string | null;
  attachment_url?: string | null;
  attachment_metadata?: string | null;
  encrypted?: boolean | null;
  edited_at?: Date | null;
}

const insertQuery = `INSERT INTO ${MESSAGES_TABLE} (chat_id, message_id, sender_id, content, created_at, message_type, attachment_url, attachment_metadata, encrypted)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;

const selectQuery = `SELECT chat_id, message_id, sender_id, content, created_at, message_type, attachment_url, attachment_metadata, encrypted, edited_at
  FROM ${MESSAGES_TABLE} WHERE chat_id = ? LIMIT ?`;
const selectFromQuery = `SELECT chat_id, message_id, sender_id, content, created_at, message_type, attachment_url, attachment_metadata, encrypted, edited_at
  FROM ${MESSAGES_TABLE} WHERE chat_id = ? AND message_id < ? LIMIT ?`;
const selectOneQuery = `SELECT chat_id, message_id, sender_id, content, created_at, message_type, attachment_url, attachment_metadata, encrypted, edited_at
  FROM ${MESSAGES_TABLE} WHERE chat_id = ? AND message_id = ?`;
const deleteOneQuery = `DELETE FROM ${MESSAGES_TABLE} WHERE chat_id = ? AND message_id = ?`;
const deleteByChatQuery = `DELETE FROM ${MESSAGES_TABLE} WHERE chat_id = ?`;
const updateContentQuery = `UPDATE ${MESSAGES_TABLE} SET content = ?, edited_at = ? WHERE chat_id = ? AND message_id = ?`;

const UNREAD_PAGE_SIZE = 250;

function senderIdFromRow(row: { sender_id?: { toString(): string } | string }): string {
  return String(row.sender_id?.toString?.() ?? row.sender_id).toLowerCase();
}

function countOthersInRows(rows: { sender_id?: { toString(): string } | string }[], viewerId: string): number {
  const vid = viewerId.toLowerCase();
  let count = 0;
  for (const row of rows) {
    if (senderIdFromRow(row) !== vid) count++;
  }
  return count;
}

export interface InsertMessageOpts {
  messageType?: MessageType;
  attachmentUrl?: string | null;
  attachmentMetadata?: AttachmentMetadata | null;
  encrypted?: boolean;
}

export async function insertMessage(
  chatId: string,
  senderId: string,
  content: string,
  opts: InsertMessageOpts = {}
): Promise<{ messageId: string; createdAt: Date }> {
  const id = types.TimeUuid.now();
  const createdAt = id.getDate();
  const messageType = opts.messageType ?? "text";
  const attachmentUrl = opts.attachmentUrl ?? null;
  const attachmentMetadata =
    opts.attachmentMetadata != null ? encryptAtRest(JSON.stringify(opts.attachmentMetadata)) : null;
  const encrypted = opts.encrypted ?? false;
  const storedContent = encryptAtRest(content);
  await scyllaClient.execute(
    insertQuery,
    [chatId, id, senderId, storedContent, createdAt, messageType, attachmentUrl, attachmentMetadata, encrypted],
    { prepare: true }
  );
  return { messageId: id.toString(), createdAt };
}

export async function getMessages(
  chatId: string,
  limit: number,
  beforeMessageId?: string
): Promise<MessageRow[]> {
  const params = beforeMessageId ? [chatId, beforeMessageId, limit] : [chatId, limit];
  const query = beforeMessageId ? selectFromQuery : selectQuery;

  let result;
  try {
    result = await scyllaClient.execute(query, params, { prepare: true });
  } catch (err) {
    console.warn("[Scylla] getMessages failed:", err);
    // В dev/локально не роняем всё приложение — просто считаем, что сообщений нет.
    return [];
  }
  return result.rows.map((row) => {
    let attachment_metadata: string | null = null;
    try {
      if (row.attachment_metadata != null) attachment_metadata = decryptAtRest(String(row.attachment_metadata));
    } catch {}
    return {
      chat_id: row.chat_id?.toString(),
      message_id: row.message_id?.toString(),
      sender_id: row.sender_id?.toString(),
      content: decryptAtRest(String(row.content)),
      created_at: row.created_at,
      message_type: row.message_type != null ? String(row.message_type) : null,
      attachment_url: row.attachment_url != null ? String(row.attachment_url) : null,
      attachment_metadata,
      encrypted: row.encrypted === true,
      edited_at: row.edited_at ?? null,
    };
  }) as MessageRow[];
}

function mapRow(row: {
  chat_id?: { toString(): string } | string;
  message_id?: { toString(): string } | string;
  sender_id?: { toString(): string } | string;
  content?: unknown;
  created_at?: Date;
  message_type?: unknown;
  attachment_url?: unknown;
  attachment_metadata?: unknown;
  encrypted?: boolean | null;
  edited_at?: Date | null;
}): MessageRow {
  let attachment_metadata: string | null = null;
  try {
    if (row.attachment_metadata != null) attachment_metadata = decryptAtRest(String(row.attachment_metadata));
  } catch {}
  return {
    chat_id: row.chat_id?.toString?.() ?? String(row.chat_id),
    message_id: row.message_id?.toString?.() ?? String(row.message_id),
    sender_id: row.sender_id?.toString?.() ?? String(row.sender_id),
    content: decryptAtRest(String(row.content)),
    created_at: row.created_at as Date,
    message_type: row.message_type != null ? String(row.message_type) : null,
    attachment_url: row.attachment_url != null ? String(row.attachment_url) : null,
    attachment_metadata,
    encrypted: row.encrypted === true,
    edited_at: row.edited_at ?? null,
  };
}

export async function getMessage(chatId: string, messageId: string): Promise<MessageRow | null> {
  try {
    const result = await scyllaClient.execute(selectOneQuery, [chatId, messageId], { prepare: true });
    const row = result.rows[0];
    if (!row) return null;
    return mapRow(row);
  } catch (err) {
    console.warn("[Scylla] getMessage failed:", err);
    return null;
  }
}

export async function countUnreadMessages(
  chatId: string,
  lastReadMessageId: string | null,
  viewerId: string
): Promise<number> {
  try {
    if (!lastReadMessageId) {
      let total = 0;
      let upperExclusive: types.TimeUuid | null = null;
      for (;;) {
        const query = upperExclusive
          ? `SELECT message_id, sender_id FROM ${MESSAGES_TABLE} WHERE chat_id = ? AND message_id < ? LIMIT ?`
          : `SELECT message_id, sender_id FROM ${MESSAGES_TABLE} WHERE chat_id = ? LIMIT ?`;
        const params = upperExclusive
          ? [chatId, upperExclusive, UNREAD_PAGE_SIZE]
          : [chatId, UNREAD_PAGE_SIZE];
        const result = await scyllaClient.execute(query, params, { prepare: true });
        const rows = result.rows;
        if (!rows.length) break;
        total += countOthersInRows(rows, viewerId);
        if (rows.length < UNREAD_PAGE_SIZE) break;
        upperExclusive = rows[rows.length - 1]!.message_id as types.TimeUuid;
      }
      return total;
    }

    const lowerExclusive = types.TimeUuid.fromString(lastReadMessageId.trim().toLowerCase());
    let total = 0;
    let upperExclusive: types.TimeUuid | null = null;
    for (;;) {
      const query = upperExclusive
        ? `SELECT message_id, sender_id FROM ${MESSAGES_TABLE} WHERE chat_id = ? AND message_id > ? AND message_id < ? LIMIT ?`
        : `SELECT message_id, sender_id FROM ${MESSAGES_TABLE} WHERE chat_id = ? AND message_id > ? LIMIT ?`;
      const params = upperExclusive
        ? [chatId, lowerExclusive, upperExclusive, UNREAD_PAGE_SIZE]
        : [chatId, lowerExclusive, UNREAD_PAGE_SIZE];
      const result = await scyllaClient.execute(query, params, { prepare: true });
      const rows = result.rows;
      if (!rows.length) break;
      total += countOthersInRows(rows, viewerId);
      if (rows.length < UNREAD_PAGE_SIZE) break;
      upperExclusive = rows[rows.length - 1]!.message_id as types.TimeUuid;
    }
    return total;
  } catch (err) {
    console.warn("[Scylla] countUnreadMessages failed:", err);
    return 0;
  }
}

export async function updateMessageContent(
  chatId: string,
  messageId: string,
  content: string
): Promise<Date> {
  const editedAt = new Date();
  const storedContent = encryptAtRest(content);
  try {
    await scyllaClient.execute(
      updateContentQuery,
      [storedContent, editedAt, chatId, messageId],
      { prepare: true }
    );
  } catch (err) {
    console.warn("[Scylla] updateMessageContent failed:", err);
    throw err;
  }
  return editedAt;
}

export async function deleteMessage(chatId: string, messageId: string): Promise<void> {
  try {
    await scyllaClient.execute(deleteOneQuery, [chatId, messageId], { prepare: true });
  } catch (err) {
    console.warn("[Scylla] deleteMessage failed:", err);
    throw err;
  }
}

export async function deleteChatMessages(chatId: string): Promise<void> {
  try {
    await scyllaClient.execute(deleteByChatQuery, [chatId], { prepare: true });
  } catch (err) {
    console.warn("[Scylla] deleteChatMessages failed:", err);
  }
}
