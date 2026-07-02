import { useEffect, useState } from "react";
import type { StickerPackDetail } from "@melon/shared";
import { getStickerPack, installStickerPack, uninstallStickerPack } from "../api";
import { useOverlayDismiss } from "../hooks/useOverlayDismiss";
import { AppleEmoji } from "./AppleEmoji";
import { MediaImage } from "./MediaImage";

type Props = {
  packId: string;
  onClose: () => void;
  onInstalled?: () => void;
};

export default function StickerPackViewModal({ packId, onClose, onInstalled }: Props) {
  const overlayDismiss = useOverlayDismiss(onClose);
  const [pack, setPack] = useState<StickerPackDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setLoading(true);
    void getStickerPack(packId)
      .then(setPack)
      .catch(() => setError("Не удалось загрузить стикерпак"))
      .finally(() => setLoading(false));
  }, [packId]);

  async function toggleInstall() {
    if (!pack || busy) return;
    setBusy(true);
    setError("");
    try {
      if (pack.isInstalled && !pack.isOwned) {
        await uninstallStickerPack(pack.id);
        setPack({ ...pack, isInstalled: false });
      } else if (!pack.isInstalled) {
        await installStickerPack(pack.id);
        setPack({ ...pack, isInstalled: true });
        onInstalled?.();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="search-overlay" {...overlayDismiss}>
      <div className="search-modal sticker-pack-view-modal" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="modal-close" aria-label="Закрыть" onClick={onClose}>
          ×
        </button>
        {loading ? (
          <p className="search-hint">Загрузка…</p>
        ) : pack ? (
          <>
            <h3>{pack.title}</h3>
            <p className="search-hint">
              {pack.creatorUsername ? `Автор: ${pack.creatorUsername}` : null}
              {pack.stickerCount > 0 ? ` · ${pack.stickerCount} стикеров` : null}
            </p>
            {error && <p className="search-error">{error}</p>}
            <div className="sticker-pack-view-grid">
              {pack.stickers.map((s) => (
                <div key={s.id} className="sticker-pack-view-item" title={s.emoji}>
                  <MediaImage src={s.imageUrl} alt={s.emoji} className="sticker-pack-thumb" eager />
                  <span className="sticker-pack-view-emoji">
                    <AppleEmoji emoji={s.emoji} size={16} />
                  </span>
                </div>
              ))}
            </div>
            {!pack.isOwned && (
              <div className="modal-actions">
                <button type="button" className="btn" disabled={busy || pack.isInstalled} onClick={() => void toggleInstall()}>
                  {pack.isInstalled ? "Добавлен" : "Добавить стикерпак"}
                </button>
                {pack.isInstalled && (
                  <button type="button" className="btn-secondary" disabled={busy} onClick={() => void toggleInstall()}>
                    Удалить из коллекции
                  </button>
                )}
              </div>
            )}
          </>
        ) : (
          <p className="search-error">{error || "Стикерпак не найден"}</p>
        )}
      </div>
    </div>
  );
}
