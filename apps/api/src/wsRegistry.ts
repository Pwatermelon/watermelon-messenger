import type { ServerWebSocket } from "bun";
import type { WSServerMessage } from "@melon/shared";

export type TrackedWSData = {
  userId: string | null;
  subscribedChats: Set<string>;
};

const byUser = new Map<string, Set<ServerWebSocket<TrackedWSData>>>();

function chatTopic(chatId: string) {
  return `chat:${chatId}`;
}

export function trackSocket(userId: string, ws: ServerWebSocket<TrackedWSData>) {
  let set = byUser.get(userId);
  if (!set) {
    set = new Set();
    byUser.set(userId, set);
  }
  set.add(ws);
}

export function untrackSocket(userId: string, ws: ServerWebSocket<TrackedWSData>) {
  byUser.get(userId)?.delete(ws);
  if (byUser.get(userId)?.size === 0) byUser.delete(userId);
}

/** Force-unsubscribe a user from a chat topic and notify their clients. */
export function kickUserFromChat(userId: string, chatId: string, payload: WSServerMessage) {
  const topic = chatTopic(chatId);
  for (const ws of byUser.get(userId) ?? []) {
    try {
      ws.unsubscribe(topic);
      ws.data.subscribedChats.delete(chatId);
      ws.send(JSON.stringify(payload));
    } catch {
      // ignore closed sockets
    }
  }
}

export function getWsStats(): { connections: number; users: number } {
  let connections = 0;
  for (const set of byUser.values()) connections += set.size;
  return { connections, users: byUser.size };
}
