import { useEffect } from "react";
import { CircleMessagePlayer } from "./CircleMessagePlayer";

type Props = {
  src: string;
  duration?: number;
  onClose: () => void;
  nested?: boolean;
};

export default function CircleLightbox({ src, duration, onClose, nested = false }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className={`circle-lightbox${nested ? " circle-lightbox-nested" : ""}`}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Кружок"
    >
      <button type="button" className="lightbox-close" onClick={onClose} aria-label="Закрыть">
        ×
      </button>
      <div className="circle-lightbox-body" onClick={(e) => e.stopPropagation()}>
        <CircleMessagePlayer src={src} duration={duration} size={300} />
      </div>
    </div>
  );
}
