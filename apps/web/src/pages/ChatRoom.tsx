import { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo } from "react";
import { useAuth } from "../context/AuthContext";
import { useWebSocketContext } from "../context/WebSocketContext";
import { ComposeRecorder } from "../components/ComposeRecorder";
import { VoiceMessagePlayer } from "../components/VoiceMessagePlayer";
import { CircleMessagePlayer } from "../components/CircleMessagePlayer";
import { MessageContextMenu } from "../components/MessageContextMenu";
import { ForwardMessageModal } from "../components/ForwardMessageModal";
import { LocationPickerModal } from "../components/LocationPickerModal";
import { LocationPreview } from "../components/LocationPreview";
import ImageCropModal from "../components/ImageCropModal";
import BirthdayInfoBlock from "../components/BirthdayInfoBlock";
import { IconAttach, IconFile, IconLocation, IconPhoto, IconSend, IconTrash, IconVideo, IconBack, IconChevronDown } from "../components/Icons";
import { getChat, getChats, getMessages, uploadFile, addGroupMembers, removeGroupMember, getUserByYandexLogin, deleteChat, updateGroup, deleteMessage, editMessage, forwardMessage, signMediaPaths, markChatReadApi } from "../api";
import { extFromBlobType } from "../utils/mediaMime";
import { compressImage, isGifFile } from "../utils/imageCompress";
import type { Chat, Message, AttachmentMetadata } from "@melon/shared";
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
  isMessageBelowViewport,
  scrollListToMessage,
} from "../utils/chatUnread";

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
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const groupAvatarInputRef = useRef<HTMLInputElement>(null);
  const [groupAvatarCropFile, setGroupAvatarCropFile] = useState<File | null>(null);
  const [locationPickerOpen, setLocationPickerOpen] = useState(false);
  const [attachMenuOpen, setAttachMenuOpen] = useState(false);
  const [lightboxImage, setLightboxImage] = useState<string | null>(null);
  const [fileDragActive, setFileDragActive] = useState(false);
  const [contactInfoOpen, setContactInfoOpen] = useState(false);
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);
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
  const [editDraft, setEditDraft] = useState<Message | null>(null);
  const composeInputRef = useRef<HTMLInputElement>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const selectionMode = selectedIds.size > 0;
  const [readCursors, setReadCursors] = useState<Record<string, string>>({});
  const readCursorsRef = useRef<Record<string, string>>({});
  const messagesRef = useRef<Message[]>([]);
  const hasMoreOlderRef = useRef(true);
  const loadingOlderRef = useRef(false);
  const loadOlderLockRef = useRef(false);
  const lastOlderLoadAtRef = useRef(0);
  const loadingRef = useRef(true);
  const prependingOlderRef = useRef(false);
  const pendingPrependRef = useRef<PrependScrollState | null>(null);
  const [prependTick, setPrependTick] = useState(0);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    loadingRef.current = loading;
  }, [loading]);

  function applyReadCursors(rows: { userId: string; lastReadMessageId: string }[]) {
    const map = Object.fromEntries(rows.map((r) => [r.userId, r.lastReadMessageId]));
    readCursorsRef.current = map;
    setReadCursors(map);
  }

  function markChatRead(messageId?: string) {
    if (!chatId || !user?.id) return;
    if (messageId) {
      const normalized = messageId.toLowerCase();
      const mine = readCursorsRef.current[user.id];
      if (mine && mine.toLowerCase() >= normalized) return;
      readCursorsRef.current[user.id] = normalized;
      setReadCursors((prev) => ({ ...prev, [user.id]: normalized }));
    }
    if (ready) {
      send(messageId ? { type: "mark_read", chatId, messageId: messageId.toLowerCase() } : { type: "mark_read", chatId });
    }
    void markChatReadApi(chatId, messageId).then(() => {
      serverUnreadCountRef.current = 0;
      setServerUnreadCount(0);
      window.dispatchEvent(new CustomEvent("wm:chat-read", { detail: { chatId } }));
    }).catch(() => {});
  }

  function isMessageReadByPeers(m: Message): boolean {
    if (m.senderId !== user?.id) return false;
    const peers = chat?.members.filter((mem) => mem.id !== user?.id) ?? [];
    return peers.some((p) => (readCursors[p.id] ?? "") >= m.id);
  }

  useEffect(() => {
    if (!lightboxImage) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLightboxImage(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightboxImage]);

  useEffect(() => {
    if (!contactInfoOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (selectedMemberId) setSelectedMemberId(null);
      else setContactInfoOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [contactInfoOpen, selectedMemberId]);

  useEffect(() => {
    setSelectedIds(new Set());
    setReadCursors({});
    readCursorsRef.current = {};
    setReplyDraft(null);
    setEditDraft(null);
    stickToBottomRef.current = true;
    pendingInitialScrollRef.current = true;
    suppressAutoReadRef.current = false;
    serverUnreadCountRef.current = 0;
    setServerUnreadCount(0);
    setUnreadJumpCount(0);
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

  const myLastReadId = user?.id ? (readCursors[user.id] ?? readCursorsRef.current[user.id] ?? null) : null;
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
    if (!chatId || !user?.id || messagesRef.current.length === 0) return;
    const list = listRef.current;
    const latestId = messagesRef.current[messagesRef.current.length - 1]!.id;

    if (serverUnreadCountRef.current <= 0) {
      if (stickToBottomRef.current) markChatRead(latestId);
      return;
    }

    if (!list) return;

    const lastRead = readCursorsRef.current[user.id] ?? null;
    const bounds = findUnreadBounds(messagesRef.current, lastRead, user.id, serverUnreadCountRef.current);

    if (!bounds.last) {
      if (stickToBottomRef.current) {
        suppressAutoReadRef.current = false;
        serverUnreadCountRef.current = 0;
        setServerUnreadCount(0);
        markChatRead(latestId);
      }
      return;
    }

    if (!isMessageBelowViewport(list, bounds.last.id)) {
      suppressAutoReadRef.current = false;
      serverUnreadCountRef.current = 0;
      setServerUnreadCount(0);
      markChatRead(latestId);
    }
  }, [chatId, user?.id]);

  useEffect(() => {
    return subscribe((msg) => {
      if (msg.type === "message" && msg.message.chatId === chatId) {
        const incoming = msg.message;
        const fromOther = incoming.senderId !== user?.id;
        const attach = incoming.attachmentUrl;
        const afterAppend = (next: Message[]) => {
          if (fromOther && !stickToBottomRef.current) {
            serverUnreadCountRef.current += 1;
            setServerUnreadCount((c) => c + 1);
            suppressAutoReadRef.current = true;
          } else if (fromOther && stickToBottomRef.current) {
            markChatRead(incoming.id);
          }
          return next;
        };
        if (attach && !attach.includes("access=")) {
          void signMediaPaths([attach]).then((urls) => {
            const signed = urls[attach];
            setMessages((prev) => {
              if (prev.some((m) => m.id === incoming.id)) return prev;
              return afterAppend([...prev, { ...incoming, attachmentUrl: signed ?? attach }]);
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
        setReadCursors((prev) => {
          const cur = prev[msg.userId];
          if (cur && cur >= msg.messageId) return prev;
          const next = { ...prev, [msg.userId]: msg.messageId };
          readCursorsRef.current = next;
          return next;
        });
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
    pendingPrependRef.current = capturePrependScroll(listEl);
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
    if (!chatId || messages.length === 0 || !user?.id) return;
    if (prependingOlderRef.current || loadingOlderRef.current) return;
    if (suppressAutoReadRef.current) {
      refreshUnreadJumpCount();
      return;
    }
    if (serverUnreadCountRef.current <= 0) {
      if (stickToBottomRef.current) markChatRead(messages[messages.length - 1]!.id);
      return;
    }
    if (!stickToBottomRef.current) {
      refreshUnreadJumpCount();
      return;
    }
    markChatRead(messages[messages.length - 1]!.id);
  }, [chatId, messages, user?.id, ready, refreshUnreadJumpCount]);

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
    getChat(chatId)
      .then((c) => {
        if (cancelled) return;
        if (!c) {
          onCloseRef.current();
          return;
        }
        setChat(c as Chat);
      })
      .catch(() => {
        if (!cancelled) onCloseRef.current();
      });

    getMessages(chatId, MESSAGE_PAGE_SIZE)
      .then(({ messages: list, readCursors: cursors, myLastReadMessageId, unreadCount }) => {
        if (!cancelled) {
          const unread = unreadCount ?? 0;
          serverUnreadCountRef.current = unread;
          setServerUnreadCount(unread);
          if (cursors?.length) applyReadCursors(cursors);
          if (user?.id && myLastReadMessageId) {
            readCursorsRef.current[user.id] = myLastReadMessageId;
            setReadCursors((prev) => ({ ...prev, [user.id]: myLastReadMessageId }));
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
          onCloseRef.current();
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
  }, [chatId]);

  useLayoutEffect(() => {
    const pending = pendingPrependRef.current;
    if (!pending || !prependingOlderRef.current) return;
    const list = listRef.current;
    if (!list) return;

    const stick = () => restorePrependScroll(list, pending);

    stick();
    requestAnimationFrame(stick);

    const ro = new ResizeObserver(() => stick());
    ro.observe(list);

    const done = window.setTimeout(() => {
      ro.disconnect();
      pendingPrependRef.current = null;
      prependingOlderRef.current = false;
      loadingOlderRef.current = false;
      loadOlderLockRef.current = false;
      setLoadingOlder(false);
    }, 800);

    return () => {
      ro.disconnect();
      window.clearTimeout(done);
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
      if (!id) return;
      void markChatReadApi(id).catch(() => {});
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
    list.addEventListener("scroll", onScroll, { passive: true });
    return () => list.removeEventListener("scroll", onScroll);
  }, [chatId, refreshUnreadJumpCount, tryMarkReadFromScroll]);

  useEffect(() => {
    if (loading && messages.length === 0) return;
    if (messages.length === 0) return;
    if (pendingPrependRef.current || prependingOlderRef.current || loadingOlderRef.current || loadOlderLockRef.current) return;

    if (pendingInitialScrollRef.current) {
      if (!user?.id) return;
      const list = listRef.current;
      const firstUnread = serverUnreadCount > 0 ? unreadBounds.first : null;

      const snap = () => {
        if (!list) return;
        if (firstUnread) {
          stickToBottomRef.current = false;
          scrollListToMessage(list, firstUnread.id, "start", 16);
        } else {
          stickToBottomRef.current = true;
          suppressAutoReadRef.current = false;
          list.scrollTop = list.scrollHeight;
        }
      };

      snap();
      requestAnimationFrame(() => {
        snap();
        requestAnimationFrame(snap);
      });
      const t1 = window.setTimeout(snap, 100);
      const t2 = window.setTimeout(snap, 400);
      const t3 = window.setTimeout(() => {
        snap();
        pendingInitialScrollRef.current = false;
        refreshUnreadJumpCount();
        if (!firstUnread) tryMarkReadFromScroll();
      }, 900);
      return () => {
        window.clearTimeout(t1);
        window.clearTimeout(t2);
        window.clearTimeout(t3);
      };
    }

    refreshUnreadJumpCount();

    if (stickToBottomRef.current) {
      scrollToBottom(false);
    }
  }, [messages, loading, scrollToBottom, unreadBounds.first, serverUnreadCount, refreshUnreadJumpCount, tryMarkReadFromScroll]);

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

  function scrollToMessage(messageId: string, block: "start" | "center" | "end" = "center") {
    const list = listRef.current;
    if (!list) return;
    scrollListToMessage(list, messageId, block, 16);
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

  async function uploadFiles(files: File[]) {
    if (!files.length || !chatId || sending || !ready) return;
    setSending(true);
    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i]!;
        const isGif = isGifFile(file);
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
          i === 0
        );
      }
      setReplyDraft(null);
    } catch (err) {
      console.error(err);
    } finally {
      setSending(false);
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
      const msg = await forwardMessage(targetChatId, chatId, forwardTarget.id);
      if (targetChatId === chatId) {
        setMessages((prev) => {
          if (prev.some((x) => x.id === msg.id)) return prev;
          return [...prev, msg as Message];
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

  async function handleDeleteChat() {
    if (!chatId) return;
    try {
      await deleteChat(chatId);
      window.dispatchEvent(new Event("wm:refresh-chats"));
      onClose();
    } catch (e) {
      console.error(e);
    }
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
      setSelectedMemberId(null);
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
        {loading && messages.length === 0 ? (
          <p style={{ color: "var(--muted)", padding: "1rem" }}>Loading messages…</p>
        ) : (
          <>
            <div ref={topSentinelRef} className="messages-top-sentinel" aria-hidden />
            {loadingOlder && (
              <div className="messages-history-overlay" aria-busy="true" aria-label="Загрузка истории">
                <span className="messages-load-older-spinner" />
              </div>
            )}
            {messages.map((m) => {
            const mt = m.messageType ?? "text";
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
            const selectable = canDeleteMessage(m);
            const selected = selectedIds.has(m.id);
            return (
            <div key={m.id}>
              {showUnreadDivider && (
                <div className="messages-unread-divider" role="separator">
                  <span>Непрочитанные сообщения</span>
                </div>
              )}
            <div
              data-message-id={m.id}
              className={`message-row ${own ? "own" : "incoming"}${selectionMode ? " selection-mode" : ""}`}
              onClick={(e) => onMessageRowClick(e, m)}
            >
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
              {chat?.type === "group" && !own && (
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
              {(m.messageType ?? "text") === "image" && m.attachmentUrl && (() => {
                const imgUrl = mediaUrl(m.attachmentUrl);
                const isGif =
                  m.attachmentMetadata?.mimeType === "image/gif" ||
                  /\.gif$/i.test(m.attachmentUrl.split("?")[0] ?? "") ||
                  m.content === "GIF";
                return (
                  <div className="message-image-wrap">
                    <button type="button" className="message-image-btn" onClick={() => setLightboxImage(imgUrl)}>
                      <img src={imgUrl} alt="" className="message-image" />
                    </button>
                    <span className="message-image-caption">{isGif ? "GIF" : "Фотография"}</span>
                  </div>
                );
              })()}
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
                  <span className="message-read-receipt" title="Прочитано" aria-label="Прочитано">
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
      {lightboxImage && (
        <div
          className="lightbox"
          role="dialog"
          aria-modal="true"
          aria-label="Просмотр изображения"
          onClick={() => setLightboxImage(null)}
        >
          <button type="button" className="lightbox-close" onClick={() => setLightboxImage(null)} aria-label="Закрыть">×</button>
          <div className="lightbox-content" onClick={(e) => e.stopPropagation()}>
            <img src={lightboxImage} alt="" className="lightbox-img" />
          </div>
        </div>
      )}

      {contactInfoOpen && chat && (
        <div
          className="contact-info-overlay"
          onClick={() => { setContactInfoOpen(false); setSelectedMemberId(null); setGroupAddError(""); }}
          role="dialog"
          aria-modal="true"
          aria-label="Информация о чате"
        >
          <div className="contact-info-modal" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="modal-close" onClick={() => { setContactInfoOpen(false); setSelectedMemberId(null); }} aria-label="Закрыть">×</button>
            {chat.type === "dm" && otherMember ? (
              <>
                <div className="contact-info-avatar-wrap">
                  {otherMember.avatarUrl ? (
                    <img
                      src={mediaUrl(otherMember.avatarUrl)}
                      alt=""
                      className="contact-info-avatar"
                    />
                  ) : (
                    <div className="contact-info-avatar-placeholder">
                      {(otherMember.username ?? "?").slice(0, 1).toUpperCase()}
                    </div>
                  )}
                </div>
                <p className="contact-info-name">{otherMember.username}</p>
                {otherMember.birthdayLabel && (
                  <BirthdayInfoBlock
                    label={otherMember.birthdayLabel}
                    age={otherMember.birthdayAge}
                    isToday={otherMember.isBirthdayToday}
                    compact
                  />
                )}
                {otherMember.yandexLogin && (
                  <div className="contact-info-id-block">
                    <span className="contact-info-label">Логин</span>
                    <code className="contact-info-code">{otherMember.yandexLogin}</code>
                  </div>
                )}
                <button
                  type="button"
                  className="contact-info-profile-btn"
                  onClick={() => {
                    setContactInfoOpen(false);
                    openProfile(otherMember.id);
                  }}
                >
                  Открыть профиль
                </button>
                <button
                  type="button"
                  className="contact-info-remove-btn"
                  onClick={handleDeleteChat}
                >
                  Удалить чат
                </button>
              </>
            ) : chat.type === "dm" ? (
              <>
                <div className="contact-info-avatar-wrap">
                  <div className="contact-info-avatar-placeholder">?</div>
                </div>
                <p className="contact-info-name">Собеседник недоступен</p>
                <p className="contact-info-muted" style={{ margin: "0 0 1rem", color: "var(--muted)", fontSize: "0.9rem" }}>
                  Возможно, собеседник удалил этот чат. Вы можете удалить его у себя.
                </p>
                <button
                  type="button"
                  className="contact-info-remove-btn"
                  onClick={handleDeleteChat}
                >
                  Удалить чат
                </button>
              </>
            ) : chat.type === "group" && selectedMemberId ? (
              (() => {
                const m = chat.members.find((x) => x.id === selectedMemberId);
                if (!m) return null;
                return (
                  <>
                    <button type="button" className="contact-info-back" onClick={() => setSelectedMemberId(null)}>
                      ← Назад
                    </button>
                    <div className="contact-info-avatar-wrap">
                      {m.avatarUrl ? (
                        <img
                          src={mediaUrl(m.avatarUrl)}
                          alt=""
                          className="contact-info-avatar"
                        />
                      ) : (
                        <div className="contact-info-avatar-placeholder">
                          {(m.username ?? "?").slice(0, 1).toUpperCase()}
                        </div>
                      )}
                    </div>
                    <p className="contact-info-name">{m.username}</p>
                    {m.birthdayLabel && (
                      <BirthdayInfoBlock label={m.birthdayLabel} age={m.birthdayAge} isToday={m.isBirthdayToday} compact />
                    )}
                    {m.yandexLogin && (
                      <div className="contact-info-id-block">
                        <span className="contact-info-label">Логин</span>
                        <code className="contact-info-code">{m.yandexLogin}</code>
                      </div>
                    )}
                    <button
                      type="button"
                      className="contact-info-profile-btn"
                      onClick={() => {
                        setContactInfoOpen(false);
                        openProfile(m.id);
                      }}
                    >
                      Открыть профиль
                    </button>
                        {isGroupAdmin && m.id !== user?.id && (
                      <button
                        type="button"
                        className="contact-info-remove-btn"
                        onClick={() => handleRemoveGroupMember(m.id)}
                      >
                        Удалить из группы
                      </button>
                    )}
                  </>
                );
              })()
            ) : chat.type === "group" ? (
              <>
                <p className="contact-info-name contact-info-group-title">{chat.name ?? "Группа"}</p>
                <div className="contact-info-group-avatar-block">
                  <div className="contact-info-group-avatar">
                    {chat.avatarUrl ? (
                      <img
                        src={mediaUrl(chat.avatarUrl)}
                        alt=""
                      />
                    ) : (
                      (chat.name ?? "Группа").slice(0, 1).toUpperCase()
                    )}
                  </div>
                  {isGroupAdmin && (
                    <>
                      <input
                        type="file"
                        ref={groupAvatarInputRef}
                        accept="image/*"
                        onChange={handleGroupAvatarPick}
                        style={{ display: "none" }}
                      />
                      <button
                        type="button"
                        className="contact-info-group-avatar-change"
                        onClick={() => groupAvatarInputRef.current?.click()}
                        disabled={sending}
                      >
                        Сменить аватар группы
                      </button>
                    </>
                  )}
                </div>
                <p className="contact-info-members-label">Участники</p>
                <ul className="contact-info-members">
                  {chat.members.map((m) => (
                    <li key={m.id} className="contact-info-member">
                      <button
                        type="button"
                        className="contact-info-member-btn"
                        onClick={() => setSelectedMemberId(m.id)}
                      >
                        <div className="contact-info-member-avatar">
                          {m.avatarUrl ? (
                            <img src={mediaUrl(m.avatarUrl)} alt="" />
                          ) : (
                            (m.username ?? "?").slice(0, 1).toUpperCase()
                          )}
                        </div>
                        <div className="contact-info-member-body">
                          <span className="contact-info-member-name">{m.username}</span>
                        </div>
                      </button>
                      {isGroupAdmin && m.id !== user?.id && (
                        <button
                          type="button"
                          className="contact-info-member-remove"
                          onClick={(e) => { e.stopPropagation(); handleRemoveGroupMember(m.id); }}
                          title="Удалить из группы"
                        >
                          ×
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
                {isGroupAdmin && (
                  <div className="contact-info-add-members">
                    <p className="contact-info-members-label">Добавить по логину</p>
                    <div className="search-id-row">
                      <input
                        type="text"
                        placeholder="Логин"
                        value={groupAddLogin}
                        onChange={(e) => { setGroupAddLogin(e.target.value); setGroupAddError(""); }}
                        onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), handleAddGroupMember())}
                        spellCheck={false}
                        autoComplete="off"
                      />
                      <button type="button" className="btn" onClick={handleAddGroupMember} disabled={!groupAddLogin.trim()}>
                        Добавить
                      </button>
                    </div>
                    {groupAddError && <p className="search-error">{groupAddError}</p>}
                  </div>
                )}
                {user && (
                  <button
                    type="button"
                    className="contact-info-remove-btn"
                    onClick={() => handleRemoveGroupMember(user.id)}
                  >
                    Покинуть группу
                  </button>
                )}
                {isGroupAdmin && (
                  <button
                    type="button"
                    className="contact-info-remove-btn"
                    onClick={handleDeleteChat}
                  >
                    Удалить группу
                  </button>
                )}
              </>
            ) : null}
          </div>
        </div>
      )}

      {messageMenu && (
        <MessageContextMenu
          x={messageMenu.x}
          y={messageMenu.y}
          onReply={() => handleReplyStart(messageMenu.message)}
          onEdit={canEditMessage(messageMenu.message) ? () => handleEditStart(messageMenu.message) : undefined}
          onForward={() => handleForwardStart(messageMenu.message)}
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
