// Shared types between API and Web

export type ChatType = "dm" | "group";
export type SubscriptionTier = "free" | "platinum";

export * from "./birthday";

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
}

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
export type MessageType = "text" | "image" | "file" | "video" | "location" | "voice" | "circle" | "system";

/** Single file in a message (album supports up to 5) */
export interface MessageAttachment {
  url: string;
  fileName?: string;
  mimeType?: string;
  size?: number;
}

/** Attachment metadata (JSON) */
export interface AttachmentMetadata {
  fileName?: string;
  mimeType?: string;
  size?: number;
  duration?: number;
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
  | { type: "mark_read"; chatId: string; messageId?: string }
  | { type: "reaction"; chatId: string; messageId: string; emoji: string | null };

export type WSServerMessage =
  | { type: "auth_ok"; user: User }
  | { type: "auth_error"; error: string }
  | { type: "message"; message: Message }
  | { type: "message_edited"; chatId: string; message: Message }
  | { type: "message_deleted"; chatId: string; messageId: string }
  | { type: "chat_removed"; chatId: string }
  | { type: "chat_members_changed"; chatId: string }
  | { type: "read_receipt"; chatId: string; userId: string; messageId: string; updatedAt?: string }
  | { type: "reaction"; chatId: string; messageId: string; reactions: MessageReaction[] }
  | { type: "typing"; chatId: string; userId: string; isTyping: boolean }
  | { type: "presence"; userId: string; online: boolean }
  | { type: "error"; error: string };
