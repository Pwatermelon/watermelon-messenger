import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import { createPortal } from "react-dom";
import type { StickerItem, StickerPackDetail, StickerPackSummary } from "@melon/shared";
import {
  addStickerToPack,
  createStickerPack,
  deleteStickerFromPack,
  deleteStickerPack,
  getStickerPack,
  getStickerPacksLibrary,
  uninstallStickerPack,
  updateStickerEmoji,
  updateStickerPack,
  uploadFile,
} from "../api";
import { normalizeStickerImage } from "../utils/imageCompress";
import { useOverlayDismiss } from "../hooks/useOverlayDismiss";
import EmojiPickerPanel from "./EmojiPickerPanel";
import { AppleEmoji } from "./AppleEmoji";
import { MediaImage } from "./MediaImage";

type Props = {
  onClose: () => void;
};

type PendingStickerUpload = {
  file: File;
  previewUrl: string;
};

export default function StickerPacksSettings({ onClose }: Props) {
  const overlayDismiss = useOverlayDismiss(onClose);
  const [owned, setOwned] = useState<StickerPackSummary[]>([]);
  const [installed, setInstalled] = useState<StickerPackSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [viewDetail, setViewDetail] = useState<StickerPackDetail | null>(null);
  const [editPackId, setEditPackId] = useState<string | null>(null);
  const [editDetail, setEditDetail] = useState<StickerPackDetail | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [newPackTitle, setNewPackTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const [pendingSticker, setPendingSticker] = useState<PendingStickerUpload | null>(null);
  const [emojiEditStickerId, setEmojiEditStickerId] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const reload = useCallback(() => {
    setLoading(true);
    void getStickerPacksLibrary()
      .then((lib) => {
        setOwned(lib.owned);
        setInstalled(lib.installed);
      })
      .catch(() => setError("Не удалось загрузить стикерпаки"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  async function openEdit(packId: string) {
    setEditPackId(packId);
    setViewDetail(null);
    setError("");
    try {
      const detail = await getStickerPack(packId);
      setEditDetail(detail);
      setEditTitle(detail.title);
    } catch {
      setError("Не удалось открыть стикерпак");
    }
  }

  async function openView(packId: string) {
    setEditPackId(null);
    setEditDetail(null);
    setError("");
    try {
      setViewDetail(await getStickerPack(packId));
    } catch {
      setError("Не удалось открыть стикерпак");
    }
  }

  async function handleCreatePack() {
    const title = newPackTitle.trim();
    if (!title || busy) return;
    setBusy(true);
    setError("");
    try {
      const pack = await createStickerPack(title);
      setNewPackTitle("");
      reload();
      void openEdit(pack.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveTitle() {
    if (!editPackId || !editTitle.trim() || busy) return;
    setBusy(true);
    try {
      await updateStickerPack(editPackId, editTitle.trim());
      const detail = await getStickerPack(editPackId);
      setEditDetail(detail);
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setBusy(false);
    }
  }

  async function handleDeletePack(id: string) {
    if (!confirm("Удалить стикерпак? Это действие необратимо.")) return;
    setBusy(true);
    try {
      await deleteStickerPack(id);
      if (editPackId === id) {
        setEditPackId(null);
        setEditDetail(null);
      }
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setBusy(false);
    }
  }

  async function handleUninstall(id: string) {
    setBusy(true);
    try {
      await uninstallStickerPack(id);
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setBusy(false);
    }
  }

  function closeEmojiPicker() {
    if (pendingSticker) URL.revokeObjectURL(pendingSticker.previewUrl);
    setPendingSticker(null);
    setEmojiEditStickerId(null);
    setEmojiPickerOpen(false);
  }

  async function handleStickerUpload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !editPackId || busy) return;
    setError("");
    try {
      const prepared = await normalizeStickerImage(file);
      const previewUrl = URL.createObjectURL(prepared);
      setPendingSticker((prev) => {
        if (prev) URL.revokeObjectURL(prev.previewUrl);
        return { file: prepared, previewUrl };
      });
      setEmojiEditStickerId(null);
      setEmojiPickerOpen(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка загрузки");
    }
  }

  async function handleEmojiPick(emoji: string) {
    if (!editPackId || busy) return;
    setBusy(true);
    setError("");
    try {
      if (pendingSticker) {
        const uploaded = await uploadFile(pendingSticker.file, { purpose: "sticker" });
        const sticker = await addStickerToPack(editPackId, emoji, uploaded.path);
        setEditDetail((prev) =>
          prev
            ? {
                ...prev,
                stickers: [...prev.stickers, sticker],
                stickerCount: prev.stickerCount + 1,
              }
            : prev
        );
        URL.revokeObjectURL(pendingSticker.previewUrl);
        setPendingSticker(null);
      } else if (emojiEditStickerId) {
        const updated = await updateStickerEmoji(editPackId, emojiEditStickerId, emoji);
        setEditDetail((prev) =>
          prev ? { ...prev, stickers: prev.stickers.map((s) => (s.id === emojiEditStickerId ? updated : s)) } : prev
        );
        setEmojiEditStickerId(null);
      }
      setEmojiPickerOpen(false);
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка");
    } finally {
      setBusy(false);
    }
  }

  function openEmojiPickerForSticker(stickerId: string) {
    if (pendingSticker) URL.revokeObjectURL(pendingSticker.previewUrl);
    setPendingSticker(null);
    setEmojiEditStickerId(stickerId);
    setEmojiPickerOpen(true);
  }

  async function handleDeleteSticker(sticker: StickerItem) {
    if (!editPackId || !confirm("Удалить стикер?")) return;
    setBusy(true);
    try {
      await deleteStickerFromPack(editPackId, sticker.id);
      setEditDetail((prev) =>
        prev
          ? {
              ...prev,
              stickers: prev.stickers.filter((s) => s.id !== sticker.id),
              stickerCount: Math.max(0, prev.stickerCount - 1),
            }
          : prev
      );
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    return () => {
      if (pendingSticker) URL.revokeObjectURL(pendingSticker.previewUrl);
    };
  }, [pendingSticker]);

  return createPortal(
    <div
      className="search-overlay modal-overlay-top sticker-packs-settings-overlay"
      onPointerDown={overlayDismiss.onOverlayPointerDown}
      onClick={overlayDismiss.onOverlayClick}
    >
      <div
        className="search-modal search-modal-wide sticker-packs-settings"
        onPointerDown={overlayDismiss.onModalPointerDown}
        onClick={(e) => e.stopPropagation()}
      >
        <button type="button" className="modal-close" aria-label="Закрыть" onClick={onClose}>
          ×
        </button>
        <h3>Стикерпаки</h3>
        {error && <p className="search-error">{error}</p>}

        {viewDetail ? (
          <div className="sticker-pack-editor">
            <button type="button" className="contact-info-back" onClick={() => setViewDetail(null)}>
              ← Назад
            </button>
            <h4>{viewDetail.title}</h4>
            <p className="search-hint">{viewDetail.creatorUsername}</p>
            <div className="sticker-pack-editor-grid">
              {viewDetail.stickers.map((s) => (
                <div key={s.id} className="sticker-pack-editor-item">
                  <MediaImage src={s.imageUrl} alt={s.emoji} className="sticker-pack-thumb" />
                  <span className="sticker-pack-view-emoji"><AppleEmoji emoji={s.emoji} size={16} /></span>
                </div>
              ))}
            </div>
          </div>
        ) : editPackId && editDetail && editDetail.isOwned ? (
          <div className="sticker-pack-editor">
            <button type="button" className="contact-info-back" onClick={() => { closeEmojiPicker(); setEditPackId(null); setEditDetail(null); }}>
              ← Назад
            </button>
            <div className="search-id-row">
              <input
                type="text"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                placeholder="Название"
              />
              <button type="button" className="btn" disabled={busy || !editTitle.trim()} onClick={() => void handleSaveTitle()}>
                Сохранить
              </button>
            </div>
            <div className="sticker-pack-add-row">
              <button type="button" className="btn" disabled={busy} onClick={() => fileRef.current?.click()}>
                Загрузить стикер
              </button>
              <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => void handleStickerUpload(e)} />
            </div>
            {pendingSticker && (
              <div className="sticker-pack-pending-preview">
                <img src={pendingSticker.previewUrl} alt="" />
              </div>
            )}
            {emojiPickerOpen && (
              <EmojiPickerPanel
                title={pendingSticker ? "Выберите emoji" : "Emoji стикера"}
                onPick={(emoji) => void handleEmojiPick(emoji)}
                onClose={closeEmojiPicker}
              />
            )}
            <div className="sticker-pack-editor-grid">
              {editDetail.stickers.map((s) => (
                <div key={s.id} className="sticker-pack-editor-item">
                  <MediaImage src={s.imageUrl} alt={s.emoji} className="sticker-pack-thumb" />
                  <button
                    type="button"
                    className="sticker-pack-emoji-btn"
                    onClick={() => openEmojiPickerForSticker(s.id)}
                    title="Изменить emoji"
                  >
                    <AppleEmoji emoji={s.emoji} size={20} />
                  </button>
                  <button type="button" className="sticker-pack-editor-remove" onClick={() => void handleDeleteSticker(s)}>
                    ×
                  </button>
                </div>
              ))}
            </div>
            <button type="button" className="contact-info-remove-btn" disabled={busy} onClick={() => void handleDeletePack(editPackId)}>
              Удалить стикерпак
            </button>
          </div>
        ) : (
          <div className="sticker-packs-settings-body">
            {loading ? (
              <p className="search-hint">Загрузка…</p>
            ) : (
              <>
                <section className="sticker-packs-section">
                  <h4>Мои стикерпаки</h4>
                  <div className="search-id-row">
                    <input
                      type="text"
                      placeholder="Название"
                      value={newPackTitle}
                      onChange={(e) => setNewPackTitle(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), void handleCreatePack())}
                    />
                    <button type="button" className="btn" disabled={busy || !newPackTitle.trim()} onClick={() => void handleCreatePack()}>
                      Создать
                    </button>
                  </div>
                  {owned.length > 0 && (
                    <ul className="sticker-packs-list">
                      {owned.map((p) => (
                        <li key={p.id}>
                          <button type="button" className="sticker-packs-list-btn" onClick={() => void openEdit(p.id)}>
                            <span>{p.title}</span>
                            <span className="search-hint">{p.stickerCount} стик.</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
                <section className="sticker-packs-section">
                  <h4>Добавленные</h4>
                  {installed.length > 0 && (
                    <ul className="sticker-packs-list">
                      {installed.map((p) => (
                        <li key={p.id} className="sticker-packs-list-row">
                          <button type="button" className="sticker-packs-list-btn" onClick={() => void openView(p.id)}>
                            <span>{p.title}</span>
                            <span className="search-hint">{p.creatorUsername}</span>
                          </button>
                          <button type="button" className="btn-secondary" disabled={busy} onClick={() => void handleUninstall(p.id)}>
                            Удалить
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              </>
            )}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
