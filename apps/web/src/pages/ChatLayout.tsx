import { useState, useEffect, useRef } from "react";
import { Link, Outlet, useNavigate, useParams, useLocation } from "react-router-dom";
import SettingsModal from "../components/SettingsModal";
import { useAuth } from "../context/AuthContext";
import { useWebSocketContext } from "../context/WebSocketContext";
import { getChats, createDm, createGroup, searchUser, getContacts, addContact } from "../api";
import type { Chat, User } from "@melon/shared";
import { mediaUrl } from "../utils/mediaUrl";
import { BrandIcon } from "../components/BrandIcon";
import { IconPlus } from "../components/Icons";
import { UserListLabel } from "../components/UserListLabel";
import { userAvatarLetter, userDisplayName } from "../utils/userDisplay";
import Profile from "./Profile";

export type ChatLayoutOutletContext = {
  openSettings: () => void;
  openProfile: (userId?: string) => void;
  addContact: (userId: string) => Promise<void>;
};

export default function ChatLayout() {
  const { user } = useAuth();
  const { subscribe } = useWebSocketContext();
  const navigate = useNavigate();
  const location = useLocation();
  const { chatId: currentChatId } = useParams();
  const [chats, setChats] = useState<Chat[]>([]);
  const [loading, setLoading] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
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
  const [sidebarQuery, setSidebarQuery] = useState("");
  const [sidebarUser, setSidebarUser] = useState<{ id: string; username: string; yandexLogin?: string | null; avatarUrl: string | null } | null>(null);
  const [sidebarLoading, setSidebarLoading] = useState(false);
  const [sidebarError, setSidebarError] = useState("");
  const [sidebarTab, setSidebarTab] = useState<"chats" | "contacts">("chats");
  const [contacts, setContacts] = useState<User[]>([]);
  const [contactsLoading, setContactsLoading] = useState(false);
  const [profileUserId, setProfileUserId] = useState<string | null | undefined>(undefined);
  const newChatMenuRef = useRef<HTMLDivElement>(null);

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
    return subscribe((msg) => {
      if (msg.type === "message") {
        setChats((prev) => {
          const copy = [...prev];
          const i = copy.findIndex((c) => c.id === msg.message.chatId);
          if (i >= 0) {
            copy[i] = {
              ...copy[i],
              lastMessageAt: msg.message.createdAt,
              lastMessagePreview: msg.message.content.slice(0, 80),
            };
            const [moved] = copy.splice(i, 1);
            copy.unshift(moved);
          }
          return copy;
        });
      }
      if (msg.type === "message_deleted") {
        window.dispatchEvent(new Event("wm:refresh-chats"));
      }
    });
  }, [subscribe]);

  function refreshChats() {
    getChats().then((list) => setChats(list as Chat[]));
  }

  useEffect(() => {
    let cancelled = false;
    getChats()
      .then((list) => {
        if (!cancelled) setChats(list as Chat[]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const onRefresh = () => refreshChats();
    window.addEventListener("wm:refresh-chats", onRefresh);
    return () => window.removeEventListener("wm:refresh-chats", onRefresh);
  }, []);

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

  async function startDm(otherUserId: string) {
    setDmError("");
    try {
      const chat = await createDm(otherUserId);
      setDmOpen(false);
      setDmLogin("");
      setDmUser(null);
      setSidebarUser(null);
      setSidebarQuery("");
      setChats((prev) => [chat as Chat, ...prev]);
      navigate(`/chat/${chat.id}`);
    } catch (e) {
      if (e instanceof Error && e.message.includes("already")) {
        const existing = chats.find((c) => c.members.some((m) => m.id === otherUserId));
        if (existing) navigate(`/chat/${existing.id}`);
        setDmOpen(false);
      } else {
        setDmError(e instanceof Error ? e.message : "Не удалось создать чат");
      }
    }
  }

  async function startGroup() {
    const name = groupName.trim();
    if (!name) return;
    setGroupError("");
    try {
      const ids = groupSelected.map((u) => u.id);
      const chat = await createGroup(name, ids);
      setGroupOpen(false);
      setGroupName("");
      setGroupSelected([]);
      setGroupAddLogin("");
      setGroupAddError("");
      setChats((prev) => [chat as Chat, ...prev]);
      navigate(`/chat/${chat.id}`);
    } catch (err) {
      setGroupError(err instanceof Error ? err.message : "Не удалось создать группу");
    }
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
      if (u.id === user?.id) return;
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
    return other?.username ?? "Chat";
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
    <div className="layout" data-testid="messenger-shell">
      <aside className="sidebar">
        <div className="sidebar-header">
          <h2 className="sidebar-title">
            <BrandIcon size={28} className="sidebar-brand-icon" />
            Watermelon
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
              <Link
                key={chat.id}
                to={`/chat/${chat.id}`}
                className={`chat-item ${currentChatId === chat.id ? "chat-item-active" : ""}`}
              >
                <div className="chat-item-avatar">
                  {chatAvatar(chat)}
                </div>
                <div className="chat-item-body">
                  <p className="chat-item-name">{displayName(chat)}</p>
                  <p className="chat-item-preview">{chat.lastMessagePreview ?? "Нет сообщений"}</p>
                </div>
              </Link>
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
                <button type="button" onClick={() => { setNewChatMenuOpen(false); setGroupError(""); setGroupOpen(true); }}>
                  Группа
                </button>
              </div>
            )}
          </div>
        </div>
      </aside>
      <main className="main">
        <Outlet context={{
          openSettings: () => setSettingsOpen(true),
          openProfile,
          addContact: handleAddContact,
        } satisfies ChatLayoutOutletContext} />
      </main>

      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}

      {profileUserId !== undefined && (
        <Profile
          modal
          userIdProp={profileUserId ?? undefined}
          onClose={() => setProfileUserId(undefined)}
          onOpenSettings={() => { setProfileUserId(undefined); setSettingsOpen(true); }}
          onAddContact={handleAddContact}
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
                    <button
                      key={c.id}
                      type="button"
                      className="dm-contact-item"
                      onClick={() => void startDm(c.id)}
                    >
                      <UserListLabel user={c} nameClassName="dm-contact-name" tagClassName="dm-contact-login" />
                    </button>
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
          onClick={(e) => { if (e.target === e.currentTarget) setGroupOpen(false); }}
        >
          <div className="search-modal" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="modal-close" aria-label="Закрыть" onClick={() => setGroupOpen(false)}>
              ×
            </button>
            <h3>Новая группа</h3>
            <input
              type="text"
              placeholder="Название группы"
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              autoFocus
            />
            <p className="search-hint">Добавьте участников по логину</p>
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
            {groupSelected.length > 0 && (
              <div className="group-selected">
                {groupSelected.map((u) => (
                  <span key={u.id} className="group-chip">
                    {u.username}
                    <button type="button" onClick={() => removeFromGroup(u.id)} aria-label="Удалить">×</button>
                  </span>
                ))}
              </div>
            )}
            <div className="modal-actions" onClick={(e) => e.stopPropagation()}>
              <button
                type="button"
                className="close btn"
                onClick={(e) => { e.stopPropagation(); startGroup(); }}
                disabled={!groupName.trim()}
              >
                Создать группу
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
