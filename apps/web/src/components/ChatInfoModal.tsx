import { useCallback, useEffect, useMemo, useState, type ChangeEvent, type RefObject } from "react";
import type { Chat, ChatSharedCategory, ChatSharedItem, User } from "@melon/shared";
import MediaLightbox, { type MediaLightboxItem } from "./MediaLightbox";
import CircleLightbox from "./CircleLightbox";
import { CircleVideoThumb } from "./CircleVideoThumb";
import { VoiceMessagePlayer } from "./VoiceMessagePlayer";
import AddGroupMemberModal from "./AddGroupMemberModal";
import { IconBell, IconBellOff, IconFile, IconPlus, IconUser } from "./Icons";
import { getChatShared, updateChatNotifications } from "../api";
import { downloadMediaFile } from "../utils/mediaFetch";
import { MediaImage } from "./MediaImage";
import { UserAvatar } from "./UserAvatar";
import { useAuthenticatedMediaSrc } from "../hooks/useAuthenticatedMediaSrc";

type TabId = "participants" | ChatSharedCategory;

const GROUP_TABS: { id: TabId; label: string }[] = [
  { id: "participants", label: "Участники" },
  { id: "media", label: "Медиа" },
  { id: "files", label: "Файлы" },
  { id: "links", label: "Ссылки" },
  { id: "voice", label: "Голосовые" },
];

const DM_TABS: { id: ChatSharedCategory; label: string }[] = [
  { id: "media", label: "Медиа" },
  { id: "files", label: "Файлы" },
  { id: "links", label: "Ссылки" },
  { id: "voice", label: "Голосовые" },
];

type Props = {
  chat: Chat;
  chatId: string;
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
  onMembersChanged: () => void | Promise<void>;
  onRemoveGroupMember: (userId: string) => void;
  onRequestDeleteChat: () => void;
  onLeaveGroup: () => void;
};

function formatSharedDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "short", year: "numeric" });
}

function isCircleItem(item: ChatSharedItem): boolean {
  if (item.messageType === "circle") return true;
  const url = item.attachmentUrl ?? "";
  return /circle\.(webm|mp4|mov)$/i.test(url);
}

function sharedItemToMedia(item: ChatSharedItem): MediaLightboxItem | null {
  if (!item.attachmentUrl || isCircleItem(item)) return null;
  const meta = item.attachmentMetadata;
  const base = {
    downloadPath: item.attachmentUrl,
    fileName: meta?.fileName ?? null,
  };
  if (item.messageType === "video") {
    return {
      url: item.attachmentUrl,
      kind: "video",
      poster: meta?.posterUrl ?? null,
      width: meta?.width,
      height: meta?.height,
      duration: meta?.duration,
      ...base,
    };
  }
  if (item.messageType === "image") return { url: item.attachmentUrl, kind: "image", ...base };
  return null;
}

function ChatInfoVideoThumb({ path, className }: { path: string; className?: string }) {
  const src = useAuthenticatedMediaSrc(path);
  if (!src) return <span className={`${className ?? ""} chat-info-media-skeleton`} aria-hidden />;
  return (
    <>
      <video src={src} muted preload="metadata" className={className} />
      <span className="chat-info-media-play" aria-hidden>
        ▶
      </span>
    </>
  );
}

export default function ChatInfoModal({
  chat,
  chatId,
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
  onMembersChanged,
  onRemoveGroupMember,
  onRequestDeleteChat,
  onLeaveGroup,
}: Props) {
  const isGroup = chat.type === "group";
  const tabs = isGroup ? GROUP_TABS : DM_TABS;
  const defaultTab: TabId = isGroup ? "participants" : "media";
  const headerTitle = isGroup ? (chat.name ?? "Группа") : (otherMember?.username ?? "Чат");
  const memberCount = chat.members.length;

  const [tab, setTab] = useState<TabId>(defaultTab);
  const [muteBusy, setMuteBusy] = useState(false);
  const [sharedByTab, setSharedByTab] = useState<Partial<Record<ChatSharedCategory, ChatSharedItem[]>>>({});
  const [hasMoreByTab, setHasMoreByTab] = useState<Partial<Record<ChatSharedCategory, boolean>>>({});
  const [loadingTab, setLoadingTab] = useState<ChatSharedCategory | null>(null);
  const [lightbox, setLightbox] = useState<{ items: MediaLightboxItem[]; index: number } | null>(null);
  const [circleLightbox, setCircleLightbox] = useState<{ src: string; duration?: number } | null>(null);
  const [addMemberOpen, setAddMemberOpen] = useState(false);

  const memberIds = useMemo(() => chat.members.map((m) => m.id), [chat.members]);

  const resetShared = useCallback(() => {
    setSharedByTab({});
    setHasMoreByTab({});
    setLoadingTab(null);
  }, []);

  useEffect(() => {
    if (!open) {
      setLightbox(null);
      setCircleLightbox(null);
      setAddMemberOpen(false);
      resetShared();
      return;
    }
    setTab(defaultTab);
  }, [open, resetShared, defaultTab, chat.id]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (lightbox) {
        setLightbox(null);
        return;
      }
      if (circleLightbox) {
        setCircleLightbox(null);
        return;
      }
      if (addMemberOpen) {
        setAddMemberOpen(false);
        return;
      }
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, lightbox, circleLightbox, addMemberOpen, onClose]);

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

  function renderParticipants() {
    if (!isGroup && otherMember) {
      return null;
    }

    if (!isGroup) {
      return (
        <p className="contact-info-muted chat-info-empty">
          Собеседник недоступен. Вы можете удалить этот чат.
        </p>
      );
    }

    return (
      <div className="chat-info-participants">
        <section className="chat-info-section">
          <h3 className="chat-info-section-title">
            Участники · {chat.members.length}
          </h3>
          <ul className="chat-info-member-list">
            {chat.members.map((m) => (
              <li key={m.id} className="chat-info-member-row">
                <button
                  type="button"
                  className="chat-info-member-main"
                  onClick={() => openProfile(m.id)}
                >
                  <div className="chat-info-member-avatar">
                    <UserAvatar path={m.avatarUrl} name={m.username ?? "?"} imgClassName="chat-info-member-avatar-img" />
                  </div>
                  <div className="chat-info-member-text">
                    <div className="chat-info-member-name-row">
                      <span className="chat-info-member-name">{m.username}</span>
                      {m.role === "admin" && <span className="chat-info-member-role">админ</span>}
                    </div>
                  </div>
                </button>
                {isGroupAdmin && m.id !== currentUserId && (
                  <button
                    type="button"
                    className="chat-info-member-remove"
                    onClick={() => onRemoveGroupMember(m.id)}
                    title="Удалить из группы"
                    aria-label="Удалить из группы"
                  >
                    ×
                  </button>
                )}
              </li>
            ))}
          </ul>
          {isGroupAdmin && (
            <button
              type="button"
              className="btn btn-secondary chat-info-add-member-btn"
              onClick={() => setAddMemberOpen(true)}
            >
              <IconPlus size={18} />
              Добавить участника
            </button>
          )}
        </section>
      </div>
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
            if (!item.attachmentUrl) return null;
            const isVideo = item.messageType === "video";
            const isCircle = isCircleItem(item);
            if (isCircle) return null;
            return (
              <button
                key={`${item.messageId}-${i}`}
                type="button"
                className="chat-info-media-tile"
                onClick={() => openMediaAt(i)}
                aria-label="Открыть медиа"
              >
                {isVideo ? (
                  <ChatInfoVideoThumb path={item.attachmentUrl} className="chat-info-media-thumb" />
                ) : (
                  <MediaImage src={item.attachmentUrl} alt="" className="chat-info-media-thumb" />
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
            const url = item.attachmentUrl;
            return (
              <li key={item.messageId} className="chat-info-file-item">
                <button
                  type="button"
                  className="chat-info-file-link"
                  disabled={!url}
                  onClick={() => {
                    if (!url) return;
                    void downloadMediaFile(url, name).catch(console.error);
                  }}
                >
                  <IconFile size={22} />
                  <span className="chat-info-file-name">{name}</span>
                  <span className="chat-info-file-date">{formatSharedDate(item.createdAt)}</span>
                </button>
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
            if (!item.attachmentUrl) return null;
            return (
              <li key={item.messageId} className="chat-info-voice-item">
                <div className="chat-info-voice-meta">
                  <span className="chat-info-voice-author">{item.sender?.username ?? "Участник"}</span>
                  <span className="chat-info-file-date">{formatSharedDate(item.createdAt)}</span>
                </div>
                {item.messageType === "circle" ? (
                  <button
                    type="button"
                    className="chat-info-circle-preview"
                    onClick={() =>
                      setCircleLightbox({
                        src: item.attachmentUrl!,
                        duration: item.attachmentMetadata?.duration,
                      })
                    }
                    aria-label="Открыть кружок"
                  >
                    <CircleVideoThumb
                      src={item.attachmentUrl}
                      poster={item.attachmentMetadata?.posterUrl ?? null}
                    />
                    <span className="chat-info-media-play" aria-hidden>
                      ▶
                    </span>
                  </button>
                ) : (
                  <VoiceMessagePlayer src={item.attachmentUrl} duration={item.attachmentMetadata?.duration} />
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

  const headerAvatarPath = isGroup ? chat.avatarUrl : otherMember?.avatarUrl;

  return (
    <div className="contact-info-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-label="Информация о чате">
      <div className="contact-info-modal chat-info-modal" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="modal-close" onClick={onClose} aria-label="Закрыть">
          ×
        </button>

        <div className="chat-info-header">
          <div className="chat-info-header-avatar">
            <div className="profile-avatar-wrap">
              {isGroup && isGroupAdmin && (
                <input
                  type="file"
                  ref={groupAvatarInputRef}
                  accept="image/*"
                  onChange={onGroupAvatarPick}
                  style={{ display: "none" }}
                />
              )}
              {headerAvatarPath ? (
                <UserAvatar path={headerAvatarPath} name={headerTitle} imgClassName="contact-info-avatar" />
              ) : (
                <div className="contact-info-avatar-placeholder">
                  {headerTitle.slice(0, 1).toUpperCase()}
                </div>
              )}
              {isGroup && isGroupAdmin && (
                <button
                  type="button"
                  className="profile-avatar-edit"
                  onClick={() => groupAvatarInputRef.current?.click()}
                  disabled={sending}
                  aria-label="Сменить фото группы"
                  title="Сменить фото группы"
                >
                  📷
                </button>
              )}
            </div>
          </div>
          <p className="chat-info-header-title">{headerTitle}</p>
          {!isGroup && otherMember?.yandexLogin && (
            <p className="chat-info-header-sub">@{otherMember.yandexLogin}</p>
          )}
          {isGroup && (
            <p className="chat-info-header-sub">
              {memberCount} {memberCount === 1 ? "участник" : memberCount < 5 ? "участника" : "участников"}
            </p>
          )}
        </div>

        <div className="chat-info-actions">
          {!isGroup && otherMember && (
            <button
              type="button"
              className="chat-info-action"
              onClick={() => openProfile(otherMember.id)}
            >
              <IconUser size={22} />
              <span>Профиль</span>
            </button>
          )}
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
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              title={t.label}
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

        {isGroup && (
          <div className="chat-info-footer chat-info-group-footer">
            <button type="button" className="contact-info-remove-btn" onClick={onLeaveGroup}>
              Покинуть группу
            </button>
            {isGroupAdmin && (
              <button type="button" className="contact-info-remove-btn" onClick={onRequestDeleteChat}>
                Удалить группу
              </button>
            )}
          </div>
        )}

        {!isGroup && (
          <div className="chat-info-footer">
            <button type="button" className="contact-info-remove-btn" onClick={onRequestDeleteChat}>
              Удалить чат
            </button>
          </div>
        )}

        {lightbox && (
          <MediaLightbox items={lightbox.items} initialIndex={lightbox.index} onClose={() => setLightbox(null)} nested />
        )}

        {circleLightbox && (
          <CircleLightbox
            src={circleLightbox.src}
            duration={circleLightbox.duration}
            onClose={() => setCircleLightbox(null)}
            nested
          />
        )}

        <AddGroupMemberModal
          open={addMemberOpen}
          onClose={() => setAddMemberOpen(false)}
          chatId={chatId}
          currentUserId={currentUserId}
          memberIds={memberIds}
          onMemberAdded={onMembersChanged}
        />
      </div>
    </div>
  );
}
