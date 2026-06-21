import { useEffect, useMemo, useRef, useState } from "react";
import { IconFile, IconSend, IconSmile } from "./Icons";
import { EmojiPickerGrid } from "./EmojiPickerPanel";
import { isGifFileDeep } from "../utils/imageCompress";

export type MediaSendItem = {
  id: string;
  file: File;
  previewUrl: string | null;
  isGif: boolean;
};

type Props = {
  items: MediaSendItem[];
  caption: string;
  onCaptionChange: (value: string) => void;
  onRemoveItem: (id: string) => void;
  onClose: () => void;
  onSend: () => void;
  sending?: boolean;
};

function mediaKindLabel(count: number): string {
  if (count === 1) return "1 медиа";
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${count} медиа`;
  return `${count} медиа`;
}

export function SendMediaModal({
  items,
  caption,
  onCaptionChange,
  onRemoveItem,
  onClose,
  onSend,
  sending = false,
}: Props) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const captionRef = useRef<HTMLTextAreaElement>(null);

  const safeIndex = Math.min(activeIndex, Math.max(0, items.length - 1));
  const active = items[safeIndex];

  useEffect(() => {
    captionRef.current?.focus();
  }, []);

  useEffect(() => {
    if (safeIndex !== activeIndex) setActiveIndex(safeIndex);
  }, [safeIndex, activeIndex]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !sending) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, sending]);

  const title = useMemo(() => mediaKindLabel(items.length), [items.length]);

  function handleCaptionKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!sending && items.length > 0) onSend();
    }
  }

  function insertEmoji(emoji: string) {
    const el = captionRef.current;
    if (!el) {
      onCaptionChange(caption + emoji);
      return;
    }
    const start = el.selectionStart ?? caption.length;
    const end = el.selectionEnd ?? caption.length;
    const next = caption.slice(0, start) + emoji + caption.slice(end);
    onCaptionChange(next);
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + emoji.length;
      el.setSelectionRange(pos, pos);
    });
  }

  return (
    <div
      className="send-media-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget && !sending) onClose();
      }}
    >
      <div
        className="send-media-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Отправка медиа"
        onClick={(e) => e.stopPropagation()}
      >
      <header className="send-media-header">
        <button type="button" className="send-media-header-btn" onClick={onClose} disabled={sending} aria-label="Закрыть">
          ×
        </button>
        <span className="send-media-title">{title}</span>
        <span className="send-media-header-spacer" aria-hidden />
      </header>

      <div className="send-media-preview">
        {active ? (
          <>
            {active.previewUrl && active.file.type.startsWith("video/") ? (
              <video src={active.previewUrl} className="send-media-preview-media" controls playsInline />
            ) : active.previewUrl ? (
              <img src={active.previewUrl} alt="" className="send-media-preview-media" />
            ) : (
              <div className="send-media-file-preview">
                <IconFile size={48} />
                <span className="send-media-file-name">{active.file.name}</span>
              </div>
            )}
            {active.isGif && <span className="send-media-gif-badge">GIF</span>}
            {items.length > 1 && (
              <button
                type="button"
                className="send-media-remove-btn"
                onClick={() => onRemoveItem(active.id)}
                disabled={sending}
                aria-label="Убрать из отправки"
              >
                ×
              </button>
            )}
          </>
        ) : null}
      </div>

      {items.length > 1 && (
        <div className="send-media-thumbs" role="tablist" aria-label="Выбор медиа">
          {items.map((item, i) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={i === safeIndex}
              className={`send-media-thumb${i === safeIndex ? " is-active" : ""}`}
              onClick={() => setActiveIndex(i)}
              disabled={sending}
            >
              {item.previewUrl ? (
                item.file.type.startsWith("video/") ? (
                  <video src={item.previewUrl} muted className="send-media-thumb-media" />
                ) : (
                  <img src={item.previewUrl} alt="" className="send-media-thumb-media" />
                )
              ) : (
                <span className="send-media-thumb-file" aria-hidden>
                  <IconFile size={18} />
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      <footer className="send-media-footer">
        {emojiOpen && (
          <div className="send-media-emoji-panel">
            <EmojiPickerGrid onPick={(e) => insertEmoji(e)} />
          </div>
        )}
        <div className="send-media-caption-row">
          <textarea
            ref={captionRef}
            className="send-media-caption-input"
            placeholder="Добавить подпись…"
            value={caption}
            rows={1}
            onChange={(e) => onCaptionChange(e.target.value)}
            onKeyDown={handleCaptionKeyDown}
            disabled={sending}
          />
          <button
            type="button"
            className={`send-media-emoji-btn${emojiOpen ? " is-active" : ""}`}
            onClick={() => setEmojiOpen((o) => !o)}
            disabled={sending}
            aria-label="Эмодзи"
          >
            <IconSmile size={22} />
          </button>
          <button
            type="button"
            className="send-media-send-btn"
            onClick={onSend}
            disabled={sending || items.length === 0}
            aria-label="Отправить"
          >
            <IconSend size={22} />
          </button>
        </div>
      </footer>
      </div>
    </div>
  );
}

export async function buildMediaSendItems(files: File[]): Promise<MediaSendItem[]> {
  const items: MediaSendItem[] = [];
  for (const file of files) {
    const isGif = await isGifFileDeep(file);
    const previewUrl =
      file.type.startsWith("image/") || file.type.startsWith("video/")
        ? URL.createObjectURL(file)
        : null;
    items.push({
      id: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2)}`,
      file,
      previewUrl,
      isGif,
    });
  }
  return items;
}

export function revokeMediaSendItems(items: MediaSendItem[]): void {
  for (const item of items) {
    if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
  }
}
