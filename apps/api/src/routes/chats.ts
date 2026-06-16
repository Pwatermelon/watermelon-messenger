import { Elysia } from "elysia";
import { eq, and, inArray, sql } from "drizzle-orm";
import { authPlugin, requireAuth } from "../auth";
import { db, users, chats, chatMembers } from "../db";
import { getMessages as scyllaGetMessages, getMessage as scyllaGetMessage, deleteMessage as scyllaDeleteMessage, insertMessage as scyllaInsertMessage, deleteChatMessages, updateMessageContent as scyllaUpdateMessageContent } from "../services/scylla";
import { publishChatEvent, kickUserFromChat } from "../ws";
import { notifyChatMembersExcept } from "../services/chatNotifications";
import { getChatSharedItems } from "../services/chatSharedMedia";
import type { AttachmentMetadata, Message as MessageDto, MessageType, Message, ChatSharedCategory } from "@melon/shared";
import { toPublicProfile } from "../lib/userDto";
import { usersShareChat } from "../lib/chatAccess";
import {
  ensureChatAvatarRegistered,
  ensureProfileMediaRegistered,
  grantMediaFromAttachment,
  grantMediaToChat,
  normalizeAttachmentMetadataForStorage,
  normalizeMessageAttachmentUrl,
  signMediaPath,
  signAttachmentMetadata,
  signUserMedia,
  filenameFromPath,
} from "../services/mediaAccess";
import { getReadCursors, getUserReadCursorsByChat } from "../services/readReceipts";
import { advanceReadCursor } from "../services/chatRead";
import { resolveUnreadCount, incrementUnreadForChat } from "../services/chatUnread";
import { getReactionsForMessages, setMessageReaction } from "../services/reactions";
import { trackMessageCreated } from "../services/prometheus";

function toUser(u: typeof users.$inferSelect) {
  return toPublicProfile(u);
}

function parseAttachmentMetadata(raw: string | null | undefined): AttachmentMetadata | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AttachmentMetadata;
  } catch {
    return null;
  }
}

async function rowToMessageDto(
  r: {
    message_id: string;
    chat_id: string;
    sender_id: string;
    content: string;
    created_at: Date;
    message_type?: string | null;
    attachment_url?: string | null;
    attachment_metadata?: string | null;
    edited_at?: Date | null;
  },
  viewerId: string,
  sender?: Awaited<ReturnType<typeof signUserMedia<ReturnType<typeof toUser>>>>
): Promise<MessageDto> {
  const attachmentMetadataRaw = parseAttachmentMetadata(r.attachment_metadata);
  const rawUrl = r.attachment_url ?? null;
  const attachmentUrl = rawUrl ? (await signMediaPath(rawUrl, viewerId)) ?? rawUrl : null;
  const attachmentMetadata = (await signAttachmentMetadata(attachmentMetadataRaw, viewerId)) ?? attachmentMetadataRaw;
  return {
    id: r.message_id,
    chatId: r.chat_id,
    senderId: r.sender_id,
    content: r.content,
    createdAt: r.created_at?.toISOString?.(),
    editedAt: r.edited_at?.toISOString?.() ?? null,
    sender,
    messageType: (r.message_type as MessageType) ?? "text",
    attachmentUrl,
    attachmentMetadata,
  };
}

type ChatDto = {
  id: string;
  type: string;
  name: string | null;
  avatarUrl?: string | null;
  createdAt?: string | null;
  lastMessageAt?: string | null;
  lastMessagePreview?: string | null;
  unreadCount?: number;
  notificationsMuted?: boolean;
  members: Array<ReturnType<typeof toUser> & { role: string }>;
};

async function signChatDto<T extends ChatDto>(chat: T, viewerId: string): Promise<T> {
  const avatarUrl = chat.avatarUrl
    ? (await signMediaPath(chat.avatarUrl, viewerId)) ?? chat.avatarUrl
    : chat.avatarUrl;
  const members = await Promise.all(chat.members.map((m) => signUserMedia(m, viewerId)));
  return { ...chat, avatarUrl, members };
}

async function buildChatDto(
  chat: typeof chats.$inferSelect,
  members: Array<{ user: typeof users.$inferSelect; role: string }>,
  viewerId: string,
  lastRead: string | null,
  notificationsMuted = false
): Promise<ChatDto> {
  let lastMessagePreview: string | null = null;
  let lastMessageAt: string | null = null;
  try {
    const [first] = await scyllaGetMessages(chat.id, 1);
    if (first) {
      lastMessagePreview = first.content.slice(0, 80);
      lastMessageAt = first.created_at?.toISOString?.() ?? null;
    }
  } catch {
    // Scylla might be unavailable
  }
  let unreadCount = 0;
  try {
    unreadCount = await resolveUnreadCount(chat.id, viewerId, lastRead);
  } catch {
    unreadCount = 0;
  }
  return {
    id: chat.id,
    type: chat.type,
    name: chat.name,
    avatarUrl: chat.avatarUrl,
    createdAt: chat.createdAt?.toISOString?.(),
    lastMessageAt,
    lastMessagePreview,
    unreadCount,
    notificationsMuted,
    members: members.map((m) => ({ ...toUser(m.user), role: m.role })),
  };
}

async function publishGroupSystemEvent(chatId: string, actorId: string, content: string): Promise<void> {
  const { messageId, createdAt } = await scyllaInsertMessage(chatId, actorId, content, {
    messageType: "system",
  });
  const [actor] = await db.select().from(users).where(eq(users.id, actorId)).limit(1);
  const message: Message = {
    id: messageId,
    chatId,
    senderId: actorId,
    content,
    createdAt: createdAt.toISOString(),
    messageType: "system",
    sender: actor ? toUser(actor) : undefined,
  };
  await publishChatEvent(chatId, { type: "message", message });
}

export const chatRoutes = new Elysia({ prefix: "/chats" })
  .use(authPlugin)
  .get("/users/by-login/:login", async ({ user, params, set }) => {
    const viewer = requireAuth(set)(user);
    const login = (params as { login?: string }).login?.trim().toLowerCase();
    if (!login) {
      set.status = 404;
      return { error: "User not found" };
    }
    const [target] = await db
      .select()
      .from(users)
      .where(sql`lower(${users.yandexLogin}) = ${login}`)
      .limit(1);
    if (!target) {
      set.status = 404;
      return { error: "User not found" };
    }
    const includeBirthday = await usersShareChat(viewer.id, target.id);
    return signUserMedia(toPublicProfile(target, includeBirthday), viewer.id);
  })
  .get("/users/search/:query", async ({ user, params, set }) => {
    const viewer = requireAuth(set)(user);
    const q = decodeURIComponent((params as { query?: string }).query ?? "").trim().toLowerCase();
    if (!q) {
      set.status = 404;
      return { error: "User not found" };
    }
    const [target] = await db
      .select()
      .from(users)
      .where(sql`lower(${users.yandexLogin}) = ${q}`)
      .limit(1);
    if (!target) {
      set.status = 404;
      return { error: "User not found" };
    }
    return signUserMedia(toPublicProfile(target, false), viewer.id);
  })
  .get("/users/:id", async ({ user, params, set }) => {
    const viewer = requireAuth(set)(user);
    const id = (params as { id?: string }).id?.trim();
    if (!id) {
      set.status = 404;
      return { error: "User not found" };
    }
    const [target] = await db.select().from(users).where(eq(users.id, id)).limit(1);
    if (!target) {
      set.status = 404;
      return { error: "User not found" };
    }
    const includeBirthday = target.birthdayVisible || viewer.id === target.id;
    const dto = toPublicProfile(target, includeBirthday);
    await ensureProfileMediaRegistered(target.id, [
      dto.avatarUrl,
      dto.coverUrl,
      ...dto.profilePhotos,
      ...dto.avatarHistory,
    ]);
    return signUserMedia(dto, viewer.id);
  })
  .get("/", async ({ user, set }) => {
    const u = requireAuth(set)(user);
    const memberChats = await db
      .select({
        chatId: chatMembers.chatId,
        role: chatMembers.role,
        muted: chatMembers.muted,
        chat: chats,
      })
      .from(chatMembers)
      .innerJoin(chats, eq(chats.id, chatMembers.chatId))
      .where(eq(chatMembers.userId, u.id));

    const result: ChatDto[] = [];
    const readCursorsByChat = await getUserReadCursorsByChat(u.id);
    for (const row of memberChats) {
      const members = await db
        .select({ user: users, role: chatMembers.role })
        .from(chatMembers)
        .innerJoin(users, eq(users.id, chatMembers.userId))
        .where(eq(chatMembers.chatId, row.chatId));
      if (row.chat.type === "dm" && members.length < 2) {
        await db
          .delete(chatMembers)
          .where(and(eq(chatMembers.chatId, row.chatId), eq(chatMembers.userId, u.id)));
        await db.delete(chats).where(eq(chats.id, row.chatId));
        await deleteChatMessages(row.chatId).catch(() => {});
        await publishChatEvent(row.chatId, { type: "chat_removed", chatId: row.chatId }).catch(() => {});
        continue;
      }
      let lastMessagePreview: string | null = null;
      let lastMessageAt: string | null = null;
      try {
        const [first] = await scyllaGetMessages(row.chatId, 1);
        if (first) {
          lastMessagePreview = first.content.slice(0, 80);
          lastMessageAt = first.created_at?.toISOString?.() ?? null;
        }
      } catch {
        // Scylla might be unavailable
      }
      const lastRead = readCursorsByChat.get(row.chatId) ?? null;
      let unreadCount = 0;
      try {
        unreadCount = await resolveUnreadCount(row.chatId, u.id, lastRead);
      } catch {
        unreadCount = 0;
      }
      result.push({
        id: row.chat.id,
        type: row.chat.type,
        name: row.chat.name,
        avatarUrl: row.chat.avatarUrl,
        createdAt: row.chat.createdAt?.toISOString?.(),
        lastMessageAt,
        lastMessagePreview,
        unreadCount,
        notificationsMuted: row.muted,
        members: members.map((m) => ({ ...toUser(m.user), role: m.role })),
      });
    }
    const signed = await Promise.all(result.map((chat) => signChatDto(chat, u.id)));
    signed.sort((a, b) => {
      const at = a.lastMessageAt ? Date.parse(a.lastMessageAt) : 0;
      const bt = b.lastMessageAt ? Date.parse(b.lastMessageAt) : 0;
      if (bt !== at) return bt - at;
      const ac = a.createdAt ? Date.parse(a.createdAt) : 0;
      const bc = b.createdAt ? Date.parse(b.createdAt) : 0;
      return bc - ac;
    });
    return signed;
  })
  .post("/dm", async ({ user, body, set }) => {
    const u = requireAuth(set)(user);
    const { userId: otherUserId } = (typeof body === "object" && body !== null ? body : {}) as { userId?: string };
    if (!otherUserId) {
      set.status = 400;
      return { error: "userId is required" };
    }
    if (otherUserId === u.id) {
      set.status = 400;
      return { error: "Cannot create DM with yourself" };
    }
    const [other] = await db.select().from(users).where(eq(users.id, otherUserId)).limit(1);
    if (!other) {
      set.status = 404;
      return { error: "User not found" };
    }
    const bothMembers = await db
      .select({ chatId: chatMembers.chatId })
      .from(chatMembers)
      .innerJoin(chats, eq(chats.id, chatMembers.chatId))
      .where(and(eq(chats.type, "dm"), inArray(chatMembers.userId, [u.id, otherUserId])));
    const chatIdCount = new Map<string, number>();
    for (const row of bothMembers) {
      chatIdCount.set(row.chatId, (chatIdCount.get(row.chatId) ?? 0) + 1);
    }
    const existingDmId = [...chatIdCount.entries()].find(([, c]) => c === 2)?.[0];
    if (existingDmId) {
      const [chat] = await db.select().from(chats).where(eq(chats.id, existingDmId)).limit(1);
      const members = await db
        .select({ user: users, role: chatMembers.role })
        .from(chatMembers)
        .innerJoin(users, eq(users.id, chatMembers.userId))
        .where(eq(chatMembers.chatId, chat.id));
      const readMap = await getUserReadCursorsByChat(u.id);
      const lastRead = readMap.get(chat.id) ?? null;
      const [myRow] = await db
        .select({ muted: chatMembers.muted })
        .from(chatMembers)
        .where(and(eq(chatMembers.chatId, chat.id), eq(chatMembers.userId, u.id)))
        .limit(1);
      return signChatDto(await buildChatDto(chat, members, u.id, lastRead, myRow?.muted ?? false), u.id);
    }
    const [chat] = await db.insert(chats).values({ type: "dm" }).returning();
    await db.insert(chatMembers).values([
      { chatId: chat.id, userId: u.id, role: "member" },
      { chatId: chat.id, userId: otherUserId, role: "member" },
    ]);
    const members = await db
      .select({ user: users, role: chatMembers.role })
      .from(chatMembers)
      .innerJoin(users, eq(users.id, chatMembers.userId))
      .where(eq(chatMembers.chatId, chat.id));
    return signChatDto(await buildChatDto(chat, members, u.id, null, false), u.id);
  })
  .post("/group", async ({ user, body, set }) => {
    const u = requireAuth(set)(user);
    const b = (typeof body === "object" && body !== null ? body : {}) as { name?: string; memberIds?: string[] };
    const name = b?.name;
    const memberIds = b?.memberIds;
    if (!name?.trim()) {
      set.status = 400;
      return { error: "name is required" };
    }
    const ids = Array.isArray(memberIds) ? [...new Set(memberIds)].filter((id) => id !== u.id) : [];
    if (ids.length > 0) {
      const existing = await db.select().from(users).where(inArray(users.id, ids));
      if (existing.length !== ids.length) {
        set.status = 400;
        return { error: "Some users not found" };
      }
    }
    const [chat] = await db.insert(chats).values({ type: "group", name: name.trim() }).returning();
    await db.insert(chatMembers).values([
      { chatId: chat.id, userId: u.id, role: "admin" },
      ...ids.map((userId) => ({ chatId: chat.id, userId, role: "member" as const })),
    ]);
    const members = await db
      .select({ user: users, role: chatMembers.role })
      .from(chatMembers)
      .innerJoin(users, eq(users.id, chatMembers.userId))
      .where(eq(chatMembers.chatId, chat.id));
    return signChatDto(
      {
        id: chat.id,
        type: chat.type,
        name: chat.name,
        avatarUrl: chat.avatarUrl,
        createdAt: chat.createdAt?.toISOString?.(),
        lastMessageAt: null,
        lastMessagePreview: null,
        notificationsMuted: false,
        members: members.map((m) => ({ ...toUser(m.user), role: m.role })),
      },
      u.id
    );
  })
  .get("/:id", async ({ user, params, set }) => {
    const u = requireAuth(set)(user);
    const { id: chatId } = params;
    const [chatRow] = await db.select().from(chats).where(eq(chats.id, chatId)).limit(1);
    if (!chatRow) {
      set.status = 404;
      return { error: "Chat not found" };
    }
    const [myMember] = await db.select().from(chatMembers).where(and(eq(chatMembers.chatId, chatId), eq(chatMembers.userId, u.id))).limit(1);
    if (!myMember) {
      set.status = 403;
      return { error: "Not a member" };
    }
    const members = await db
      .select({ user: users, role: chatMembers.role })
      .from(chatMembers)
      .innerJoin(users, eq(users.id, chatMembers.userId))
      .where(eq(chatMembers.chatId, chatId));
    if (chatRow.type === "dm" && members.length < 2) {
      await db
        .delete(chatMembers)
        .where(and(eq(chatMembers.chatId, chatId), eq(chatMembers.userId, u.id)));
      await db.delete(chats).where(eq(chats.id, chatId));
      await deleteChatMessages(chatId).catch(() => {});
      await publishChatEvent(chatId, { type: "chat_removed", chatId }).catch(() => {});
      set.status = 404;
      return { error: "Chat not found" };
    }
    let lastMessagePreview: string | null = null;
    let lastMessageAt: string | null = null;
    try {
      const [first] = await scyllaGetMessages(chatId, 1);
      if (first) {
        lastMessagePreview = first.content.slice(0, 80);
        lastMessageAt = first.created_at?.toISOString?.() ?? null;
      }
    } catch {}
    return signChatDto(
      {
        id: chatRow.id,
        type: chatRow.type,
        name: chatRow.name,
        avatarUrl: chatRow.avatarUrl,
        createdAt: chatRow.createdAt?.toISOString?.(),
        lastMessageAt,
        lastMessagePreview,
        notificationsMuted: myMember.muted,
        members: members.map((m) => ({ ...toUser(m.user), role: m.role })),
      },
      u.id
    );
  })
  .post("/:id/members", async ({ user, params, body, set }) => {
    const u = requireAuth(set)(user);
    const { id: chatId } = params;
    const [chatRow] = await db.select().from(chats).where(eq(chats.id, chatId)).limit(1);
    if (!chatRow || chatRow.type !== "group") {
      set.status = 404;
      return { error: "Group not found" };
    }
    const [myMember] = await db.select().from(chatMembers).where(and(eq(chatMembers.chatId, chatId), eq(chatMembers.userId, u.id))).limit(1);
    if (!myMember || myMember.role !== "admin") {
      set.status = 403;
      return { error: "Only admin can add members" };
    }
    const { userIds } = body as { userIds?: string[] };
    const ids = Array.isArray(userIds) ? [...new Set(userIds)].filter((id) => id && id !== u.id) : [];
    if (ids.length === 0) {
      set.status = 400;
      return { error: "userIds required" };
    }
    const existingUsers = await db.select().from(users).where(inArray(users.id, ids));
    if (existingUsers.length !== ids.length) {
      set.status = 400;
      return { error: "Some users not found" };
    }
    const alreadyIn = await db.select({ userId: chatMembers.userId }).from(chatMembers).where(eq(chatMembers.chatId, chatId));
    const alreadySet = new Set(alreadyIn.map((r) => r.userId));
    const toAdd = ids.filter((id) => !alreadySet.has(id));
    if (toAdd.length > 0) {
      await db.insert(chatMembers).values(toAdd.map((userId) => ({ chatId, userId, role: "member" as const })));
      const addedNames = existingUsers
        .filter((usr) => toAdd.includes(usr.id))
        .map((usr) => usr.username)
        .join(", ");
      const [actor] = await db.select().from(users).where(eq(users.id, u.id)).limit(1);
      const text = `${actor?.username ?? "Участник"} добавил(а): ${addedNames}`;
      await publishGroupSystemEvent(chatId, u.id, text);
      await publishChatEvent(chatId, { type: "chat_members_changed", chatId });
    }
    const members = await db
      .select({ user: users, role: chatMembers.role })
      .from(chatMembers)
      .innerJoin(users, eq(users.id, chatMembers.userId))
      .where(eq(chatMembers.chatId, chatId));
    let lastMessagePreview: string | null = null;
    let lastMessageAt: string | null = null;
    try {
      const [first] = await scyllaGetMessages(chatId, 1);
      if (first) {
        lastMessagePreview = first.content.slice(0, 80);
        lastMessageAt = first.created_at?.toISOString?.() ?? null;
      }
    } catch {}
    return signChatDto(
      {
        id: chatRow.id,
        type: chatRow.type,
        name: chatRow.name,
        avatarUrl: chatRow.avatarUrl,
        createdAt: chatRow.createdAt?.toISOString?.(),
        lastMessageAt,
        lastMessagePreview,
        notificationsMuted: myMember.muted,
        members: members.map((m) => ({ ...toUser(m.user), role: m.role })),
      },
      u.id
    );
  })
  .delete("/:id/members/:userId", async ({ user, params, set }) => {
    const u = requireAuth(set)(user);
    const { id: chatId, userId: targetUserId } = params;
    const [chatRow] = await db.select().from(chats).where(eq(chats.id, chatId)).limit(1);
    if (!chatRow || chatRow.type !== "group") {
      set.status = 404;
      return { error: "Group not found" };
    }
    const [myMember] = await db.select().from(chatMembers).where(and(eq(chatMembers.chatId, chatId), eq(chatMembers.userId, u.id))).limit(1);
    if (!myMember) {
      set.status = 403;
      return { error: "Not a member" };
    }
    if (targetUserId !== u.id && myMember.role !== "admin") {
      set.status = 403;
      return { error: "Only admin can remove other members" };
    }
    const [targetUser] = await db.select().from(users).where(eq(users.id, targetUserId)).limit(1);
    const [actor] = await db.select().from(users).where(eq(users.id, u.id)).limit(1);
    await db.delete(chatMembers).where(and(eq(chatMembers.chatId, chatId), eq(chatMembers.userId, targetUserId)));
    const eventText =
      targetUserId === u.id
        ? `${targetUser?.username ?? "Участник"} покинул(а) группу`
        : `${actor?.username ?? "Участник"} исключил(а) ${targetUser?.username ?? "участника"}`;
    await publishGroupSystemEvent(chatId, u.id, eventText);
    kickUserFromChat(targetUserId, chatId, { type: "chat_removed", chatId });
    await publishChatEvent(chatId, { type: "chat_members_changed", chatId });
    const members = await db
      .select({ user: users, role: chatMembers.role })
      .from(chatMembers)
      .innerJoin(users, eq(users.id, chatMembers.userId))
      .where(eq(chatMembers.chatId, chatId));
    let lastMessagePreview: string | null = null;
    let lastMessageAt: string | null = null;
    try {
      const [first] = await scyllaGetMessages(chatId, 1);
      if (first) {
        lastMessagePreview = first.content.slice(0, 80);
        lastMessageAt = first.created_at?.toISOString?.() ?? null;
      }
    } catch {}
    return signChatDto(
      {
        id: chatRow.id,
        type: chatRow.type,
        name: chatRow.name,
        avatarUrl: chatRow.avatarUrl,
        createdAt: chatRow.createdAt?.toISOString?.(),
        lastMessageAt,
        lastMessagePreview,
        notificationsMuted: myMember.muted,
        members: members.map((m) => ({ ...toUser(m.user), role: m.role })),
      },
      u.id
    );
  })
  .get("/:id/unread-count", async ({ user, params, set }) => {
    const u = requireAuth(set)(user);
    const { id: chatId } = params;
    const [member] = await db
      .select()
      .from(chatMembers)
      .where(and(eq(chatMembers.chatId, chatId), eq(chatMembers.userId, u.id)))
      .limit(1);
    if (!member) {
      set.status = 403;
      return { error: "Not a member of this chat" };
    }
    const readMap = await getUserReadCursorsByChat(u.id);
    const lastRead = readMap.get(chatId) ?? null;
    const count = await resolveUnreadCount(chatId, u.id, lastRead);
    return { count };
  })
  .post("/:id/read", async ({ user, params, body, set }) => {
    const u = requireAuth(set)(user);
    const { id: chatId } = params;
    const payload = (typeof body === "object" && body !== null ? body : {}) as { messageId?: string };
    const messageId = payload.messageId?.trim();
    if (!messageId) {
      set.status = 400;
      return { error: "messageId required" };
    }
    const [member] = await db
      .select()
      .from(chatMembers)
      .where(and(eq(chatMembers.chatId, chatId), eq(chatMembers.userId, u.id)))
      .limit(1);
    if (!member) {
      set.status = 403;
      return { error: "Not a member of this chat" };
    }
    const { advanced, messageId: resolvedId, updatedAt } = await advanceReadCursor(chatId, u.id, messageId);
    if (advanced && resolvedId) {
      await publishChatEvent(chatId, {
        type: "read_receipt",
        chatId,
        userId: u.id,
        messageId: resolvedId,
        updatedAt: updatedAt ?? new Date().toISOString(),
      });
    }
    return { ok: true, messageId: resolvedId };
  })
  .get("/:id/messages", async ({ user, params, query, set }) => {
    const u = requireAuth(set)(user);
    const { id: chatId } = params;
    const limit = Math.min(Number(query.limit) || 50, 100);
    const before = (query.before as string) || undefined;
    const [member] = await db
      .select()
      .from(chatMembers)
      .where(and(eq(chatMembers.chatId, chatId), eq(chatMembers.userId, u.id)))
      .limit(1);
    if (!member) {
      set.status = 403;
      return { error: "Not a member of this chat" };
    }
    const rows = await scyllaGetMessages(chatId, limit, before);
    const userIds = [...new Set(rows.map((r) => r.sender_id))];
    const userMap = new Map<string, typeof users.$inferSelect>();
    if (userIds.length) {
      const list = await db.select().from(users).where(inArray(users.id, userIds));
      list.forEach((us) => userMap.set(us.id, us));
    }
    const messages = await Promise.all(
      rows.map(async (r) => {
        const senderRow = userMap.get(r.sender_id);
        const sender = senderRow
          ? await signUserMedia(toUser(senderRow), u.id)
          : undefined;
        return rowToMessageDto(r, u.id, sender);
      })
    );
    const reactionMap = await getReactionsForMessages(messages.map((m) => m.id));
    const withReactions = messages.map((m) => ({
      ...m,
      reactions: reactionMap[m.id.toLowerCase()] ?? reactionMap[m.id] ?? [],
    }));
    const readCursors = await getReadCursors(chatId);
    const readMap = await getUserReadCursorsByChat(u.id);
    const myLastReadMessageId = readMap.get(chatId) ?? null;
    const unreadCount = await resolveUnreadCount(chatId, u.id, myLastReadMessageId);
    return { messages: withReactions.slice().reverse(), readCursors, myLastReadMessageId, unreadCount };
  })
  .patch("/:id/messages/:messageId", async ({ user, params, body, set }) => {
    const u = requireAuth(set)(user);
    const { id: chatId, messageId } = params;
    const [member] = await db
      .select()
      .from(chatMembers)
      .where(and(eq(chatMembers.chatId, chatId), eq(chatMembers.userId, u.id)))
      .limit(1);
    if (!member) {
      set.status = 403;
      return { error: "Not a member of this chat" };
    }
    const row = await scyllaGetMessage(chatId, messageId);
    if (!row) {
      set.status = 404;
      return { error: "Message not found" };
    }
    if (row.sender_id !== u.id) {
      set.status = 403;
      return { error: "Only the sender can edit this message" };
    }
    const messageType = (row.message_type as MessageType) ?? "text";
    if (messageType !== "text") {
      set.status = 400;
      return { error: "Only text messages can be edited" };
    }
    const payload = body as { content?: string };
    const content = typeof payload.content === "string" ? payload.content.trim() : "";
    if (!content) {
      set.status = 400;
      return { error: "content required" };
    }
    if (content === row.content) {
      const [senderUser] = await db.select().from(users).where(eq(users.id, u.id)).limit(1);
      const sender = senderUser ? await signUserMedia(toUser(senderUser), u.id) : undefined;
      const message = await rowToMessageDto(row, u.id, sender);
      return { message };
    }
    const editedAt = await scyllaUpdateMessageContent(chatId, messageId, content);
    const [senderUser] = await db.select().from(users).where(eq(users.id, u.id)).limit(1);
    const sender = senderUser ? await signUserMedia(toUser(senderUser), u.id) : undefined;
    const message = await rowToMessageDto(
      { ...row, content, edited_at: editedAt },
      u.id,
      sender
    );
    await publishChatEvent(chatId, { type: "message_edited", chatId, message });
    return { message };
  })
  .delete("/:id/messages/:messageId", async ({ user, params, set }) => {
    const u = requireAuth(set)(user);
    const { id: chatId, messageId } = params;
    const [member] = await db
      .select()
      .from(chatMembers)
      .where(and(eq(chatMembers.chatId, chatId), eq(chatMembers.userId, u.id)))
      .limit(1);
    if (!member) {
      set.status = 403;
      return { error: "Not a member of this chat" };
    }
    const row = await scyllaGetMessage(chatId, messageId);
    if (!row) {
      set.status = 404;
      return { error: "Message not found" };
    }
    await scyllaDeleteMessage(chatId, messageId);
    await publishChatEvent(chatId, { type: "message_deleted", chatId, messageId });
    return { success: true };
  })
  .put("/:id/messages/:messageId/reaction", async ({ user, params, body, set }) => {
    const u = requireAuth(set)(user);
    const { id: chatId, messageId } = params;
    const [member] = await db
      .select()
      .from(chatMembers)
      .where(and(eq(chatMembers.chatId, chatId), eq(chatMembers.userId, u.id)))
      .limit(1);
    if (!member) {
      set.status = 403;
      return { error: "Not a member of this chat" };
    }
    const row = await scyllaGetMessage(chatId, messageId);
    if (!row) {
      set.status = 404;
      return { error: "Message not found" };
    }
    const payload = body as { emoji?: string | null };
    const emoji = payload.emoji === null || payload.emoji === undefined ? null : String(payload.emoji);
    const reactions = await setMessageReaction(chatId, messageId, u.id, emoji);
    const normalizedId = messageId.trim().toLowerCase();
    await publishChatEvent(chatId, { type: "reaction", chatId, messageId: normalizedId, reactions });
    return { reactions };
  })
  .post("/:id/messages/forward", async ({ user, params, body, set }) => {
    const u = requireAuth(set)(user);
    const targetChatId = params.id;
    const payload = body as { fromChatId?: string; messageId?: string };
    const fromChatId = payload.fromChatId?.trim();
    const messageId = payload.messageId?.trim();
    if (!fromChatId || !messageId) {
      set.status = 400;
      return { error: "fromChatId and messageId required" };
    }
    const [targetMember] = await db
      .select()
      .from(chatMembers)
      .where(and(eq(chatMembers.chatId, targetChatId), eq(chatMembers.userId, u.id)))
      .limit(1);
    if (!targetMember) {
      set.status = 403;
      return { error: "Not a member of target chat" };
    }
    const [sourceMember] = await db
      .select()
      .from(chatMembers)
      .where(and(eq(chatMembers.chatId, fromChatId), eq(chatMembers.userId, u.id)))
      .limit(1);
    if (!sourceMember) {
      set.status = 403;
      return { error: "Not a member of source chat" };
    }
    const row = await scyllaGetMessage(fromChatId, messageId);
    if (!row) {
      set.status = 404;
      return { error: "Message not found" };
    }
    const [originalSender] = await db.select().from(users).where(eq(users.id, row.sender_id)).limit(1);
    const originalMeta = parseAttachmentMetadata(row.attachment_metadata) ?? {};
    const { replyTo: _replyTo, ...metaWithoutReply } = originalMeta;
    const forwardedFrom = originalMeta.forwardedFrom ?? {
      userId: row.sender_id,
      username: originalSender?.username ?? originalSender?.yandexLogin ?? "Пользователь",
    };
    const attachmentMetadata =
      normalizeAttachmentMetadataForStorage({ ...metaWithoutReply, forwardedFrom }) ?? { forwardedFrom };
    const attachmentUrl = normalizeMessageAttachmentUrl(row.attachment_url, attachmentMetadata);
    const { messageId: newId, createdAt } = await scyllaInsertMessage(targetChatId, u.id, row.content, {
      messageType: (row.message_type as MessageType) ?? "text",
      attachmentUrl,
      attachmentMetadata,
    });
    trackMessageCreated();
    await grantMediaFromAttachment(attachmentUrl, targetChatId, attachmentMetadata);
    const [senderUser] = await db.select().from(users).where(eq(users.id, u.id)).limit(1);
    const sender = senderUser ? await signUserMedia(toUser(senderUser), u.id) : undefined;
    const wsMessage: MessageDto = {
      id: newId,
      chatId: targetChatId,
      senderId: u.id,
      content: row.content,
      createdAt: createdAt.toISOString(),
      sender,
      messageType: (row.message_type as MessageType) ?? "text",
      attachmentUrl,
      attachmentMetadata,
    };
    await publishChatEvent(targetChatId, { type: "message", message: wsMessage });
    await incrementUnreadForChat(targetChatId, u.id).catch(() => {});
    const preview = row.content.slice(0, 120) || "Пересланное сообщение";
    const title = senderUser?.username ?? "Watermelon";
    await notifyChatMembersExcept(targetChatId, u.id, title, preview);
    const message = await rowToMessageDto(
      {
        message_id: newId,
        chat_id: targetChatId,
        sender_id: u.id,
        content: row.content,
        created_at: createdAt,
        message_type: row.message_type,
        attachment_url: attachmentUrl,
        attachment_metadata: JSON.stringify(attachmentMetadata),
      },
      u.id,
      sender
    );
    return { message };
  })
  .put("/:id", async ({ user, params, body, set }) => {
    const u = requireAuth(set)(user);
    const { id: chatId } = params;
    const [chatRow] = await db.select().from(chats).where(eq(chats.id, chatId)).limit(1);
    if (!chatRow) {
      set.status = 404;
      return { error: "Chat not found" };
    }
    if (chatRow.type !== "group") {
      set.status = 400;
      return { error: "Only groups can be updated" };
    }
    const [myMember] = await db
      .select()
      .from(chatMembers)
      .where(and(eq(chatMembers.chatId, chatId), eq(chatMembers.userId, u.id)))
      .limit(1);
    if (!myMember || myMember.role !== "admin") {
      set.status = 403;
      return { error: "Only admin can update group" };
    }
    const payload = body as { name?: string; avatarUrl?: string | null };
    const updates: Partial<typeof chats.$inferInsert> = {};
    if (typeof payload.name === "string") {
      const trimmed = payload.name.trim();
      if (!trimmed) {
        set.status = 400;
        return { error: "name cannot be empty" };
      }
      updates.name = trimmed;
    }
    if ("avatarUrl" in payload) {
      if (payload.avatarUrl == null) {
        updates.avatarUrl = null;
      } else if (typeof payload.avatarUrl === "string") {
        updates.avatarUrl = payload.avatarUrl.trim() || null;
      }
    }
    if (Object.keys(updates).length === 0) {
      return {
        id: chatRow.id,
        type: chatRow.type,
        name: chatRow.name,
        avatarUrl: chatRow.avatarUrl,
        createdAt: chatRow.createdAt?.toISOString?.(),
        lastMessageAt: null,
        lastMessagePreview: null,
        members: [] as unknown as Array<ReturnType<typeof toUser> & { role: string }>,
      };
    }
    const oldAvatar = chatRow.avatarUrl ?? null;
    const [updatedChat] = await db
      .update(chats)
      .set(updates)
      .where(eq(chats.id, chatId))
      .returning();
    const newAvatar = "avatarUrl" in updates ? (updates.avatarUrl ?? null) : oldAvatar;
    if ("avatarUrl" in updates && updates.avatarUrl) {
      await ensureChatAvatarRegistered(chatId, updates.avatarUrl);
      const filename = filenameFromPath(updates.avatarUrl);
      if (filename) await grantMediaToChat(filename, chatId);
    }
    if ("avatarUrl" in updates && newAvatar !== oldAvatar) {
      const [actor] = await db.select().from(users).where(eq(users.id, u.id)).limit(1);
      const text =
        newAvatar === null
          ? `${actor?.username ?? "Участник"} удалил(а) фото группы`
          : `${actor?.username ?? "Участник"} изменил(а) фото группы`;
      await publishGroupSystemEvent(chatId, u.id, text);
      await publishChatEvent(chatId, { type: "chat_members_changed", chatId });
    }
    const members = await db
      .select({ user: users, role: chatMembers.role })
      .from(chatMembers)
      .innerJoin(users, eq(users.id, chatMembers.userId))
      .where(eq(chatMembers.chatId, chatId));
    let lastMessagePreview: string | null = null;
    let lastMessageAt: string | null = null;
    try {
      const [first] = await scyllaGetMessages(chatId, 1);
      if (first) {
        lastMessagePreview = first.content.slice(0, 80);
        lastMessageAt = first.created_at?.toISOString?.() ?? null;
      }
    } catch {}
    return signChatDto(
      {
        id: updatedChat.id,
        type: updatedChat.type,
        name: updatedChat.name,
        avatarUrl: updatedChat.avatarUrl,
        createdAt: updatedChat.createdAt?.toISOString?.(),
        lastMessageAt,
        lastMessagePreview,
        notificationsMuted: myMember.muted,
        members: members.map((m) => ({ ...toUser(m.user), role: m.role })),
      },
      u.id
    );
  })
  .get("/:id/shared", async ({ user, params, query, set }) => {
    const u = requireAuth(set)(user);
    const { id: chatId } = params;
    const [myMember] = await db
      .select()
      .from(chatMembers)
      .where(and(eq(chatMembers.chatId, chatId), eq(chatMembers.userId, u.id)))
      .limit(1);
    if (!myMember) {
      set.status = 403;
      return { error: "Not a member" };
    }
    const category = String(query?.category ?? "media") as ChatSharedCategory;
    if (!["media", "files", "voice", "links"].includes(category)) {
      set.status = 400;
      return { error: "Invalid category" };
    }
    const limit = Math.min(Math.max(Number(query?.limit) || 48, 1), 60);
    const before = typeof query?.before === "string" && query.before ? query.before : undefined;
    return getChatSharedItems(chatId, u.id, category, limit, before);
  })
  .patch("/:id/notifications", async ({ user, params, body, set }) => {
    const u = requireAuth(set)(user);
    const { id: chatId } = params;
    const [myMember] = await db
      .select()
      .from(chatMembers)
      .where(and(eq(chatMembers.chatId, chatId), eq(chatMembers.userId, u.id)))
      .limit(1);
    if (!myMember) {
      set.status = 403;
      return { error: "Not a member" };
    }
    const payload = body as { muted?: boolean };
    if (typeof payload.muted !== "boolean") {
      set.status = 400;
      return { error: "muted is required" };
    }
    await db
      .update(chatMembers)
      .set({ muted: payload.muted })
      .where(and(eq(chatMembers.chatId, chatId), eq(chatMembers.userId, u.id)));
    return { notificationsMuted: payload.muted };
  })
  .delete("/:id", async ({ user, params, set }) => {
    const u = requireAuth(set)(user);
    const { id: chatId } = params;
    const [chatRow] = await db.select().from(chats).where(eq(chats.id, chatId)).limit(1);
    if (!chatRow) {
      set.status = 404;
      return { error: "Chat not found" };
    }
    const [member] = await db
      .select()
      .from(chatMembers)
      .where(and(eq(chatMembers.chatId, chatId), eq(chatMembers.userId, u.id)))
      .limit(1);
    if (!member) {
      set.status = 403;
      return { error: "Not a member of this chat" };
    }

    if (chatRow.type === "group") {
      if (member.role !== "admin") {
        set.status = 403;
        return { error: "Only admin can delete group" };
      }
      await db.delete(chatMembers).where(eq(chatMembers.chatId, chatId));
      await db.delete(chats).where(eq(chats.id, chatId));
      await deleteChatMessages(chatId).catch(() => {});
      await publishChatEvent(chatId, { type: "chat_removed", chatId }).catch(() => {});
      return { success: true };
    }

    await db
      .delete(chatMembers)
      .where(and(eq(chatMembers.chatId, chatId), eq(chatMembers.userId, u.id)));
    const remaining = await db
      .select()
      .from(chatMembers)
      .where(eq(chatMembers.chatId, chatId))
      .limit(1);
    if (remaining.length === 0) {
      await db.delete(chats).where(eq(chats.id, chatId));
      await deleteChatMessages(chatId).catch(() => {});
      await publishChatEvent(chatId, { type: "chat_removed", chatId }).catch(() => {});
    } else {
      await publishChatEvent(chatId, { type: "chat_members_changed", chatId }).catch(() => {});
    }
    kickUserFromChat(u.id, chatId, { type: "chat_removed", chatId });
    return { success: true };
  });
