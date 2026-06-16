import { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo } from "react";
import { useAuth } from "../context/AuthContext";
import { useWebSocketContext } from "../context/WebSocketContext";
import { ComposeRecorder } from "../components/ComposeRecorder";
import { VoiceMessagePlayer } from "../components/VoiceMessagePlayer";
import { CircleMessagePlayer } from "../components/CircleMessagePlayer";
import { MessageContextMenu } from "../components/MessageContextMenu";
import { MessageReactions } from "../components/MessageReactions";
import { ForwardMessageModal } from "../components/ForwardMessageModal";
import { LocationPickerModal } from "../components/LocationPickerModal";
import { LocationPreview } from "../components/LocationPreview";
import ImageCropModal from "../components/ImageCropModal";
import ChatInfoModal from "../components/ChatInfoModal";
import { IconAttach, IconFile, IconLocation, IconPhoto, IconSend, IconTrash, IconVideo, IconBack, IconChevronDown } from "../components/Icons";
import { getChat, getChats, getMessages, uploadFile, addGroupMembers, removeGroupMember, getUserByYandexLogin, deleteChat, updateGroup, deleteMessage, editMessage, forwardMessage, signMediaPaths, markChatReadApi, setMessageReaction } from "../api";
import { extFromBlobType } from "../utils/mediaMime";
import { compressImage, isGifFileDeep } from "../utils/imageCompress";
import ImageLightbox from "../components/ImageLightbox";
import { MessageMediaGallery } from "../components/MessageMediaGallery";
import {
  MAX_ATTACHMENTS_PER_MESSAGE,
  applySignedPathsToMessage,
  chunkFiles,
  collectMessageMediaPaths,
  isAlbumImageFile,
} from "../utils/messageAttachments";
import type { MessageAttachment } from "@melon/shared";
import type { Chat, Message, AttachmentMetadata, User } from "@melon/shared";
import type { MessageItem } from "../api";
import { getWsUrl } from "../config";
import { mediaUrl, mediaDownloadUrl } from "../utils/mediaUrl";
import { buildReplyTo } from "../utils/messagePreview";
import { linkifyText } from "../utils/linkify";
import { parseLocationCoords } from "../utils/yandexMaps";
import { capturePrependScroll, restorePrependScroll, type PrependScrollState } from "../utils/messageListScroll";
import {
  countUnreadBelowViewport,
  findUnreadBounds,
  isMessageVisibleInViewport,
  scrollListToMessage,
  compareMessageId,
} from "../utils/chatUnread";
import { getMessageReaders, isMessageReadByAnyPeer } from "../utils/messageRead";
import { formatMessageDateLabel, shouldShowDateDivider } from "../utils/messageDates";
import { playMessageSound } from "../utils/messageSounds";

type ChatRoomProps = {
  chatId: string;
  onClose: () => void;
  openProfile: (userId?: string) => void;
  onSyncPreview?: (message: Message) => void;
  showBack?: boolean;
};

const MESSAGE_PAGE_SIZE = 50;

export default function ChatRoom({ chatId, onClose, openProfile, onSyncPreview: _onSyncPreview, showBack = false }: ChatRoomProps) {
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
  const [lightbox, setLightbox] = useState<{ urls: string[]; index: number } | null>(null);
  const [fileDragActive, setFileDragActive] = useState(false);
  const [contactInfoOpen, setContactInfoOpen] = useState(false);
  const [deleteChatConfirmOpen, setDeleteChatConfirmOpen] = useState(false);
  const [deleteChatBusy, setDeleteChatBusy] = useState(false);
  const [groupAddLogin, setGroupAddLogin] = useState("");
  const [groupAddError, setGroupAddError] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const topSentinelRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const pendingInitialScrollRef = useRef(false);
  const suppressAutoReadRef = useRef(false);
  const serverUnreadCountRef = useRef(0);
  const [serverUnreadCount, setServerUnreadCount] = useState(0);
  const [unreadJumpCount, setUnreadJumpCount] = useState(0);
  const fileDragDepthRef = useRef(0);
  const longPressRef = useRef<number | null>(null);
  const [messageMenu, setMessageMenu] = useState<{ message: Message; x: number; y: number } | null>(null);
  const [forwardTarget, setForwardTarget] = useState<Message | null>(null);
  const [forwardChats, setForwardChats] = useState<Chat[]>([]);
  const [forwarding, setForwarding] = useState(false);
  const [replyDraft, setReplyDraft] = useState<Message | null>(null);
  const [highlightMessageId, setHighlightMessageId] = useState<string | null>(null);
  const highlightTimerRef = useRef<number | null>(null);
  const [editDraft, setEditDraft] = useState<Message | null>(null);
  const composeInputRef = useRef<HTMLInputElement>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const selectionMode = selectedIds.size > 0;
  const [readCursors, setReadCursors] = useState<Record<string, string>>({});
  const readCursorsRef = useRef<Record<string, string>>({});
  const readCursorTimesRef = useRef<Record<string, string>>({});
  const messagesRef = useRef<Message[]>([]);
  const hasMoreOlderRef = useRef(true);
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
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    loadingRef.current = loading;
  }, [loading]);

  function applyReadCursors(rows: { userId: string; lastReadMessageId: string; updatedAt?: string }[]) {
    const map = Object.fromEntries(
      rows.map((r) => [r.userId.toLowerCase(), r.lastReadMessageId.trim().toLowerCase()])
    );
    const times = Object.fromEntries(
      rows
        .filter((r) => r.updatedAt)
        .map((r) => [r.userId.toLowerCase(), r.updatedAt as string])
    );
    readCursorsRef.current = map;
    readCursorTimesRef.current = times;
    setReadCursors(map);
  }

  function canMarkReadNow(): boolean {
    if (typeof document === "undefined") return true;
    return document.visibilityState === "visible" && document.hasFocus();
  }

  function isMessageSeenForRead(messageId: string): boolean {
    const list = listRef.current;
    if (!list) return false;
    return isMessageVisibleInViewport(list, messageId);
  }

  function membersForReadReceipts(): User[] {
    if (chat?.members?.length) return chat.members;
    if (chat?.type === "dm" && user?.id) {
      const peer = chat.members.find((m) => m.id.toLowerCase() !== user.id.toLowerCase());
      if (peer) {
        return [{ id: user.id, username: user.username ?? "?" } as User, peer];
      }
    }
    return chat?.members ?? [];
  }

  function resolveMarkReadTarget(): string | null {
    const list = messagesRef.current;
    if (!list.length || !user?.id) return null;
    const listEl = listRef.current;
    if (!listEl) return null;

    const latestId = list[list.length - 1]!.id;
    const userKey = user.id.toLowerCase();
    const lastRead = readCursorsRef.current[userKey] ?? readCursorsRef.current[user.id] ?? null;
    const bounds = findUnreadBounds(list, lastRead, user.id, serverUnreadCountRef.current);

    if (stickToBottomRef.current || isMessageVisibleInViewport(listEl, latestId)) {
      return latestId;
    }
    if (bounds.last && isMessageVisibleInViewport(listEl, bounds.last.id)) {
      return bounds.last.id;
    }
    return null;
  }

  function markChatRead(messageId: string) {
    if (!chatId || !user?.id || !canMarkReadNow() || !messagesReady) return;
    const normalized = messageId.toLowerCase();
    if (!isMessageSeenForRead(normalized)) return;
    const userKey = user.id.toLowerCase();
    const mine = readCursorsRef.current[userKey] ?? readCursorsRef.current[user.id];
    if (mine && compareMessageId(mine, normalized) >= 0) {
      serverUnreadCountRef.current = 0;
      setServerUnreadCount(0);
      suppressAutoReadRef.current = false;
      return;
    }
    readCursorsRef.current[userKey] = normalized;
    setReadCursors((prev) => ({ ...prev, [userKey]: normalized }));
    const markedAt = new Date().toISOString();
    readCursorTimesRef.current[userKey] = markedAt;
    lastMarkedReadRef.current = normalized;
    lastMarkedReadChatIdRef.current = chatId;
    serverUnreadCountRef.current = 0;
    setServerUnreadCount(0);
    suppressAutoReadRef.current = false;
    window.dispatchEvent(new CustomEvent("wm:chat-read", { detail: { chatId } }));
    if (ready) {
      send({ type: "mark_read", chatId, messageId: normalized });
    }
    void markChatReadApi(chatId, normalized).catch(() => {});
  }

  function scheduleMarkChatRead(messageId: string) {
    const normalized = messageId.toLowerCase();
    const attempt = () => {
      if (isMessageSeenForRead(normalized)) markChatRead(normalized);
    };
    requestAnimationFrame(() => {
      attempt();
      requestAnimationFrame(attempt);
    });
  }

  function getPeerReaders(m: Message) {
    if (!user?.id || m.senderId.toLowerCase() !== user.id.toLowerCase()) return [];
    return getMessageReaders(m.id, m.senderId, membersForReadReceipts(), readCursors);
  }

  function isMessageReadByPeers(m: Message): boolean {
    if (!user?.id || m.senderId.toLowerCase() !== user.id.toLowerCase()) return false;
    return isMessageReadByAnyPeer(m.id, m.senderId, membersForReadReceipts(), readCursors);
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
    if (!lightbox) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLightbox(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightbox]);

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
    setReplyDraft(null);
    setEditDraft(null);
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

  useEffect(() => {
    if (!replyDraft && !editDraft) return;
    composeInputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setReplyDraft(null);
        setEditDraft(null);
        setInput("");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [replyDraft, editDraft]);

  useEffect(() => {
    if (!selectionMode) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelectedIds(new Set());
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectionMode]);

  const otherMember = chat?.type === "dm" ? chat.members.find((m) => m.id !== user?.id) : null;

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
    return subscribe((msg) => {
      if (msg.type === "message" && msg.message.chatId === chatId) {
        const incoming = msg.message;
        const fromOther = incoming.senderId !== user?.id;
        const afterAppend = (next: Message[]) => {
          if (fromOther && !stickToBottomRef.current) {
            serverUnreadCountRef.current += 1;
            setServerUnreadCount((c) => c + 1);
            suppressAutoReadRef.current = true;
          } else if (fromOther && stickToBottomRef.current) {
            scheduleMarkChatRead(incoming.id);
          }
          return next;
        };
        const paths = collectMessageMediaPaths(incoming);
        const needsSign = paths.some((p) => p && !p.includes("access="));
        if (needsSign && paths.length) {
          void signMediaPaths(paths).then((signed) => {
            setMessages((prev) => {
              if (prev.some((m) => m.id === incoming.id)) return prev;
              return afterAppend([...prev, applySignedPathsToMessage(incoming, signed)]);
            });
          });
          return;
        }
        setMessages((prev) => {
          if (prev.some((m) => m.id === incoming.id)) return prev;
          return afterAppend([...prev, incoming]);
        });
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
        const incomingId = msg.messageId.toLowerCase();
        const userKey = msg.userId.toLowerCase();
        const updatedAt = msg.updatedAt ?? new Date().toISOString();
        const cur = readCursorsRef.current[userKey] ?? readCursorsRef.current[msg.userId];
        if (cur && compareMessageId(cur, incomingId) > 0) return;
        const nextCursors = { ...readCursorsRef.current, [userKey]: incomingId };
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
    });
  }, [subscribe, chatId, user?.id]);

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
    if (!chatId || messages.length === 0 || !user?.id || !canMarkReadNow() || !messagesReady) return;
    if (prependingOlderRef.current || loadingOlderRef.current) return;
    tryMarkReadFromScroll();
  }, [chatId, messages, user?.id, messagesReady, tryMarkReadFromScroll]);

  useEffect(() => {
    if (!chatId) return;
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
            readCursorsRef.current[user.id.toLowerCase()] = mine;
            setReadCursors((prev) => ({ ...prev, [user.id.toLowerCase()]: mine }));
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
      if (stableFrames >= 2) finish();
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
      const id = chatId;
      const lastRead = lastMarkedReadRef.current;
      if (!id || !lastRead || lastMarkedReadChatIdRef.current !== id) return;
      void markChatReadApi(id, lastRead).catch(() => {});
    };
  }, [chatId]);

  const scrollToBottom = useCallback((instant: boolean) => {
    const list = listRef.current;
    if (list) {
      list.scrollTop = list.scrollHeight;
      return;
    }
    messagesEndRef.current?.scrollIntoView({ behavior: instant ? "auto" : "smooth", block: "end" });
  }, []);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const onScroll = () => {
      stickToBottomRef.current = list.scrollHeight - list.scrollTop - list.clientHeight < 120;
      refreshUnreadJumpCount();
      tryMarkReadFromScroll();
    };
    const onFocus = () => tryMarkReadFromScroll();
    const onVisibility = () => {
      if (document.visibilityState === "visible") tryMarkReadFromScroll();
    };
    list.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      list.removeEventListener("scroll", onScroll);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [chatId, refreshUnreadJumpCount, tryMarkReadFromScroll]);

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
      if (firstUnread) {
        stickToBottomRef.current = false;
        scrollListToMessage(listRef.current, firstUnread.id, "start", 16);
      } else {
        stickToBottomRef.current = true;
        suppressAutoReadRef.current = false;
        listRef.current.scrollTop = listRef.current.scrollHeight;
      }
    };

    snap();
    requestAnimationFrame(snap);
    pendingInitialScrollRef.current = false;
    setMessagesReady(true);
    refreshUnreadJumpCount();
    if (!firstUnread) tryMarkReadFromScroll();

    let refineFrames = 0;
    const refine = () => {
      if (sessionChatId !== chatId) return;
      snap();
      refineFrames += 1;
      if (refineFrames < 6) requestAnimationFrame(refine);
    };
    requestAnimationFrame(refine);
    requestAnimationFrame(() => tryMarkReadFromScroll());

    const ro = new ResizeObserver(() => {
      snap();
      tryMarkReadFromScroll();
    });
    ro.observe(list);
    const maxWait = window.setTimeout(() => ro.disconnect(), 1200);

    return () => {
      ro.disconnect();
      window.clearTimeout(maxWait);
    };
  }, [
    chatId,
    loading,
    loadingOlder,
    messages.length,
    unreadBounds.first,
    serverUnreadCount,
    refreshUnreadJumpCount,
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

  function dispatchMessage(
    opts: {
      content: string;
      messageType?: "text" | "image" | "file" | "video" | "location" | "voice" | "circle";
      attachmentUrl?: string | null;
      attachmentMetadata?: AttachmentMetadata | null;
    },
    withReply = true
  ) {
    if (!chatId) return;
    const replyMeta: AttachmentMetadata | null =
      withReply && replyDraft
        ? { ...(opts.attachmentMetadata ?? {}), replyTo: buildReplyTo(replyDraft) }
        : opts.attachmentMetadata ?? null;
    send({
      type: "message",
      chatId,
      content: opts.content,
      messageType: opts.messageType ?? "text",
      attachmentUrl: opts.attachmentUrl ?? null,
      attachmentMetadata: replyMeta,
    });
    playMessageSound("outgoing");
  }

  async function sendMessage(opts: {
    content: string;
    messageType?: "text" | "image" | "file" | "video" | "location" | "voice" | "circle";
    attachmentUrl?: string | null;
    attachmentMetadata?: AttachmentMetadata | null;
  }) {
    if (!chatId || sending) return;
    setSending(true);
    try {
      dispatchMessage(opts);
      setReplyDraft(null);
    } finally {
      setSending(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text) return;
    if (editDraft) {
      await saveEdit(text);
      return;
    }
    setInput("");
    await sendMessage({ content: text });
  }

  async function saveEdit(text: string) {
    if (!chatId || !editDraft || sending) return;
    setSending(true);
    try {
      const updated = await editMessage(chatId, editDraft.id, text);
      setMessages((prev) => prev.map((m) => (m.id === updated.id ? { ...m, ...updated } as Message : m)));
      setEditDraft(null);
      setInput("");
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

  function jumpToLastUnread() {
    const list = listRef.current;
    if (!unreadBounds.last || !list) return;
    scrollListToMessage(list, unreadBounds.last.id, "nearest", 24);
    requestAnimationFrame(() => {
      refreshUnreadJumpCount();
      tryMarkReadFromScroll();
    });
  }

  function handleReplyStart(m: Message) {
    setMessageMenu(null);
    setEditDraft(null);
    setInput("");
    setReplyDraft(m);
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

  async function uploadSingleFile(file: File, withReply: boolean) {
    const isGif = await isGifFileDeep(file);
    const isImage = file.type.startsWith("image/") && !isGif;
    const toUpload = isImage ? await compressImage(file) : file;
    const { path, fileName, mimeType, size } = await uploadFile(toUpload);
    const type = isGif || isImage ? "image" : file.type.startsWith("video/") ? "video" : "file";
    dispatchMessage(
      {
        content: isGif ? "GIF" : type === "image" ? "Фотография" : file.name,
        messageType: type,
        attachmentUrl: path,
        attachmentMetadata:
          isGif
            ? { fileName: file.name || "animation.gif", mimeType: "image/gif", size: file.size }
            : type === "image"
            ? { fileName: "Фотография", mimeType: toUpload.type, size: toUpload.size }
            : { fileName: file.name ?? fileName, mimeType: mimeType ?? file.type, size: size ?? file.size },
      },
      withReply
    );
  }

  async function uploadAlbumFiles(files: File[], withReply: boolean) {
    const attachments: MessageAttachment[] = [];
    for (const file of files) {
      const isGif = await isGifFileDeep(file);
      const toUpload = isGif ? file : await compressImage(file);
      const { path, fileName, mimeType, size } = await uploadFile(toUpload);
      attachments.push({
        url: path,
        fileName: file.name || fileName,
        mimeType: isGif ? "image/gif" : mimeType || toUpload.type || "image/jpeg",
        size: size ?? file.size,
      });
    }
    const count = attachments.length;
    const hasGif = attachments.some((a) => a.mimeType === "image/gif");
    dispatchMessage(
      {
        content: count === 1 ? (hasGif ? "GIF" : "Фотография") : `${count} фото`,
        messageType: "image",
        attachmentUrl: attachments[0]!.url,
        attachmentMetadata: {
          attachments,
          mimeType: attachments[0]!.mimeType,
          fileName: attachments[0]!.fileName,
        },
      },
      withReply
    );
  }

  async function uploadFiles(files: File[]) {
    if (!files.length || !chatId || sending || !ready) return;
    setSending(true);
    try {
      const album: File[] = [];
      const other: File[] = [];
      for (const f of files) {
        if (isAlbumImageFile(f)) album.push(f);
        else other.push(f);
      }
      const albumChunks = chunkFiles(album, MAX_ATTACHMENTS_PER_MESSAGE);
      let first = true;
      for (const chunk of albumChunks) {
        if (chunk.length > 0) {
          await uploadAlbumFiles(chunk, first);
          first = false;
        }
      }
      for (const file of other) {
        await uploadSingleFile(file, first);
        first = false;
      }
      setReplyDraft(null);
    } catch (err) {
      console.error(err);
    } finally {
      setSending(false);
    }
  }

  function handleComposePaste(e: React.ClipboardEvent) {
    if (!chatId || sending || !ready || editDraft) return;
    const fromFiles = Array.from(e.clipboardData.files ?? []);
    if (fromFiles.length > 0) {
      e.preventDefault();
      e.stopPropagation();
      void uploadFiles(fromFiles);
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
      void uploadFiles(pasted);
    }
  }

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    await uploadFiles(files);
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
    void uploadFiles(Array.from(e.dataTransfer.files ?? []));
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
    setSending(true);
    try {
      const mime = blob.type || "audio/webm";
      const ext = extFromBlobType(mime, "audio");
      const file = new File([blob], `voice.${ext}`, { type: mime });
      const { path } = await uploadFile(file);
      await sendMessage({
        content: "Голосовое сообщение",
        messageType: "voice",
        attachmentUrl: path,
        attachmentMetadata: { duration: d, mimeType: mime },
      });
    } catch (err) {
      console.error("Voice send failed:", err);
    } finally {
      setSending(false);
    }
  }

  async function handleCircleSend(blob: Blob, d: number) {
    const minSize = 200;
    if (blob.size < minSize) return;
    setSending(true);
    try {
      const mime = blob.type || "video/webm";
      const ext = extFromBlobType(mime, "video");
      const file = new File([blob], `circle.${ext}`, { type: mime });
      const { path } = await uploadFile(file);
      await sendMessage({
        content: "Кружок",
        messageType: "circle",
        attachmentUrl: path,
        attachmentMetadata: { duration: d, mimeType: mime },
      });
    } catch (err) {
      console.error("Circle send failed:", err);
    } finally {
      setSending(false);
    }
  }

  function displayContent(m: Message | MessageItem): string {
    return m.content;
  }

  const displayName = chat
    ? chat.name ?? (chat.type === "dm" ? chat.members.find((m) => m.id !== user?.id)?.username : null) ?? "Chat"
    : "…";

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

  function handleForwardStart(m: Message) {
    setMessageMenu(null);
    setForwardTarget(m);
    getChats()
      .then((list) => setForwardChats(list as Chat[]))
      .catch(() => setForwardChats([]));
  }

  async function handleForwardTo(targetChatId: string) {
    if (!chatId || !forwardTarget) return;
    setForwarding(true);
    try {
      let msg = (await forwardMessage(targetChatId, chatId, forwardTarget.id)) as Message;
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
      setForwardTarget(null);
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

  async function handleAddGroupMember() {
    if (!chatId || !groupAddLogin.trim()) return;
    setGroupAddError("");
    try {
      const u = await getUserByYandexLogin(groupAddLogin.trim());
      if (!u) {
        setGroupAddError("Пользователь не найден");
        return;
      }
      await addGroupMembers(chatId, [u.id]);
      const fresh = await getChat(chatId);
      if (fresh) setChat(fresh as Chat);
      setGroupAddLogin("");
      window.dispatchEvent(new Event("wm:refresh-chats"));
    } catch (e) {
      setGroupAddError(e instanceof Error ? e.message : "Ошибка");
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

  if (!chatId) return null;

  return (
    <>
      <div className={`chat-header${selectionMode ? " chat-header-select" : ""}`}>
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
            <button
              type="button"
              className="chat-header-select-delete"
              onClick={() => void handleDeleteSelected()}
            >
              <IconTrash size={18} /> Удалить
            </button>
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
            {(() => {
              const url = headerAvatarUrl();
              return url ? (
                <img src={mediaUrl(url)} alt="" />
              ) : (
                headerAvatarLetter()
              );
            })()}
          </div>
          <div className="chat-header-name-wrap">
            <h3 className="chat-header-name">{displayName}</h3>
            {chat?.type === "dm" && otherMember?.isBirthdayToday && (
              <span className="chat-header-birthday">🎂 Сегодня день рождения</span>
            )}
            {chat?.type === "group" && (
              <span className="chat-header-meta">{chat.members.length} участников</span>
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
                  <div className="message-system" data-message-id={m.id}>
                    <span>{m.content}</span>
                  </div>
                </div>
              );
            }
            const naked = mt === "circle" || mt === "voice" || mt === "image";
            const own = m.senderId === user?.id;
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
              data-message-id={m.id}
              className={`message-row ${own ? "own" : "incoming"}${showRowSender ? " message-row-naked-incoming" : ""}${selectionMode ? " selection-mode" : ""}${highlightMessageId === m.id ? " message-row-target-highlight" : ""}`}
              onClick={(e) => onMessageRowClick(e, m)}
            >
              {showRowSender && (
                <div className="message-row-sender">{m.sender?.username ?? "?"}</div>
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
              className={`message ${own ? "own" : ""}${naked ? " message-naked" : ""}${mt === "circle" ? " message-circle" : ""}${mt === "voice" ? " message-voice" : ""}`}
              onClick={(e) => onMessageBubbleClick(e, m)}
              onContextMenu={(e) => onMessageContextMenu(e, m)}
              onTouchStart={(e) => onMessageTouchStart(e, m)}
              onTouchEnd={onMessageTouchEnd}
              onTouchCancel={onMessageTouchEnd}
            >
              {chat?.type === "group" && !own && !showRowSender && (
                <div className="message-sender">{m.sender?.username ?? "?"}</div>
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
                <p className="message-content">{linkifyText(displayContent(m))}</p>
              )}
              {(m.messageType ?? "text") === "image" && m.attachmentUrl && (
                <MessageMediaGallery
                  message={m}
                  priority={msgIndex >= messages.length - 16}
                  onOpenLightbox={(urls, index) => setLightbox({ urls, index })}
                />
              )}
              {(m.messageType ?? "text") === "file" && m.attachmentUrl && (
                <a
                  href={mediaDownloadUrl(m.attachmentUrl, m.attachmentMetadata?.fileName)}
                  download={m.attachmentMetadata?.fileName ?? undefined}
                  className="message-file"
                >
                  📎 {m.attachmentMetadata?.fileName ?? "File"}
                </a>
              )}
              {(m.messageType ?? "text") === "video" && m.attachmentUrl && (
                <video src={mediaUrl(m.attachmentUrl)} controls className="message-video" />
              )}
              {(m.messageType ?? "text") === "location" && (() => {
                const loc = parseLocationCoords(m.content, m.attachmentMetadata);
                if (!loc) return <p className="message-content">{linkifyText(displayContent(m))}</p>;
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
                  duration={m.attachmentMetadata?.duration}
                />
              )}
              {(m.reactions?.length ?? 0) > 0 && (
                <MessageReactions
                  reactions={m.reactions ?? []}
                  userId={user?.id}
                  onToggle={(emoji) => void handleReaction(m, emoji)}
                />
              )}
              {(mt !== "circle" && mt !== "voice") || (own && isMessageReadByPeers(m)) ? (
              <div className="message-meta">
                {mt !== "circle" && mt !== "voice" && (
                  <div className="message-time">
                    {m.editedAt && <span className="message-edited">изменено</span>}
                    {m.createdAt
                      ? new Date(m.createdAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })
                      : ""}
                  </div>
                )}
                {own && isMessageReadByPeers(m) && (
                  <span
                    className="message-read-receipt"
                    title={
                      chat?.type === "group"
                        ? `Просмотрели: ${peerReaders.map((r) => r.username).join(", ")}`
                        : "Прочитано"
                    }
                    aria-label="Прочитано"
                  >
                    🍉
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
      {unreadJumpCount > 0 && unreadBounds.last && serverUnreadCount > 0 && (
        <button
          type="button"
          className="messages-unread-jump"
          onClick={jumpToLastUnread}
          aria-label={`Прокрутить к непрочитанным: ${unreadJumpCount}`}
        >
          <IconChevronDown size={18} />
          <span>{unreadJumpCount > 99 ? "99+" : unreadJumpCount}</span>
        </button>
      )}
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
                setInput("");
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
        <form onSubmit={handleSubmit} className="compose-form compose-form-inline">
          <div className="compose-attach-wrap">
            <button
              type="button"
              className="compose-btn compose-btn-icon compose-btn-attach"
              onClick={() => setAttachMenuOpen((o) => !o)}
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
            onChange={(e) => setInput(e.target.value)}
            onPaste={handleComposePaste}
            disabled={!ready}
          />
          {input.trim() || editDraft ? (
            <button type="submit" className="compose-btn compose-btn-send" data-testid="compose-send" disabled={!ready || sending || !input.trim()}>
              <IconSend size={20} />
            </button>
          ) : (
            <ComposeRecorder disabled={!ready || sending} onVoiceSend={handleVoiceSend} onCircleSend={handleCircleSend} />
          )}
        </form>
      </div>
      </div>
      {lightbox && (
        <ImageLightbox
          images={lightbox.urls}
          initialIndex={lightbox.index}
          onClose={() => setLightbox(null)}
          title="Фото"
        />
      )}

      {contactInfoOpen && chat && user && (
        <ChatInfoModal
          chat={chat}
          currentUserId={user.id}
          otherMember={otherMember}
          open={contactInfoOpen}
          onClose={() => {
            setContactInfoOpen(false);
            setGroupAddError("");
          }}
          openProfile={openProfile}
          notificationsMuted={chat.notificationsMuted ?? false}
          onNotificationsMutedChange={(muted) => setChat((c) => (c ? { ...c, notificationsMuted: muted } : c))}
          isGroupAdmin={isGroupAdmin}
          sending={sending}
          groupAvatarInputRef={groupAvatarInputRef}
          onGroupAvatarPick={handleGroupAvatarPick}
          groupAddLogin={groupAddLogin}
          setGroupAddLogin={setGroupAddLogin}
          groupAddError={groupAddError}
          onAddGroupMember={handleAddGroupMember}
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

      {forwardTarget && (
        <ForwardMessageModal
          chats={forwardChats}
          userId={user?.id}
          currentChatId={chatId}
          sending={forwarding}
          onSelect={(id) => void handleForwardTo(id)}
          onClose={() => !forwarding && setForwardTarget(null)}
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
