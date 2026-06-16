import { useEffect, useRef, useState } from "react";
import { IconDownload, IconEdit, IconForward, IconReply } from "./Icons";
import type { MessageReader } from "../utils/messageRead";
import { mediaUrl } from "../utils/mediaUrl";

export const QUICK_REACTIONS = ["👍", "❤️", "🔥", "🥰", "👏", "😁", "🤔", "🤯", "😢", "🎉"] as const;

type Props = {
  x: number;
  y: number;
  readers: MessageReader[];
  canDownload: boolean;
  onReply: () => void;
  onForward: () => void;
  onEdit?: () => void;
  onDownload?: () => void;
  onReaction: (emoji: string) => void;
  onClose: () => void;
};

export function MessageContextMenu({
  x,
  y,
  readers,
  canDownload,
  onReply,
  onForward,
  onEdit,
  onDownload,
  onReaction,
  onClose,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [viewersOpen, setViewersOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      const menu = ref.current;
      if (!menu || menu.contains(e.target as Node)) return;
      onClose();
    };
    const id = window.setTimeout(() => {
      window.addEventListener("pointerdown", onPointerDown, true);
    }, 0);
    return () => {
      window.clearTimeout(id);
      window.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [onClose]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const pad = 8;
    let left = x;
    let top = y;
    if (left + rect.width > window.innerWidth - pad) left = window.innerWidth - rect.width - pad;
    if (top + rect.height > window.innerHeight - pad) top = window.innerHeight - rect.height - pad;
    if (left < pad) left = pad;
    if (top < pad) top = pad;
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  }, [x, y, viewersOpen]);

  const viewersLabel =
    readers.length === 0
      ? "Просмотрено"
      : readers.length === 1
      ? "Просмотрено · 1"
      : `Просмотрено · ${readers.length}`;

  return (
    <div
      ref={ref}
      className="message-context-menu"
      style={{ left: x, top: y }}
      role="menu"
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="message-context-reactions" role="group" aria-label="Реакции">
        {QUICK_REACTIONS.map((emoji) => (
          <button
            key={emoji}
            type="button"
            className="message-context-reaction-btn"
            onClick={() => {
              onReaction(emoji);
              onClose();
            }}
            aria-label={`Реакция ${emoji}`}
          >
            {emoji}
          </button>
        ))}
      </div>

      <div className="message-context-menu-divider" />

      <button type="button" className="message-context-menu-item" onClick={onReply} role="menuitem">
        <IconReply size={18} /> Ответить
      </button>
      {onEdit && (
        <button type="button" className="message-context-menu-item" onClick={onEdit} role="menuitem">
          <IconEdit size={18} /> Изменить
        </button>
      )}
      <button type="button" className="message-context-menu-item" onClick={onForward} role="menuitem">
        <IconForward size={18} /> Переслать
      </button>
      {canDownload && onDownload && (
        <button type="button" className="message-context-menu-item" onClick={onDownload} role="menuitem">
          <IconDownload size={18} /> Скачать
        </button>
      )}

      <div className="message-context-menu-divider" />

      <div
        className="message-context-submenu-wrap"
        onMouseEnter={() => setViewersOpen(true)}
        onMouseLeave={() => setViewersOpen(false)}
      >
        <button
          type="button"
          className="message-context-menu-item message-context-menu-item-submenu"
          onClick={() => setViewersOpen((o) => !o)}
          role="menuitem"
          aria-haspopup="true"
          aria-expanded={viewersOpen}
        >
          <span>{viewersLabel}</span>
          <span className="message-context-submenu-arrow" aria-hidden>
            ›
          </span>
        </button>
        {viewersOpen && (
          <div className="message-context-submenu" role="menu">
            {readers.length === 0 ? (
              <div className="message-context-submenu-empty">Пока никто не просмотрел</div>
            ) : (
              readers.map((r) => (
                <div key={r.id} className="message-context-submenu-item">
                  <span className="message-context-submenu-avatar">
                    {r.avatarUrl ? <img src={mediaUrl(r.avatarUrl)} alt="" /> : r.username.slice(0, 1).toUpperCase()}
                  </span>
                  <span>{r.username}</span>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
