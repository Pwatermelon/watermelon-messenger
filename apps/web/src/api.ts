import type { AttachmentMetadata, Chat, ChatFolder, ChatSharedCategory, ChatSharedItem, MessageType, StickerItem, StickerPackDetail, StickerPackSummary, User } from "@melon/shared";
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
    folderIds?: string[];
    members: Array<{ id: string; username: string; avatarUrl: string | null; subscriptionTier?: string; role: string }>;
  }>
> {
  const res = await fetch(`${getApiUrl()}/chats`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  if (!res.ok) throw new Error("Failed to load chats");
  return res.json();
}

export type DmResolveResult =
  | {
      draft: false;
      chat: Chat;
    }
  | {
      draft: true;
      peer: User;
    };

export async function resolveDm(userId: string): Promise<DmResolveResult> {
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
      "Не удалось открыть диалог. Попробуйте войти снова.";
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
  notificationsMuted: false as boolean | undefined,
  members: [] as Array<{ id: string; username: string; avatarUrl: string | null; subscriptionTier?: string; role: string }>,
};

export type ChatResponse = typeof chatResponseType;

export async function sendDmMessage(
  userId: string,
  opts: {
    content: string;
    messageType?: MessageType;
    attachmentUrl?: string | null;
    attachmentMetadata?: AttachmentMetadata | null;
  }
): Promise<{ chat: ChatResponse; message: { id: string; chatId: string; content: string; createdAt: string } }> {
  const res = await fetch(`${getApiUrl()}/chats/dm/send`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getToken()}`,
    },
    body: JSON.stringify({ userId, ...opts }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? "Не удалось отправить сообщение");
  }
  return res.json();
}

export async function createGroup(
  name: string,
  memberIds: string[],
  avatarUrl?: string | null
): Promise<ChatResponse> {
  const res = await fetch(`${getApiUrl()}/chats/group`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getToken()}`,
    },
    body: JSON.stringify({
      name: name.trim(),
      memberIds,
      ...(avatarUrl ? { avatarUrl } : {}),
    }),
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

export async function getChatShared(
  chatId: string,
  category: ChatSharedCategory,
  opts?: { limit?: number; before?: string }
): Promise<{ items: ChatSharedItem[]; hasMore: boolean }> {
  const params = new URLSearchParams({ category });
  if (opts?.limit) params.set("limit", String(opts.limit));
  if (opts?.before) params.set("before", opts.before);
  const res = await fetch(
    `${getApiUrl()}/chats/${encodeURIComponent(chatId)}/shared?${params}`,
    { headers: { Authorization: `Bearer ${getToken()}` } }
  );
  if (!res.ok) throw new Error("Failed to load shared items");
  return res.json();
}

export async function updateChatNotifications(
  chatId: string,
  muted: boolean
): Promise<{ notificationsMuted: boolean }> {
  const res = await fetch(`${getApiUrl()}/chats/${encodeURIComponent(chatId)}/notifications`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getToken()}`,
    },
    body: JSON.stringify({ muted }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? "Failed to update notifications");
  }
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
  if (!res.ok) return null;
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

export async function getBlockedUsers(): Promise<User[]> {
  const res = await fetch(`${getApiUrl()}/blocks`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  if (!res.ok) throw new Error("Failed to load blocked users");
  return res.json();
}

export async function isUserBlocked(userId: string): Promise<boolean> {
  const res = await fetch(`${getApiUrl()}/blocks/check/${encodeURIComponent(userId)}`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  if (!res.ok) return false;
  const data = (await res.json()) as { blocked?: boolean };
  return Boolean(data.blocked);
}

export async function blockUser(userId: string): Promise<void> {
  const res = await fetch(`${getApiUrl()}/blocks/${encodeURIComponent(userId)}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? "Failed to block user");
  }
}

export async function unblockUser(userId: string): Promise<void> {
  const res = await fetch(`${getApiUrl()}/blocks/${encodeURIComponent(userId)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  if (!res.ok) throw new Error("Failed to unblock user");
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

export type ReadCursor = { userId: string; lastReadMessageId: string; updatedAt?: string };

export async function markChatReadApi(chatId: string, messageId: string): Promise<void> {
  const normalized = messageId.trim().toLowerCase();
  const res = await fetch(`${getApiUrl()}/chats/${encodeURIComponent(chatId)}/read`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getToken()}`,
    },
    body: JSON.stringify({ messageId: normalized }),
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

export async function getChatReadCursors(chatId: string): Promise<ReadCursor[]> {
  const res = await fetch(`${getApiUrl()}/chats/${encodeURIComponent(chatId)}/read-cursors`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  if (!res.ok) return [];
  const data = (await res.json()) as { readCursors?: ReadCursor[] };
  return data.readCursors ?? [];
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

export async function setMessageReaction(
  chatId: string,
  messageId: string,
  emoji: string | null
): Promise<import("@melon/shared").MessageReaction[]> {
  const res = await fetch(
    `${getApiUrl()}/chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(messageId)}/reaction`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${getToken()}`,
      },
      body: JSON.stringify({ emoji }),
    }
  );
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Не удалось поставить реакцию");
  return data.reactions ?? [];
}

export async function markChatReadAllApi(chatId: string): Promise<void> {
  const res = await fetch(`${getApiUrl()}/chats/${encodeURIComponent(chatId)}/read-all`, {
    method: "POST",
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as { error?: string }).error ?? "Failed to mark read");
  }
}

export async function getChatFolders(): Promise<ChatFolder[]> {
  const res = await fetch(`${getApiUrl()}/chat-folders`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  if (!res.ok) throw new Error("Failed to load folders");
  const data = (await res.json()) as { folders?: ChatFolder[] };
  return data.folders ?? [];
}

export async function createChatFolder(name: string): Promise<ChatFolder> {
  const res = await fetch(`${getApiUrl()}/chat-folders`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getToken()}`,
    },
    body: JSON.stringify({ name }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Failed to create folder");
  return data.folder;
}

export async function renameChatFolder(folderId: string, name: string): Promise<ChatFolder> {
  const res = await fetch(`${getApiUrl()}/chat-folders/${encodeURIComponent(folderId)}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getToken()}`,
    },
    body: JSON.stringify({ name }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Failed to rename folder");
  return data.folder;
}

export async function deleteChatFolder(folderId: string): Promise<void> {
  const res = await fetch(`${getApiUrl()}/chat-folders/${encodeURIComponent(folderId)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? "Failed to delete folder");
  }
}

export async function reorderChatFolders(folderIds: string[]): Promise<ChatFolder[]> {
  const res = await fetch(`${getApiUrl()}/chat-folders/reorder`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getToken()}` },
    body: JSON.stringify({ folderIds }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Failed to reorder folders");
  return data.folders ?? [];
}

export async function addChatToFolderApi(folderId: string, chatId: string): Promise<void> {
  const res = await fetch(
    `${getApiUrl()}/chat-folders/${encodeURIComponent(folderId)}/chats/${encodeURIComponent(chatId)}`,
    { method: "PUT", headers: { Authorization: `Bearer ${getToken()}` } }
  );
  if (!res.ok) throw new Error("Failed to add to folder");
}

export async function removeChatFromFolderApi(folderId: string, chatId: string): Promise<void> {
  const res = await fetch(
    `${getApiUrl()}/chat-folders/${encodeURIComponent(folderId)}/chats/${encodeURIComponent(chatId)}`,
    { method: "DELETE", headers: { Authorization: `Bearer ${getToken()}` } }
  );
  if (!res.ok) throw new Error("Failed to remove from folder");
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

export type AdminReport = {
  id: string;
  category: string;
  message: string;
  pageUrl: string | null;
  screenshotUrl: string | null;
  status: "open" | "resolved";
  adminNote: string | null;
  createdAt: string;
  resolvedAt: string | null;
  user: { id: string; yandexLogin: string | null; username: string };
};

export async function submitReport(body: {
  message: string;
  category?: string;
  pageUrl?: string;
  screenshotUrl?: string;
}): Promise<{ id: string }> {
  const res = await fetch(`${getApiUrl()}/reports`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getToken()}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? "Не удалось отправить обращение");
  }
  return res.json();
}

export async function getAdminReports(status?: "open" | "resolved"): Promise<AdminReport[]> {
  const q = status ? `?status=${status}` : "";
  const res = await fetch(`${getApiUrl()}/admin/reports${q}`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? "Forbidden");
  }
  return res.json();
}

export async function resolveAdminReport(id: string, note?: string): Promise<void> {
  const res = await fetch(`${getApiUrl()}/admin/reports/${encodeURIComponent(id)}/resolve`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getToken()}`,
    },
    body: JSON.stringify(note ? { note } : {}),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? "Не удалось закрыть жалобу");
  }
}

export type AdminLegalAcceptance = {
  id: string;
  batchId: string;
  documentType: string;
  documentVersion: string;
  ipAddress: string | null;
  acceptedAt: string;
  user: { id: string; yandexLogin: string | null; username: string };
};

export async function getAdminLegalAcceptances(): Promise<AdminLegalAcceptance[]> {
  const res = await fetch(`${getApiUrl()}/admin/legal/acceptances`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? "Forbidden");
  }
  return res.json();
}

export type LegalStatus = {
  current: { personal_data: string; terms: string; privacy: string };
  accepted: Partial<
    Record<string, { version: string; acceptedAt: string }>
  >;
  upToDate: boolean;
};

export async function getLegalStatus(): Promise<LegalStatus> {
  const res = await fetch(`${getApiUrl()}/auth/legal/status`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  if (!res.ok) throw new Error("Failed to load legal status");
  return res.json();
}

export async function acceptLegalDocuments(bundle: LegalStatus["current"]): Promise<void> {
  const res = await fetch(`${getApiUrl()}/auth/legal/accept`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getToken()}`,
    },
    body: JSON.stringify(bundle),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error || "Не удалось сохранить согласие");
  }
}

export type GrafanaDashboard = {
  uid: string;
  title: string;
  embedPath: string;
};

export async function getGrafanaDashboards(): Promise<GrafanaDashboard[]> {
  const res = await fetch(`${getApiUrl()}/admin/observability/dashboards`, {
    headers: { Authorization: `Bearer ${getToken()}` },
    credentials: "include",
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? "Forbidden");
  }
  const data = (await res.json()) as { dashboards?: GrafanaDashboard[] };
  return data.dashboards ?? [];
}

export async function prepareGrafanaSession(): Promise<void> {
  const res = await fetch(`${getApiUrl()}/admin/observability/session`, {
    method: "POST",
    headers: { Authorization: `Bearer ${getToken()}` },
    credentials: "include",
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? "Forbidden");
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
  opts?: { purpose?: "chat" | "profile" | "sticker" | "report" }
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

export async function getStickerPacksLibrary(): Promise<{ owned: StickerPackSummary[]; installed: StickerPackSummary[] }> {
  const res = await fetch(`${getApiUrl()}/sticker-packs`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  if (!res.ok) throw new Error("Failed to load sticker packs");
  return res.json();
}

export async function getStickerPack(id: string): Promise<StickerPackDetail> {
  const res = await fetch(`${getApiUrl()}/sticker-packs/${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  if (!res.ok) throw new Error("Failed to load sticker pack");
  return res.json();
}

export async function createStickerPack(title: string): Promise<StickerPackSummary> {
  const res = await fetch(`${getApiUrl()}/sticker-packs`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken()}` },
    body: JSON.stringify({ title }),
  });
  if (!res.ok) throw new Error("Failed to create sticker pack");
  return res.json();
}

export async function updateStickerPack(id: string, title: string): Promise<StickerPackSummary> {
  const res = await fetch(`${getApiUrl()}/sticker-packs/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken()}` },
    body: JSON.stringify({ title }),
  });
  if (!res.ok) throw new Error("Failed to update sticker pack");
  return res.json();
}

export async function deleteStickerPack(id: string): Promise<void> {
  const res = await fetch(`${getApiUrl()}/sticker-packs/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  if (!res.ok) throw new Error("Failed to delete sticker pack");
}

export async function addStickerToPack(
  packId: string,
  emoji: string,
  imageUrl: string
): Promise<StickerItem> {
  const res = await fetch(`${getApiUrl()}/sticker-packs/${encodeURIComponent(packId)}/stickers`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken()}` },
    body: JSON.stringify({ emoji, imageUrl }),
  });
  if (!res.ok) throw new Error("Failed to add sticker");
  return res.json();
}

export async function updateStickerEmoji(packId: string, stickerId: string, emoji: string): Promise<StickerItem> {
  const res = await fetch(
    `${getApiUrl()}/sticker-packs/${encodeURIComponent(packId)}/stickers/${encodeURIComponent(stickerId)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken()}` },
      body: JSON.stringify({ emoji }),
    }
  );
  if (!res.ok) throw new Error("Failed to update sticker");
  return res.json();
}

export async function deleteStickerFromPack(packId: string, stickerId: string): Promise<void> {
  const res = await fetch(
    `${getApiUrl()}/sticker-packs/${encodeURIComponent(packId)}/stickers/${encodeURIComponent(stickerId)}`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${getToken()}` },
    }
  );
  if (!res.ok) throw new Error("Failed to delete sticker");
}

export async function installStickerPack(id: string): Promise<void> {
  const res = await fetch(`${getApiUrl()}/sticker-packs/${encodeURIComponent(id)}/install`, {
    method: "POST",
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  if (!res.ok) throw new Error("Failed to add sticker pack");
}

export async function uninstallStickerPack(id: string): Promise<void> {
  const res = await fetch(`${getApiUrl()}/sticker-packs/${encodeURIComponent(id)}/install`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  if (!res.ok) throw new Error("Failed to remove sticker pack");
}

export async function deleteAccount(confirmPhrase: string): Promise<void> {
  const res = await fetch(`${getApiUrl()}/auth/me/delete`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getToken()}`,
    },
    body: JSON.stringify({ confirmPhrase }),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error || "Не удалось удалить аккаунт");
  }
}
