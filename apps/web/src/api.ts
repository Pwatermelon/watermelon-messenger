import type { AttachmentMetadata, MessageType, User } from "@melon/shared";
import { getApiUrl } from "./config";

function getToken(): string | null {
  return localStorage.getItem("wm_token") ?? localStorage.getItem("melon_token");
}

export async function getChats(): Promise<
  Array<{
    id: string;
    type: string;
    name: string | null;
    createdAt: string;
    lastMessageAt: string | null;
    lastMessagePreview: string | null;
    unreadCount?: number;
    members: Array<{ id: string; username: string; avatarUrl: string | null; subscriptionTier?: string; role: string }>;
  }>
> {
  const res = await fetch(`${getApiUrl()}/chats`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  if (!res.ok) throw new Error("Failed to load chats");
  return res.json();
}

export async function createDm(userId: string): Promise<{
  id: string;
  type: string;
  name: string | null;
  createdAt: string;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  members: Array<{ id: string; username: string; avatarUrl: string | null; subscriptionTier?: string; role: string }>;
}> {
  const res = await fetch(`${getApiUrl()}/chats/dm`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getToken()}`,
    },
    body: JSON.stringify({ userId }),
  });
  if (!res.ok) {
    const text = await res.text();
    let data: { error?: string } = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = {};
    }
    const msg =
      (typeof data.error === "string" && data.error) ||
      (res.status === 401 && "Сессия истекла. Войдите снова.") ||
      (res.status === 404 && "Пользователь не найден") ||
      (res.status === 400 && (data.error || "Неверный запрос")) ||
      (res.status >= 500 && "Ошибка сервера. Попробуйте позже.") ||
      "Не удалось создать чат. Попробуйте войти снова.";
    throw new Error(msg);
  }
  return res.json();
}

const chatResponseType = {
  id: "",
  type: "",
  name: null as string | null,
  avatarUrl: null as string | null,
  createdAt: "",
  lastMessageAt: null as string | null,
  lastMessagePreview: null as string | null,
  members: [] as Array<{ id: string; username: string; avatarUrl: string | null; subscriptionTier?: string; role: string }>,
};

export type ChatResponse = typeof chatResponseType;

export async function createGroup(name: string, memberIds: string[]): Promise<ChatResponse> {
  const res = await fetch(`${getApiUrl()}/chats/group`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getToken()}`,
    },
    body: JSON.stringify({ name: name.trim(), memberIds }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? "Failed to create group");
  }
  return res.json();
}

export async function updateGroup(chatId: string, updates: { name?: string; avatarUrl?: string | null }): Promise<ChatResponse> {
  const res = await fetch(`${getApiUrl()}/chats/${encodeURIComponent(chatId)}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getToken()}`,
    },
    body: JSON.stringify(updates),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? "Failed to update group");
  }
  return res.json();
}

export async function getChat(chatId: string): Promise<ChatResponse | null> {
  const res = await fetch(`${getApiUrl()}/chats/${encodeURIComponent(chatId)}`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  if (!res.ok) return null;
  return res.json();
}

export async function addGroupMembers(chatId: string, userIds: string[]): Promise<ChatResponse> {
  const res = await fetch(`${getApiUrl()}/chats/${encodeURIComponent(chatId)}/members`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getToken()}`,
    },
    body: JSON.stringify({ userIds }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? "Failed to add members");
  }
  return res.json();
}

export async function removeGroupMember(chatId: string, userId: string): Promise<ChatResponse> {
  const res = await fetch(
    `${getApiUrl()}/chats/${encodeURIComponent(chatId)}/members/${encodeURIComponent(userId)}`,
    { method: "DELETE", headers: { Authorization: `Bearer ${getToken()}` } }
  );
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? "Failed to remove member");
  }
  return res.json();
}

export async function searchUser(query: string): Promise<User | null> {
  const q = query.trim();
  if (!q) return null;
  const res = await fetch(`${getApiUrl()}/chats/users/search/${encodeURIComponent(q)}`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error("Failed to lookup user");
  return res.json();
}

export async function getUserByYandexLogin(login: string): Promise<User | null> {
  const q = login.trim().toLowerCase();
  if (!q) return null;
  const res = await fetch(`${getApiUrl()}/chats/users/by-login/${encodeURIComponent(q)}`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error("Failed to lookup user");
  return res.json();
}

export async function getUserById(id: string): Promise<User | null> {
  const res = await fetch(`${getApiUrl()}/chats/users/${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  if (!res.ok) return null;
  return res.json();
}

export async function getContacts(): Promise<User[]> {
  const res = await fetch(`${getApiUrl()}/contacts`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  if (!res.ok) throw new Error("Failed to load contacts");
  return res.json();
}

export async function addContact(userId: string): Promise<User> {
  const res = await fetch(`${getApiUrl()}/contacts/${encodeURIComponent(userId)}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? "Failed to add contact");
  }
  return res.json();
}

export async function removeContact(userId: string): Promise<void> {
  const res = await fetch(`${getApiUrl()}/contacts/${encodeURIComponent(userId)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  if (!res.ok) throw new Error("Failed to remove contact");
}

export async function updateProfile(updates: {
  username?: string;
  avatarUrl?: string | null;
  coverUrl?: string | null;
  bio?: string | null;
  profilePhotos?: string[];
  avatarHistory?: string[];
  birthdayVisible?: boolean;
}): Promise<User> {
  const res = await fetch(`${getApiUrl()}/auth/me`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getToken()}`,
    },
    body: JSON.stringify(updates),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? "Update failed");
  }
  return res.json();
}

export async function createPlatinumPayment(): Promise<{
  paymentId?: string;
  confirmationUrl?: string | null;
  amount?: string;
  currency?: string;
  user?: User;
  devMode?: boolean;
  message?: string;
}> {
  const res = await fetch(`${getApiUrl()}/payments/platinum`, {
    method: "POST",
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Payment failed");
  return data;
}

export async function getPlatinumPaymentStatus(paymentId: string): Promise<{ status: string; user: User }> {
  const res = await fetch(`${getApiUrl()}/payments/platinum/${encodeURIComponent(paymentId)}`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Not found");
  return data;
}

export interface MessageItem {
  id: string;
  chatId: string;
  senderId: string;
  content: string;
  createdAt: string;
  editedAt?: string | null;
  sender?: { id: string; username: string };
  messageType?: MessageType;
  attachmentUrl?: string | null;
  attachmentMetadata?: AttachmentMetadata | null;
}

export type ReadCursor = { userId: string; lastReadMessageId: string };

export async function markChatReadApi(chatId: string, messageId?: string): Promise<void> {
  const res = await fetch(`${getApiUrl()}/chats/${encodeURIComponent(chatId)}/read`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getToken()}`,
    },
    body: JSON.stringify(messageId ? { messageId } : {}),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as { error?: string }).error ?? "Failed to mark read");
  }
}

export async function getChatUnreadCount(chatId: string): Promise<number> {
  const res = await fetch(`${getApiUrl()}/chats/${encodeURIComponent(chatId)}/unread-count`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  if (!res.ok) return 0;
  const data = (await res.json()) as { count?: number };
  return typeof data.count === "number" ? data.count : 0;
}

export async function getMessages(
  chatId: string,
  limit?: number,
  before?: string
): Promise<{
  messages: MessageItem[];
  readCursors?: ReadCursor[];
  myLastReadMessageId?: string | null;
  unreadCount?: number;
}> {
  const params = new URLSearchParams();
  if (limit) params.set("limit", String(limit));
  if (before) params.set("before", before);
  const res = await fetch(`${getApiUrl()}/chats/${chatId}/messages?${params}`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  if (!res.ok) throw new Error("Failed to load messages");
  return res.json();
}

export async function deleteMessage(chatId: string, messageId: string): Promise<void> {
  const res = await fetch(
    `${getApiUrl()}/chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(messageId)}`,
    { method: "DELETE", headers: { Authorization: `Bearer ${getToken()}` } }
  );
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? "Не удалось удалить сообщение");
  }
}

export async function editMessage(
  chatId: string,
  messageId: string,
  content: string
): Promise<MessageItem> {
  const res = await fetch(
    `${getApiUrl()}/chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(messageId)}`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${getToken()}`,
      },
      body: JSON.stringify({ content }),
    }
  );
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Не удалось изменить сообщение");
  return data.message as MessageItem;
}

export async function forwardMessage(
  targetChatId: string,
  fromChatId: string,
  messageId: string
): Promise<MessageItem> {
  const res = await fetch(`${getApiUrl()}/chats/${encodeURIComponent(targetChatId)}/messages/forward`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getToken()}`,
    },
    body: JSON.stringify({ fromChatId, messageId }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Не удалось переслать сообщение");
  return data.message as MessageItem;
}

export async function deleteChat(chatId: string): Promise<void> {
  const res = await fetch(`${getApiUrl()}/chats/${encodeURIComponent(chatId)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? "Failed to delete chat");
  }
}

export type AdminUser = {
  id: string;
  yandexLogin: string;
  betaApproved: boolean;
  isAdmin: boolean;
};

export async function getAdminUsers(q?: string): Promise<AdminUser[]> {
  const params = q ? `?q=${encodeURIComponent(q)}` : "";
  const res = await fetch(`${getApiUrl()}/admin/users${params}`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? "Forbidden");
  }
  return res.json();
}

export async function approveUser(userId: string): Promise<void> {
  const res = await fetch(`${getApiUrl()}/admin/users/${encodeURIComponent(userId)}/approve`, {
    method: "POST",
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? "Failed");
  }
}

export async function revokeUser(userId: string): Promise<void> {
  const res = await fetch(`${getApiUrl()}/admin/users/${encodeURIComponent(userId)}/revoke`, {
    method: "POST",
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? "Failed");
  }
}

export async function signMediaPaths(paths: string[]): Promise<Record<string, string>> {
  const unique = [...new Set(paths.filter(Boolean))];
  if (!unique.length) return {};
  const res = await fetch(`${getApiUrl()}/media/sign`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getToken()}`,
    },
    body: JSON.stringify({ paths: unique }),
  });
  if (!res.ok) return {};
  const data = (await res.json()) as { urls?: Record<string, string> };
  return data.urls ?? {};
}

export async function uploadFile(
  file: File,
  opts?: { purpose?: "chat" | "profile" }
): Promise<{ url: string; path: string; fileName: string; mimeType: string; size: number }> {
  const form = new FormData();
  form.append("file", file);
  if (opts?.purpose) form.append("purpose", opts.purpose);
  const res = await fetch(`${getApiUrl()}/upload`, {
    method: "POST",
    headers: { Authorization: `Bearer ${getToken()}` },
    body: form,
  });
  if (!res.ok) {
    const text = await res.text();
    let data: { error?: string } = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {}
    const msg =
      res.status === 413 ? "Файл слишком большой (макс. 100 МБ)" :
      (typeof data.error === "string" && data.error) || "Ошибка загрузки";
    throw new Error(msg);
  }
  const data = await res.json();
  const path = typeof data.url === "string" ? data.url : "/uploads/";
  const base = getApiUrl().replace(/\/api\/?$/, "");
  return {
    url: `${base}${path.startsWith("/") ? path : `/${path}`}`,
    path: path.startsWith("/") ? path : `/${path}`,
    fileName: data.fileName,
    mimeType: data.mimeType,
    size: data.size,
  };
}
