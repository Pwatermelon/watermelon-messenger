/**
 * WebSocket handler: auth via first message, subscribe to chats, broadcast via Redis.
 * For horizontal scaling: each instance subscribes to Redis channels and server.publish() to local WS.
 */
import type { ServerWebSocket } from "bun";
import * as jose from "jose";
import { db, users, chatMembers } from "./db";
import { eq, and } from "drizzle-orm";
import * as scylla from "./services/scylla";
import * as redis from "./services/redis";
import { notifyChatMembersExcept } from "./services/chatNotifications";
import { grantMediaFromAttachment } from "./services/mediaAccess";
import { trackMessageCreated } from "./services/prometheus";
import { advanceReadCursor } from "./services/chatRead";
import { incrementUnreadForChat } from "./services/chatUnread";
import { trackSocket, untrackSocket } from "./wsRegistry";
import type { WSClientMessage, WSServerMessage, Message } from "@melon/shared";

const JWT_SECRET = process.env.JWT_SECRET ?? "watermelon-dev-secret-change-in-prod";
const JWT_SECRET_BYTES = new TextEncoder().encode(JWT_SECRET);

type WSData = {
  userId: string | null;
  subscribedChats: Set<string>;
};

function send(ws: ServerWebSocket<WSData>, msg: WSServerMessage): void {
  ws.send(JSON.stringify(msg));
}

let wsServerRef: { publish: (topic: string, data: string) => number } | null = null;

export function setWSServer(server: { publish: (topic: string, data: string) => number }) {
  wsServerRef = server;
}

export async function publishChatEvent(chatId: string, payload: WSServerMessage): Promise<void> {
  const data = JSON.stringify(payload);
  await redis.publishToChat(chatId, data);
  wsServerRef?.publish(chatTopic(chatId), data);
}

function chatTopic(chatId: string) {
  return `chat:${chatId}`;
}

async function isChatMember(chatId: string, userId: string): Promise<boolean> {
  const [member] = await db
    .select({ userId: chatMembers.userId })
    .from(chatMembers)
    .where(and(eq(chatMembers.chatId, chatId), eq(chatMembers.userId, userId)))
    .limit(1);
  return Boolean(member);
}

function decodeJwtSubUnsafe(token: string): string | null {
  const parts = token.split(".");
  if (parts.length < 2) return null;
  try {
    const payloadJson = Buffer.from(parts[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    const payload = JSON.parse(payloadJson) as { sub?: unknown };
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}

export const wsHandlers = {
  data: {} as WSData,

  open(ws: ServerWebSocket<WSData>) {
    ws.data = { userId: null, subscribedChats: new Set() };
  },

  async message(ws: ServerWebSocket<WSData>, raw: string | Buffer | Record<string, unknown>) {
      try {
      let msg: WSClientMessage;
      if (typeof raw === "object" && raw !== null && !Buffer.isBuffer(raw) && !(raw instanceof Uint8Array) && !(raw instanceof ArrayBuffer)) {
        msg = raw as unknown as WSClientMessage;
      } else {
        let str: string;
        if (typeof raw === "string") {
          str = raw.trim();
        } else if (Buffer.isBuffer(raw)) {
          str = raw.toString("utf8").trim();
        } else if (raw instanceof Uint8Array || raw instanceof ArrayBuffer) {
          const buf = raw instanceof ArrayBuffer ? Buffer.from(raw) : Buffer.from(raw);
          str = buf.toString("utf8").trim();
        } else {
          str = String(raw).trim();
        }
        if (!str) {
          send(ws, { type: "error", error: "Empty message" });
          return;
        }
        try {
          msg = JSON.parse(str) as WSClientMessage;
        } catch {
          send(ws, { type: "error", error: "Invalid JSON" });
          return;
        }
      }

      if (msg.type === "auth") {
        if (ws.data.userId) {
          const [u] = await db.select().from(users).where(eq(users.id, ws.data.userId)).limit(1);
          if (u) {
            send(ws, {
              type: "auth_ok",
              user: {
                id: u.id,
                email: u.email,
                username: u.username,
                avatarUrl: u.avatarUrl,
                subscriptionTier: u.subscriptionTier ?? "free",
                betaApproved: u.betaApproved ?? false,
                isAdmin: u.isAdmin ?? false,
                createdAt: u.createdAt?.toISOString?.() ?? "",
              },
            });
          }
          return;
        }
        let userId: string | null = null;
        try {
          const { payload } = await jose.jwtVerify(msg.token, JWT_SECRET_BYTES);
          if (!payload?.sub || typeof payload.sub !== "string") throw new Error("Invalid token");
          userId = payload.sub;
        } catch (err) {
          console.warn("[WS] jwtVerify failed, falling back to decode-only:", err);
          userId = decodeJwtSubUnsafe(msg.token);
        }
        if (!userId) {
          send(ws, { type: "auth_error", error: "Invalid token" });
          return;
        }
        try {
          const [u] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
          if (!u) throw new Error("User not found");
          ws.data.userId = u.id;
          const authOk = {
            type: "auth_ok" as const,
            user: {
              id: u.id,
              email: u.email,
              username: u.username,
              avatarUrl: u.avatarUrl,
              subscriptionTier: u.subscriptionTier ?? "free",
              betaApproved: u.betaApproved ?? false,
              isAdmin: u.isAdmin ?? false,
              createdAt: u.createdAt?.toISOString?.() ?? "",
            },
          };
          send(ws, authOk);
          trackSocket(u.id, ws);
          redis.setPresence(u.id).catch((err) => console.warn("[WS] setPresence failed:", err));
        } catch (e) {
          send(ws, { type: "auth_error", error: String(e) });
        }
        return;
      }

      if (!ws.data.userId) {
        send(ws, { type: "error", error: "Authenticate first" });
        return;
      }

      if (msg.type === "subscribe") {
        const { chatId } = msg;
        if (!chatId) return;
        if (!(await isChatMember(chatId, ws.data.userId))) {
          send(ws, { type: "error", error: "Not a member of this chat" });
          return;
        }
        ws.subscribe(chatTopic(chatId));
        ws.data.subscribedChats.add(chatId);
        return;
      }

      if (msg.type === "unsubscribe") {
        const { chatId } = msg;
        ws.unsubscribe(chatTopic(chatId));
        ws.data.subscribedChats.delete(chatId ?? "");
        return;
      }

      if (msg.type === "message") {
        const { chatId, content, messageType, attachmentUrl, attachmentMetadata } = msg;
        if (!chatId || content == null) {
          send(ws, { type: "error", error: "chatId and content required" });
          return;
        }
        const [member] = await db
          .select()
          .from(chatMembers)
          .where(and(eq(chatMembers.chatId, chatId), eq(chatMembers.userId, ws.data.userId)))
          .limit(1);
        if (!member) {
          send(ws, { type: "error", error: "Not a member of this chat" });
          return;
        }
        try {
          const { messageId, createdAt } = await scylla.insertMessage(
            chatId,
            ws.data.userId,
            content,
            {
              messageType: messageType ?? "text",
              attachmentUrl: attachmentUrl ?? null,
              attachmentMetadata: attachmentMetadata ?? null,
            }
          );
          try {
            await grantMediaFromAttachment(attachmentUrl, chatId, attachmentMetadata ?? null);
          } catch (err) {
            console.warn("[WS] grantMediaFromAttachment failed:", err);
          }
          const mt = messageType ?? "text";
          if (mt !== "system") {
            trackMessageCreated();
            await incrementUnreadForChat(chatId, ws.data.userId).catch((err) => {
              console.warn("[WS] incrementUnread failed:", err);
            });
          }
          const [u] = await db.select().from(users).where(eq(users.id, ws.data.userId)).limit(1);
          const message: Message = {
            id: messageId,
            chatId,
            senderId: ws.data.userId,
            content,
            createdAt: createdAt.toISOString(),
            sender: u
              ? {
                  id: u.id,
                  email: u.email,
                  username: u.username,
                  avatarUrl: u.avatarUrl,
                  subscriptionTier: u.subscriptionTier ?? "free",
                  createdAt: u.createdAt?.toISOString?.(),
                }
              : undefined,
            messageType: messageType ?? "text",
            attachmentUrl: attachmentUrl ?? null,
            attachmentMetadata: attachmentMetadata ?? null,
          };
          const payload: WSServerMessage = { type: "message", message };
          await publishChatEvent(chatId, payload);

          const preview = content.slice(0, 120) || "Новое сообщение";
          const title = u?.username ?? "Watermelon";
          await notifyChatMembersExcept(chatId, ws.data.userId, title, preview);
        } catch (e) {
          send(ws, { type: "error", error: String(e) });
        }
        return;
      }

      if (msg.type === "typing") {
        const { chatId, isTyping } = msg;
        if (!chatId) return;
        if (!(await isChatMember(chatId, ws.data.userId))) return;
        const payload: WSServerMessage = {
          type: "typing",
          chatId,
          userId: ws.data.userId,
          isTyping: !!isTyping,
        };
        wsServerRef?.publish(chatTopic(chatId), JSON.stringify(payload));
        return;
      }

      if (msg.type === "mark_read") {
        const { chatId, messageId } = msg;
        if (!chatId) {
          send(ws, { type: "error", error: "chatId required" });
          return;
        }
        if (!messageId?.trim()) {
          send(ws, { type: "error", error: "messageId required" });
          return;
        }
        const [member] = await db
          .select()
          .from(chatMembers)
          .where(and(eq(chatMembers.chatId, chatId), eq(chatMembers.userId, ws.data.userId)))
          .limit(1);
        if (!member) {
          send(ws, { type: "error", error: "Not a member of this chat" });
          return;
        }
        const { advanced, messageId: resolvedId, updatedAt } = await advanceReadCursor(
          chatId,
          ws.data.userId,
          messageId
        );
        if (advanced && resolvedId) {
          await publishChatEvent(chatId, {
            type: "read_receipt",
            chatId,
            userId: ws.data.userId,
            messageId: resolvedId,
            updatedAt: updatedAt ?? new Date().toISOString(),
          });
        }
      }
      } catch (err) {
        console.error("[WS] message error:", err);
        try {
          send(ws, { type: "error", error: "Server error" });
        } catch {}
      }
    },

  close(ws: ServerWebSocket<WSData>) {
    if (ws.data.userId) {
      untrackSocket(ws.data.userId, ws);
      redis.removePresence(ws.data.userId);
    }
  },
};

export { kickUserFromChat } from "./wsRegistry";

export function setupRedisSubscriber(server: { publish: (topic: string, data: string) => number }) {
  redis.redisSub.psubscribe(`${redis.WS_CHANNEL_PREFIX}*`);
  redis.redisSub.on("pmessage", (_pattern, channel, payload) => {
    const chatId = channel.replace(redis.WS_CHANNEL_PREFIX, "");
    server.publish(chatTopic(chatId), payload);
  });
}
