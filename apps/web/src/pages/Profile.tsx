import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams, useOutletContext } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { getUserById, updateProfile, uploadFile, getContacts, addContact, removeContact } from "../api";
import { mediaUrl as resolveMediaUrl } from "../utils/mediaUrl";
import { compressImage } from "../utils/imageCompress";
import type { User } from "@melon/shared";
import type { ChatLayoutOutletContext } from "./ChatLayout";
import BirthdayInfoBlock from "../components/BirthdayInfoBlock";
import ImageLightbox from "../components/ImageLightbox";
import ImageCropModal from "../components/ImageCropModal";

type ProfileProps = {
  modal?: boolean;
  onClose?: () => void;
  userIdProp?: string;
  onOpenSettings?: () => void;
  onAddContact?: (userId: string) => Promise<void>;
  onContactChange?: () => void;
};

function mediaFullUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  return resolveMediaUrl(path);
}

function buildAvatarPaths(profile: User): string[] {
  const paths: string[] = [];
  if (profile.avatarUrl) paths.push(profile.avatarUrl);
  for (const p of profile.avatarHistory ?? []) {
    if (!paths.includes(p)) paths.push(p);
  }
  return paths;
}

export default function Profile({ modal, onClose, userIdProp, onOpenSettings, onAddContact, onContactChange }: ProfileProps = {}) {
  const { userId: routeUserId } = useParams<{ userId?: string }>();
  const userId = userIdProp ?? routeUserId;
  const navigate = useNavigate();
  const outlet = useOutletContext<ChatLayoutOutletContext | null>();
  const openSettings = onOpenSettings ?? outlet?.openSettings;
  const addContactFn = onAddContact ?? outlet?.addContact;
  const { user: me, updateUser } = useAuth();
  const isOwn = !userId || userId === me?.id;
  const targetId = userId ?? me?.id;
  const [isContact, setIsContact] = useState(false);
  const [contactBusy, setContactBusy] = useState(false);
  const [cropFile, setCropFile] = useState<{ file: File; kind: "avatar" | "cover" } | null>(null);

  const [profile, setProfile] = useState<User | null>(isOwn && me ? me : null);
  const [loading, setLoading] = useState(!isOwn);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [bio, setBio] = useState(me?.bio ?? "");
  const [avatarLightboxIndex, setAvatarLightboxIndex] = useState<number | null>(null);
  const [photoLightboxIndex, setPhotoLightboxIndex] = useState<number | null>(null);
  const [loginCopied, setLoginCopied] = useState(false);
  const coverInputRef = useRef<HTMLInputElement>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!targetId) return;
    if (isOwn && me) {
      setProfile(me);
      setBio(me.bio ?? "");
      return;
    }
    setLoading(true);
    getUserById(targetId)
      .then((u) => setProfile(u))
      .finally(() => setLoading(false));
  }, [targetId, isOwn, me]);

  useEffect(() => {
    setIsContact(false);
    if (isOwn || !targetId) return;
    getContacts()
      .then((list) => setIsContact(list.some((c) => c.id === targetId)))
      .catch(() => setIsContact(false));
  }, [targetId, isOwn]);

  async function handleAddContact() {
    if (!profile) return;
    setContactBusy(true);
    try {
      if (addContactFn) await addContactFn(profile.id);
      else await addContact(profile.id);
      setIsContact(true);
      onContactChange?.();
    } finally {
      setContactBusy(false);
    }
  }

  async function handleRemoveContact() {
    if (!profile) return;
    setContactBusy(true);
    try {
      await removeContact(profile.id);
      setIsContact(false);
      onContactChange?.();
    } finally {
      setContactBusy(false);
    }
  }

  async function copyLogin() {
    if (!profile?.yandexLogin) return;
    try {
      await navigator.clipboard.writeText(profile.yandexLogin);
      setLoginCopied(true);
      setTimeout(() => setLoginCopied(false), 2000);
    } catch {
      setMessage("Не удалось скопировать");
    }
  }

  async function saveBio() {
    if (!isOwn) return;
    setSaving(true);
    setMessage("");
    try {
      const updated = await updateProfile({ bio: bio.trim() || null });
      updateUser(updated);
      setProfile(updated);
      setMessage("Био сохранено");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setSaving(false);
    }
  }

  async function uploadAvatar(file: File) {
    setSaving(true);
    setMessage("");
    try {
      const compressed = await compressImage(file);
      const { path } = await uploadFile(compressed, { purpose: "profile" });
      const updated = await updateProfile({ avatarUrl: path });
      updateUser(updated);
      setProfile(updated);
      setMessage("Аватар обновлён");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Ошибка загрузки");
    } finally {
      setSaving(false);
    }
  }

  async function uploadCover(file: File) {
    setSaving(true);
    setMessage("");
    try {
      const compressed = await compressImage(file);
      const { path } = await uploadFile(compressed, { purpose: "profile" });
      const updated = await updateProfile({ coverUrl: path });
      updateUser(updated);
      setProfile(updated);
      setMessage("Обложка обновлена");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Ошибка загрузки");
    } finally {
      setSaving(false);
    }
  }

  async function addPhoto(file: File) {
    setSaving(true);
    setMessage("");
    try {
      const compressed = await compressImage(file);
      const { path } = await uploadFile(compressed, { purpose: "profile" });
      const current = profile?.profilePhotos ?? [];
      const updated = await updateProfile({ profilePhotos: [...current, path].slice(0, 12) });
      updateUser(updated);
      setProfile(updated);
      setMessage("Фото добавлено");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setSaving(false);
    }
  }

  async function removePhoto(path: string) {
    const current = profile?.profilePhotos ?? [];
    const idx = current.indexOf(path);
    const updated = await updateProfile({ profilePhotos: current.filter((p) => p !== path) });
    updateUser(updated);
    setProfile(updated);
    if (photoLightboxIndex !== null) {
      const remaining = updated.profilePhotos ?? [];
      if (remaining.length === 0) setPhotoLightboxIndex(null);
      else setPhotoLightboxIndex(Math.min(idx >= 0 ? idx : photoLightboxIndex, remaining.length - 1));
    }
  }

  async function removeAvatarAt(listIndex: number) {
    if (!profile || !isOwn) return;
    const list = buildAvatarPaths(profile);
    const next = list.filter((_, i) => i !== listIndex);
    setSaving(true);
    setMessage("");
    try {
      const updated = await updateProfile({
        avatarUrl: next[0] ?? null,
        avatarHistory: next.slice(1),
      });
      updateUser(updated);
      setProfile(updated);
      if (next.length === 0) setAvatarLightboxIndex(null);
      else setAvatarLightboxIndex(Math.min(listIndex, next.length - 1));
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="profile-page">
        <p className="profile-loading">Загрузка профиля…</p>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="profile-page">
        <p>Профиль не найден</p>
        <Link to="/">← Назад</Link>
      </div>
    );
  }

  const coverDisplay = mediaFullUrl(profile.coverUrl);
  const avatarDisplay = mediaFullUrl(profile.avatarUrl);
  const photos = profile.profilePhotos ?? [];
  const avatarPaths = buildAvatarPaths(profile);
  const avatarUrls = avatarPaths.map((p) => mediaFullUrl(p)).filter(Boolean) as string[];
  const photoUrls = photos.map((p) => mediaFullUrl(p)).filter(Boolean) as string[];

  const hasToolbarActions =
    (!isOwn && !!profile) || (isOwn && !!openSettings);

  const body = (
    <div className={`profile-page${modal ? " profile-page-modal" : ""}`}>
      {(!modal || hasToolbarActions) && (
      <div className={`profile-toolbar${modal ? " profile-toolbar-modal" : ""}`}>
        {!modal && (
          <button type="button" className="profile-back" onClick={() => navigate(-1)}>
            ← Назад
          </button>
        )}
        <div className="profile-toolbar-actions">
          {!isOwn && profile && (
            isContact ? (
              <button
                type="button"
                className="profile-remove-contact"
                onClick={() => void handleRemoveContact()}
                disabled={contactBusy}
              >
                {contactBusy ? "…" : "Удалить из контактов"}
              </button>
            ) : (
              <button
                type="button"
                className="profile-add-contact"
                onClick={() => void handleAddContact()}
                disabled={contactBusy}
              >
                {contactBusy ? "…" : "В контакты"}
              </button>
            )
          )}
          {isOwn && openSettings && (
            <button type="button" className="profile-settings-link" onClick={openSettings}>
              Настройки
            </button>
          )}
        </div>
      </div>
      )}

      <div className="profile-cover-wrap">
        {coverDisplay ? (
          <img src={coverDisplay} alt="" className="profile-cover" />
        ) : (
          <div className="profile-cover-placeholder" />
        )}
        {isOwn && (
          <>
            <input
              type="file"
              ref={coverInputRef}
              accept="image/*"
              style={{ display: "none" }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) setCropFile({ file: f, kind: "cover" });
              }}
            />
            <button type="button" className="profile-cover-edit" onClick={() => coverInputRef.current?.click()} disabled={saving}>
              Сменить обложку
            </button>
          </>
        )}
      </div>

      <div className="profile-header">
        <div className="profile-avatar-wrap">
          {avatarDisplay ? (
            <button
              type="button"
              className="profile-avatar-btn"
              onClick={() => avatarUrls.length > 0 && setAvatarLightboxIndex(0)}
              title="Открыть аватар"
            >
              <img src={avatarDisplay} alt="" className="profile-avatar" />
            </button>
          ) : (
            <div className="profile-avatar-placeholder">{profile.username.slice(0, 1).toUpperCase()}</div>
          )}
          {profile.subscriptionTier === "platinum" && <span className="profile-platinum-badge">✦</span>}
          {isOwn && (
            <>
              <input
                type="file"
                ref={avatarInputRef}
                accept="image/*"
                style={{ display: "none" }}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) setCropFile({ file: f, kind: "avatar" });
                }}
              />
              <button
                type="button"
                className="profile-avatar-edit"
                onClick={() => avatarInputRef.current?.click()}
                disabled={saving}
                title="Сменить аватар"
              >
                📷
              </button>
            </>
          )}
        </div>
        <h1 className="profile-name">{profile.username}</h1>
        {profile.yandexLogin && (
          <button type="button" className="profile-login" onClick={() => void copyLogin()} title="Скопировать логин">
            {loginCopied ? "Скопировано" : profile.yandexLogin}
          </button>
        )}
        {profile.birthdayLabel && (
          <BirthdayInfoBlock
            label={profile.birthdayLabel}
            age={profile.birthdayAge}
            isToday={profile.isBirthdayToday}
          />
        )}
      </div>

      <div className="profile-section">
        <h2>О себе</h2>
        {isOwn ? (
          <>
            <textarea
              className="profile-bio-input"
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              placeholder="Расскажите о себе…"
              maxLength={500}
              rows={4}
            />
            <button type="button" className="btn" onClick={() => void saveBio()} disabled={saving}>Сохранить</button>
          </>
        ) : (
          <p className="profile-bio">{profile.bio?.trim() || "Пользователь пока ничего не написал."}</p>
        )}
      </div>

      <div className="profile-section">
        <div className="profile-photos-header">
          <h2>Фото {photos.length > 0 ? `(${photos.length})` : ""}</h2>
          {isOwn && (
            <>
              <input
                type="file"
                ref={photoInputRef}
                accept="image/*"
                style={{ display: "none" }}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) void addPhoto(f);
                }}
              />
              <button type="button" className="btn btn-secondary" onClick={() => photoInputRef.current?.click()} disabled={saving || photos.length >= 12}>
                + Добавить
              </button>
            </>
          )}
          {!isOwn && photos.length > 0 && (
            <button type="button" className="profile-view-all-btn" onClick={() => setPhotoLightboxIndex(0)}>
              Смотреть все
            </button>
          )}
        </div>
        {photos.length === 0 ? (
          <p className="profile-empty">Нет фото</p>
        ) : (
          <>
            <div className="profile-photos-grid">
              {photos.map((p, i) => {
                const url = mediaFullUrl(p);
                if (!url) return null;
                return (
                  <div key={p} className="profile-photo-item">
                    <button type="button" className="profile-photo-open" onClick={() => setPhotoLightboxIndex(i)}>
                      <img src={url} alt="" />
                    </button>
                    {isOwn && (
                      <button type="button" className="profile-photo-remove" onClick={() => void removePhoto(p)} aria-label="Удалить">
                        ×
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
            {isOwn && photos.length > 0 && (
              <button type="button" className="profile-view-all-btn profile-view-all-btn-block" onClick={() => setPhotoLightboxIndex(0)}>
                Открыть все фото
              </button>
            )}
          </>
        )}
      </div>

      {message && <p className="profile-message">{message}</p>}

      {avatarLightboxIndex !== null && avatarUrls.length > 0 && (
        <ImageLightbox
          images={avatarUrls}
          initialIndex={avatarLightboxIndex}
          onClose={() => setAvatarLightboxIndex(null)}
          canDelete={isOwn}
          onDelete={(i) => void removeAvatarAt(i)}
          title="Аватары"
        />
      )}

      {photoLightboxIndex !== null && photoUrls.length > 0 && (
        <ImageLightbox
          images={photoUrls}
          initialIndex={photoLightboxIndex}
          onClose={() => setPhotoLightboxIndex(null)}
          canDelete={isOwn}
          onDelete={(i) => {
            const path = photos[i];
            if (path) void removePhoto(path);
            else setPhotoLightboxIndex(null);
          }}
          title="Фото профиля"
        />
      )}
    </div>
  );

  const cropModal = cropFile ? (
    <ImageCropModal
      file={cropFile.file}
      aspect={cropFile.kind === "avatar" ? 1 : 4.5}
      title={cropFile.kind === "avatar" ? "Аватар" : "Обложка"}
      outputWidth={cropFile.kind === "avatar" ? 512 : 1200}
      outputHeight={cropFile.kind === "avatar" ? 512 : 267}
      onConfirm={(f) => {
        const kind = cropFile.kind;
        setCropFile(null);
        void (kind === "avatar" ? uploadAvatar(f) : uploadCover(f));
      }}
      onCancel={() => setCropFile(null)}
    />
  ) : null;

  if (modal && onClose) {
    return (
      <>
        {cropModal}
        <div
        className="search-overlay profile-overlay"
        onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      >
        <div className="profile-modal" onClick={(e) => e.stopPropagation()}>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Закрыть">
            ×
          </button>
          {body}
        </div>
      </div>
      </>
    );
  }

  return (
    <>
      {cropModal}
      {body}
    </>
  );
}
