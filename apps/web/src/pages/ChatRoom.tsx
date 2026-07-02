import { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo } from "react";
import { useAuth } from "../context/AuthContext";
import { useWebSocketContext } from "../context/WebSocketContext";
import { ComposeRecorder } from "../components/ComposeRecorder";
import { VoiceMessagePlayer } from "../components/VoiceMessagePlayer";
import { CircleMessagePlayer } from "../components/CircleMessagePlayer";
import { MessageContextMenu } from "../components/MessageContextMenu";
import { MessageReactions } from "../components/MessageReactions";
import { ForwardMessageModal } from "../components/ForwardMessageModal";
import { SendMediaModal, buildMediaSendItems, revokeMediaSendItems, type MediaSendItem } from "../components/SendMediaModal";
import { LocationPickerModal } from "../components/LocationPickerModal";
import { LocationPreview } from "../components/LocationPreview";
import ImageCropModal from "../components/ImageCropModal";
import ChatInfoModal from "../components/ChatInfoModal";
import { IconAttach, IconFile, IconLocation, IconPhoto, IconSend, IconTrash, IconVideo, IconBack, IconChevronDown, IconSmile, IconSearch, IconForward } from "../components/Icons";
import { AppleEmoji } from "../components/AppleEmoji";
import { ChatMessageSearchPanel } from "../components/ChatMessageSearchPanel";
import ComposeEmojiStickerPanel from "../components/ComposeEmojiStickerPanel";
import StickerPackViewModal from "../components/StickerPackViewModal";
import { getChat, getChats, getMessages, uploadFile, uploadFileWithProgress, removeGroupMember, deleteChat, updateGroup, deleteMessage, editMessage, forwardMessage, signMediaPaths, markChatReadApi, getChatReadCursors, setMessageReaction, sendDmMessage } from "../api";
import { extFromBlobType } from "../utils/mediaMime";
import { compressImage, isGifFileDeep, getImageDimensions } from "../utils/imageCompress";
import { getVideoDimensions } from "../utils/videoDimensions";
import MediaLightbox, { type MediaLightboxItem } from "../components/MediaLightbox";
import { MessageVideoPlayer } from "../components/MessageVideoPlayer";
import { MessageMediaGallery } from "../components/MessageMediaGallery";
import {
  applySignedPathsToMessage,
  collectMessageMediaPaths,
  isVideoFile,
  mediaBatchFallbackLabel,
  planMediaBatchParts,
} from "../utils/messageAttachments";
import type { Chat, Message, AttachmentMetadata, User, MessageType, StickerItem, StickerPackSummary, MessageAttachment } from "@melon/shared";
import { buildSystemMessageNodes } from "../utils/systemMessageContent";
import { mediaMessageCaption, resolveMediaPartContent } from "../utils/mediaCaption";
import { formatPeerActivity, type PeerActivityKind } from "../utils/chatActivity";
import type { MessageItem } from "../api";
import { getWsUrl } from "../config";
import { mediaUrl, mediaDownloadUrl } from "../utils/mediaUrl";
import { UserAvatar } from "../components/UserAvatar";
import { buildReplyTo } from "../utils/messagePreview";
import { formatMessageText } from "../utils/formatMessageText";
import { parseLocationCoords } from "../utils/yandexMaps";
import {
  capturePrependScroll,
  restorePrependScroll,
  scrollListToBottom,
  type PrependScrollState,
} from "../utils/messageListScroll";
import {
  countUnreadBelowViewport,
  findUnreadBounds,
  isMessageVisibleInViewport,
  scrollListToMessage,
  compareMessageId,
} from "../utils/chatUnread";
import { getMessageReaders, isMessageReadByAnyPeer, isMessageReadByCursor, mergeReadCursor } from "../utils/messageRead";
import { formatMessageDateLabel, shouldShowDateDivider } from "../utils/messageDates";
import { captureCirclePoster } from "../utils/circlePoster";
import { captureVideoPoster } from "../utils/videoPoster";
import { getVideoMetaCache, probeVideoMeta, setVideoMetaCache } from "../utils/videoMetaCache";
import { playMessageSound } from "../utils/messageSounds";
import { canMarkChatReadNow } from "../utils/canMarkChatReadNow";
import { createOutgoingSendQueue } from "../utils/outgoingSendQueue";
import { findPendingMessageForServer } from "../utils/matchPendingMessage";
import {
  clearComposeDraft,
  getComposeDraft,
  resolveComposeDraftKey,
  setComposeDraft,
} from "../utils/chatComposeDrafts";

type ChatRoomProps = {
  chatId?: string;
  draftPeer?: User;
  onDraftChatCreated?: (chat: Chat) => void;
  onClose: () => void;
  openProfile: (userId?: string) => void;
  onSyncPreview?: (message: Message) => void;
  showBack?: boolean;
};

const MESSAGE_PAGE_SIZE = 50;

export default function ChatRoom({ chatId, draftPeer, onDraftChatCreated, onClose, openProfile, onSyncPreview: _onSyncPreview, showBack = false }: ChatRoomProps) {
  const isDraft = Boolean(draftPeer && !chatId);
  const { user } = useAuth();
  const { send, ready, status, reconnect, subscribe } = useWebSocketContext();
  const [chat, setChat] = useState<Chat | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [messagesReady, setMessagesReady] = useState(false);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const groupAvatarInputRef = useRef<HTMLInputElement>(null);
  const [groupAvatarCropFile, setGroupAvatarCropFile] = useState<File | null>(null);
  const [locationPickerOpen, setLocationPickerOpen] = useState(false);
  const [attachMenuOpen, setAttachMenuOpen] = useState(false);
  const [emojiPanelOpen, setEmojiPanelOpen] = useState(false);
  const [stickerPackViewId, setStickerPackViewId] = useState<string | null>(null);
  const [mediaLightbox, setMediaLightbox] = useState<{ items: MediaLightboxItem[]; index: number } | null>(null);
  const [fileDragActive, setFileDragActive] = useState(false);
  const [contactInfoOpen, setContactInfoOpen] = useState(false);
  const [deleteChatConfirmOpen, setDeleteChatConfirmOpen] = useState(false);
  const [deleteChatBusy, setDeleteChatBusy] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const topSentinelRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const pendingInitialScrollRef = useRef(false);
  const suppressAutoReadRef = useRef(false);
  const serverUnreadCountRef = useRef(0);
  const [serverUnreadCount, setServerUnreadCount] = useState(0);
  const [unreadJumpCount, setUnreadJumpCount] = useState(0);
  const [awayFromBottom, setAwayFromBottom] = useState(false);
  const [chatSearchOpen, setChatSearchOpen] = useState(false);
  const fileDragDepthRef = useRef(0);
  const longPressRef = useRef<number | null>(null);
  const [messageMenu, setMessageMenu] = useState<{ message: Message; x: number; y: number } | null>(null);
  const [forwardTargets, setForwardTargets] = useState<Message[] | null>(null);
  const [forwardChats, setForwardChats] = useState<Chat[]>([]);
  const [forwarding, setForwarding] = useState(false);
  const [replyDraft, setReplyDraft] = useState<Message | null>(null);
  const [highlightMessageId, setHighlightMessageId] = useState<string | null>(null);
  const highlightTimerRef = useRef<number | null>(null);
  const [editDraft, setEditDraft] = useState<Message | null>(null);
  const [mediaSendDraft, setMediaSendDraft] = useState<{ items: MediaSendItem[]; caption: string } | null>(null);
  const composeInputRef = useRef<HTMLInputElement>(null);
  const composeDraftKeyRef = useRef<string | null>(null);
  const composeDraftTextRef = useRef("");
  const outgoingSendQueueRef = useRef(createOutgoingSendQueue());
  const editDraftRef = useRef<Message | null>(null);
  editDraftRef.current = editDraft;
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const selectionMode = selectedIds.size > 0;
  const [readCursors, setReadCursors] = useState<Record<string, string>>({});
  const readCursorsRef = useRef<Record<string, string>>({});
  const readCursorTimesRef = useRef<Record<string, string>>({});
  const messagesRef = useRef<Message[]>([]);
  const hasMoreOlderRef = useRef(true);
  const [peerActivities, setPeerActivities] = useState<Map<string, PeerActivityKind>>(() => new Map());
  const peerActivityTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const typingActiveRef = useRef(false);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadingOlderRef = useRef(false);
  const loadOlderLockRef = useRef(false);
  const lastOlderLoadAtRef = useRef(0);
  const loadingRef = useRef(true);
  const prependingOlderRef = useRef(false);
  const pendingPrependRef = useRef<PrependScrollState | null>(null);
  const [prependTick, setPrependTick] = useState(0);
  const [reloadNonce, setReloadNonce] = useState(0);
  const lastMarkedReadRef = useRef<string | null>(null);
  const lastMarkedReadChatIdRef = useRef<string | null>(null);
  const lastPersistedReadRef = useRef<string | null>(null);
  const markReadRetryRef = useRef<number | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const closeOverlays = () => setContactInfoOpen(false);
    window.addEventListener("wm:close-chat-overlays", closeOverlays);
    return () => window.removeEventListener("wm:close-chat-overlays", closeOverlays);
  }, []);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    loadingRef.current = loading;
  }, [loading]);

  function applyReadCursors(rows: { userId: string; lastReadMessageId: string; updatedAt?: string }[]) {
    const map = { ...readCursorsRef.current };
    const times = { ...readCursorTimesRef.current };
    for (const r of rows) {
      const key = r.userId.toLowerCase();
      map[key] = mergeReadCursor(map[key], r.lastReadMessageId);
      if (r.updatedAt) times[key] = r.updatedAt;
    }
    readCursorsRef.current = map;
    readCursorTimesRef.current = times;
    setReadCursors(map);
  }

  function canonicalMessageId(messageId: string): string {
    const found = messagesRef.current.find((m) => m.id.toLowerCase() === messageId.toLowerCase());
    return found?.id ?? messageId;
  }

  function canMarkReadNow(): boolean {
    return canMarkChatReadNow();
  }

  function membersForReadReceipts(): User[] {
    if (chat?.members?.length) return chat.members;
    if (chat?.type === "dm" && user?.id) {
      const peer =
        chat.members.find((m) => m.id.toLowerCase() !== user.id.toLowerCase()) ??
        Object.keys(readCursorsRef.current)
          .filter((k) => k !== user.id.toLowerCase())
          .map((id) => ({ id, username: "?" } as User))[0];
      if (peer) {
        return [{ id: user.id, username: user.username ?? "?", avatarUrl: user.avatarUrl } as User, peer];
      }
    }
    return chat?.members ?? [];
  }

  function resolveMarkReadTarget(): string | null {
    const list = messagesRef.current;
    if (!list.length || !user?.id || !listRef.current) return null;

    const userKey = user.id.toLowerCase();
    const listEl = listRef.current;

    // Внизу чата — прочитано до последнего сообщения (включая своё: TimeUUID курсора покрывает всё до него).
    if (stickToBottomRef.current) {
      for (let i = list.length - 1; i >= 0; i--) {
        const m = list[i]!;
        if ((m.messageType ?? "text") === "system") continue;
        return m.id;
      }
    }

    // Иначе — самое новое видимое входящее.
    let best: string | null = null;
    for (const m of list) {
      if ((m.messageType ?? "text") === "system") continue;
      if (m.senderId.toLowerCase() === userKey) continue;
      if (!isMessageVisibleInViewport(listEl, m.id)) continue;
      if (!best || compareMessageId(m.id, best) > 0) best = m.id;
    }
    return best;
  }

  function persistMarkRead(messageId: string, attempt = 0) {
    if (!chatId || !user?.id) return;
    const normalized = messageId.toLowerCase();
    const apiId = canonicalMessageId(messageId);

    if (lastPersistedReadRef.current && compareMessageId(lastPersistedReadRef.current, normalized) >= 0) {
      serverUnreadCountRef.current = 0;
      setServerUnreadCount(0);
      suppressAutoReadRef.current = false;
      window.dispatchEvent(new CustomEvent("wm:chat-read", { detail: { chatId } }));
      return;
    }

    const run = async () => {
      if (!canMarkReadNow()) return;
      try {
        if (ready) send({ type: "mark_read", chatId, messageId: apiId });
        await markChatReadApi(chatId, apiId);
        lastPersistedReadRef.current = normalized;
        lastMarkedReadRef.current = normalized;
        lastMarkedReadChatIdRef.current = chatId;
        serverUnreadCountRef.current = 0;
        setServerUnreadCount(0);
        suppressAutoReadRef.current = false;
        window.dispatchEvent(new CustomEvent("wm:chat-read", { detail: { chatId } }));
      } catch (err) {
        console.warn("mark read failed:", err);
        if (attempt < 4) {
          markReadRetryRef.current = window.setTimeout(
            () => persistMarkRead(messageId, attempt + 1),
            400 * (attempt + 1)
          );
        }
      }
    };
    void run();
  }

  function markChatRead(messageId: string) {
    if (!chatId || !user?.id || !canMarkReadNow() || !messagesReady) return;
    const normalized = messageId.trim().toLowerCase();
    const userKey = user.id.toLowerCase();
    const mine = readCursorsRef.current[userKey] ?? readCursorsRef.current[user.id];
    if (mine && compareMessageId(mine, normalized) >= 0) {
      persistMarkRead(messageId);
      return;
    }
    const markedAt = new Date().toISOString();
    readCursorsRef.current[userKey] = normalized;
    readCursorTimesRef.current[userKey] = markedAt;
    setReadCursors((prev) => ({ ...prev, [userKey]: normalized }));
    lastMarkedReadRef.current = normalized;
    lastMarkedReadChatIdRef.current = chatId;
    persistMarkRead(messageId);
  }

  function scheduleMarkChatRead(messageId: string) {
    requestAnimationFrame(() => markChatRead(messageId));
  }

  useEffect(() => {
    if (!deleteChatConfirmOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !deleteChatBusy) setDeleteChatConfirmOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [deleteChatConfirmOpen, deleteChatBusy]);

  useEffect(() => {
    if (!mediaLightbox) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMediaLightbox(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mediaLightbox]);

  useEffect(() => {
    return () => {
      if (highlightTimerRef.current) window.clearTimeout(highlightTimerRef.current);
    };
  }, []);

  useEffect(() => {
    setSelectedIds(new Set());
    setReadCursors({});
    readCursorsRef.current = {};
    readCursorTimesRef.current = {};
    lastMarkedReadRef.current = null;
    lastMarkedReadChatIdRef.current = null;
    lastPersistedReadRef.current = null;
    if (markReadRetryRef.current) {
      window.clearTimeout(markReadRetryRef.current);
      markReadRetryRef.current = null;
    }
    setReplyDraft(null);
    setEditDraft(null);
    outgoingSendQueueRef.current = createOutgoingSendQueue();
    setMediaSendDraft((draft) => {
      if (draft) revokeMediaSendItems(draft.items);
      return null;
    });
    stickToBottomRef.current = true;
    pendingInitialScrollRef.current = true;
    setMessagesReady(false);
    suppressAutoReadRef.current = false;
    serverUnreadCountRef.current = 0;
    setServerUnreadCount(0);
    setUnreadJumpCount(0);
    setDeleteChatConfirmOpen(false);
    setDeleteChatBusy(false);
  }, [chatId]);

  const applyComposeInput = useCallback((value: string | ((prev: string) => string)) => {
    setInput((prev) => {
      const next = typeof value === "function" ? value(prev) : value;
      if (!editDraftRef.current) {
        composeDraftTextRef.current = next;
        const key = composeDraftKeyRef.current;
        if (key) setComposeDraft(key, next);
      }
      return next;
    });
  }, []);

  const restoreComposeInput = useCallback(() => {
    applyComposeInput(composeDraftTextRef.current);
  }, [applyComposeInput]);

  useEffect(() => {
    const key = resolveComposeDraftKey(chatId, draftPeer?.id);
    composeDraftKeyRef.current = key;
    const text = key ? getComposeDraft(key) : "";
    composeDraftTextRef.current = text;
    setInput(text);

    return () => {
      const saveKey = composeDraftKeyRef.current;
      if (saveKey) setComposeDraft(saveKey, composeDraftTextRef.current);
    };
  }, [chatId, draftPeer?.id]);

  useEffect(() => {
    if (!replyDraft && !editDraft) return;
    composeInputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (editDraft) {
        setEditDraft(null);
        restoreComposeInput();
      }
      setReplyDraft(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [replyDraft, editDraft, restoreComposeInput]);

  useEffect(() => {
    if (!selectionMode) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelectedIds(new Set());
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectionMode]);

  const otherMember = chat?.type === "dm" ? chat.members.find((m) => m.id !== user?.id) : null;

  function getPeerReaders(m: Message) {
    if (!user?.id || m.senderId.toLowerCase() !== user.id.toLowerCase()) return [];
    return getMessageReaders(m.id, m.senderId, membersForReadReceipts(), readCursors);
  }

  function isMessageReadByPeers(m: Message): boolean {
    if (!user?.id || m.senderId.toLowerCase() !== user.id.toLowerCase()) return false;
    if (chat?.type === "dm") {
      const peerId = otherMember?.id ?? Object.keys(readCursors).find((k) => k !== user.id.toLowerCase());
      if (!peerId) return false;
      const peerCursor = readCursors[peerId.toLowerCase()] ?? readCursors[peerId];
      return isMessageReadByCursor(m.id, peerCursor);
    }
    return isMessageReadByAnyPeer(m.id, m.senderId, membersForReadReceipts(), readCursors);
  }

  const peerActivityLabel = useMemo(() => {
    if (!chat || peerActivities.size === 0) return null;
    const names = new Map(chat.members.map((m) => [m.id, m.username]));
    return formatPeerActivity(peerActivities, names, chat.type === "group");
  }, [chat, peerActivities]);

  const myLastReadId = user?.id
    ? (readCursors[user.id.toLowerCase()] ?? readCursors[user.id] ?? readCursorsRef.current[user.id.toLowerCase()] ?? null)
    : null;
  const unreadBounds = useMemo(
    () =>
      user?.id
        ? findUnreadBounds(messages, myLastReadId, user.id, serverUnreadCount)
        : { first: null, last: null, count: 0 },
    [messages, myLastReadId, user?.id, serverUnreadCount]
  );

  const refreshUnreadJumpCount = useCallback(() => {
    const list = listRef.current;
    if (!list || !user?.id || serverUnreadCountRef.current <= 0) {
      setUnreadJumpCount(0);
      return;
    }
    setUnreadJumpCount(
      countUnreadBelowViewport(
        list,
        messagesRef.current,
        readCursorsRef.current[user.id] ?? null,
        user.id,
        serverUnreadCountRef.current
      )
    );
  }, [user?.id]);

  const updateScrollAwayState = useCallback(() => {
    const list = listRef.current;
    if (!list) return;
    const distanceFromBottom = list.scrollHeight - list.scrollTop - list.clientHeight;
    const atBottom = distanceFromBottom < 80;
    stickToBottomRef.current = atBottom;
    setAwayFromBottom(!atBottom);
    refreshUnreadJumpCount();
  }, [refreshUnreadJumpCount]);

  const tryMarkReadFromScroll = useCallback(() => {
    if (!chatId || !user?.id || messagesRef.current.length === 0 || !canMarkReadNow() || !messagesReady) return;
    const target = resolveMarkReadTarget();
    if (target) markChatRead(target);
  }, [chatId, user?.id, messagesReady]);

  useEffect(() => {
    if (!chatId || !ready) return;
    send({ type: "subscribe", chatId });
  }, [chatId, ready, send]);

  useEffect(() => {
    if (!chatId || !messagesReady) return;
    let cancelled = false;
    const sync = () => {
      void getChatReadCursors(chatId).then((rows) => {
        if (!cancelled && rows.length) applyReadCursors(rows);
      });
    };
    sync();
    const timer = window.setInterval(sync, 4000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [chatId, messagesReady]);

  const clearPeerActivity = useCallback((userId: string) => {
    const timer = peerActivityTimersRef.current.get(userId);
    if (timer) clearTimeout(timer);
    peerActivityTimersRef.current.delete(userId);
    setPeerActivities((prev) => {
      if (!prev.has(userId)) return prev;
      const next = new Map(prev);
      next.delete(userId);
      return next;
    });
  }, []);

  const setPeerActivity = useCallback(
    (userId: string, kind: PeerActivityKind, active: boolean) => {
      if (!userId || userId.toLowerCase() === user?.id?.toLowerCase()) return;
      const existingTimer = peerActivityTimersRef.current.get(userId);
      if (existingTimer) clearTimeout(existingTimer);
      if (!active) {
        clearPeerActivity(userId);
        return;
      }
      setPeerActivities((prev) => {
        const next = new Map(prev);
        next.set(userId, kind);
        return next;
      });
      peerActivityTimersRef.current.set(
        userId,
        setTimeout(() => clearPeerActivity(userId), kind === "typing" ? 4500 : 8000)
      );
    },
    [clearPeerActivity, user?.id]
  );

  useEffect(() => {
    setPeerActivities(new Map());
    peerActivityTimersRef.current.forEach((t) => clearTimeout(t));
    peerActivityTimersRef.current.clear();
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    if (typingActiveRef.current && chatId && ready) {
      send({ type: "typing", chatId, isTyping: false });
    }
    typingActiveRef.current = false;
  }, [chatId, ready, send]);

  const notifyTyping = useCallback(
    (active: boolean) => {
      if (!chatId || !ready) return;
      send({ type: "typing", chatId, isTyping: active });
    },
    [chatId, ready, send]
  );

  const notifyRecording = useCallback(
    (kind: "voice" | "circle", active: boolean) => {
      if (!chatId || !ready) return;
      send({ type: "recording", chatId, kind, active });
    },
    [chatId, ready, send]
  );

  const handleInputChange = useCallback(
    (value: string) => {
      applyComposeInput(value);
      if (!chatId || editDraft) return;
      if (!typingActiveRef.current) {
        typingActiveRef.current = true;
        notifyTyping(true);
      }
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
      typingTimerRef.current = setTimeout(() => {
        typingActiveRef.current = false;
        notifyTyping(false);
      }, 3000);
    },
    [chatId, editDraft, notifyTyping, applyComposeInput]
  );

  const revokeMessageBlobUrls = useCallback((m: Message) => {
    if (m.attachmentUrl?.startsWith("blob:")) URL.revokeObjectURL(m.attachmentUrl);
    if (m.attachmentMetadata?.posterUrl?.startsWith("blob:")) {
      URL.revokeObjectURL(m.attachmentMetadata.posterUrl);
    }
  }, []);

  const appendOptimisticMessage = useCallback((msg: Message) => {
    setMessages((prev) => [...prev, msg]);
    stickToBottomRef.current = true;
    requestAnimationFrame(() => scrollToBottom(false));
  }, []);

  const updateOptimisticMessage = useCallback((id: string, patch: Partial<Message>) => {
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  }, []);

  const resolveOptimisticWithServer = useCallback(
    (serverMsg: Message) => {
      setMessages((prev) => {
        if (prev.some((m) => m.id === serverMsg.id)) return prev;
        const idx = findPendingMessageForServer(prev, serverMsg);
        if (idx < 0) return [...prev, serverMsg];
        revokeMessageBlobUrls(prev[idx]!);
        const next = [...prev];
        next[idx] = { ...serverMsg, clientPending: false, uploadProgress: undefined, sendFailed: false };
        return next;
      });
    },
    [revokeMessageBlobUrls]
  );

  const enqueueOutgoingSend = useCallback(<T,>(task: () => Promise<T>): Promise<T> => {
    return outgoingSendQueueRef.current.enqueue(task);
  }, []);

  const insertOptimisticMessage = useCallback(
    (
      opts: {
        content: string;
        messageType?: MessageType;
        attachmentUrl?: string | null;
        attachmentMetadata?: AttachmentMetadata | null;
        uploadProgress?: number | null;
      },
      withReply = true
    ): string => {
      const id = `pending-${crypto.randomUUID()}`;
      if (!user || !chatId) return id;
      const replyMeta: AttachmentMetadata | null =
        withReply && replyDraft
          ? { ...(opts.attachmentMetadata ?? {}), replyTo: buildReplyTo(replyDraft) }
          : opts.attachmentMetadata ?? null;
      appendOptimisticMessage({
        id,
        chatId,
        senderId: user.id,
        content: opts.content,
        createdAt: new Date().toISOString(),
        sender: user,
        messageType: opts.messageType ?? "text",
        attachmentUrl: opts.attachmentUrl ?? null,
        attachmentMetadata: replyMeta,
        clientPending: true,
        uploadProgress: opts.uploadProgress ?? null,
      });
      return id;
    },
    [user, chatId, replyDraft, appendOptimisticMessage]
  );

  useEffect(() => {
    return subscribe((msg) => {
      if (msg.type === "message" && msg.message.chatId === chatId) {
        const incoming = msg.message;
        const fromOther = incoming.senderId.toLowerCase() !== user?.id?.toLowerCase();
        const afterAppend = (next: Message[]) => {
          if (fromOther && !stickToBottomRef.current) {
            serverUnreadCountRef.current += 1;
            setServerUnreadCount((c) => c + 1);
            suppressAutoReadRef.current = true;
          } else if (fromOther && stickToBottomRef.current) {
            if (canMarkReadNow()) {
              scheduleMarkChatRead(incoming.id);
            } else {
              serverUnreadCountRef.current += 1;
              setServerUnreadCount((c) => c + 1);
              suppressAutoReadRef.current = true;
            }
          } else if (!fromOther && stickToBottomRef.current) {
            requestAnimationFrame(() => scrollToBottom(false));
          }
          return next;
        };
        const paths = collectMessageMediaPaths(incoming);
        const needsSign = paths.some((p) => p && !p.includes("access="));
        if (needsSign && paths.length) {
          void signMediaPaths(paths).then((signed) => {
            const signedMsg = applySignedPathsToMessage(incoming, signed);
            if (fromOther) {
              setMessages((prev) => {
                if (prev.some((m) => m.id === signedMsg.id)) return prev;
                return afterAppend([...prev, signedMsg]);
              });
            } else {
              resolveOptimisticWithServer(signedMsg);
              if (stickToBottomRef.current) requestAnimationFrame(() => scrollToBottom(false));
            }
          });
          return;
        }
        if (fromOther) {
          setMessages((prev) => {
            if (prev.some((m) => m.id === incoming.id)) return prev;
            return afterAppend([...prev, incoming]);
          });
        } else {
          resolveOptimisticWithServer(incoming);
        }
      }
      if (msg.type === "message_deleted" && msg.chatId === chatId) {
        setMessages((prev) => prev.filter((m) => m.id !== msg.messageId));
      }
      if (msg.type === "message_edited" && msg.chatId === chatId) {
        setMessages((prev) =>
          prev.map((m) => (m.id === msg.message.id ? { ...m, ...msg.message } : m))
        );
      }
      if (msg.type === "read_receipt" && msg.chatId === chatId) {
        const incomingId = msg.messageId.trim().toLowerCase();
        const userKey = msg.userId.toLowerCase();
        const updatedAt = msg.updatedAt ?? new Date().toISOString();
        const cur = readCursorsRef.current[userKey];
        const merged = mergeReadCursor(cur, incomingId);
        if (cur === merged) {
          const curTime = readCursorTimesRef.current[userKey];
          const curAt = curTime ? Date.parse(curTime) : NaN;
          const incAt = Date.parse(updatedAt);
          if (!Number.isFinite(incAt) || (Number.isFinite(curAt) && incAt <= curAt)) return;
        }
        const nextCursors = { ...readCursorsRef.current, [userKey]: merged };
        const nextTimes = { ...readCursorTimesRef.current, [userKey]: updatedAt };
        readCursorsRef.current = nextCursors;
        readCursorTimesRef.current = nextTimes;
        setReadCursors(nextCursors);
      }
      if (msg.type === "reaction" && msg.chatId === chatId) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id.toLowerCase() === msg.messageId.toLowerCase() ? { ...m, reactions: msg.reactions } : m
          )
        );
      }
      if (msg.type === "chat_members_changed" && msg.chatId === chatId) {
        void getChat(chatId).then((c) => {
          if (c) setChat(c as Chat);
        });
        window.dispatchEvent(new Event("wm:refresh-chats"));
      }
      if (msg.type === "typing" && msg.chatId === chatId) {
        setPeerActivity(msg.userId, "typing", msg.isTyping);
      }
      if (msg.type === "recording" && msg.chatId === chatId) {
        setPeerActivity(msg.userId, msg.kind, msg.active);
      }
    });
  }, [subscribe, chatId, user?.id, setPeerActivity, resolveOptimisticWithServer]);

  const loadOlderMessages = useCallback(async () => {
    if (!chatId || loadOlderLockRef.current || !hasMoreOlderRef.current || loadingRef.current) return;
    const oldest = messagesRef.current[0];
    if (!oldest) return;

    const listEl = listRef.current;
    if (!listEl) return;

    loadOlderLockRef.current = true;
    loadingOlderRef.current = true;
    prependingOlderRef.current = true;
    lastOlderLoadAtRef.current = Date.now();
    setLoadingOlder(true);

    let didPrepend = false;
    try {
      const { messages: older } = await getMessages(chatId, MESSAGE_PAGE_SIZE, oldest.id);
      const batch = older as Message[];
      if (batch.length < MESSAGE_PAGE_SIZE) {
        hasMoreOlderRef.current = false;
      }
      if (batch.length === 0) {
        hasMoreOlderRef.current = false;
        return;
      }
      const listNow = listRef.current;
      if (!listNow) return;
      pendingPrependRef.current = capturePrependScroll(listNow);
      setMessages((prev) => {
        const ids = new Set(prev.map((m) => m.id));
        const fresh = batch.filter((m) => !ids.has(m.id));
        if (fresh.length === 0) {
          hasMoreOlderRef.current = false;
          return prev;
        }
        didPrepend = true;
        return [...fresh, ...prev];
      });
      if (didPrepend) setPrependTick((t) => t + 1);
    } catch (err) {
      console.error(err);
    } finally {
      if (!didPrepend) {
        loadOlderLockRef.current = false;
        loadingOlderRef.current = false;
        prependingOlderRef.current = false;
        pendingPrependRef.current = null;
        setLoadingOlder(false);
      }
    }
  }, [chatId]);

  useEffect(() => {
    if (!chatId) return;
    const refreshChat = () => {
      void getChat(chatId).then((c) => {
        if (c) setChat(c as Chat);
      });
    };
    window.addEventListener("wm:block-changed", refreshChat);
    return () => window.removeEventListener("wm:block-changed", refreshChat);
  }, [chatId]);

  useEffect(() => {
    if (!chatId || messages.length === 0 || !user?.id || !canMarkReadNow() || !messagesReady) return;
    if (prependingOlderRef.current || loadingOlderRef.current) return;

    const listEl = listRef.current;
    const firstUnread = unreadBounds.first;
    if (suppressAutoReadRef.current && firstUnread && listEl) {
      if (isMessageVisibleInViewport(listEl, firstUnread.id, 8)) {
        suppressAutoReadRef.current = false;
      } else {
        refreshUnreadJumpCount();
        return;
      }
    }

    tryMarkReadFromScroll();
  }, [chatId, messages, user?.id, messagesReady, tryMarkReadFromScroll, refreshUnreadJumpCount, unreadBounds.first]);

  useEffect(() => {
    if (!isDraft || !draftPeer || !user) return;
    setChat({
      id: "",
      type: "dm",
      name: null,
      createdAt: new Date().toISOString(),
      lastMessageAt: null,
      lastMessagePreview: null,
      members: [
        { ...draftPeer, role: "member", createdAt: draftPeer.createdAt ?? new Date().toISOString() },
        {
          id: user.id,
          username: user.username,
          avatarUrl: user.avatarUrl,
          createdAt: user.createdAt ?? new Date().toISOString(),
          role: "member",
        },
      ],
    });
    setMessages([]);
    setLoading(false);
    loadingRef.current = false;
    setMessagesReady(true);
    setLoadError("");
  }, [isDraft, draftPeer, user]);

  useEffect(() => {
    if (!chatId || isDraft) return;
    let cancelled = false;
    setLoading(true);
    loadingRef.current = true;
    setLoadingOlder(false);
    loadingOlderRef.current = false;
    loadOlderLockRef.current = false;
    prependingOlderRef.current = false;
    pendingPrependRef.current = null;
    hasMoreOlderRef.current = true;
    setMessages([]);
    setAwayFromBottom(false);
    setChatSearchOpen(false);
    stickToBottomRef.current = true;
    setLoadError("");
    getChat(chatId)
      .then((c) => {
        if (cancelled) return;
        if (!c) {
          setLoadError("Не удалось открыть чат");
          return;
        }
        setChat(c as Chat);
      })
      .catch(() => {
        if (!cancelled) setLoadError("Не удалось открыть чат");
      });

    getMessages(chatId, MESSAGE_PAGE_SIZE)
      .then(({ messages: list, readCursors: cursors, myLastReadMessageId, unreadCount }) => {
        if (!cancelled) {
          const unread = unreadCount ?? 0;
          serverUnreadCountRef.current = unread;
          setServerUnreadCount(unread);
          if (cursors?.length) applyReadCursors(cursors);
          if (user?.id && myLastReadMessageId) {
            const mine = myLastReadMessageId.trim().toLowerCase();
            const userKey = user.id.toLowerCase();
            readCursorsRef.current[userKey] = mine;
            setReadCursors((prev) => ({ ...prev, [userKey]: mine }));
            lastPersistedReadRef.current = mine;
            const ownCursor = cursors?.find((c) => c.userId.toLowerCase() === userKey);
            if (ownCursor?.updatedAt) {
              readCursorTimesRef.current[userKey] = ownCursor.updatedAt;
            }
          }
          suppressAutoReadRef.current = unread > 0;
          setMessages(list as Message[]);
          const more = list.length >= MESSAGE_PAGE_SIZE;
          hasMoreOlderRef.current = more;
        }
      })
      .catch(() => {
        if (!cancelled) {
          setMessages([]);
          setLoadError("Не удалось загрузить сообщения");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
          loadingRef.current = false;
        }
      });
    return () => {
      cancelled = true;
    };
  }, [chatId, reloadNonce]);

  useLayoutEffect(() => {
    const pending = pendingPrependRef.current;
    if (!pending || !prependingOlderRef.current) return;
    const list = listRef.current;
    if (!list) return;

    let finished = false;
    let lastHeight = -1;
    let stableFrames = 0;

    const finish = () => {
      if (finished) return;
      finished = true;
      ro.disconnect();
      window.clearTimeout(maxWait);
      pendingPrependRef.current = null;
      prependingOlderRef.current = false;
      loadingOlderRef.current = false;
      loadOlderLockRef.current = false;
      setLoadingOlder(false);
    };

    const stick = () => {
      if (finished) return;
      const ok = restorePrependScroll(list, pending);
      if (!ok && pending.anchorMessageId) {
        requestAnimationFrame(stick);
        return;
      }
      const h = list.scrollHeight;
      if (h === lastHeight) stableFrames += 1;
      else {
        lastHeight = h;
        stableFrames = 0;
      }
      if (stableFrames >= 2) {
        updateScrollAwayState();
        finish();
      }
    };

    stick();
    requestAnimationFrame(stick);

    const ro = new ResizeObserver(() => stick());
    ro.observe(list);

    const maxWait = window.setTimeout(finish, 1500);

    return () => {
      if (!finished) {
        ro.disconnect();
        window.clearTimeout(maxWait);
      }
    };
  }, [prependTick]);

  useEffect(() => {
    const root = listRef.current;
    const sentinel = topSentinelRef.current;
    if (!root || !sentinel || loading) return;

    const io = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting) return;
        if (loadOlderLockRef.current || loadingOlderRef.current || loadingRef.current || !hasMoreOlderRef.current) {
          return;
        }
        if (Date.now() - lastOlderLoadAtRef.current < 800) return;
        void loadOlderMessages();
      },
      { root, rootMargin: "0px", threshold: 0 }
    );
    io.observe(sentinel);
    return () => io.disconnect();
  }, [chatId, loading, loadOlderMessages]);

  useEffect(() => {
    return () => {
      if (markReadRetryRef.current) {
        window.clearTimeout(markReadRetryRef.current);
        markReadRetryRef.current = null;
      }
      const id = chatId;
      const list = messagesRef.current;
      const lastMsg = list[list.length - 1];
      if (!id || !lastMsg) return;

      const lastRead = lastMarkedReadRef.current;
      const atBottom = stickToBottomRef.current;
      const alreadyMarked =
        lastRead &&
        lastMarkedReadChatIdRef.current === id &&
        compareMessageId(lastRead, lastMsg.id) >= 0;

      if (!atBottom && !alreadyMarked) return;
      if (!canMarkChatReadNow()) return;

      const targetId = alreadyMarked ? lastRead! : lastMsg.id;
      const apiId = canonicalMessageId(targetId);
      void markChatReadApi(id, apiId)
        .then(() => {
          window.dispatchEvent(new CustomEvent("wm:chat-read", { detail: { chatId: id } }));
        })
        .catch(() => {});
    };
  }, [chatId]);

  const scrollToBottom = useCallback((_instant: boolean) => {
    const list = listRef.current;
    if (list) {
      scrollListToBottom(list, messagesEndRef.current);
    } else {
      messagesEndRef.current?.scrollIntoView({ behavior: "auto", block: "end" });
    }
    stickToBottomRef.current = true;
    setAwayFromBottom(false);
  }, []);

  const jumpDown = useCallback(() => {
    const list = listRef.current;
    if (!list) return;

    const firstUnread =
      serverUnreadCountRef.current > 0 && user?.id
        ? findUnreadBounds(
            messagesRef.current,
            readCursorsRef.current[user.id.toLowerCase()] ?? readCursorsRef.current[user.id] ?? null,
            user.id,
            serverUnreadCountRef.current
          ).first
        : null;

    if (firstUnread) {
      suppressAutoReadRef.current = true;
      scrollListToMessage(list, firstUnread.id, "start", 16);
      stickToBottomRef.current = false;
      setAwayFromBottom(true);
    } else {
      scrollToBottom(false);
    }

    requestAnimationFrame(() => {
      updateScrollAwayState();
      tryMarkReadFromScroll();
    });
  }, [scrollToBottom, updateScrollAwayState, tryMarkReadFromScroll, user?.id]);

  useEffect(() => {
    const list = listRef.current;
    if (!list || !messagesReady) return;
    const onScroll = () => {
      updateScrollAwayState();
      tryMarkReadFromScroll();
    };
    const onFocus = () => {
      if (canMarkReadNow()) tryMarkReadFromScroll();
    };
    const onVisibility = () => {
      if (canMarkReadNow()) tryMarkReadFromScroll();
    };
    list.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    updateScrollAwayState();
    return () => {
      list.removeEventListener("scroll", onScroll);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [chatId, messagesReady, updateScrollAwayState, tryMarkReadFromScroll]);

  useLayoutEffect(() => {
    if (loading && messages.length === 0) return;
    if (messages.length === 0) return;
    if (!pendingInitialScrollRef.current) return;
    if (prependingOlderRef.current || loadingOlderRef.current || loadingOlder) return;

    const list = listRef.current;
    if (!list) return;

    const sessionChatId = chatId;
    const firstUnread = serverUnreadCount > 0 ? unreadBounds.first : null;

    const snap = () => {
      if (!listRef.current || sessionChatId !== chatId) return;
      const list = listRef.current;
      const endEl = messagesEndRef.current;
      scrollListToBottom(list, endEl);
      if (firstUnread && !isMessageVisibleInViewport(list, firstUnread.id, 16)) {
        stickToBottomRef.current = false;
        scrollListToMessage(list, firstUnread.id, "start", 16);
      } else {
        stickToBottomRef.current = true;
        suppressAutoReadRef.current = false;
        scrollListToBottom(list, endEl);
      }
    };

    snap();
    requestAnimationFrame(snap);
    pendingInitialScrollRef.current = false;
    setMessagesReady(true);
    requestAnimationFrame(() => updateScrollAwayState());
    tryMarkReadFromScroll();

    let refineFrames = 0;
    const refine = () => {
      if (sessionChatId !== chatId) return;
      snap();
      refineFrames += 1;
      if (refineFrames < 12) requestAnimationFrame(refine);
    };
    requestAnimationFrame(refine);
    requestAnimationFrame(() => tryMarkReadFromScroll());
  }, [
    chatId,
    loading,
    loadingOlder,
    messages.length,
    unreadBounds.first,
    serverUnreadCount,
    refreshUnreadJumpCount,
    updateScrollAwayState,
    tryMarkReadFromScroll,
  ]);

  useEffect(() => {
    if (!messagesReady) return;
    if (loading && messages.length === 0) return;
    if (messages.length === 0) return;
    if (
      pendingPrependRef.current ||
      prependingOlderRef.current ||
      loadingOlderRef.current ||
      loadOlderLockRef.current ||
      loadingOlder
    ) {
      return;
    }

    refreshUnreadJumpCount();

    if (stickToBottomRef.current) {
      scrollToBottom(false);
    }
  }, [messages, loading, loadingOlder, messagesReady, scrollToBottom, refreshUnreadJumpCount]);

  useEffect(() => {
    if (!messagesReady) return;
    const list = listRef.current;
    const end = messagesEndRef.current;
    if (!list || !end) return;

    let raf = 0;
    const nudgeBottom = () => {
      if (!stickToBottomRef.current) return;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        if (!stickToBottomRef.current || !listRef.current) return;
        scrollListToBottom(listRef.current, messagesEndRef.current);
      });
    };

    const io = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry || !stickToBottomRef.current) return;
        if (entry.intersectionRatio < 0.99) nudgeBottom();
      },
      { root: list, threshold: [0, 0.5, 0.99, 1] }
    );
    io.observe(end);
    list.addEventListener("load", nudgeBottom, true);

    return () => {
      io.disconnect();
      list.removeEventListener("load", nudgeBottom, true);
      cancelAnimationFrame(raf);
    };
  }, [messagesReady, chatId]);

  useEffect(() => {
    for (const m of messages) {
      if ((m.messageType ?? "text") !== "video" || !m.attachmentUrl) continue;
      const url = mediaUrl(m.attachmentUrl);
      const meta = m.attachmentMetadata;
      if (meta?.width && meta?.height) {
        setVideoMetaCache(url, {
          width: meta.width,
          height: meta.height,
          duration: meta.duration,
        });
        continue;
      }
      if (getVideoMetaCache(url)) continue;
      void probeVideoMeta(url);
    }
  }, [messages]);

  function dispatchMessage(
    opts: {
      content: string;
      messageType?: MessageType;
      attachmentUrl?: string | null;
      attachmentMetadata?: AttachmentMetadata | null;
    },
    withReply = true,
    pendingId?: string
  ) {
    if (isDraft && draftPeer) {
      void sendDraftMessage(opts, withReply);
      return;
    }
    if (!chatId) return;
    const replyMeta: AttachmentMetadata | null =
      withReply && replyDraft
        ? { ...(opts.attachmentMetadata ?? {}), replyTo: buildReplyTo(replyDraft) }
        : opts.attachmentMetadata ?? null;

    let activePendingId = pendingId;
    if (!activePendingId) {
      activePendingId = insertOptimisticMessage(
        {
          content: opts.content,
          messageType: opts.messageType,
          attachmentUrl: opts.attachmentUrl,
          attachmentMetadata: replyMeta,
          uploadProgress: null,
        },
        withReply
      );
    } else {
      updateOptimisticMessage(activePendingId, {
        content: opts.content,
        messageType: opts.messageType,
        attachmentUrl: opts.attachmentUrl,
        attachmentMetadata: replyMeta,
        uploadProgress: null,
      });
    }

    send({
      type: "message",
      chatId,
      content: opts.content,
      messageType: opts.messageType ?? "text",
      attachmentUrl: opts.attachmentUrl ?? null,
      attachmentMetadata: replyMeta,
    });
    playMessageSound("outgoing");
    setReplyDraft(null);
    stickToBottomRef.current = true;
    requestAnimationFrame(() => scrollToBottom(false));
  }

  async function sendDraftMessage(
    opts: {
      content: string;
      messageType?: MessageType;
      attachmentUrl?: string | null;
      attachmentMetadata?: AttachmentMetadata | null;
    },
    withReply = true
  ) {
    if (!draftPeer || sending) return;
    const replyMeta: AttachmentMetadata | null =
      withReply && replyDraft
        ? { ...(opts.attachmentMetadata ?? {}), replyTo: buildReplyTo(replyDraft) }
        : opts.attachmentMetadata ?? null;
    setSending(true);
    try {
      const { chat } = await sendDmMessage(draftPeer.id, {
        ...opts,
        attachmentMetadata: replyMeta,
      });
      playMessageSound("outgoing");
      setReplyDraft(null);
      onDraftChatCreated?.(chat as Chat);
    } catch (err) {
      console.error(err);
    } finally {
      setSending(false);
    }
  }

  async function sendMessage(opts: {
    content: string;
    messageType?: MessageType;
    attachmentUrl?: string | null;
    attachmentMetadata?: AttachmentMetadata | null;
  }) {
    if (isDraft && draftPeer) {
      return enqueueOutgoingSend(() => sendDraftMessage(opts));
    }
    if (!chatId) return;
    const pendingId = insertOptimisticMessage({
      content: opts.content,
      messageType: opts.messageType,
      attachmentUrl: opts.attachmentUrl,
      attachmentMetadata: opts.attachmentMetadata,
      uploadProgress: null,
    });
    return enqueueOutgoingSend(async () => {
      dispatchMessage(opts, true, pendingId);
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text) return;
    if (editDraft) {
      await saveEdit(text);
      return;
    }
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    typingActiveRef.current = false;
    notifyTyping(false);
    const key = composeDraftKeyRef.current;
    if (key) clearComposeDraft(key);
    composeDraftTextRef.current = "";
    applyComposeInput("");
    await sendMessage({ content: text });
  }

  function insertEmoji(emoji: string) {
    if (editDraft) {
      setInput((prev) => prev + emoji);
    } else {
      applyComposeInput((prev) => prev + emoji);
    }
    composeInputRef.current?.focus();
  }

  function sendSticker(sticker: StickerItem, pack: StickerPackSummary) {
    if (!chatId || editDraft) return;
    setEmojiPanelOpen(false);
    void sendMessage({
      content: sticker.emoji,
      messageType: "sticker",
      attachmentUrl: sticker.imagePath,
      attachmentMetadata: {
        emoji: sticker.emoji,
        stickerPackId: pack.id,
        stickerId: sticker.id,
        mimeType: "image/webp",
      },
    });
  }

  async function saveEdit(text: string) {
    if (!chatId || !editDraft || sending) return;
    setSending(true);
    try {
      const updated = await editMessage(chatId, editDraft.id, text);
      setMessages((prev) => prev.map((m) => (m.id === updated.id ? { ...m, ...updated } as Message : m)));
      setEditDraft(null);
      restoreComposeInput();
      window.dispatchEvent(new Event("wm:refresh-chats"));
    } catch (err) {
      console.error(err);
    } finally {
      setSending(false);
    }
  }

  function flashMessage(messageId: string) {
    if (highlightTimerRef.current) window.clearTimeout(highlightTimerRef.current);
    setHighlightMessageId(messageId);
    highlightTimerRef.current = window.setTimeout(() => {
      setHighlightMessageId(null);
      highlightTimerRef.current = null;
    }, 2200);
  }

  function scrollToMessage(messageId: string, block: "start" | "center" | "end" = "center") {
    const list = listRef.current;
    if (!list) return;
    const found = scrollListToMessage(list, messageId, block, 16);
    if (found) flashMessage(messageId);
    requestAnimationFrame(() => {
      refreshUnreadJumpCount();
      tryMarkReadFromScroll();
    });
  }

  const ensureMessageInView = useCallback(
    async (messageId: string): Promise<boolean> => {
      const target = messageId.trim().toLowerCase();
      let working = messagesRef.current;
      if (working.some((m) => m.id.toLowerCase() === target)) return true;
      if (!chatId) return false;

      let before = working[0]?.id;
      for (let i = 0; i < 50; i++) {
        if (!before || !hasMoreOlderRef.current) break;
        const { messages: older } = await getMessages(chatId, MESSAGE_PAGE_SIZE, before);
        if (older.length === 0) {
          hasMoreOlderRef.current = false;
          break;
        }
        const ids = new Set(working.map((m) => m.id));
        const fresh = (older as Message[]).filter((m) => !ids.has(m.id));
        if (fresh.length) {
          working = [...fresh, ...working];
          setMessages(working);
        }
        if (working.some((m) => m.id.toLowerCase() === target)) return true;
        if (older.length < MESSAGE_PAGE_SIZE) {
          hasMoreOlderRef.current = false;
          break;
        }
        before = older[0]?.id;
      }
      return working.some((m) => m.id.toLowerCase() === target);
    },
    [chatId]
  );

  async function jumpToSearchResult(messageId: string) {
    setChatSearchOpen(false);
    const found = await ensureMessageInView(messageId);
    if (!found) return;
    await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
    scrollToMessage(messageId);
  }

  function handleReplyStart(m: Message) {
    setMessageMenu(null);
    // Если пользователь редактировал сообщение, его текст в поле — это содержимое
    // редактируемого сообщения, поэтому при переходе к ответу его нужно очистить.
    // Если же он просто набирал новое сообщение, текст сохраняем.
    if (editDraft) {
      setEditDraft(null);
      restoreComposeInput();
    }
    setReplyDraft(m);
    composeInputRef.current?.focus();
  }

  function handleEditStart(m: Message) {
    setMessageMenu(null);
    setReplyDraft(null);
    setEditDraft(m);
    setInput(m.content);
    composeInputRef.current?.focus();
  }

  function openAttach(accept: string) {
    setAttachMenuOpen(false);
    const inputEl = fileInputRef.current;
    if (!inputEl) return;
    inputEl.accept = accept;
    inputEl.click();
  }

  async function uploadSingleFile(
    file: File,
    withReply: boolean,
    caption?: string,
    existingPendingId?: string,
    initialPreviewUrl?: string | null
  ) {
    const isGif = await isGifFileDeep(file);
    const isImage = file.type.startsWith("image/") && !isGif;
    const toUpload = isImage ? await compressImage(file) : file;
    const isVideo = file.type.startsWith("video/");
    const dims = isImage || isGif ? await getImageDimensions(file) : isVideo ? await getVideoDimensions(file) : null;
    const type = isGif || isImage ? "image" : isVideo ? "video" : "file";
    const fallback = isGif ? "GIF" : type === "image" ? "Фотография" : type === "video" ? "Видео" : file.name;
    const content = resolveMediaPartContent(caption, fallback);
    const ownedPreview =
      initialPreviewUrl == null && (type === "image" || type === "video")
        ? URL.createObjectURL(type === "image" ? toUpload : file)
        : null;
    const previewUrl = initialPreviewUrl ?? ownedPreview;
    const baseMeta: AttachmentMetadata =
      isGif
        ? { fileName: file.name || "animation.gif", mimeType: "image/gif", size: file.size, ...(dims ?? {}) }
        : type === "image"
        ? { fileName: "Фотография", mimeType: toUpload.type, size: toUpload.size, ...(dims ?? {}) }
        : type === "video"
        ? { fileName: file.name, mimeType: file.type, size: file.size, ...(dims ?? {}) }
        : { fileName: file.name, mimeType: file.type, size: file.size };

    const pendingId =
      existingPendingId ??
      insertOptimisticMessage(
        {
          content,
          messageType: type,
          attachmentUrl: previewUrl,
          attachmentMetadata: baseMeta,
          uploadProgress: 0,
        },
        withReply
      );

    if (existingPendingId) {
      updateOptimisticMessage(pendingId, {
        content,
        messageType: type,
        attachmentMetadata: baseMeta,
        uploadProgress: 0,
      });
    }

    let posterBlobUrl: string | undefined;
    if (isVideo) {
      const posterBlob = await captureVideoPoster(file);
      if (posterBlob) {
        posterBlobUrl = URL.createObjectURL(posterBlob);
        updateOptimisticMessage(pendingId, {
          attachmentMetadata: { ...baseMeta, posterUrl: posterBlobUrl },
        });
      }
    }

    try {
      let posterPath: string | undefined;
      if (isVideo && posterBlobUrl) {
        const posterBlob = await fetch(posterBlobUrl).then((r) => r.blob());
        const posterFile = new File([posterBlob], "video-poster.jpg", { type: "image/jpeg" });
        const uploadedPoster = await uploadFileWithProgress(posterFile, (pct) => {
          updateOptimisticMessage(pendingId, { uploadProgress: Math.round(pct * 0.12) });
        });
        posterPath = uploadedPoster.path;
      }

      const { path, fileName, mimeType, size } = await uploadFileWithProgress(toUpload, (pct) => {
        const base = posterPath ? 12 : 0;
        updateOptimisticMessage(pendingId, { uploadProgress: base + Math.round(pct * (1 - base / 100)) });
      });
      if (ownedPreview) URL.revokeObjectURL(ownedPreview);
      if (previewUrl && previewUrl !== ownedPreview) URL.revokeObjectURL(previewUrl);
      if (posterBlobUrl) URL.revokeObjectURL(posterBlobUrl);
      const finalMeta: AttachmentMetadata =
        isGif
          ? { fileName: file.name || "animation.gif", mimeType: "image/gif", size: file.size, ...(dims ?? {}) }
          : type === "image"
          ? { fileName: "Фотография", mimeType: toUpload.type, size: toUpload.size, ...(dims ?? {}) }
          : type === "video"
          ? {
              fileName: file.name ?? fileName,
              mimeType: mimeType ?? file.type,
              size: size ?? file.size,
              ...(dims ?? {}),
              ...(posterPath ? { posterUrl: posterPath } : {}),
            }
          : { fileName: file.name ?? fileName, mimeType: mimeType ?? file.type, size: size ?? file.size };

      dispatchMessage(
        {
          content,
          messageType: type,
          attachmentUrl: path,
          attachmentMetadata: finalMeta,
        },
        withReply,
        pendingId
      );
    } catch (err) {
      console.error(err);
      if (ownedPreview) URL.revokeObjectURL(ownedPreview);
      if (posterBlobUrl) URL.revokeObjectURL(posterBlobUrl);
      updateOptimisticMessage(pendingId, { sendFailed: true, uploadProgress: undefined });
    }
  }

  async function uploadAlbumFiles(
    files: File[],
    withReply: boolean,
    caption?: string,
    existingPendingId?: string,
    initialPreviewUrl?: string | null
  ) {
    const previewUrls: string[] = [];
    const fallback = mediaBatchFallbackLabel(files);
    const content = resolveMediaPartContent(caption, fallback);
    const pendingId =
      existingPendingId ??
      insertOptimisticMessage(
        {
          content,
          messageType: "image",
          attachmentUrl: initialPreviewUrl ?? null,
          attachmentMetadata: { mimeType: "image/jpeg" },
          uploadProgress: 0,
        },
        withReply
      );

    if (existingPendingId) {
      updateOptimisticMessage(pendingId, { content, uploadProgress: 0 });
    }

    try {
      const attachments: MessageAttachment[] = [];
      let done = 0;
      for (const file of files) {
        if (isVideoFile(file)) {
          const dims = await getVideoDimensions(file);
          let posterBlobUrl: string | undefined;
          let posterPath: string | undefined;
          const posterBlob = await captureVideoPoster(file);
          if (posterBlob) {
            posterBlobUrl = URL.createObjectURL(posterBlob);
            previewUrls.push(posterBlobUrl);
            const posterFile = new File([posterBlob], "video-poster.jpg", { type: "image/jpeg" });
            const uploadedPoster = await uploadFileWithProgress(posterFile, (pct) => {
              const total = Math.round(((done + pct * 0.12) / files.length) * 100);
              updateOptimisticMessage(pendingId, { uploadProgress: total });
            });
            posterPath = uploadedPoster.path;
          }
          const preview = URL.createObjectURL(file);
          previewUrls.push(preview);
          const { path, fileName, mimeType, size } = await uploadFileWithProgress(file, (pct) => {
            const base = posterPath ? 0.12 : 0;
            const total = Math.round(((done + base + pct * (1 - base)) / files.length) * 100);
            updateOptimisticMessage(pendingId, {
              uploadProgress: total,
              attachmentUrl: preview,
              attachmentMetadata: {
                attachments: [
                  ...attachments,
                  {
                    url: preview,
                    fileName: file.name || fileName,
                    mimeType: mimeType || file.type,
                    size: size ?? file.size,
                    ...(dims ?? {}),
                    ...(posterBlobUrl ? { posterUrl: posterBlobUrl } : {}),
                  },
                ],
                mimeType: mimeType || file.type,
                fileName: file.name || fileName,
              },
            });
          });
          done += 1;
          attachments.push({
            url: path,
            fileName: file.name || fileName,
            mimeType: mimeType || file.type,
            size: size ?? file.size,
            ...(dims ?? {}),
            ...(posterPath ? { posterUrl: posterPath } : {}),
          });
        } else {
          const isGif = await isGifFileDeep(file);
          const toUpload = isGif ? file : await compressImage(file);
          const dims = await getImageDimensions(file);
          const preview = URL.createObjectURL(toUpload);
          previewUrls.push(preview);
          const { path, fileName, mimeType, size } = await uploadFileWithProgress(toUpload, (pct) => {
            const total = Math.round(((done + pct / 100) / files.length) * 100);
            updateOptimisticMessage(pendingId, {
              uploadProgress: total,
              attachmentUrl: preview,
              attachmentMetadata: {
                attachments: [
                  ...attachments,
                  {
                    url: preview,
                    fileName: file.name || fileName,
                    mimeType: isGif ? "image/gif" : mimeType || toUpload.type || "image/jpeg",
                    size: size ?? file.size,
                    ...(dims ?? {}),
                  },
                ],
                mimeType: isGif ? "image/gif" : mimeType || toUpload.type || "image/jpeg",
                fileName: file.name || fileName,
              },
            });
          });
          done += 1;
          attachments.push({
            url: path,
            fileName: file.name || fileName,
            mimeType: isGif ? "image/gif" : mimeType || toUpload.type || "image/jpeg",
            size: size ?? file.size,
            ...(dims ?? {}),
          });
        }
        updateOptimisticMessage(pendingId, {
          uploadProgress: Math.round((done / files.length) * 100),
        });
      }
      for (const url of previewUrls) URL.revokeObjectURL(url);
      if (initialPreviewUrl) URL.revokeObjectURL(initialPreviewUrl);

      const finalFallback = mediaBatchFallbackLabel(files);
      const finalContent = resolveMediaPartContent(caption, finalFallback);
      dispatchMessage(
        {
          content: finalContent,
          messageType: "image",
          attachmentUrl: attachments[0]!.url,
          attachmentMetadata: {
            attachments,
            mimeType: attachments[0]!.mimeType,
            fileName: attachments[0]!.fileName,
          },
        },
        withReply,
        pendingId
      );
    } catch (err) {
      console.error(err);
      for (const url of previewUrls) URL.revokeObjectURL(url);
      updateOptimisticMessage(pendingId, { sendFailed: true, uploadProgress: undefined });
    }
  }

  function insertMediaBatchOptimistic(
    part: ReturnType<typeof planMediaBatchParts>[number],
    previewByFile: Map<File, string | null>
  ): string {
    if (part.kind === "album") {
      const fallback = mediaBatchFallbackLabel(part.files);
      const content = resolveMediaPartContent(part.caption, fallback);
      return insertOptimisticMessage(
        {
          content,
          messageType: "image",
          attachmentUrl: previewByFile.get(part.files[0]!) ?? null,
          attachmentMetadata: { mimeType: "image/jpeg" },
          uploadProgress: 0,
        },
        part.withReply
      );
    }
    const file = part.file;
    const isGif = file.type === "image/gif" || /\.gif$/i.test(file.name);
    const isImage = file.type.startsWith("image/") && !isGif;
    const isVideo = file.type.startsWith("video/");
    const type = isGif || isImage ? "image" : isVideo ? "video" : "file";
    const fallback = isGif ? "GIF" : type === "image" ? "Фотография" : type === "video" ? "Видео" : file.name;
    const content = resolveMediaPartContent(part.caption, fallback);
    return insertOptimisticMessage(
      {
        content,
        messageType: type,
        attachmentUrl: previewByFile.get(file) ?? null,
        attachmentMetadata:
          type === "file"
            ? { fileName: file.name, mimeType: file.type, size: file.size }
            : { mimeType: file.type || "application/octet-stream", fileName: file.name },
        uploadProgress: 0,
      },
      part.withReply
    );
  }

  async function uploadFiles(
    files: File[],
    caption?: string,
    pendingIds?: string[],
    previewByFile?: Map<File, string | null>
  ) {
    if (!files.length || !chatId || !ready) return;
    const parts = planMediaBatchParts(files, caption);
    return enqueueOutgoingSend(async () => {
      try {
        for (let i = 0; i < parts.length; i++) {
          const part = parts[i]!;
          const pendingId = pendingIds?.[i];
          if (part.kind === "album") {
            await uploadAlbumFiles(
              part.files,
              part.withReply,
              part.caption,
              pendingId,
              previewByFile?.get(part.files[0]!) ?? null
            );
          } else {
            await uploadSingleFile(
              part.file,
              part.withReply,
              part.caption,
              pendingId,
              previewByFile?.get(part.file) ?? null
            );
          }
        }
        setReplyDraft(null);
      } catch (err) {
        console.error(err);
      }
    });
  }

  async function openMediaSendModal(files: File[]) {
    if (!files.length || !chatId || !ready || editDraft) return;
    const items = await buildMediaSendItems(files);
    if (mediaSendDraft) {
      setMediaSendDraft({ ...mediaSendDraft, items: [...mediaSendDraft.items, ...items] });
      return;
    }
    const caption = input.trim();
    applyComposeInput("");
    setAttachMenuOpen(false);
    setEmojiPanelOpen(false);
    setMediaSendDraft({ items, caption });
  }

  function closeMediaSendModal() {
    if (!mediaSendDraft) return;
    const { items, caption } = mediaSendDraft;
    revokeMediaSendItems(items);
    if (caption) applyComposeInput(caption);
    setMediaSendDraft(null);
  }

  function removeMediaSendItem(id: string) {
    if (!mediaSendDraft) return;
    const removed = mediaSendDraft.items.find((item) => item.id === id);
    if (removed?.previewUrl) URL.revokeObjectURL(removed.previewUrl);
    const items = mediaSendDraft.items.filter((item) => item.id !== id);
    if (items.length === 0) {
      if (mediaSendDraft.caption) applyComposeInput(mediaSendDraft.caption);
      setMediaSendDraft(null);
      return;
    }
    setMediaSendDraft({ ...mediaSendDraft, items });
  }

  async function confirmMediaSend() {
    if (!mediaSendDraft || !chatId || !ready) return;
    const { items, caption } = mediaSendDraft;
    const files = items.map((item) => item.file);
    const previewByFile = new Map(items.map((item) => [item.file, item.previewUrl]));
    const parts = planMediaBatchParts(files, caption);
    const pendingIds = parts.map((part) => insertMediaBatchOptimistic(part, previewByFile));
    setMediaSendDraft(null);
    await uploadFiles(files, caption, pendingIds, previewByFile);
  }

  function handleComposePaste(e: React.ClipboardEvent) {
    if (!chatId || sending || !ready || editDraft) return;
    const fromFiles = Array.from(e.clipboardData.files ?? []);
    if (fromFiles.length > 0) {
      e.preventDefault();
      e.stopPropagation();
      void openMediaSendModal(fromFiles);
      return;
    }
    const items = Array.from(e.clipboardData.items ?? []);
    const pasted: File[] = [];
    for (const item of items) {
      if (item.kind !== "file") continue;
      const file = item.getAsFile();
      if (file) pasted.push(file);
    }
    if (pasted.length > 0) {
      e.preventDefault();
      e.stopPropagation();
      void openMediaSendModal(pasted);
    }
  }

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    await openMediaSendModal(files);
  }

  function hasDraggedFiles(e: React.DragEvent) {
    return Array.from(e.dataTransfer.types).includes("Files");
  }

  function handleFileDragEnter(e: React.DragEvent) {
    if (!ready || sending || !hasDraggedFiles(e)) return;
    e.preventDefault();
    fileDragDepthRef.current += 1;
    setFileDragActive(true);
  }

  function handleFileDragLeave(e: React.DragEvent) {
    if (!hasDraggedFiles(e)) return;
    e.preventDefault();
    fileDragDepthRef.current = Math.max(0, fileDragDepthRef.current - 1);
    if (fileDragDepthRef.current === 0) setFileDragActive(false);
  }

  function handleFileDragOver(e: React.DragEvent) {
    if (!ready || sending || !hasDraggedFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  }

  function handleFileDrop(e: React.DragEvent) {
    if (!hasDraggedFiles(e)) return;
    e.preventDefault();
    fileDragDepthRef.current = 0;
    setFileDragActive(false);
    void openMediaSendModal(Array.from(e.dataTransfer.files ?? []));
  }

  function handleLocation() {
    setAttachMenuOpen(false);
    setLocationPickerOpen(true);
  }

  async function sendLocation(lat: number, lng: number) {
    setLocationPickerOpen(false);
    await sendMessage({
      content: `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
      messageType: "location",
      attachmentMetadata: { lat, lng },
    });
  }

  async function handleVoiceSend(blob: Blob, d: number) {
    const minSize = 200;
    if (blob.size < minSize) return;
    return enqueueOutgoingSend(async () => {
      const mime = blob.type || "audio/webm";
      const ext = extFromBlobType(mime, "audio");
      const file = new File([blob], `voice.${ext}`, { type: mime });
      const previewUrl = URL.createObjectURL(blob);
      const pendingId = insertOptimisticMessage({
        content: "Голосовое сообщение",
        messageType: "voice",
        attachmentUrl: previewUrl,
        attachmentMetadata: { duration: d, mimeType: mime },
        uploadProgress: 0,
      });
      try {
        const { path } = await uploadFileWithProgress(file, (pct) => {
          updateOptimisticMessage(pendingId, { uploadProgress: pct });
        });
        URL.revokeObjectURL(previewUrl);
        dispatchMessage(
          {
            content: "Голосовое сообщение",
            messageType: "voice",
            attachmentUrl: path,
            attachmentMetadata: { duration: d, mimeType: mime },
          },
          true,
          pendingId
        );
      } catch (err) {
        console.error("Voice send failed:", err);
        updateOptimisticMessage(pendingId, { sendFailed: true, uploadProgress: undefined });
      }
    });
  }

  async function handleCircleSend(blob: Blob, d: number) {
    const minSize = 200;
    if (blob.size < minSize) return;
    return enqueueOutgoingSend(async () => {
      const mime = blob.type || "video/webm";
      const ext = extFromBlobType(mime, "video");
      const file = new File([blob], `circle.${ext}`, { type: mime });
      const previewUrl = URL.createObjectURL(blob);
      let posterBlobUrl: string | undefined;
      const pendingId = insertOptimisticMessage({
        content: "Кружок",
        messageType: "circle",
        attachmentUrl: previewUrl,
        attachmentMetadata: { duration: d, mimeType: mime },
        uploadProgress: 0,
      });
      try {
        const posterBlob = await captureCirclePoster(blob);
        let posterUrl: string | undefined;
        if (posterBlob) {
          posterBlobUrl = URL.createObjectURL(posterBlob);
          updateOptimisticMessage(pendingId, {
            attachmentMetadata: { duration: d, mimeType: mime, posterUrl: posterBlobUrl },
          });
          const posterFile = new File([posterBlob], "circle-poster.jpg", { type: "image/jpeg" });
          const uploadedPoster = await uploadFileWithProgress(posterFile, (pct) => {
            updateOptimisticMessage(pendingId, { uploadProgress: Math.round(pct * 0.15) });
          });
          posterUrl = uploadedPoster.path;
        }
        const { path } = await uploadFileWithProgress(file, (pct) => {
          const base = posterBlob ? 15 : 0;
          updateOptimisticMessage(pendingId, { uploadProgress: base + Math.round(pct * (1 - base / 100)) });
        });
        URL.revokeObjectURL(previewUrl);
        if (posterBlobUrl) URL.revokeObjectURL(posterBlobUrl);
        dispatchMessage(
          {
            content: "Кружок",
            messageType: "circle",
            attachmentUrl: path,
            attachmentMetadata: {
              duration: d,
              mimeType: mime,
              ...(posterUrl ? { posterUrl } : {}),
            },
          },
          true,
          pendingId
        );
      } catch (err) {
        console.error("Circle send failed:", err);
        URL.revokeObjectURL(previewUrl);
        if (posterBlobUrl) URL.revokeObjectURL(posterBlobUrl);
        updateOptimisticMessage(pendingId, { sendFailed: true, uploadProgress: undefined });
      }
    });
  }

  function displayContent(m: Message | MessageItem): string {
    return m.content;
  }

  const displayName = chat
    ? chat.name ?? (chat.type === "dm" ? chat.members.find((m) => m.id !== user?.id)?.username : null) ?? "Chat"
    : draftPeer?.username ?? "…";

  function headerAvatarUrl(): string | null {
    if (!chat) return null;
    if (chat.type === "group" && chat.avatarUrl) return chat.avatarUrl;
    if (chat.type === "dm" && otherMember?.avatarUrl) return otherMember.avatarUrl;
    return null;
  }

  function headerAvatarLetter(): string {
    return displayName.slice(0, 1).toUpperCase();
  }

  const isGroupAdmin = Boolean(chat?.type === "group" && chat.members.find((m) => m.id === user?.id)?.role === "admin");

  const dmBlockMessage = useMemo(() => {
    const status = chat?.dmBlockStatus;
    if (chat?.type !== "dm" || !status) return null;
    if (status.blockedByPeer) return "Пользователь вас заблокировал";
    if (status.blockedByMe) return "Вы заблокировали данного пользователя";
    return null;
  }, [chat]);

  function canDeleteMessage(m: Message): boolean {
    if ((m.messageType ?? "text") === "system") return false;
    return Boolean(user && chatId);
  }

  function canEditMessage(m: Message): boolean {
    if (!user || m.senderId !== user.id) return false;
    return (m.messageType ?? "text") === "text";
  }

  function toggleMessageSelect(messageId: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(messageId)) next.delete(messageId);
      else next.add(messageId);
      return next;
    });
  }

  function openMessageMenu(clientX: number, clientY: number, m: Message) {
    setMessageMenu({ message: m, x: clientX, y: clientY });
  }

  function onMessageContextMenu(e: React.MouseEvent, m: Message) {
    e.preventDefault();
    openMessageMenu(e.clientX, e.clientY, m);
  }

  function onMessageRowClick(e: React.MouseEvent, m: Message) {
    if (!canDeleteMessage(m)) return;
    const t = e.target as HTMLElement;
    if (t.closest(".voice-player, .circle-player, .message-reply-quote, a, button, video, audio, input, textarea")) return;
    if (t.closest(".message")) return;
    toggleMessageSelect(m.id);
  }

  function onMessageBubbleClick(e: React.MouseEvent, m: Message) {
    const t = e.target as HTMLElement;
    if (t.closest(".voice-player, .circle-player, .message-reply-quote, a, button, video, audio")) return;
    e.stopPropagation();
    if (selectionMode && canDeleteMessage(m)) {
      toggleMessageSelect(m.id);
      return;
    }
    openMessageMenu(e.clientX, e.clientY, m);
  }

  function onMessageTouchStart(e: React.TouchEvent, m: Message) {
    const target = e.target as HTMLElement;
    if (target.closest(".voice-player, .circle-player")) return;
    const touch = e.touches[0];
    if (!touch) return;
    longPressRef.current = window.setTimeout(() => {
      openMessageMenu(touch.clientX, touch.clientY, m);
      longPressRef.current = null;
    }, 500);
  }

  function onMessageTouchEnd() {
    if (longPressRef.current != null) {
      clearTimeout(longPressRef.current);
      longPressRef.current = null;
    }
  }

  async function handleDeleteSelected() {
    if (!chatId || selectedIds.size === 0) return;
    const ids = [...selectedIds];
    try {
      await Promise.all(ids.map((id) => deleteMessage(chatId, id)));
      setMessages((prev) => prev.filter((m) => !ids.includes(m.id)));
      setSelectedIds(new Set());
      window.dispatchEvent(new Event("wm:refresh-chats"));
    } catch (err) {
      console.error(err);
    }
  }

  function messageHasDownloadableMedia(m: Message): boolean {
    const mt = m.messageType ?? "text";
    return mt === "image" || mt === "video";
  }

  function handleDownloadMedia(m: Message) {
    setMessageMenu(null);
    const url = m.attachmentUrl;
    if (!url) return;
    const a = document.createElement("a");
    a.href = mediaDownloadUrl(url, m.attachmentMetadata?.fileName);
    a.download = m.attachmentMetadata?.fileName ?? "";
    a.rel = "noopener";
    a.target = "_blank";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  async function handleReaction(m: Message, emoji: string) {
    if (!chatId) return;
    const mine = m.reactions?.find((r) => r.userId === user?.id);
    const nextEmoji = mine?.emoji === emoji ? null : emoji;
    try {
      const reactions = await setMessageReaction(chatId, m.id, nextEmoji);
      setMessages((prev) => prev.map((x) => (x.id === m.id ? { ...x, reactions } : x)));
    } catch (err) {
      console.error(err);
    }
  }

  function canForwardMessage(m: Message): boolean {
    if ((m.messageType ?? "text") === "system") return false;
    if (m.clientPending) return false;
    return Boolean(chatId);
  }

  function openForwardModal(targets: Message[]) {
    const list = targets.filter(canForwardMessage);
    if (!list.length) return;
    setForwardTargets(list);
    getChats()
      .then((chats) => setForwardChats(chats as Chat[]))
      .catch(() => setForwardChats([]));
  }

  function handleForwardStart(m: Message) {
    setMessageMenu(null);
    openForwardModal([m]);
  }

  function handleForwardSelected() {
    const ordered = messages.filter((m) => selectedIds.has(m.id));
    openForwardModal(ordered);
  }

  async function handleForwardTo(targetChatId: string) {
    if (!chatId || !forwardTargets?.length) return;
    setForwarding(true);
    try {
      for (const target of forwardTargets) {
        let msg = (await forwardMessage(targetChatId, chatId, target.id)) as Message;
        if (targetChatId === chatId) {
          const paths = collectMessageMediaPaths(msg);
          if (paths.length && paths.some((p) => p && !p.includes("access="))) {
            const signed = await signMediaPaths(paths);
            msg = applySignedPathsToMessage(msg, signed);
          }
          setMessages((prev) => {
            if (prev.some((x) => x.id === msg.id)) return prev;
            return [...prev, msg];
          });
        }
      }
      setForwardTargets(null);
      setSelectedIds(new Set());
      window.dispatchEvent(new Event("wm:refresh-chats"));
    } catch (err) {
      console.error(err);
    } finally {
      setForwarding(false);
    }
  }

  async function confirmDeleteChat() {
    if (!chatId || deleteChatBusy) return;
    setDeleteChatBusy(true);
    try {
      await deleteChat(chatId);
      setDeleteChatConfirmOpen(false);
      setContactInfoOpen(false);
      window.dispatchEvent(new CustomEvent("wm:chat-removed", { detail: { chatId } }));
      window.dispatchEvent(new Event("wm:refresh-chats"));
      onClose();
    } catch (e) {
      console.error(e);
    } finally {
      setDeleteChatBusy(false);
    }
  }

  function requestDeleteChat() {
    setDeleteChatConfirmOpen(true);
  }

  function handleGroupAvatarPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !file.type.startsWith("image/")) return;
    setGroupAvatarCropFile(file);
  }

  async function uploadGroupAvatar(croppedFile: File) {
    if (!chatId) return;
    setSending(true);
    try {
      const compressed = await compressImage(croppedFile);
      const { path } = await uploadFile(compressed, { purpose: "profile" });
      await updateGroup(chatId, { avatarUrl: path });
      const fresh = await getChat(chatId);
      if (fresh) setChat(fresh as Chat);
      window.dispatchEvent(new Event("wm:refresh-chats"));
    } catch (err) {
      console.error(err);
    } finally {
      setSending(false);
    }
  }

  async function handleRemoveGroupMember(memberId: string) {
    if (!chatId) return;
    try {
      await removeGroupMember(chatId, memberId);
      if (memberId === user?.id) {
        window.dispatchEvent(new Event("wm:refresh-chats"));
        onClose();
        return;
      }
      const fresh = await getChat(chatId);
      if (fresh) setChat(fresh as Chat);
      window.dispatchEvent(new Event("wm:refresh-chats"));
    } catch (e) {
      console.error(e);
    }
  }

  if (!chatId && !isDraft) return null;

  const scrollDownBadgeCount =
    unreadJumpCount > 0 ? unreadJumpCount : awayFromBottom && serverUnreadCount > 0 ? serverUnreadCount : 0;

  return (
    <>
      <div className={`chat-header${selectionMode ? " chat-header-select" : ""}${chatSearchOpen ? " chat-header-search" : ""}`}>
        {chatSearchOpen && chatId ? (
          <ChatMessageSearchPanel
            chatId={chatId}
            isGroup={chat?.type === "group"}
            onClose={() => setChatSearchOpen(false)}
            onSelectMessage={(id) => void jumpToSearchResult(id)}
          />
        ) : (
        <>
        {showBack && !selectionMode && (
          <button
            type="button"
            className="chat-header-back"
            onClick={onClose}
            aria-label="К списку чатов"
          >
            <IconBack size={22} />
          </button>
        )}
        {selectionMode ? (
          <>
            <button
              type="button"
              className="chat-header-select-cancel"
              onClick={() => setSelectedIds(new Set())}
              aria-label="Отмена"
            >
              ×
            </button>
            <span className="chat-header-select-count">
              {selectedIds.size} {selectedIds.size === 1 ? "сообщение" : selectedIds.size < 5 ? "сообщения" : "сообщений"}
            </span>
            <div className="chat-header-select-actions">
              <button
                type="button"
                className="chat-header-select-forward"
                disabled={!messages.some((m) => selectedIds.has(m.id) && canForwardMessage(m))}
                onClick={() => handleForwardSelected()}
              >
                <IconForward size={18} /> Переслать
              </button>
              <button
                type="button"
                className="chat-header-select-delete"
                onClick={() => void handleDeleteSelected()}
              >
                <IconTrash size={18} /> Удалить
              </button>
            </div>
          </>
        ) : (
          <>
        <button
          type="button"
          className="chat-header-user"
          onClick={() => setContactInfoOpen(true)}
          title="Информация о чате"
        >
          <div className="chat-header-avatar">
            <UserAvatar
              path={headerAvatarUrl()}
              name={headerAvatarLetter()}
              imgClassName="chat-header-avatar-img"
              eager
            />
          </div>
          <div className="chat-header-name-wrap">
            <h3 className="chat-header-name">{displayName}</h3>
            {peerActivityLabel ? (
              <span className="chat-header-activity">{peerActivityLabel}</span>
            ) : (
              <>
                {chat?.type === "dm" && otherMember?.isBirthdayToday && (
                  <span className="chat-header-birthday"><AppleEmoji emoji="🎂" size={14} /> Сегодня день рождения</span>
                )}
                {chat?.type === "group" && (
                  <span className="chat-header-meta">{chat.members.length} участников</span>
                )}
              </>
            )}
          </div>
        </button>
        {status === "connecting" && (
          <span style={{ fontSize: "0.8rem", color: "var(--muted)" }} title={getWsUrl()}>
            Connecting…
          </span>
        )}
        {status === "auth_failed" && (
          <span style={{ fontSize: "0.8rem", color: "var(--danger)" }}>Session expired. Log out and log in again.</span>
        )}
        {status === "failed" && (
          <span style={{ fontSize: "0.8rem", color: "var(--muted)" }}>
            Disconnected. <button type="button" onClick={reconnect} className="link-button">Retry</button> (or log out and log in)
          </span>
        )}
        {!selectionMode && chatId && !isDraft && (
          <button
            type="button"
            className="chat-header-search-btn"
            onClick={() => setChatSearchOpen(true)}
            aria-label="Поиск по сообщениям"
            title="Поиск"
          >
            <IconSearch size={20} />
          </button>
        )}
          </>
        )}
        </>
        )}
      </div>
      <div
        className={`chat-body${fileDragActive ? " chat-body-drag" : ""}`}
        onDragEnter={handleFileDragEnter}
        onDragLeave={handleFileDragLeave}
        onDragOver={handleFileDragOver}
        onDrop={handleFileDrop}
      >
        {fileDragActive && (
          <div className="chat-drop-overlay" aria-hidden>
            <span>Отпустите, чтобы отправить</span>
          </div>
        )}
      <div
        className="messages"
        ref={listRef}
        onContextMenu={(e) => {
          if (!(e.target as HTMLElement).closest(".message")) e.preventDefault();
        }}
      >
        {loadError && messages.length === 0 ? (
          <div className="chat-load-error">
            <p>{loadError}</p>
            <button type="button" className="btn-secondary" onClick={() => setReloadNonce((n) => n + 1)}>
              Повторить
            </button>
          </div>
        ) : loading && messages.length === 0 ? (
          <p className="chat-load-hint">Загрузка сообщений…</p>
        ) : (
          <>
            <div ref={topSentinelRef} className="messages-top-sentinel" aria-hidden />
            {loadingOlder && (
              <div className="messages-history-overlay" aria-busy="true" aria-label="Загрузка истории">
                <div className="messages-history-overlay-chip">
                  <span className="messages-load-older-spinner" />
                </div>
              </div>
            )}
            {messages.map((m, msgIndex) => {
            const mt = m.messageType ?? "text";
            const prevCountable = messages
              .slice(0, msgIndex)
              .reverse()
              .find((x) => (x.messageType ?? "text") !== "system");
            const dateLabel =
              mt !== "system" ? formatMessageDateLabel(m.createdAt) : null;
            const showDateDivider =
              mt !== "system" && shouldShowDateDivider(m.createdAt, prevCountable?.createdAt);
            const showUnreadDivider = unreadBounds.first?.id === m.id;
            if (mt === "system") {
              return (
                <div key={m.id}>
                  {showUnreadDivider && (
                    <div className="messages-unread-divider" role="separator">
                      <span>Непрочитанные сообщения</span>
                    </div>
                  )}
                  <div className="message-system" data-message-id={m.id.toLowerCase()}>
                    <span>
                      {buildSystemMessageNodes(m.content, (userId) => openProfile(userId), {
                        mentions: m.attachmentMetadata?.systemMentions,
                        members: chat?.members,
                      })}
                    </span>
                  </div>
                </div>
              );
            }
            const naked = mt === "circle" || mt === "voice" || mt === "sticker";
            const hasMediaBubble = mt === "image" || mt === "video";
            const own = user?.id != null && m.senderId.toLowerCase() === user.id.toLowerCase();
            const isPending = Boolean(m.clientPending);
            const uploadPct = m.uploadProgress;
            const sameSenderCluster =
              chat?.type === "group" &&
              !own &&
              prevCountable &&
              prevCountable.senderId === m.senderId;
            const showRowSender = chat?.type === "group" && !own && naked && !sameSenderCluster;
            const peerReaders = own ? getPeerReaders(m) : [];
            const selectable = canDeleteMessage(m);
            const selected = selectedIds.has(m.id);
            return (
            <div key={m.id}>
              {showDateDivider && dateLabel && (
                <div className="messages-date-divider" role="separator">
                  <span>{dateLabel}</span>
                </div>
              )}
              {showUnreadDivider && (
                <div className="messages-unread-divider" role="separator">
                  <span>Непрочитанные сообщения</span>
                </div>
              )}
            <div
              data-message-id={m.id.toLowerCase()}
              className={`message-row ${own ? "own" : "incoming"}${showRowSender ? " message-row-naked-incoming" : ""}${selectionMode ? " selection-mode" : ""}${highlightMessageId === m.id ? " message-row-target-highlight" : ""}`}
              onClick={(e) => onMessageRowClick(e, m)}
            >
              {showRowSender && (
                <button
                  type="button"
                  className="message-row-sender message-sender-link"
                  onClick={(e) => {
                    e.stopPropagation();
                    openProfile(m.senderId);
                  }}
                >
                  {m.sender?.username ?? "?"}
                </button>
              )}
              <div
                className={`message-row-body${selected ? " is-selected" : ""}`}
                role={selectionMode && selectable ? "button" : undefined}
                tabIndex={selectionMode && selectable ? 0 : undefined}
                onKeyDown={
                  selectionMode && selectable
                    ? (e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          toggleMessageSelect(m.id);
                        }
                      }
                    : undefined
                }
              >
                {selectionMode && selectable && (
                  <div className={`message-select-check${selected ? " is-checked" : ""}`} aria-hidden>
                    {selected && (
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                        <path d="M2.5 6l2.5 2.5 4.5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </div>
                )}
            <div
              className={`message ${own ? "own" : ""}${naked ? " message-naked" : ""}${hasMediaBubble ? " message-has-media" : ""}${mt === "circle" ? " message-circle" : ""}${mt === "voice" ? " message-voice" : ""}${isPending ? " message-pending" : ""}${m.sendFailed ? " message-send-failed" : ""}`}
              onClick={(e) => onMessageBubbleClick(e, m)}
              onContextMenu={(e) => onMessageContextMenu(e, m)}
              onTouchStart={(e) => onMessageTouchStart(e, m)}
              onTouchEnd={onMessageTouchEnd}
              onTouchCancel={onMessageTouchEnd}
            >
              {chat?.type === "group" && !own && !showRowSender && (
                <button
                  type="button"
                  className="message-sender message-sender-link"
                  onClick={(e) => {
                    e.stopPropagation();
                    openProfile(m.senderId);
                  }}
                >
                  {m.sender?.username ?? "?"}
                </button>
              )}
              {m.attachmentMetadata?.forwardedFrom && (
                <div className="message-forwarded">
                  Переслано от {m.attachmentMetadata.forwardedFrom.username}
                </div>
              )}
              {m.attachmentMetadata?.replyTo && (
                <button
                  type="button"
                  className="message-reply-quote"
                  onClick={() => scrollToMessage(m.attachmentMetadata!.replyTo!.messageId)}
                >
                  <span className="message-reply-author">{m.attachmentMetadata.replyTo.senderName}</span>
                  <span className="message-reply-text">{m.attachmentMetadata.replyTo.preview}</span>
                </button>
              )}
              {(m.messageType ?? "text") === "text" && (
                <p className="message-content">{formatMessageText(displayContent(m))}</p>
              )}
              {(m.messageType ?? "text") === "image" && m.attachmentUrl && (
                <div className="message-media-wrap">
                  <MessageMediaGallery
                    message={m}
                    priority={msgIndex >= messages.length - 16}
                    onOpenLightbox={(items, index) => setMediaLightbox({ items, index })}
                  />
                  {isPending && uploadPct != null && uploadPct >= 0 && (
                    <div className="message-pending-progress">{uploadPct}%</div>
                  )}
                </div>
              )}
              {(m.messageType ?? "text") === "file" && m.attachmentUrl && (
                <a
                  href={mediaDownloadUrl(m.attachmentUrl, m.attachmentMetadata?.fileName)}
                  download={m.attachmentMetadata?.fileName ?? undefined}
                  className="message-file"
                >
                  <IconAttach size={16} className="message-file-icon" aria-hidden />
                  {m.attachmentMetadata?.fileName ?? "File"}
                </a>
              )}
              {(m.messageType ?? "text") === "video" && m.attachmentUrl && (
                <div className="message-media-wrap">
                  <MessageVideoPlayer
                    src={mediaUrl(m.attachmentUrl)}
                    poster={m.attachmentMetadata?.posterUrl ? mediaUrl(m.attachmentMetadata.posterUrl) : null}
                    width={m.attachmentMetadata?.width}
                    height={m.attachmentMetadata?.height}
                    duration={m.attachmentMetadata?.duration}
                    onExpand={() =>
                      setMediaLightbox({
                        items: [
                          {
                            url: mediaUrl(m.attachmentUrl!),
                            kind: "video",
                            poster: m.attachmentMetadata?.posterUrl ? mediaUrl(m.attachmentMetadata.posterUrl) : null,
                            width: m.attachmentMetadata?.width,
                            height: m.attachmentMetadata?.height,
                            duration: m.attachmentMetadata?.duration,
                            downloadPath: m.attachmentUrl,
                            fileName: m.attachmentMetadata?.fileName,
                          },
                        ],
                        index: 0,
                      })
                    }
                  />
                  {isPending && uploadPct != null && uploadPct >= 0 && (
                    <div className="message-pending-progress">{uploadPct}%</div>
                  )}
                </div>
              )}
              {(m.messageType ?? "text") === "location" && (() => {
                const loc = parseLocationCoords(m.content, m.attachmentMetadata);
                if (!loc) return <p className="message-content">{formatMessageText(displayContent(m))}</p>;
                return <LocationPreview lat={loc.lat} lng={loc.lng} />;
              })()}
              {(m.messageType ?? "text") === "voice" && m.attachmentUrl && (
                <VoiceMessagePlayer
                  src={mediaUrl(m.attachmentUrl)}
                  duration={m.attachmentMetadata?.duration}
                />
              )}
              {(m.messageType ?? "text") === "circle" && m.attachmentUrl && (
                <CircleMessagePlayer
                  src={mediaUrl(m.attachmentUrl)}
                  poster={m.attachmentMetadata?.posterUrl ? mediaUrl(m.attachmentMetadata.posterUrl) : null}
                  duration={m.attachmentMetadata?.duration}
                />
              )}
              {(m.messageType ?? "text") === "sticker" && m.attachmentUrl && (
                <button
                  type="button"
                  className="message-sticker"
                  onClick={() => {
                    const packId = m.attachmentMetadata?.stickerPackId;
                    if (packId) setStickerPackViewId(packId);
                  }}
                >
                  <img src={mediaUrl(m.attachmentUrl)} alt={m.attachmentMetadata?.emoji ?? "Стикер"} className="message-sticker-img" />
                </button>
              )}
              {(() => {
                const mt = m.messageType ?? "text";
                if (mt !== "image" && mt !== "video" && mt !== "file") return null;
                const cap = mediaMessageCaption(m);
                return cap ? <p className="message-content message-media-caption">{formatMessageText(cap)}</p> : null;
              })()}
              {(m.reactions?.length ?? 0) > 0 && (
                <MessageReactions
                  reactions={m.reactions ?? []}
                  userId={user?.id}
                  onToggle={(emoji) => void handleReaction(m, emoji)}
                />
              )}
              {(mt !== "circle" && mt !== "voice") || (own && isMessageReadByPeers(m)) || isPending ? (
              <div className="message-meta">
                {isPending && (
                  <span className="message-pending-status">
                    {m.sendFailed
                      ? "Не отправлено"
                      : uploadPct != null && uploadPct >= 0
                      ? `Загрузка ${uploadPct}%`
                      : "Отправка…"}
                  </span>
                )}
                {mt !== "circle" && mt !== "voice" && (
                  <div className="message-time">
                    {m.editedAt && <span className="message-edited">изменено</span>}
                    {m.createdAt
                      ? new Date(m.createdAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })
                      : ""}
                  </div>
                )}
                {own && !isPending && isMessageReadByPeers(m) && (
                  <span
                    className="message-read-receipt"
                    title={
                      chat?.type === "group"
                        ? `Просмотрели: ${peerReaders.map((r) => r.username).join(", ")}`
                        : "Прочитано"
                    }
                    aria-label="Прочитано"
                  >
                    <AppleEmoji emoji="🍉" size={14} className="message-read-receipt-emoji" />
                  </span>
                )}
              </div>
              ) : null}
            </div>
              </div>
            </div>
            </div>
          );
          })}
          </>
        )}
        <div ref={messagesEndRef} />
      </div>
      {awayFromBottom && (
        <button
          type="button"
          className="messages-scroll-down"
          onClick={jumpDown}
          aria-label={
            scrollDownBadgeCount > 0
              ? `К непрочитанным: ${scrollDownBadgeCount}`
              : "В конец чата"
          }
          title={scrollDownBadgeCount > 0 ? "К непрочитанным" : "В конец чата"}
        >
          <IconChevronDown size={18} />
          {scrollDownBadgeCount > 0 && (
            <span>{scrollDownBadgeCount > 99 ? "99+" : scrollDownBadgeCount}</span>
          )}
        </button>
      )}
      {dmBlockMessage ? (
        <div className="compose compose-blocked">
          <p>{dmBlockMessage}</p>
        </div>
      ) : (
      <div className="compose">
        {replyDraft && (
          <div className="compose-reply">
            <div className="compose-reply-body">
              <span className="compose-reply-label">Ответ {replyDraft.sender?.username ?? "пользователю"}</span>
              <span className="compose-reply-preview">{buildReplyTo(replyDraft).preview}</span>
            </div>
            <button type="button" className="compose-reply-close" onClick={() => setReplyDraft(null)} aria-label="Отменить ответ">
              ×
            </button>
          </div>
        )}
        {editDraft && (
          <div className="compose-reply compose-edit">
            <div className="compose-reply-body">
              <span className="compose-reply-label">Редактирование</span>
              <span className="compose-reply-preview">{editDraft.content}</span>
            </div>
            <button
              type="button"
              className="compose-reply-close"
              onClick={() => {
                setEditDraft(null);
                restoreComposeInput();
              }}
              aria-label="Отменить редактирование"
            >
              ×
            </button>
          </div>
        )}
        <input
          type="file"
          ref={fileInputRef}
          accept="*/*"
          multiple
          onChange={handleFileSelect}
          style={{ display: "none" }}
        />
        {emojiPanelOpen && !editDraft && (
          <ComposeEmojiStickerPanel
            onPickEmoji={insertEmoji}
            onPickSticker={sendSticker}
            onClose={() => setEmojiPanelOpen(false)}
          />
        )}
        <form onSubmit={handleSubmit} className="compose-form compose-form-inline">
          <div className="compose-attach-wrap">
            <button
              type="button"
              className={`compose-btn compose-btn-icon compose-btn-emoji${emojiPanelOpen ? " is-active" : ""}`}
              onClick={() => {
                setEmojiPanelOpen((o) => !o);
                setAttachMenuOpen(false);
              }}
              disabled={!ready || sending || Boolean(editDraft)}
              title="Эмодзи и стикеры"
            >
              <IconSmile size={22} />
            </button>
            <button
              type="button"
              className="compose-btn compose-btn-icon compose-btn-attach"
              onClick={() => {
                setAttachMenuOpen((o) => !o);
                setEmojiPanelOpen(false);
              }}
              disabled={!ready || sending || Boolean(editDraft)}
              title="Вложение"
            >
              <IconAttach size={22} />
            </button>
            {attachMenuOpen && (
              <>
                <div className="compose-attach-backdrop" onClick={() => setAttachMenuOpen(false)} />
                <div className="compose-attach-menu">
                  <button type="button" onClick={() => openAttach("image/*")}><IconPhoto size={18} /> Фото</button>
                  <button type="button" onClick={() => openAttach("video/*")}><IconVideo size={18} /> Видео</button>
                  <button type="button" onClick={() => openAttach("*/*")}><IconFile size={18} /> Файл</button>
                  <button type="button" onClick={handleLocation}><IconLocation size={18} /> Геометка</button>
                </div>
              </>
            )}
          </div>
          <input
            type="text"
            ref={composeInputRef}
            className="compose-input"
            data-testid="compose-input"
            placeholder={editDraft ? "Изменить сообщение…" : "Сообщение…"}
            value={input}
            onChange={(e) => handleInputChange(e.target.value)}
            onPaste={handleComposePaste}
            disabled={!ready}
          />
          {input.trim() || editDraft ? (
            <button type="submit" className="compose-btn compose-btn-send" data-testid="compose-send" disabled={!ready || sending || !input.trim()}>
              <IconSend size={20} />
            </button>
          ) : (
            <ComposeRecorder
              disabled={!ready || sending}
              onVoiceSend={handleVoiceSend}
              onCircleSend={handleCircleSend}
              onRecordingChange={notifyRecording}
            />
          )}
        </form>
      </div>
      )}
      </div>
      {mediaSendDraft && (
        <SendMediaModal
          items={mediaSendDraft.items}
          caption={mediaSendDraft.caption}
          onCaptionChange={(caption) => setMediaSendDraft((draft) => (draft ? { ...draft, caption } : draft))}
          onRemoveItem={removeMediaSendItem}
          onClose={closeMediaSendModal}
          onSend={() => void confirmMediaSend()}
          sending={sending}
        />
      )}
      {stickerPackViewId && (
        <StickerPackViewModal packId={stickerPackViewId} onClose={() => setStickerPackViewId(null)} />
      )}
      {mediaLightbox && (
        <MediaLightbox
          items={mediaLightbox.items}
          initialIndex={mediaLightbox.index}
          onClose={() => setMediaLightbox(null)}
          title="Медиа"
        />
      )}

      {contactInfoOpen && chat && user && chatId && (
        <ChatInfoModal
          chat={chat}
          chatId={chatId}
          currentUserId={user.id}
          otherMember={otherMember}
          open={contactInfoOpen}
          onClose={() => setContactInfoOpen(false)}
          openProfile={openProfile}
          notificationsMuted={chat.notificationsMuted ?? false}
          onNotificationsMutedChange={(muted) => setChat((c) => (c ? { ...c, notificationsMuted: muted } : c))}
          isGroupAdmin={isGroupAdmin}
          sending={sending}
          groupAvatarInputRef={groupAvatarInputRef}
          onGroupAvatarPick={handleGroupAvatarPick}
          onMembersChanged={async () => {
            const fresh = await getChat(chatId);
            if (fresh) setChat(fresh as Chat);
            window.dispatchEvent(new Event("wm:refresh-chats"));
          }}
          onRemoveGroupMember={handleRemoveGroupMember}
          onRequestDeleteChat={requestDeleteChat}
          onLeaveGroup={() => user && handleRemoveGroupMember(user.id)}
        />
      )}

      {deleteChatConfirmOpen && (
        <div
          className="search-overlay modal-overlay-top"
          onClick={(e) => {
            if (e.target === e.currentTarget && !deleteChatBusy) setDeleteChatConfirmOpen(false);
          }}
        >
          <div className="search-modal confirm-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <button
              type="button"
              className="modal-close"
              onClick={() => !deleteChatBusy && setDeleteChatConfirmOpen(false)}
              disabled={deleteChatBusy}
              aria-label="Закрыть"
            >
              ×
            </button>
            <h3>{chat?.type === "group" ? "Удалить группу?" : "Удалить чат?"}</h3>
            <p className="confirm-modal-text">
              {chat?.type === "group"
                ? "Группа и вся история сообщений будут удалены для всех участников. Это действие нельзя отменить."
                : "Чат и все сообщения будут удалены и у вас, и у собеседника. Это действие нельзя отменить."}
            </p>
            <div className="confirm-modal-actions">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setDeleteChatConfirmOpen(false)}
                disabled={deleteChatBusy}
              >
                Отмена
              </button>
              <button
                type="button"
                className="btn confirm-btn-danger"
                onClick={() => void confirmDeleteChat()}
                disabled={deleteChatBusy}
              >
                {deleteChatBusy ? "…" : chat?.type === "group" ? "Удалить группу" : "Удалить чат"}
              </button>
            </div>
          </div>
        </div>
      )}

      {messageMenu && (
        <MessageContextMenu
          x={messageMenu.x}
          y={messageMenu.y}
          showViewers={chat?.type === "group" && messageMenu.message.senderId === user?.id}
          readers={
            chat?.type === "group" && messageMenu.message.senderId === user?.id
              ? getPeerReaders(messageMenu.message)
              : []
          }
          canDownload={messageHasDownloadableMedia(messageMenu.message)}
          onReply={() => handleReplyStart(messageMenu.message)}
          onEdit={canEditMessage(messageMenu.message) ? () => handleEditStart(messageMenu.message) : undefined}
          onForward={() => handleForwardStart(messageMenu.message)}
          onDownload={() => handleDownloadMedia(messageMenu.message)}
          onReaction={(emoji) => void handleReaction(messageMenu.message, emoji)}
          onClose={() => setMessageMenu(null)}
        />
      )}

      {forwardTargets && (
        <ForwardMessageModal
          chats={forwardChats}
          userId={user?.id}
          currentChatId={chatId}
          sending={forwarding}
          messageCount={forwardTargets.length}
          onSelect={(id) => void handleForwardTo(id)}
          onClose={() => !forwarding && setForwardTargets(null)}
        />
      )}

      {groupAvatarCropFile && (
        <ImageCropModal
          file={groupAvatarCropFile}
          variant="avatar"
          title="Аватар группы"
          onConfirm={(cropped) => {
            setGroupAvatarCropFile(null);
            void uploadGroupAvatar(cropped);
          }}
          onCancel={() => setGroupAvatarCropFile(null)}
        />
      )}

      {locationPickerOpen && (
        <LocationPickerModal
          onConfirm={(lat, lng) => void sendLocation(lat, lng)}
          onCancel={() => setLocationPickerOpen(false)}
        />
      )}
    </>
  );
}
