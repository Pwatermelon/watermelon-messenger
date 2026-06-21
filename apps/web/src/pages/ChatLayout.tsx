import { useState, useEffect, useRef, useCallback } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import SettingsModal from "../components/SettingsModal";
import AdminConsoleModal from "../components/AdminConsoleModal";
import { useAuth } from "../context/AuthContext";
import { useWebSocketContext } from "../context/WebSocketContext";
import { useActiveChat } from "../context/ActiveChatContext";
import { getChats, getChat, createDm, createGroup, searchUser, getContacts, addContact, uploadFile } from "../api";
import type { Chat, User, Message } from "@melon/shared";
import { mediaUrl } from "../utils/mediaUrl";
import { BrandIcon } from "../components/BrandIcon";
import { IconPlus } from "../components/Icons";
import { UserListLabel } from "../components/UserListLabel";
import { ContactPickItem } from "../components/ContactPickItem";
import ImageCropModal from "../components/ImageCropModal";
import { userAvatarLetter, userDisplayName } from "../utils/userDisplay";
import { compressImage } from "../utils/imageCompress";
import Profile from "./Profile";
import ChatRoom from "./ChatRoom";
import { APP_VERSION } from "../version";
import { applyMessageToChatList, mergeChatLists, upsertChatInList } from "../utils/chatListUpdate";
import { playMessageSound } from "../utils/messageSounds";
import { useCompactLayout } from "../hooks/useCompactLayout";

function EmptyChat() {
  return (
    <div className="empty-chat">
      <div className="empty-chat-icon">
        <BrandIcon size={80} />
      </div>
      <h2>Watermelon Messenger</h2>
      <p>Выберите чат или создайте новый</p>
    </div>
  );
}

export type ChatLayoutOutletContext = {
  openSettings: () => void;
  openProfile: (userId?: string) => void;
  addContact: (userId: string) => Promise<void>;
};

export default function ChatLayout() {
  const { user } = useAuth();
  const { subscribe, send, ready } = useWebSocketContext();
  const navigate = useNavigate();
  const location = useLocation();
  const { activeChatId, openChat, closeChat } = useActiveChat();
  const compact = useCompactLayout();
  const [chats, setChats] = useState<Chat[]>([]);
  const [loading, setLoading] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [adminConsoleOpen, setAdminConsoleOpen] = useState(false);
  const [newChatMenuOpen, setNewChatMenuOpen] = useState(false);
  const [dmOpen, setDmOpen] = useState(false);
  const [groupOpen, setGroupOpen] = useState(false);
  const [dmLogin, setDmLogin] = useState("");
  const [dmUser, setDmUser] = useState<{ id: string; username: string; yandexLogin?: string | null; avatarUrl: string | null } | null>(null);
  const [dmLoading, setDmLoading] = useState(false);
  const [dmError, setDmError] = useState("");
  const [groupName, setGroupName] = useState("");
  const [groupSelected, setGroupSelected] = useState<Array<{ id: string; username: string }>>([]);
  const [groupAddLogin, setGroupAddLogin] = useState("");
  const [groupAddError, setGroupAddError] = useState("");
  const [groupError, setGroupError] = useState("");
  const [groupCreating, setGroupCreating] = useState(false);
  const [groupAvatarPath, setGroupAvatarPath] = useState<string | null>(null);
  const [groupAvatarPreview, setGroupAvatarPreview] = useState<string | null>(null);
  const [groupAvatarCropFile, setGroupAvatarCropFile] = useState<File | null>(null);
  const groupAvatarInputRef = useRef<HTMLInputElement>(null);
  const [sidebarQuery, setSidebarQuery] = useState("");
  const [sidebarUser, setSidebarUser] = useState<{ id: string; username: string; yandexLogin?: string | null; avatarUrl: string | null } | null>(null);
  const [sidebarLoading, setSidebarLoading] = useState(false);
  const [sidebarError, setSidebarError] = useState("");
  const [sidebarTab, setSidebarTab] = useState<"chats" | "contacts">("chats");
  const [contacts, setContacts] = useState<User[]>([]);
  const [contactsLoading, setContactsLoading] = useState(false);
  const [profileUserId, setProfileUserId] = useState<string | null | undefined>(undefined);
  const newChatMenuRef = useRef<HTMLDivElement>(null);
  const subscribedChatsRef = useRef<Set<string>>(new Set());
  const activeChatIdRef = useRef(activeChatId);
  activeChatIdRef.current = activeChatId;
  const userIdRef = useRef(user?.id);
  userIdRef.current = user?.id;
  const chatsRef = useRef(chats);
  chatsRef.current = chats;

  const bumpChatPreview = useCallback((message: Pick<Message, "chatId" | "createdAt" | "content" | "messageType">) => {
    setChats((prev) => applyMessageToChatList(prev, message));
  }, []);

  function openProfile(userId?: string) {
    setProfileUserId(userId ?? null);
  }

  async function handleAddContact(userId: string) {
    await addContact(userId);
    if (sidebarTab === "contacts") void loadContacts();
  }

  function loadContacts() {
    setContactsLoading(true);
    getContacts()
      .then(setContacts)
      .catch(() => setContacts([]))
      .finally(() => setContactsLoading(false));
  }

  useEffect(() => {
    if (sidebarTab === "contacts") loadContacts();
  }, [sidebarTab]);

  useEffect(() => {
    if (dmOpen) loadContacts();
  }, [dmOpen]);

  useEffect(() => {
    if (groupOpen) loadContacts();
  }, [groupOpen]);

  useEffect(() => {
    const state = location.state as { openSettings?: boolean } | null;
    if (state?.openSettings) {
      setSettingsOpen(true);
      navigate(`${location.pathname}${location.search}`, { replace: true, state: {} });
    }
    const profileState = state as { openProfile?: string | null } | null;
    if (profileState && "openProfile" in (profileState ?? {})) {
      setProfileUserId(profileState.openProfile ?? null);
      navigate(`${location.pathname}${location.search}`, { replace: true, state: {} });
    }
  }, [location.state, location.pathname, location.search, navigate]);

  useEffect(() => {
    if (!ready) {
      subscribedChatsRef.current.clear();
      return;
    }
    for (const chat of chats) {
      if (subscribedChatsRef.current.has(chat.id)) continue;
      send({ type: "subscribe", chatId: chat.id });
      subscribedChatsRef.current.add(chat.id);
    }
  }, [chats, ready, send]);

  useEffect(() => {
    return subscribe((msg) => {
      if (msg.type === "message") {
        const incoming = msg.message;
        const isSystem = (incoming.messageType ?? "text") === "system";
        const fromOther = incoming.senderId !== userIdRef.current;
        const isActive = incoming.chatId === activeChatIdRef.current;

        if (!isSystem && fromOther) {
          const chat = chatsRef.current.find((c) => c.id === incoming.chatId);
          if (!chat?.notificationsMuted) {
            const hidden = document.visibilityState !== "visible";
            if (isActive && !hidden) playMessageSound("incoming");
            else playMessageSound("notification");
          }
        }

        setChats((prev) => {
          const chatId = incoming.chatId;
          let next = applyMessageToChatList(prev, incoming);
          if (!isSystem && fromOther && !isActive) {
            next = next.map((c) =>
              c.id === chatId ? { ...c, unreadCount: (c.unreadCount ?? 0) + 1 } : c
            );
          } else if (!isSystem && fromOther && isActive) {
            next = next.map((c) =>
              c.id === chatId ? { ...c, unreadCount: 0 } : c
            );
          }
          return next;
        });
      }
      if (msg.type === "message_edited") {
        setChats((prev) => applyMessageToChatList(prev, msg.message));
      }
      if (msg.type === "read_receipt" && msg.userId === userIdRef.current) {
        setChats((prev) => prev.map((c) => (c.id === msg.chatId ? { ...c, unreadCount: 0 } : c)));
      }
      if (msg.type === "message_deleted" || msg.type === "chat_removed" || msg.type === "chat_members_changed") {
        if (msg.type === "chat_removed") {
          setChats((prev) => prev.filter((c) => c.id !== msg.chatId));
          if (msg.chatId === activeChatIdRef.current) closeChat();
        }
        if (msg.type === "chat_members_changed") {
          window.dispatchEvent(new Event("wm:refresh-chats"));
        }
        if (msg.type === "message_deleted") {
          window.dispatchEvent(new Event("wm:refresh-chats"));
        }
      }
    });
  }, [subscribe, closeChat]);

  const refreshChats = useCallback(() => {
    void getChats().then((list) => {
      setChats((prev) => mergeChatLists(prev, list as Chat[]));
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    getChats()
      .then((list) => {
        if (!cancelled) {
          setChats((prev) => mergeChatLists(prev, list as Chat[]));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const onChatRead = (e: Event) => {
      const chatId = (e as CustomEvent<{ chatId?: string }>).detail?.chatId;
      if (!chatId) return;
      setChats((prev) => prev.map((c) => (c.id === chatId ? { ...c, unreadCount: 0 } : c)));
    };
    window.addEventListener("wm:chat-read", onChatRead);
    return () => window.removeEventListener("wm:chat-read", onChatRead);
  }, []);

  useEffect(() => {
    const onChatRemoved = (e: Event) => {
      const chatId = (e as CustomEvent<{ chatId?: string }>).detail?.chatId;
      if (!chatId) return;
      setChats((prev) => prev.filter((c) => c.id !== chatId));
      if (chatId === activeChatIdRef.current) closeChat();
    };
    window.addEventListener("wm:chat-removed", onChatRemoved);
    return () => window.removeEventListener("wm:chat-removed", onChatRemoved);
  }, [closeChat]);

  useEffect(() => {
    const onRefresh = () => refreshChats();
    window.addEventListener("wm:refresh-chats", onRefresh);
    return () => window.removeEventListener("wm:refresh-chats", onRefresh);
  }, [refreshChats]);

  useEffect(() => {
    if (!activeChatId || chatsRef.current.some((c) => c.id === activeChatId)) return;
    let cancelled = false;
    void getChat(activeChatId).then((c) => {
      if (cancelled || !c) return;
      setChats((prev) => {
        if (prev.some((x) => x.id === activeChatId)) return prev;
        return upsertChatInList(prev, { ...(c as Chat), unreadCount: 0 });
      });
    });
    return () => {
      cancelled = true;
    };
  }, [activeChatId]);

  useEffect(() => {
    if (!newChatMenuOpen) return;
    const close = (e: MouseEvent) => {
      if (newChatMenuRef.current && !newChatMenuRef.current.contains(e.target as Node)) {
        setNewChatMenuOpen(false);
      }
    };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [newChatMenuOpen]);

  async function lookupSidebarUser() {
    const q = sidebarQuery.trim();
    if (!q) return;
    if (user?.yandexLogin && q.toLowerCase() === user.yandexLogin.toLowerCase()) {
      setSidebarError("Нельзя искать себя");
      setSidebarUser(null);
      return;
    }
    setSidebarError("");
    setSidebarUser(null);
    setSidebarLoading(true);
    try {
      const u = await searchUser(q);
      if (u) setSidebarUser(u);
      else setSidebarError("Пользователь не найден");
    } catch {
      setSidebarError("Пользователь не найден");
    } finally {
      setSidebarLoading(false);
    }
  }

  async function lookupDmUser() {
    const q = dmLogin.trim();
    if (!q) return;
    if (user?.yandexLogin && q.toLowerCase() === user.yandexLogin.toLowerCase()) {
      setDmError("Нельзя искать себя");
      setDmUser(null);
      return;
    }
    setDmError("");
    setDmUser(null);
    setDmLoading(true);
    try {
      const u = await searchUser(q);
      if (u) setDmUser(u);
      else setDmError("Пользователь не найден");
    } catch {
      setDmError("Пользователь не найден");
    } finally {
      setDmLoading(false);
    }
  }

  async function startDm(otherUserId: string): Promise<boolean> {
    setDmError("");
    try {
      const chat = await createDm(otherUserId);
      setDmOpen(false);
      setDmLogin("");
      setDmUser(null);
      setSidebarUser(null);
      setSidebarQuery("");
      setSidebarTab("chats");
      setChats((prev) => upsertChatInList(prev, { ...(chat as Chat), unreadCount: 0 }));
      await openChat(chat.id);
      return true;
    } catch (e) {
      if (e instanceof Error && e.message.includes("already")) {
        const existing = chatsRef.current.find((c) => c.members.some((m) => m.id === otherUserId));
        if (existing) {
          setSidebarTab("chats");
          setChats((prev) => upsertChatInList(prev, existing));
          await openChat(existing.id);
        }
        setDmOpen(false);
        return true;
      }
      setDmError(e instanceof Error ? e.message : "Не удалось создать чат");
      return false;
    }
  }

  function resetGroupForm() {
    setGroupName("");
    setGroupSelected([]);
    setGroupAddLogin("");
    setGroupAddError("");
    setGroupError("");
    setGroupCreating(false);
    if (groupAvatarPreview) URL.revokeObjectURL(groupAvatarPreview);
    setGroupAvatarPreview(null);
    setGroupAvatarPath(null);
    setGroupAvatarCropFile(null);
  }

  function closeGroupModal() {
    resetGroupForm();
    setGroupOpen(false);
  }

  function handleGroupAvatarPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !file.type.startsWith("image/")) return;
    setGroupAvatarCropFile(file);
  }

  async function confirmGroupAvatar(cropped: File) {
    setGroupAvatarCropFile(null);
    setGroupError("");
    try {
      const compressed = await compressImage(cropped);
      const preview = URL.createObjectURL(compressed);
      setGroupAvatarPreview((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return preview;
      });
      const { path } = await uploadFile(compressed, { purpose: "profile" });
      setGroupAvatarPath(path);
    } catch (err) {
      setGroupError(err instanceof Error ? err.message : "Не удалось загрузить аватар");
    }
  }

  async function startGroup() {
    const name = groupName.trim();
    if (!name || groupCreating) return;
    setGroupError("");
    setGroupCreating(true);
    try {
      const ids = groupSelected.map((u) => u.id);
      const chat = await createGroup(name, ids, groupAvatarPath);
      resetGroupForm();
      setGroupOpen(false);
      setChats((prev) => upsertChatInList(prev, { ...(chat as Chat), unreadCount: 0 }));
      await openChat(chat.id);
    } catch (err) {
      setGroupError(err instanceof Error ? err.message : "Не удалось создать группу");
      setGroupCreating(false);
    }
  }

  function addContactToGroup(c: User) {
    if (c.id === user?.id) return;
    if (groupSelected.some((x) => x.id === c.id)) return;
    setGroupSelected((prev) => [...prev, { id: c.id, username: userDisplayName(c) }]);
  }

  async function addGroupMemberByLogin() {
    const login = groupAddLogin.trim();
    if (!login) return;
    setGroupAddError("");
    try {
      const u = await searchUser(login);
      if (!u) {
        setGroupAddError("Пользователь не найден");
        return;
      }
      if (u.id === user?.id) {
        setGroupAddError("Вы уже будете в группе как создатель");
        return;
      }
      if (groupSelected.some((x) => x.id === u.id)) return;
      setGroupSelected((prev) => [...prev, { id: u.id, username: userDisplayName(u) }]);
      setGroupAddLogin("");
    } catch {
      setGroupAddError("Пользователь не найден");
    }
  }

  function removeFromGroup(id: string) {
    setGroupSelected((prev) => prev.filter((x) => x.id !== id));
  }

  function displayName(chat: Chat): string {
    if (chat.name) return chat.name;
    const other = chat.members.find((m) => m.id !== user?.id);
    if (other?.username) return other.username;
    return chat.type === "dm" ? "Удалённый чат" : "Чат";
  }

  function avatarLetter(chat: Chat): string {
    const name = displayName(chat);
    return name.slice(0, 1).toUpperCase();
  }

  function chatAvatar(chat: Chat) {
    if (chat.type === "group") {
      const url = chat.avatarUrl ?? null;
      if (url) {
        const src = mediaUrl(url);
        return <img src={src} alt="" className="chat-item-avatar-img" />;
      }
      return <span className="chat-item-avatar-letter">{avatarLetter(chat)}</span>;
    }
    const other = chat.members.find((m) => m.id !== user?.id);
    const url = other?.avatarUrl ?? null;
    if (url) {
      const src = mediaUrl(url);
      return <img src={src} alt="" className="chat-item-avatar-img" />;
    }
    return <span className="chat-item-avatar-letter">{avatarLetter(chat)}</span>;
  }

  return (
    <div
      className={`layout${activeChatId ? " layout-chat-open" : ""}${compact ? " layout-compact" : ""}`}
      data-testid="messenger-shell"
    >
      <aside className="sidebar">
        <div className="sidebar-header">
          <h2 className="sidebar-title">
            <BrandIcon size={28} className="sidebar-brand-icon" />
            <span className="sidebar-title-text">
              Watermelon
              <span className="sidebar-version" title={`Версия ${APP_VERSION}`}>
                v{APP_VERSION}
              </span>
            </span>
          </h2>
          <button
            type="button"
            className="sidebar-settings-btn"
            title="Настройки"
            data-testid="settings-btn"
            onClick={() => setSettingsOpen(true)}
          >
            ⚙
          </button>
        </div>
        <div className="sidebar-search">
          <div className="sidebar-search-row">
            <input
              type="search"
              className="sidebar-search-input"
              data-testid="sidebar-user-search"
              placeholder="Логин"
              value={sidebarQuery}
              onChange={(e) => { setSidebarQuery(e.target.value); setSidebarError(""); setSidebarUser(null); }}
              onKeyDown={(e) => e.key === "Enter" && lookupSidebarUser()}
              spellCheck={false}
              autoComplete="off"
            />
            <button
              type="button"
              className="sidebar-search-btn"
              data-testid="sidebar-user-search-btn"
              onClick={() => void lookupSidebarUser()}
              disabled={sidebarLoading || !sidebarQuery.trim()}
            >
              {sidebarLoading ? "…" : "Найти"}
            </button>
          </div>
          {sidebarError && <p className="sidebar-search-error">{sidebarError}</p>}
          {sidebarUser && (
            <div className="sidebar-search-result" data-testid="sidebar-search-result">
              <div className="sidebar-search-user">
                <div className="sidebar-search-avatar">
                  {sidebarUser.avatarUrl ? (
                    <img
                      src={mediaUrl(sidebarUser.avatarUrl)}
                      alt=""
                    />
                  ) : (
                    <span>{userAvatarLetter(sidebarUser)}</span>
                  )}
                </div>
                <div className="sidebar-search-user-body">
                  <span className="sidebar-search-name">{userDisplayName(sidebarUser)}</span>
                  {sidebarUser.yandexLogin && sidebarUser.yandexLogin.toLowerCase() !== sidebarUser.username?.toLowerCase() && (
                    <span className="sidebar-search-login">{sidebarUser.yandexLogin}</span>
                  )}
                </div>
              </div>
              <div className="sidebar-search-actions">
                <button type="button" className="sidebar-search-action primary" onClick={() => void startDm(sidebarUser.id)}>
                  Написать
                </button>
                <Link to={`/profile/${sidebarUser.id}`} className="sidebar-search-action" onClick={(e) => { e.preventDefault(); openProfile(sidebarUser.id); setSidebarUser(null); setSidebarQuery(""); }}>
                  Профиль
                </Link>
              </div>
            </div>
          )}
        </div>
        <div className="sidebar-tabs">
          <button type="button" className={sidebarTab === "chats" ? "active" : ""} onClick={() => setSidebarTab("chats")}>Чаты</button>
          <button type="button" className={sidebarTab === "contacts" ? "active" : ""} onClick={() => setSidebarTab("contacts")}>Контакты</button>
        </div>
        <div className="chat-list">
          {sidebarTab === "chats" ? (
          <>
          {loading ? (
            <p className="chat-list-empty">Загрузка…</p>
          ) : chats.length === 0 ? (
            <p className="chat-list-empty">Нет чатов</p>
          ) : (
            chats.map((chat) => (
              <button
                key={chat.id}
                type="button"
                className={`chat-item chat-item-btn ${activeChatId === chat.id ? "chat-item-active" : ""}`}
                onClick={() => {
                  void openChat(chat.id);
                }}
              >
                <div className="chat-item-avatar">
                  {chatAvatar(chat)}
                </div>
                <div className="chat-item-body">
                  <div className="chat-item-top">
                    <p className="chat-item-name">{displayName(chat)}</p>
                    {(chat.unreadCount ?? 0) > 0 && activeChatId !== chat.id && (
                      <span className="chat-item-unread" aria-label={`${chat.unreadCount} непрочитанных`}>
                        {chat.unreadCount! > 99 ? "99+" : chat.unreadCount}
                      </span>
                    )}
                  </div>
                  <p className="chat-item-preview">{chat.lastMessagePreview ?? "Нет сообщений"}</p>
                </div>
              </button>
            ))
          )}
          </>
          ) : contactsLoading ? (
            <p className="chat-list-empty">Загрузка…</p>
          ) : contacts.length === 0 ? (
            <p className="chat-list-empty">Нет контактов</p>
          ) : (
            contacts.map((c) => (
              <button
                key={c.id}
                type="button"
                className="chat-item chat-item-btn"
                onClick={() => openProfile(c.id)}
              >
                <div className="chat-item-avatar">
                  {c.avatarUrl ? (
                    <img src={mediaUrl(c.avatarUrl)} alt="" className="chat-item-avatar-img" />
                  ) : (
                    <span className="chat-item-avatar-letter">{userAvatarLetter(c)}</span>
                  )}
                </div>
                <div className="chat-item-body">
                  <UserListLabel user={c} />
                </div>
              </button>
            ))
          )}
        </div>
        <div className="sidebar-footer">
          <div className="new-chat-wrap" ref={newChatMenuRef}>
            <button
              type="button"
              className="new-chat-btn"
              data-testid="new-chat-btn"
              onClick={() => setNewChatMenuOpen((o) => !o)}
              title="Новый чат"
              aria-expanded={newChatMenuOpen}
            >
              <IconPlus size={26} />
            </button>
            {newChatMenuOpen && (
              <div className="new-chat-menu">
                <button type="button" data-testid="new-dm-btn" onClick={() => { setNewChatMenuOpen(false); setDmOpen(true); }}>
                  Личный чат
                </button>
                <button type="button" onClick={() => { setNewChatMenuOpen(false); resetGroupForm(); setGroupOpen(true); }}>
                  Группа
                </button>
              </div>
            )}
          </div>
        </div>
      </aside>
      <main className="main">
        {activeChatId ? (
          <ChatRoom
            chatId={activeChatId}
            onClose={closeChat}
            openProfile={openProfile}
            onSyncPreview={bumpChatPreview}
            showBack={compact}
          />
        ) : (
          <EmptyChat />
        )}
      </main>

      {settingsOpen && (
        <SettingsModal
          onClose={() => setSettingsOpen(false)}
          onOpenAdmin={() => setAdminConsoleOpen(true)}
        />
      )}
      {adminConsoleOpen && <AdminConsoleModal open onClose={() => setAdminConsoleOpen(false)} />}

      {profileUserId !== undefined && (
        <Profile
          modal
          userIdProp={profileUserId ?? undefined}
          onClose={() => setProfileUserId(undefined)}
          onOpenSettings={() => { setProfileUserId(undefined); setSettingsOpen(true); }}
          onAddContact={handleAddContact}
          onContactChange={() => { if (sidebarTab === "contacts") void loadContacts(); }}
          onStartDm={startDm}
        />
      )}

      {dmOpen && (
        <div
          className="search-overlay"
          onClick={(e) => { if (e.target === e.currentTarget) { setDmOpen(false); setDmUser(null); setDmError(""); } }}
        >
          <div className="search-modal search-modal-wide dm-modal" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className="modal-close"
              aria-label="Закрыть"
              onClick={() => { setDmOpen(false); setDmUser(null); setDmError(""); }}
            >
              ×
            </button>
            <h3>Новый диалог</h3>
            <div className="dm-modal-body">
              <div className="search-id-row">
                <input
                  type="text"
                  data-testid="dm-user-id-input"
                  placeholder="Логин"
                  value={dmLogin}
                  onChange={(e) => { setDmLogin(e.target.value); setDmError(""); }}
                  onKeyDown={(e) => e.key === "Enter" && lookupDmUser()}
                  autoFocus
                  spellCheck={false}
                  autoComplete="off"
                />
                <button type="button" className="btn" data-testid="dm-lookup-btn" onClick={lookupDmUser} disabled={dmLoading || !dmLogin.trim()}>
                  {dmLoading ? "…" : "Найти"}
                </button>
              </div>
              {dmError && <p className="search-error">{dmError}</p>}
              {dmUser && (
                <div className="search-result-single">
                  <div className="avatar">{dmUser.avatarUrl ? (
                    <img src={mediaUrl(dmUser.avatarUrl)} alt="" />
                  ) : userAvatarLetter(dmUser)}</div>
                  <div className="search-result-user-text">
                    <span className="search-result-name">{userDisplayName(dmUser)}</span>
                    {dmUser.yandexLogin && dmUser.yandexLogin.toLowerCase() !== dmUser.username?.toLowerCase() && (
                      <span className="search-result-login">{dmUser.yandexLogin}</span>
                    )}
                  </div>
                  <button
                    type="button"
                    className="btn"
                    data-testid="dm-start-btn"
                    onClick={(e) => { e.stopPropagation(); startDm(dmUser.id); }}
                  >
                    Написать
                  </button>
                </div>
              )}

              <p className="dm-contacts-label">Контакты</p>
              <div className="dm-contacts-list">
                {contactsLoading ? (
                  <p className="search-hint">Загрузка…</p>
                ) : contacts.length === 0 ? (
                  <p className="search-hint">Нет контактов — добавьте из профиля</p>
                ) : (
                  contacts.map((c) => (
                    <ContactPickItem key={c.id} user={c} onClick={() => void startDm(c.id)} />
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {groupOpen && (
        <div
          className="search-overlay"
          onClick={(e) => { if (e.target === e.currentTarget) closeGroupModal(); }}
        >
          <div className="search-modal search-modal-wide dm-modal" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="modal-close" aria-label="Закрыть" onClick={closeGroupModal}>
              ×
            </button>
            <h3>Новая группа</h3>
            <div className="group-create-header">
              <input
                type="file"
                ref={groupAvatarInputRef}
                accept="image/*"
                onChange={handleGroupAvatarPick}
                style={{ display: "none" }}
              />
              <button
                type="button"
                className="group-create-avatar"
                onClick={() => groupAvatarInputRef.current?.click()}
                aria-label="Выбрать аватар группы"
              >
                {groupAvatarPreview ? (
                  <img src={groupAvatarPreview} alt="" />
                ) : (
                  (groupName.trim().slice(0, 1) || "?").toUpperCase()
                )}
              </button>
              <p className="group-create-avatar-hint">Нажмите, чтобы установить фото</p>
              <input
                type="text"
                className="group-create-name-input"
                placeholder="Название группы"
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                autoFocus
              />
            </div>
            <div className="dm-modal-body">
            <div className="group-selected">
              <span className="group-chip group-chip-creator">Вы</span>
              {groupSelected.map((u) => (
                <span key={u.id} className="group-chip">
                  {u.username}
                  <button type="button" onClick={() => removeFromGroup(u.id)} aria-label="Удалить">×</button>
                </span>
              ))}
            </div>
            <div className="search-id-row">
              <input
                type="text"
                placeholder="Логин"
                value={groupAddLogin}
                onChange={(e) => { setGroupAddLogin(e.target.value); setGroupAddError(""); }}
                onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addGroupMemberByLogin())}
                spellCheck={false}
                autoComplete="off"
              />
              <button type="button" className="btn" onClick={addGroupMemberByLogin} disabled={!groupAddLogin.trim()}>
                Добавить
              </button>
            </div>
            {groupAddError && <p className="search-error">{groupAddError}</p>}
            {groupError && <p className="search-error">{groupError}</p>}
            <p className="dm-contacts-label">Контакты</p>
            <div className="dm-contacts-list">
              {contactsLoading ? (
                <p className="search-hint">Загрузка…</p>
              ) : contacts.length === 0 ? (
                <p className="search-hint">Нет контактов — добавьте из профиля</p>
              ) : (
                contacts.map((c) => {
                  const selected = groupSelected.some((x) => x.id === c.id);
                  return (
                    <ContactPickItem
                      key={c.id}
                      user={c}
                      selected={selected}
                      disabled={selected || c.id === user?.id}
                      onClick={() => addContactToGroup(c)}
                    />
                  );
                })
              )}
            </div>
            <div className="modal-actions" onClick={(e) => e.stopPropagation()}>
              <button
                type="button"
                className="close btn"
                onClick={(e) => { e.stopPropagation(); startGroup(); }}
                disabled={!groupName.trim() || groupCreating}
              >
                {groupCreating ? "Создание…" : "Создать группу"}
              </button>
            </div>
            </div>
          </div>
        </div>
      )}

      {groupAvatarCropFile && (
        <ImageCropModal
          file={groupAvatarCropFile}
          variant="avatar"
          title="Аватар группы"
          onConfirm={(cropped) => void confirmGroupAvatar(cropped)}
          onCancel={() => setGroupAvatarCropFile(null)}
        />
      )}
    </div>
  );
}
