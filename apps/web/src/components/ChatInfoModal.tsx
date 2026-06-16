import { useCallback, useEffect, useMemo, useState, type ChangeEvent, type RefObject } from "react";
import type { Chat, ChatSharedCategory, ChatSharedItem, User } from "@melon/shared";
import BirthdayInfoBlock from "./BirthdayInfoBlock";
import MediaLightbox, { type MediaLightboxItem } from "./MediaLightbox";
import { VoiceMessagePlayer } from "./VoiceMessagePlayer";
import { CircleMessagePlayer } from "./CircleMessagePlayer";
import { IconBell, IconBellOff, IconFile } from "./Icons";
import { getChatShared, updateChatNotifications } from "../api";
import { mediaDownloadUrl, mediaUrl } from "../utils/mediaUrl";
import { parseLocationCoords } from "../utils/yandexMaps";

type TabId = "participants" | ChatSharedCategory;

const TABS: { id: TabId; label: string }[] = [
  { id: "participants", label: "Участники" },
  { id: "media", label: "Медиа" },
  { id: "files", label: "Файлы" },
  { id: "links", label: "Ссылки" },
  { id: "voice", label: "Голосовые" },
];

type Props = {
  chat: Chat;
  currentUserId: string;
  otherMember: User | null | undefined;
  open: boolean;
  onClose: () => void;
  openProfile: (userId: string) => void;
  notificationsMuted: boolean;
  onNotificationsMutedChange: (muted: boolean) => void;
  isGroupAdmin: boolean;
  sending: boolean;
  groupAvatarInputRef: RefObject<HTMLInputElement>;
  onGroupAvatarPick: (e: ChangeEvent<HTMLInputElement>) => void;
  groupAddLogin: string;
  setGroupAddLogin: (v: string) => void;
  groupAddError: string;
  onAddGroupMember: () => void;
  onRemoveGroupMember: (userId: string) => void;
  onRequestDeleteChat: () => void;
  onLeaveGroup: () => void;
};

function formatSharedDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "short", year: "numeric" });
}

function sharedItemToMedia(item: ChatSharedItem): MediaLightboxItem | null {
  if (!item.attachmentUrl) return null;
  const url = mediaUrl(item.attachmentUrl);
  if (item.messageType === "video") return { url, kind: "video" };
  if (item.messageType === "image") return { url, kind: "image" };
  return null;
}

export default function ChatInfoModal({
  chat,
  currentUserId,
  otherMember,
  open,
  onClose,
  openProfile,
  notificationsMuted,
  onNotificationsMutedChange,
  isGroupAdmin,
  sending,
  groupAvatarInputRef,
  onGroupAvatarPick,
  groupAddLogin,
  setGroupAddLogin,
  groupAddError,
  onAddGroupMember,
  onRemoveGroupMember,
  onRequestDeleteChat,
  onLeaveGroup,
}: Props) {
  const [tab, setTab] = useState<TabId>("participants");
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);
  const [muteBusy, setMuteBusy] = useState(false);
  const [sharedByTab, setSharedByTab] = useState<Partial<Record<ChatSharedCategory, ChatSharedItem[]>>>({});
  const [hasMoreByTab, setHasMoreByTab] = useState<Partial<Record<ChatSharedCategory, boolean>>>({});
  const [loadingTab, setLoadingTab] = useState<ChatSharedCategory | null>(null);
  const [lightbox, setLightbox] = useState<{ items: MediaLightboxItem[]; index: number } | null>(null);

  const isGroup = chat.type === "group";
  const headerTitle = isGroup ? (chat.name ?? "Группа") : (otherMember?.username ?? "Чат");
  const memberCount = chat.members.length;

  const resetShared = useCallback(() => {
    setSharedByTab({});
    setHasMoreByTab({});
    setLoadingTab(null);
  }, []);

  useEffect(() => {
    if (!open) {
      setTab("participants");
      setSelectedMemberId(null);
      setLightbox(null);
      resetShared();
    }
  }, [open, resetShared]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (lightbox) {
        setLightbox(null);
        return;
      }
      if (selectedMemberId) setSelectedMemberId(null);
      else onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, selectedMemberId, lightbox, onClose]);

  const loadShared = useCallback(async (category: ChatSharedCategory, before?: string) => {
    setLoadingTab(category);
    try {
      const res = await getChatShared(chat.id, category, { limit: 48, before });
      setSharedByTab((prev) => ({
        ...prev,
        [category]: before ? [...(prev[category] ?? []), ...res.items] : res.items,
      }));
      setHasMoreByTab((prev) => ({ ...prev, [category]: res.hasMore }));
    } catch {
      if (!before) setSharedByTab((prev) => ({ ...prev, [category]: [] }));
      setHasMoreByTab((prev) => ({ ...prev, [category]: false }));
    } finally {
      setLoadingTab(null);
    }
  }, [chat.id]);

  useEffect(() => {
    if (!open || tab === "participants") return;
    if (sharedByTab[tab] !== undefined) return;
    void loadShared(tab);
  }, [open, tab, sharedByTab, loadShared]);

  function loadMore(category: ChatSharedCategory) {
    const list = sharedByTab[category] ?? [];
    const before = list[list.length - 1]?.messageId;
    void loadShared(category, before);
  }

  const mediaItems = useMemo(
    () => (sharedByTab.media ?? []).map(sharedItemToMedia).filter((x): x is MediaLightboxItem => x != null),
    [sharedByTab.media]
  );

  async function toggleMute() {
    if (muteBusy) return;
    setMuteBusy(true);
    try {
      const next = !notificationsMuted;
      await updateChatNotifications(chat.id, next);
      onNotificationsMutedChange(next);
    } catch {
      // ignore
    } finally {
      setMuteBusy(false);
    }
  }

  function openMediaAt(index: number) {
    if (mediaItems.length === 0) return;
    setLightbox({ items: mediaItems, index });
  }

  function renderMemberDetail(m: User & { role?: string }) {
    return (
      <>
        <button type="button" className="contact-info-back" onClick={() => setSelectedMemberId(null)}>
          ← Назад
        </button>
        <div className="contact-info-avatar-wrap">
          {m.avatarUrl ? (
            <img src={mediaUrl(m.avatarUrl)} alt="" className="contact-info-avatar" />
          ) : (
            <div className="contact-info-avatar-placeholder">{(m.username ?? "?").slice(0, 1).toUpperCase()}</div>
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
            onClose();
            openProfile(m.id);
          }}
        >
          Открыть профиль
        </button>
        {isGroupAdmin && m.id !== currentUserId && (
          <button type="button" className="contact-info-remove-btn" onClick={() => onRemoveGroupMember(m.id)}>
            Удалить из группы
          </button>
        )}
      </>
    );
  }

  function renderParticipants() {
    if (selectedMemberId) {
      const m = chat.members.find((x) => x.id === selectedMemberId);
      if (!m) return null;
      return renderMemberDetail(m);
    }

    if (!isGroup && otherMember) {
      return (
        <>
          <div className="contact-info-avatar-wrap">
            {otherMember.avatarUrl ? (
              <img src={mediaUrl(otherMember.avatarUrl)} alt="" className="contact-info-avatar" />
            ) : (
              <div className="contact-info-avatar-placeholder">
                {(otherMember.username ?? "?").slice(0, 1).toUpperCase()}
              </div>
            )}
          </div>
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
              onClose();
              openProfile(otherMember.id);
            }}
          >
            Открыть профиль
          </button>
          <button type="button" className="contact-info-remove-btn" onClick={onRequestDeleteChat}>
            Удалить чат
          </button>
        </>
      );
    }

    if (!isGroup) {
      return (
        <>
          <p className="contact-info-muted" style={{ color: "var(--muted)", fontSize: "0.9rem" }}>
            Собеседник недоступен. Вы можете удалить этот чат.
          </p>
          <button type="button" className="contact-info-remove-btn" onClick={onRequestDeleteChat}>
            Удалить чат
          </button>
        </>
      );
    }

    return (
      <>
        {isGroupAdmin && (
          <div className="contact-info-group-avatar-block chat-info-group-avatar-inline">
            <input
              type="file"
              ref={groupAvatarInputRef}
              accept="image/*"
              onChange={onGroupAvatarPick}
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
          </div>
        )}
        <ul className="contact-info-members">
          {chat.members.map((m) => (
            <li key={m.id} className="contact-info-member">
              <button type="button" className="contact-info-member-btn" onClick={() => setSelectedMemberId(m.id)}>
                <div className="contact-info-member-avatar">
                  {m.avatarUrl ? (
                    <img src={mediaUrl(m.avatarUrl)} alt="" />
                  ) : (
                    (m.username ?? "?").slice(0, 1).toUpperCase()
                  )}
                </div>
                <div className="contact-info-member-body">
                  <span className="contact-info-member-name">{m.username}</span>
                  {m.role === "admin" && <span className="chat-info-member-role">админ</span>}
                </div>
              </button>
              {isGroupAdmin && m.id !== currentUserId && (
                <button
                  type="button"
                  className="contact-info-member-remove"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemoveGroupMember(m.id);
                  }}
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
                onChange={(e) => setGroupAddLogin(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), onAddGroupMember())}
                spellCheck={false}
                autoComplete="off"
              />
              <button type="button" className="btn" onClick={onAddGroupMember} disabled={!groupAddLogin.trim()}>
                Добавить
              </button>
            </div>
            {groupAddError && <p className="search-error">{groupAddError}</p>}
          </div>
        )}
        <button type="button" className="contact-info-remove-btn" onClick={onLeaveGroup}>
          Покинуть группу
        </button>
        {isGroupAdmin && (
          <button type="button" className="contact-info-remove-btn" onClick={onRequestDeleteChat}>
            Удалить группу
          </button>
        )}
      </>
    );
  }

  function renderMediaTab() {
    const items = sharedByTab.media ?? [];
    if (loadingTab === "media" && items.length === 0) {
      return <p className="chat-info-empty">Загрузка…</p>;
    }
    if (items.length === 0) return <p className="chat-info-empty">Нет медиа</p>;
    return (
      <>
        <div className="chat-info-media-grid">
          {items.map((item, i) => {
            const url = item.attachmentUrl ? mediaUrl(item.attachmentUrl) : "";
            if (!url) return null;
            const isVideo = item.messageType === "video";
            return (
              <button
                key={`${item.messageId}-${i}`}
                type="button"
                className="chat-info-media-tile"
                onClick={() => openMediaAt(i)}
                aria-label="Открыть медиа"
              >
                {isVideo ? (
                  <>
                    <video src={url} muted preload="metadata" className="chat-info-media-thumb" />
                    <span className="chat-info-media-play" aria-hidden>
                      ▶
                    </span>
                  </>
                ) : (
                  <img src={url} alt="" className="chat-info-media-thumb" loading="lazy" />
                )}
              </button>
            );
          })}
        </div>
        {hasMoreByTab.media && (
          <button
            type="button"
            className="chat-info-load-more"
            disabled={loadingTab === "media"}
            onClick={() => loadMore("media")}
          >
            {loadingTab === "media" ? "Загрузка…" : "Показать ещё"}
          </button>
        )}
      </>
    );
  }

  function renderFilesTab() {
    const items = sharedByTab.files ?? [];
    if (loadingTab === "files" && items.length === 0) {
      return <p className="chat-info-empty">Загрузка…</p>;
    }
    if (items.length === 0) return <p className="chat-info-empty">Нет файлов</p>;
    return (
      <>
        <ul className="chat-info-file-list">
          {items.map((item) => {
            const name = item.attachmentMetadata?.fileName ?? "Файл";
            const href = item.attachmentUrl ? mediaDownloadUrl(item.attachmentUrl, name) : "#";
            return (
              <li key={item.messageId} className="chat-info-file-item">
                <a href={href} className="chat-info-file-link" download target="_blank" rel="noopener noreferrer">
                  <IconFile size={22} />
                  <span className="chat-info-file-name">{name}</span>
                  <span className="chat-info-file-date">{formatSharedDate(item.createdAt)}</span>
                </a>
              </li>
            );
          })}
        </ul>
        {hasMoreByTab.files && (
          <button
            type="button"
            className="chat-info-load-more"
            disabled={loadingTab === "files"}
            onClick={() => loadMore("files")}
          >
            {loadingTab === "files" ? "Загрузка…" : "Показать ещё"}
          </button>
        )}
      </>
    );
  }

  function renderLinksTab() {
    const items = sharedByTab.links ?? [];
    if (loadingTab === "links" && items.length === 0) {
      return <p className="chat-info-empty">Загрузка…</p>;
    }
    if (items.length === 0) return <p className="chat-info-empty">Нет ссылок</p>;
    return (
      <>
        <ul className="chat-info-link-list">
          {items.map((item, i) => {
            if (item.messageType === "location") {
              const coords = parseLocationCoords(item.content, item.attachmentMetadata ?? undefined);
              const href =
                coords != null
                  ? `https://yandex.ru/maps/?pt=${coords.lng},${coords.lat}&z=16&l=map`
                  : item.content;
              return (
                <li key={`${item.messageId}-${i}`} className="chat-info-link-item">
                  <a href={href} target="_blank" rel="noopener noreferrer" className="chat-info-link">
                    {item.content || "Геопозиция"}
                  </a>
                  <span className="chat-info-file-date">{formatSharedDate(item.createdAt)}</span>
                </li>
              );
            }
            const url = item.links?.[0] ?? item.content;
            return (
              <li key={`${item.messageId}-${i}`} className="chat-info-link-item">
                <a href={url} target="_blank" rel="noopener noreferrer" className="chat-info-link">
                  {url}
                </a>
                <span className="chat-info-file-date">{formatSharedDate(item.createdAt)}</span>
              </li>
            );
          })}
        </ul>
        {hasMoreByTab.links && (
          <button
            type="button"
            className="chat-info-load-more"
            disabled={loadingTab === "links"}
            onClick={() => loadMore("links")}
          >
            {loadingTab === "links" ? "Загрузка…" : "Показать ещё"}
          </button>
        )}
      </>
    );
  }

  function renderVoiceTab() {
    const items = sharedByTab.voice ?? [];
    if (loadingTab === "voice" && items.length === 0) {
      return <p className="chat-info-empty">Загрузка…</p>;
    }
    if (items.length === 0) return <p className="chat-info-empty">Нет голосовых</p>;
    return (
      <>
        <ul className="chat-info-voice-list">
          {items.map((item) => {
            const src = item.attachmentUrl ? mediaUrl(item.attachmentUrl) : "";
            if (!src) return null;
            return (
              <li key={item.messageId} className="chat-info-voice-item">
                <div className="chat-info-voice-meta">
                  <span className="chat-info-voice-author">{item.sender?.username ?? "Участник"}</span>
                  <span className="chat-info-file-date">{formatSharedDate(item.createdAt)}</span>
                </div>
                {item.messageType === "circle" ? (
                  <CircleMessagePlayer src={src} duration={item.attachmentMetadata?.duration} />
                ) : (
                  <VoiceMessagePlayer src={src} duration={item.attachmentMetadata?.duration} />
                )}
              </li>
            );
          })}
        </ul>
        {hasMoreByTab.voice && (
          <button
            type="button"
            className="chat-info-load-more"
            disabled={loadingTab === "voice"}
            onClick={() => loadMore("voice")}
          >
            {loadingTab === "voice" ? "Загрузка…" : "Показать ещё"}
          </button>
        )}
      </>
    );
  }

  if (!open) return null;

  const headerAvatar = isGroup
    ? chat.avatarUrl
      ? mediaUrl(chat.avatarUrl)
      : null
    : otherMember?.avatarUrl
      ? mediaUrl(otherMember.avatarUrl)
      : null;

  return (
    <div className="contact-info-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-label="Информация о чате">
      <div className="contact-info-modal chat-info-modal" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="modal-close" onClick={onClose} aria-label="Закрыть">
          ×
        </button>

        <div className="chat-info-header">
          <div className="chat-info-header-avatar">
            {headerAvatar ? (
              <img src={headerAvatar} alt="" className="contact-info-avatar" />
            ) : (
              <div className="contact-info-avatar-placeholder">
                {headerTitle.slice(0, 1).toUpperCase()}
              </div>
            )}
          </div>
          <p className="chat-info-header-title">{headerTitle}</p>
          {isGroup && (
            <p className="chat-info-header-sub">
              {memberCount} {memberCount === 1 ? "участник" : memberCount < 5 ? "участника" : "участников"}
            </p>
          )}
        </div>

        <div className="chat-info-actions">
          <button
            type="button"
            className={`chat-info-action${notificationsMuted ? " chat-info-action-muted" : ""}`}
            onClick={() => void toggleMute()}
            disabled={muteBusy}
            title={notificationsMuted ? "Включить уведомления" : "Отключить уведомления"}
          >
            {notificationsMuted ? <IconBellOff size={22} /> : <IconBell size={22} />}
            <span>{notificationsMuted ? "Без звука" : "Звук"}</span>
          </button>
        </div>

        <div className="chat-info-tabs" role="tablist" aria-label="Разделы чата">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              className={`chat-info-tab${tab === t.id ? " chat-info-tab-active" : ""}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="chat-info-panel" role="tabpanel">
          {tab === "participants" && renderParticipants()}
          {tab === "media" && renderMediaTab()}
          {tab === "files" && renderFilesTab()}
          {tab === "links" && renderLinksTab()}
          {tab === "voice" && renderVoiceTab()}
        </div>

        {lightbox && (
          <MediaLightbox items={lightbox.items} initialIndex={lightbox.index} onClose={() => setLightbox(null)} nested />
        )}
      </div>
    </div>
  );
}
