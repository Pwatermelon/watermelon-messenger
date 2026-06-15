import { useState, useEffect, useRef } from "react";
import { useParams, useNavigate, useOutletContext } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useWebSocketContext } from "../context/WebSocketContext";
import { ComposeRecorder } from "../components/ComposeRecorder";
import { VoiceMessagePlayer } from "../components/VoiceMessagePlayer";
import { CircleMessagePlayer } from "../components/CircleMessagePlayer";
import { MessageContextMenu } from "../components/MessageContextMenu";
import { ForwardMessageModal } from "../components/ForwardMessageModal";
import BirthdayInfoBlock from "../components/BirthdayInfoBlock";
import { IconAttach, IconFile, IconLocation, IconPhoto, IconSend, IconTrash, IconVideo } from "../components/Icons";
import { getChats, getMessages, uploadFile, addGroupMembers, removeGroupMember, getUserByYandexLogin, deleteChat, updateGroup, deleteMessage, forwardMessage, signMediaPaths } from "../api";
import { extFromBlobType } from "../utils/mediaMime";
import { compressImage } from "../utils/imageCompress";
import type { Chat, Message } from "@melon/shared";
import type { MessageItem } from "../api";
import { getWsUrl } from "../config";
import { mediaUrl } from "../utils/mediaUrl";
import type { ChatLayoutOutletContext } from "./ChatLayout";

export default function ChatRoom() {
  const { chatId } = useParams<{ chatId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { openProfile } = useOutletContext<ChatLayoutOutletContext>();
  const { send, ready, status, reconnect, subscribe } = useWebSocketContext();
  const [chat, setChat] = useState<Chat | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const groupAvatarInputRef = useRef<HTMLInputElement>(null);
  const [attachMenuOpen, setAttachMenuOpen] = useState(false);
  const [lightboxImage, setLightboxImage] = useState<string | null>(null);
  const [contactInfoOpen, setContactInfoOpen] = useState(false);
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);
  const [groupAddLogin, setGroupAddLogin] = useState("");
  const [groupAddError, setGroupAddError] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const longPressRef = useRef<number | null>(null);
  const [messageMenu, setMessageMenu] = useState<{ message: Message; x: number; y: number } | null>(null);
  const [forwardTarget, setForwardTarget] = useState<Message | null>(null);
  const [forwardChats, setForwardChats] = useState<Chat[]>([]);
  const [forwarding, setForwarding] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const selectionMode = selectedIds.size > 0;

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
  }, [chatId]);

  useEffect(() => {
    if (!selectionMode) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelectedIds(new Set());
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectionMode]);

  const otherMember = chat?.type === "dm" ? chat.members.find((m) => m.id !== user?.id) : null;

  useEffect(() => {
    return subscribe((msg) => {
      if (msg.type === "message" && msg.message.chatId === chatId) {
        const incoming = msg.message;
        const attach = incoming.attachmentUrl;
        if (attach && !attach.includes("access=")) {
          void signMediaPaths([attach]).then((urls) => {
            const signed = urls[attach];
            setMessages((prev) => {
              if (prev.some((m) => m.id === incoming.id)) return prev;
              return [...prev, { ...incoming, attachmentUrl: signed ?? attach }];
            });
          });
          return;
        }
        setMessages((prev) => {
          if (prev.some((m) => m.id === incoming.id)) return prev;
          return [...prev, incoming];
        });
      }
      if (msg.type === "message_deleted" && msg.chatId === chatId) {
        setMessages((prev) => prev.filter((m) => m.id !== msg.messageId));
      }
    });
  }, [subscribe, chatId]);

  useEffect(() => {
    if (!chatId) return;
    let cancelled = false;
    setLoading(true);
    getChats()
      .then((chats) => {
        const c = (chats as Chat[]).find((ch) => ch.id === chatId);
        if (!cancelled) setChat(c ?? null);
      })
      .catch(() => {
        if (!cancelled) setChat(null);
      });

    getMessages(chatId, 50)
      .then(({ messages: list }) => {
        if (!cancelled) setMessages(list as Message[]);
      })
      .catch(() => {
        if (!cancelled) setMessages([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [chatId]);

  useEffect(() => {
    if (!chatId || !ready) return;
    send({ type: "subscribe", chatId });
    return () => {
      send({ type: "unsubscribe", chatId });
    };
  }, [chatId, ready, send]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function sendMessage(opts: {
    content: string;
    messageType?: "text" | "image" | "file" | "video" | "location" | "voice" | "circle";
    attachmentUrl?: string | null;
    attachmentMetadata?: { fileName?: string; mimeType?: string; size?: number; duration?: number; lat?: number; lng?: number } | null;
  }) {
    if (!chatId || sending) return;
    setSending(true);
    try {
      send({
        type: "message",
        chatId,
        content: opts.content,
        messageType: opts.messageType ?? "text",
        attachmentUrl: opts.attachmentUrl ?? null,
        attachmentMetadata: opts.attachmentMetadata ?? null,
      });
    } finally {
      setSending(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text) return;
    setInput("");
    await sendMessage({ content: text });
  }

  function openAttach(accept: string) {
    setAttachMenuOpen(false);
    const inputEl = fileInputRef.current;
    if (!inputEl) return;
    inputEl.accept = accept;
    inputEl.click();
  }

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !chatId) return;
    e.target.value = "";
    setSending(true);
    try {
      const isImage = file.type.startsWith("image/");
      const toUpload = isImage ? await compressImage(file) : file;
      const { path, fileName, mimeType, size } = await uploadFile(toUpload);
      const type = isImage ? "image" : file.type.startsWith("video/") ? "video" : "file";
      await sendMessage({
        content: type === "image" ? "Фотография" : file.name,
        messageType: type,
        attachmentUrl: path,
        attachmentMetadata: type === "image" ? { fileName: "Фотография", mimeType: toUpload.type, size: toUpload.size } : { fileName: file.name ?? fileName, mimeType: mimeType ?? file.type, size: size ?? file.size },
      });
    } catch (err) {
      console.error(err);
    } finally {
      setSending(false);
    }
  }

  function handleLocation() {
    if (!navigator.geolocation) return;
    setSending(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        sendMessage({
          content: `Location: ${lat.toFixed(5)}, ${lng.toFixed(5)}`,
          messageType: "location",
          attachmentMetadata: { lat, lng },
        });
        setSending(false);
      },
      () => setSending(false)
    );
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

  function canDeleteMessage(_m: Message): boolean {
    return Boolean(user && chatId);
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
      navigate("/", { replace: true });
    } catch (e) {
      console.error(e);
    }
  }

  async function handleGroupAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (!chatId) return;
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !file.type.startsWith("image/")) return;
    setSending(true);
    try {
      const compressed = await compressImage(file);
      const { path } = await uploadFile(compressed);
      const updated = await updateGroup(chatId, { avatarUrl: path });
      setChat(updated as Chat);
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
      const updated = await addGroupMembers(chatId, [u.id]);
      setChat(updated as Chat);
      setGroupAddLogin("");
    } catch (e) {
      setGroupAddError(e instanceof Error ? e.message : "Ошибка");
    }
  }

  async function handleRemoveGroupMember(memberId: string) {
    if (!chatId) return;
    try {
      const updated = await removeGroupMember(chatId, memberId);
      setSelectedMemberId(null);
      if (memberId === user?.id) {
        window.dispatchEvent(new Event("wm:refresh-chats"));
        navigate("/", { replace: true });
        return;
      }
      setChat(updated as Chat);
    } catch (e) {
      console.error(e);
    }
  }

  if (!chatId) return null;

  return (
    <>
      <div className={`chat-header${selectionMode ? " chat-header-select" : ""}`}>
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
      <div className="messages" ref={listRef}>
        {loading ? (
          <p style={{ color: "var(--muted)", padding: "1rem" }}>Loading messages…</p>
        ) : (
          messages.map((m) => {
            const mt = m.messageType ?? "text";
            const naked = mt === "circle" || mt === "voice" || mt === "image";
            const own = m.senderId === user?.id;
            const selectable = canDeleteMessage(m);
            const selected = selectedIds.has(m.id);
            return (
            <div
              key={m.id}
              className={`message-row ${own ? "own" : "incoming"}${selected ? " is-selected" : ""}${selectionMode ? " selection-mode" : ""}`}
            >
              {own && selectable && (
                <button
                  type="button"
                  className="message-row-hit"
                  onClick={() => toggleMessageSelect(m.id)}
                  aria-label={selected ? "Снять выбор" : "Выбрать сообщение"}
                />
              )}
              {selected && selectable && (
                <div className="message-select-check is-checked" aria-hidden>
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                    <path d="M2.5 6l2.5 2.5 4.5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
              )}
            <div
              className={`message ${own ? "own" : ""}${naked ? " message-naked" : ""}`}
              onContextMenu={(e) => onMessageContextMenu(e, m)}
              onTouchStart={(e) => onMessageTouchStart(e, m)}
              onTouchEnd={onMessageTouchEnd}
              onTouchCancel={onMessageTouchEnd}
            >
              {(chat?.type === "group" || (m.sender && m.senderId !== user?.id)) && (
                <div className="message-sender">{m.sender?.username ?? "?"}</div>
              )}
              {m.attachmentMetadata?.forwardedFrom && (
                <div className="message-forwarded">
                  Переслано от {m.attachmentMetadata.forwardedFrom.username}
                </div>
              )}
              {(m.messageType ?? "text") === "text" && (
                <p className="message-content">{displayContent(m)}</p>
              )}
              {(m.messageType ?? "text") === "image" && m.attachmentUrl && (() => {
                const imgUrl = mediaUrl(m.attachmentUrl);
                return (
                  <div className="message-image-wrap">
                    <button type="button" className="message-image-btn" onClick={() => setLightboxImage(imgUrl)}>
                      <img src={imgUrl} alt="" className="message-image" />
                    </button>
                    <span className="message-image-caption">Фотография</span>
                  </div>
                );
              })()}
              {(m.messageType ?? "text") === "file" && m.attachmentUrl && (
                <a href={mediaUrl(m.attachmentUrl)} target="_blank" rel="noopener noreferrer" className="message-file">
                  📎 {m.attachmentMetadata?.fileName ?? "File"}
                </a>
              )}
              {(m.messageType ?? "text") === "video" && m.attachmentUrl && (
                <video src={mediaUrl(m.attachmentUrl)} controls className="message-video" />
              )}
              {(m.messageType ?? "text") === "location" && m.attachmentMetadata?.lat != null && (
                <a
                  href={`https://yandex.ru/maps/?pt=${m.attachmentMetadata.lng},${m.attachmentMetadata.lat}&z=16&l=map`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="message-location"
                >
                  <IconLocation size={16} /> Геопозиция
                </a>
              )}
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
              <div className="message-time">
                {m.createdAt
                  ? new Date(m.createdAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })
                  : ""}
              </div>
            </div>
              {!own && selectable && (
                <button
                  type="button"
                  className="message-row-hit"
                  onClick={() => toggleMessageSelect(m.id)}
                  aria-label={selected ? "Снять выбор" : "Выбрать сообщение"}
                />
              )}
            </div>
          );
          })
        )}
        <div ref={messagesEndRef} />
      </div>
      <div className="compose">
        <input
          type="file"
          ref={fileInputRef}
          accept="*/*"
          onChange={handleFileSelect}
          style={{ display: "none" }}
        />
        <form onSubmit={handleSubmit} className="compose-form compose-form-inline">
          <div className="compose-attach-wrap">
            <button
              type="button"
              className="compose-btn compose-btn-icon compose-btn-attach"
              onClick={() => setAttachMenuOpen((o) => !o)}
              disabled={!ready || sending}
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
                  <button type="button" onClick={() => { setAttachMenuOpen(false); handleLocation(); }}><IconLocation size={18} /> Геометка</button>
                </div>
              </>
            )}
          </div>
          <input
            type="text"
            className="compose-input"
            data-testid="compose-input"
            placeholder="Сообщение…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={!ready}
          />
          {input.trim() ? (
            <button type="submit" className="compose-btn compose-btn-send" data-testid="compose-send" disabled={!ready || sending}>
              <IconSend size={20} />
            </button>
          ) : (
            <ComposeRecorder disabled={!ready || sending} onVoiceSend={handleVoiceSend} onCircleSend={handleCircleSend} />
          )}
        </form>
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
                        onChange={handleGroupAvatarChange}
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
    </>
  );
}
