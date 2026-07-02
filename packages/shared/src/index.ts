// Shared types between API and Web

export type ChatType = "dm" | "group";
export type SubscriptionTier = "free" | "platinum";

export * from "./birthday";
export * from "./timeUuid";
export * from "./uploadLimits";

/** Max messages kept per chat; older ones are removed silently on new sends. */
export const MAX_CHAT_MESSAGES = 1000;

export interface User {
  id: string;
  email?: string;
  username: string;
  avatarUrl: string | null;
  coverUrl?: string | null;
  bio?: string | null;
  profilePhotos?: string[];
  createdAt: string;
  subscriptionTier?: SubscriptionTier;
  subscriptionExpiresAt?: string | null;
  yandexId?: string | null;
  yandexLogin?: string | null;
  birthday?: string | null;
  birthdayVisible?: boolean;
  birthdayLabel?: string | null;
  birthdayAge?: number | null;
  isBirthdayToday?: boolean;
  avatarHistory?: string[];
  betaApproved?: boolean;
  isAdmin?: boolean;
  /** Коины — подарок за поддержку проекта (melon-payment) */
  coinBalance?: number;
}

export interface Chat {
  id: string;
  type: ChatType;
  name: string | null;
  avatarUrl?: string | null;
  createdAt: string;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  members: (User & { role: string })[];
  unreadCount?: number;
  /** Push notifications muted for the current viewer */
  notificationsMuted?: boolean;
  /** Present in DM when either side has blocked the other */
  dmBlockStatus?: { blockedByMe: boolean; blockedByPeer: boolean };
  /** Folder ids this chat belongs to (per-user) */
  folderIds?: string[];
}

export type ChatFolderKind = "custom";

export interface ChatFolder {
  id: string;
  name: string;
  sortOrder: number;
  kind: ChatFolderKind;
}

/** Virtual folder — all chats; not stored on server */
export const VIRTUAL_FOLDER_ALL = "__all__" as const;

export type ChatSharedCategory = "media" | "files" | "voice" | "links";

export interface ChatSharedItem {
  messageId: string;
  messageType: MessageType;
  attachmentUrl: string | null;
  attachmentMetadata?: AttachmentMetadata | null;
  content: string;
  createdAt: string;
  sender?: User;
  links?: string[];
}

/** Message content type */
export type MessageType = "text" | "image" | "file" | "video" | "location" | "voice" | "circle" | "system" | "sticker";

export interface StickerPackSummary {
  id: string;
  title: string;
  creatorId: string;
  creatorUsername?: string;
  stickerCount: number;
  isOwned: boolean;
  isInstalled: boolean;
  createdAt: string;
}

export interface StickerItem {
  id: string;
  packId: string;
  emoji: string;
  /** Signed URL for display */
  imageUrl: string;
  /** Canonical `/uploads/...` path for sending messages */
  imagePath: string;
  sortOrder: number;
}

export interface StickerPackDetail extends StickerPackSummary {
  stickers: StickerItem[];
}

/** Single file in a message (album supports up to 5) */
export interface MessageAttachment {
  url: string;
  fileName?: string;
  mimeType?: string;
  size?: number;
  /** Intrinsic pixel size — позволяет зарезервировать место и избежать скачков скролла. */
  width?: number;
  height?: number;
  /** Poster frame for video items in a mixed album */
  posterUrl?: string;
  duration?: number;
}

/** Attachment metadata (JSON) */
export interface AttachmentMetadata {
  fileName?: string;
  mimeType?: string;
  size?: number;
  duration?: number;
  /** Intrinsic pixel size одиночного вложения (для резервирования места). */
  width?: number;
  height?: number;
  /** First-frame JPEG for video circles */
  posterUrl?: string;
  lat?: number;
  lng?: number;
  attachments?: MessageAttachment[];
  forwardedFrom?: { userId: string; username: string };
  replyTo?: {
    messageId: string;
    senderId: string;
    senderName: string;
    preview: string;
    messageType?: MessageType;
  };
  /** Associated emoji for sticker messages */
  emoji?: string;
  stickerPackId?: string;
  stickerId?: string;
  /** Clickable usernames in group system events */
  systemMentions?: { userId: string; username: string }[];
}

export interface Message {
  id: string;
  chatId: string;
  senderId: string;
  content: string;
  createdAt: string;
  editedAt?: string | null;
  sender?: User;
  messageType?: MessageType;
  attachmentUrl?: string | null;
  attachmentMetadata?: AttachmentMetadata | null;
  reactions?: MessageReaction[];
  /** Только на клиенте: сообщение ещё отправляется */
  clientPending?: boolean;
  /** Только на клиенте: прогресс загрузки вложения 0–100; null — уже загружено, ждём WS */
  uploadProgress?: number | null;
  /** Только на клиенте: отправка не удалась */
  sendFailed?: boolean;
}

export interface MessageReaction {
  emoji: string;
  userId: string;
  username?: string;
}

export type WSClientMessage =
  | { type: "auth"; token: string }
  | { type: "subscribe"; chatId: string }
  | { type: "unsubscribe"; chatId: string }
  | {
      type: "message";
      chatId: string;
      content: string;
      messageType?: MessageType;
      attachmentUrl?: string | null;
      attachmentMetadata?: AttachmentMetadata | null;
    }
  | { type: "typing"; chatId: string; isTyping: boolean }
  | { type: "recording"; chatId: string; kind: "voice" | "circle"; active: boolean }
  | { type: "mark_read"; chatId: string; messageId?: string }
  | { type: "reaction"; chatId: string; messageId: string; emoji: string | null };

export type WSServerMessage =
  | { type: "auth_ok"; user: User }
  | { type: "auth_error"; error: string }
  | { type: "message"; message: Message }
  | { type: "message_edited"; chatId: string; message: Message }
  | { type: "message_deleted"; chatId: string; messageId: string }
  | { type: "chat_removed"; chatId: string }
  | { type: "chat_created"; chat: Chat }
  | { type: "chat_members_changed"; chatId: string }
  | { type: "read_receipt"; chatId: string; userId: string; messageId: string; updatedAt?: string }
  | { type: "reaction"; chatId: string; messageId: string; reactions: MessageReaction[] }
  | { type: "typing"; chatId: string; userId: string; isTyping: boolean }
  | { type: "recording"; chatId: string; userId: string; kind: "voice" | "circle"; active: boolean }
  | { type: "presence"; userId: string; online: boolean }
  | { type: "error"; error: string };
