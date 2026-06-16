import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../context/ThemeContext";
import { updateProfile, uploadFile } from "../api";
import { mediaUrl } from "../utils/mediaUrl";
import { compressImage } from "../utils/imageCompress";
import { subscribeToPush, unsubscribeFromPush, isPushServerConfigured } from "../lib/pushNotifications";
import { areMessageSoundsEnabled, setMessageSoundsEnabled } from "../utils/messageSounds";
import { logoutViaYandex } from "../lib/yandexLogout";
import { formatBirthdayLabel, getBirthdayAge } from "@melon/shared";
import BirthdayInfoBlock from "./BirthdayInfoBlock";
import ImageCropModal from "./ImageCropModal";
import { useOverlayDismiss } from "../hooks/useOverlayDismiss";

type Props = {
  onClose: () => void;
  onOpenAdmin?: () => void;
};

function SettingsSwitch({
  checked,
  disabled,
  onChange,
  label,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={`settings-switch${checked ? " is-on" : ""}`}
      disabled={disabled}
      onClick={onChange}
    >
      <span className="settings-switch-thumb" />
    </button>
  );
}

export default function SettingsModal({ onClose, onOpenAdmin }: Props) {
  const overlayDismiss = useOverlayDismiss(onClose);
  const { user, updateUser, logout, token } = useAuth();
  const { theme, setTheme } = useTheme();
  const [username, setUsername] = useState(user?.username ?? "");
  const [avatarUrl, setAvatarUrl] = useState(user?.avatarUrl ?? null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [loginCopied, setLoginCopied] = useState(false);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushLoading, setPushLoading] = useState(false);
  const [pushServerOk, setPushServerOk] = useState<boolean | null>(null);
  const [messageSoundsEnabled, setMessageSoundsEnabledState] = useState(areMessageSoundsEnabled);
  const [birthdayVisible, setBirthdayVisible] = useState(user?.birthdayVisible ?? false);
  const [privacyLoading, setPrivacyLoading] = useState(false);
  const [cropFile, setCropFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const yandexLogin = user?.yandexLogin ?? null;
  const birthday = user?.birthday ?? null;
  const birthdayLabel = birthday ? formatBirthdayLabel(birthday) : null;

  useEffect(() => {
    setUsername(user?.username ?? "");
    setAvatarUrl(user?.avatarUrl ?? null);
    setBirthdayVisible(user?.birthdayVisible ?? false);
  }, [user]);

  useEffect(() => {
    void isPushServerConfigured().then(setPushServerOk);
    if ("serviceWorker" in navigator && "PushManager" in window) {
      void navigator.serviceWorker.ready.then((reg) =>
        reg.pushManager.getSubscription().then((sub) => setPushEnabled(!!sub))
      );
    }
  }, []);

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

  const avatarDisplayUrl = avatarUrl ? mediaUrl(avatarUrl) : null;
  const nameDirty = username.trim() !== (user?.username ?? "").trim();

  async function handleAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !file.type.startsWith("image/")) return;
    setCropFile(file);
  }

  async function uploadAvatar(croppedFile: File, originalFile?: File) {
    setSaving(true);
    setMessage("");
    try {
      const cropped = await compressImage(croppedFile);
      const { url } = await uploadFile(cropped, { purpose: "profile" });
      const cropPath = url.startsWith("http") ? new URL(url).pathname : url;

      const payload: { avatarUrl: string; avatarHistory?: string[] } = { avatarUrl: cropPath };
      if (originalFile && user) {
        const original = await compressImage(originalFile);
        const fullRes = await uploadFile(original, { purpose: "profile" });
        const fullPath = fullRes.url.startsWith("http") ? new URL(fullRes.url).pathname : fullRes.url;
        const history = [...(user.avatarHistory ?? [])];
        payload.avatarHistory = [fullPath, ...history.filter((h) => h !== fullPath && h !== cropPath)].slice(0, 24);
      }

      const updated = await updateProfile(payload);
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
        const result = await subscribeToPush(token);
        if (!result.ok) {
          const err =
            result.reason === "server_unconfigured"
              ? "Уведомления в браузере не настроены на сервере (нужны push-ключи)"
              : result.reason === "unsupported"
                ? "Браузер не поддерживает push-уведомления"
                : "Не удалось включить уведомления";
          throw new Error(err);
        }
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
          variant="avatar"
          title="Аватар"
          onConfirm={(cropped, original) => {
            setCropFile(null);
            void uploadAvatar(cropped, original);
          }}
          onCancel={() => setCropFile(null)}
        />
      )}
      <div
        className="search-overlay settings-overlay"
        data-testid="settings-modal"
        onPointerDown={overlayDismiss.onOverlayPointerDown}
        onClick={overlayDismiss.onOverlayClick}
      >
        <div
          className="settings-modal"
          onPointerDown={overlayDismiss.onModalPointerDown}
          onClick={(e) => e.stopPropagation()}
        >
          <button type="button" className="modal-close settings-modal-close" onClick={onClose} aria-label="Закрыть">
            ×
          </button>

          <div className="settings-hero">
            <div className="settings-hero-avatar-wrap">
              {avatarDisplayUrl ? (
                <img src={avatarDisplayUrl} alt="" className="settings-hero-avatar" />
              ) : (
                <div className="settings-hero-avatar settings-hero-avatar-placeholder">
                  {(user?.username ?? "?").slice(0, 1).toUpperCase()}
                </div>
              )}
              <input
                type="file"
                ref={fileInputRef}
                accept="image/*"
                onChange={handleAvatarChange}
                className="settings-hero-file-input"
              />
              <button
                type="button"
                className="settings-hero-avatar-btn"
                onClick={() => fileInputRef.current?.click()}
                disabled={saving}
                aria-label="Сменить аватар"
              >
                📷
              </button>
            </div>
            <h2 className="settings-hero-name">{user?.username ?? "Профиль"}</h2>
            {yandexLogin && (
              <button type="button" className="settings-hero-login" onClick={() => void copyLogin()}>
                {loginCopied ? "Скопировано ✓" : `@${yandexLogin}`}
              </button>
            )}
          </div>

          <div className="settings-modal-body">
            {message && <p className="settings-toast">{message}</p>}

            <section className="settings-card">
              <h3 className="settings-card-title">Имя</h3>
              <div className="settings-name-row">
                <input
                  id="settings-username"
                  type="text"
                  className="settings-name-input"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Ваше имя"
                  onKeyDown={(e) => e.key === "Enter" && nameDirty && void handleSaveProfile()}
                />
                <button
                  type="button"
                  className="btn settings-name-save"
                  onClick={() => void handleSaveProfile()}
                  disabled={saving || !username.trim() || !nameDirty}
                >
                  {saving ? "…" : "Сохранить"}
                </button>
              </div>
              <Link to="/profile" className="settings-row-link" onClick={onClose}>
                <span>Полный профиль</span>
                <span className="settings-row-chevron" aria-hidden>›</span>
              </Link>
            </section>

            <section className="settings-card">
              <h3 className="settings-card-title">Конфиденциальность</h3>
              {birthday ? (
                <>
                  <div className="settings-row">
                    <div className="settings-row-text">
                      <span className="settings-row-label">День рождения</span>
                      <span className="settings-row-hint">Виден другим в профиле</span>
                    </div>
                    <SettingsSwitch
                      checked={birthdayVisible}
                      disabled={privacyLoading}
                      onChange={() => void toggleBirthdayVisible()}
                      label="Показывать день рождения"
                    />
                  </div>
                  <BirthdayInfoBlock
                    label={birthdayLabel!}
                    age={birthday ? getBirthdayAge(birthday) : null}
                    compact
                  />
                </>
              ) : (
                <p className="settings-card-hint">День рождения подтянется при следующем входе через Яндекс.</p>
              )}
            </section>

            <section className="settings-card">
              <h3 className="settings-card-title">Уведомления</h3>
              <div className="settings-row">
                <div className="settings-row-text">
                  <span className="settings-row-label">Звуки сообщений</span>
                  <span className="settings-row-hint">Отправка, получение и фоновые уведомления</span>
                </div>
                <SettingsSwitch
                  checked={messageSoundsEnabled}
                  onChange={() => {
                    const next = !messageSoundsEnabled;
                    setMessageSoundsEnabled(next);
                    setMessageSoundsEnabledState(next);
                  }}
                  label="Звуки сообщений"
                />
              </div>
              <div className="settings-row">
                <div className="settings-row-text">
                  <span className="settings-row-label">Push-уведомления</span>
                  <span className="settings-row-hint">
                    {pushServerOk === false
                      ? "На сервере не заданы ключи Web Push"
                      : "Когда вкладка закрыта или в фоне"}
                  </span>
                </div>
                <SettingsSwitch
                  checked={pushEnabled}
                  disabled={pushLoading || pushServerOk === false}
                  onChange={() => void togglePush()}
                  label="Push-уведомления"
                />
              </div>
            </section>

            <section className="settings-card">
              <h3 className="settings-card-title">Оформление</h3>
              <div className="settings-theme-segment">
                <button
                  type="button"
                  className={`settings-theme-segment-btn${theme === "dark" ? " active" : ""}`}
                  onClick={() => setTheme("dark")}
                >
                  Тёмная
                </button>
                <button
                  type="button"
                  className={`settings-theme-segment-btn${theme === "light" ? " active" : ""}`}
                  onClick={() => setTheme("light")}
                >
                  Светлая
                </button>
              </div>
            </section>

            {user?.isAdmin && (
              <section className="settings-card settings-card-flat">
                <button
                  type="button"
                  className="settings-row-link"
                  onClick={() => {
                    onClose();
                    onOpenAdmin?.();
                  }}
                >
                  <span>Администрирование</span>
                  <span className="settings-row-chevron" aria-hidden>›</span>
                </button>
              </section>
            )}

            <button type="button" className="settings-logout-btn" onClick={handleLogout}>
              Выйти из аккаунта
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
