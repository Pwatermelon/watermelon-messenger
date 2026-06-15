import { useState, useRef } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../context/ThemeContext";
import { updateProfile, uploadFile } from "../api";
import { mediaUrl } from "../utils/mediaUrl";
import { compressImage } from "../utils/imageCompress";
import { subscribeToPush, unsubscribeFromPush } from "../lib/pushNotifications";
import { logoutViaYandex } from "../lib/yandexLogout";
import { formatBirthdayLabel, getBirthdayAge } from "@melon/shared";
import BirthdayInfoBlock from "./BirthdayInfoBlock";
import ImageCropModal from "./ImageCropModal";

type Props = {
  onClose: () => void;
};

export default function SettingsModal({ onClose }: Props) {
  const { user, updateUser, logout, token } = useAuth();
  const { theme, setTheme } = useTheme();
  const [username, setUsername] = useState(user?.username ?? "");
  const [avatarUrl, setAvatarUrl] = useState(user?.avatarUrl ?? null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [loginCopied, setLoginCopied] = useState(false);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushLoading, setPushLoading] = useState(false);
  const [birthdayVisible, setBirthdayVisible] = useState(user?.birthdayVisible ?? false);
  const [privacyLoading, setPrivacyLoading] = useState(false);
  const [cropFile, setCropFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const yandexLogin = user?.yandexLogin ?? null;
  const birthday = user?.birthday ?? null;
  const birthdayLabel = birthday ? formatBirthdayLabel(birthday) : null;

  async function copyLogin() {
    if (!yandexLogin) return;
    try {
      await navigator.clipboard.writeText(yandexLogin);
      setLoginCopied(true);
      setTimeout(() => setLoginCopied(false), 2000);
    } catch {
      setMessage("Не удалось скопировать");
    }
  }

  const avatarDisplayUrl = avatarUrl
    ? mediaUrl(avatarUrl)
    : null;

  async function handleAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !file.type.startsWith("image/")) return;
    setCropFile(file);
  }

  async function uploadAvatar(file: File) {
    setSaving(true);
    setMessage("");
    try {
      const compressed = await compressImage(file);
      const { url } = await uploadFile(compressed, { purpose: "profile" });
      const path = url.startsWith("http") ? new URL(url).pathname : url;
      const updated = await updateProfile({ avatarUrl: path });
      setAvatarUrl(updated.avatarUrl ?? null);
      updateUser(updated as Parameters<typeof updateUser>[0]);
      setMessage("Аватар обновлён");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Ошибка загрузки");
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveProfile() {
    const name = username.trim();
    if (!name) return;
    setSaving(true);
    setMessage("");
    try {
      const updated = await updateProfile({ username: name });
      updateUser(updated as Parameters<typeof updateUser>[0]);
      setMessage("Имя сохранено");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Ошибка");
    } finally {
      setSaving(false);
    }
  }

  function handleLogout() {
    logoutViaYandex(logout);
  }

  async function toggleBirthdayVisible() {
    if (!birthday) return;
    setPrivacyLoading(true);
    setMessage("");
    const next = !birthdayVisible;
    try {
      const updated = await updateProfile({ birthdayVisible: next });
      setBirthdayVisible(next);
      updateUser(updated as Parameters<typeof updateUser>[0]);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setPrivacyLoading(false);
    }
  }

  async function togglePush() {
    if (!token) return;
    setPushLoading(true);
    setMessage("");
    try {
      if (pushEnabled) {
        await unsubscribeFromPush(token);
        setPushEnabled(false);
      } else {
        const perm = await Notification.requestPermission();
        if (perm !== "granted") throw new Error("Разрешите уведомления в браузере");
        const ok = await subscribeToPush(token);
        if (!ok) throw new Error("Push недоступен на сервере");
        setPushEnabled(true);
      }
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setPushLoading(false);
    }
  }

  return (
    <>
      {cropFile && (
        <ImageCropModal
          file={cropFile}
          aspect={1}
          title="Аватар"
          outputWidth={512}
          outputHeight={512}
          onConfirm={(f) => {
            setCropFile(null);
            void uploadAvatar(f);
          }}
          onCancel={() => setCropFile(null)}
        />
      )}
    <div
      className="search-overlay"
      data-testid="settings-modal"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="settings-modal-header">
          <h2>Настройки</h2>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Закрыть">
            ×
          </button>
        </div>
        <div className="settings-modal-body">
          <div className="settings-section">
            <h3>Профиль</h3>
            <Link to="/profile" className="settings-profile-link" onClick={onClose}>
              Редактировать профиль →
            </Link>
            <div className="settings-avatar-row">
              <div className="settings-avatar-wrap">
                {avatarDisplayUrl ? (
                  <img src={avatarDisplayUrl} alt="" className="settings-avatar" />
                ) : (
                  <div className="settings-avatar-placeholder">
                    {(user?.username ?? "?").slice(0, 1).toUpperCase()}
                  </div>
                )}
              </div>
              <div>
                <input
                  type="file"
                  ref={fileInputRef}
                  accept="image/*"
                  onChange={handleAvatarChange}
                  style={{ display: "none" }}
                />
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={saving}
                >
                  {saving ? "…" : "Сменить аватар"}
                </button>
              </div>
            </div>
            <div className="settings-field">
              <label htmlFor="settings-username">Имя (отображаемое)</label>
              <input
                id="settings-username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Ваше имя"
              />
              <button type="button" className="btn" onClick={handleSaveProfile} disabled={saving || !username.trim()}>
                Сохранить имя
              </button>
            </div>
            {yandexLogin && (
              <div className="settings-field">
                <label>Ваш логин</label>
                <button type="button" className="settings-id-code" onClick={copyLogin}>
                  {loginCopied ? "Скопировано" : yandexLogin}
                </button>
              </div>
            )}
            {message && <p className="settings-message">{message}</p>}
          </div>
          <div className="settings-section">
            <h3>Конфиденциальность</h3>
            {birthday ? (
              <>
                <label className="settings-checkbox-row">
                  <input
                    type="checkbox"
                    checked={birthdayVisible}
                    onChange={() => void toggleBirthdayVisible()}
                    disabled={privacyLoading}
                  />
                  <span>Показывать день рождения другим пользователям</span>
                </label>
                <BirthdayInfoBlock
                  label={birthdayLabel!}
                  age={birthday ? getBirthdayAge(birthday) : null}
                  compact
                />
                <p className="settings-hint">Другие увидят дату только при включённой галочке.</p>
              </>
            ) : (
              <p className="settings-hint">Появится после следующего входа.</p>
            )}
          </div>
          <div className="settings-section">
            <h3>Уведомления</h3>
            <button type="button" className="btn btn-secondary" onClick={() => void togglePush()} disabled={pushLoading}>
              {pushLoading ? "…" : pushEnabled ? "Push: вкл" : "Push: выкл"}
            </button>
          </div>
          <div className="settings-section">
            <h3>Тема</h3>
            <div className="settings-theme-row">
              <button
                type="button"
                className={`settings-theme-btn ${theme === "dark" ? "active" : ""}`}
                onClick={() => setTheme("dark")}
              >
                Тёмная
              </button>
              <button
                type="button"
                className={`settings-theme-btn ${theme === "light" ? "active" : ""}`}
                onClick={() => setTheme("light")}
              >
                Светлая
              </button>
            </div>
          </div>
          {user?.isAdmin && (
            <div className="settings-section">
              <Link to="/admin" className="settings-admin-link" onClick={onClose}>
                Beta-доступ (админ)
              </Link>
            </div>
          )}
          <div className="settings-section">
            <button type="button" className="settings-logout" onClick={handleLogout}>
              Выйти из аккаунта
            </button>
          </div>
        </div>
      </div>
    </div>
    </>
  );
}
