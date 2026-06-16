import { useEffect, useState } from "react";

export type MediaLightboxItem = {
  url: string;
  kind: "image" | "video";
};

type Props = {
  items: MediaLightboxItem[];
  initialIndex?: number;
  onClose: () => void;
  nested?: boolean;
  title?: string;
};

export default function MediaLightbox({
  items,
  initialIndex = 0,
  onClose,
  nested = false,
  title,
}: Props) {
  const [index, setIndex] = useState(initialIndex);

  useEffect(() => {
    setIndex(initialIndex);
  }, [initialIndex, items]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") setIndex((i) => Math.max(0, i - 1));
      if (e.key === "ArrowRight") setIndex((i) => Math.min(items.length - 1, i + 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [items.length, onClose]);

  if (items.length === 0) return null;

  const current = items[index] ?? items[0];
  const canPrev = index > 0;
  const canNext = index < items.length - 1;

  return (
    <div
      className={`lightbox lightbox-gallery${nested ? " lightbox-nested" : ""}`}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={title ?? "Просмотр медиа"}
    >
      <button type="button" className="lightbox-close" onClick={onClose} aria-label="Закрыть">
        ×
      </button>
      {items.length > 1 && (
        <>
          <button
            type="button"
            className="lightbox-nav lightbox-nav-prev"
            onClick={(e) => {
              e.stopPropagation();
              if (canPrev) setIndex((i) => i - 1);
            }}
            disabled={!canPrev}
            aria-label="Предыдущее"
          >
            ‹
          </button>
          <button
            type="button"
            className="lightbox-nav lightbox-nav-next"
            onClick={(e) => {
              e.stopPropagation();
              if (canNext) setIndex((i) => i + 1);
            }}
            disabled={!canNext}
            aria-label="Следующее"
          >
            ›
          </button>
          <div className="lightbox-counter" aria-live="polite">
            {index + 1} / {items.length}
          </div>
        </>
      )}
      <div className="lightbox-gallery-body" onClick={(e) => e.stopPropagation()}>
        <div className="lightbox-content">
          {current.kind === "video" ? (
            <video
              key={current.url}
              src={current.url}
              className="lightbox-video"
              controls
              autoPlay
              playsInline
            />
          ) : (
            <img src={current.url} alt="" className="lightbox-img" />
          )}
        </div>
        {items.length > 1 && (
          <div className="lightbox-thumbs" role="listbox" aria-label="Миниатюры">
            {items.map((item, i) => (
              <button
                key={`${item.url}-${i}`}
                type="button"
                className={`lightbox-thumb${i === index ? " lightbox-thumb-active" : ""}`}
                onClick={() => setIndex(i)}
                aria-label={`Медиа ${i + 1}`}
                aria-selected={i === index}
              >
                {item.kind === "video" ? (
                  <span className="lightbox-thumb-video">▶</span>
                ) : (
                  <img src={item.url} alt="" />
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
