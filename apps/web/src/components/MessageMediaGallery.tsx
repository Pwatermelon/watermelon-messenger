import { useState, type CSSProperties } from "react";
import type { Message, MessageAttachment } from "@melon/shared";
import { mediaUrl } from "../utils/mediaUrl";
import { getMessageAttachments, isGifAttachment } from "../utils/messageAttachments";

// Габариты кадра одиночной картинки (должны совпадать с CSS).
const MAX_TILE_W = 320;
const MAX_TILE_H = 360;

function displayMediaSize(w: number, h: number): { width: number; height: number } {
  let dw = w;
  let dh = h;
  if (dw > MAX_TILE_W) {
    dh = (dh * MAX_TILE_W) / dw;
    dw = MAX_TILE_W;
  }
  if (dh > MAX_TILE_H) {
    dw = (dw * MAX_TILE_H) / dh;
    dh = MAX_TILE_H;
  }
  return { width: Math.max(1, Math.round(dw)), height: Math.max(1, Math.round(dh)) };
}

type Props = {
  message: Message;
  priority?: boolean;
  onOpenLightbox: (urls: string[], index: number) => void;
};

function MediaTile({
  attachment,
  count,
  index,
  priority,
  onOpen,
}: {
  attachment: MessageAttachment;
  count: number;
  index: number;
  priority?: boolean;
  onOpen: (index: number) => void;
}) {
  const src = mediaUrl(attachment.url);
  const isGif = isGifAttachment(attachment);
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);

  // Для одиночной картинки заранее резервируем точный контейнер по сохранённым
  // размерам — чтобы при подгрузке не дёргался скролл (как в Telegram).
  const w = attachment.width;
  const h = attachment.height;
  let reserveStyle: CSSProperties | undefined;
  if (count === 1 && w && h) {
    const size = displayMediaSize(w, h);
    reserveStyle = { width: size.width, minHeight: size.height, aspectRatio: `${w} / ${h}` };
  }
  const reserved = Boolean(reserveStyle);

  if (failed) {
    return (
      <div className="message-media-item message-media-item--failed" aria-hidden>
        <span className="message-media-failed-label">Не удалось загрузить</span>
      </div>
    );
  }

  return (
    <button
      type="button"
      className={`message-media-item message-media-item--${count}${index === 0 && count === 3 ? " message-media-item--lead" : ""}${reserved ? " message-media-item--reserved" : ""}`}
      style={reserveStyle}
      onClick={() => onOpen(index)}
    >
      {!loaded && <span className="message-media-skeleton" aria-hidden />}
      <img
        src={src}
        alt=""
        className={`message-media-img${isGif ? " message-media-img-gif" : ""}${loaded ? " is-loaded" : ""}`}
        loading={priority ? "eager" : "lazy"}
        decoding="async"
        onLoad={() => setLoaded(true)}
        onError={() => setFailed(true)}
      />
      {isGif && <span className="message-media-gif-badge">GIF</span>}
    </button>
  );
}

export function MessageMediaGallery({ message, priority = false, onOpenLightbox }: Props) {
  const attachments = getMessageAttachments(message);
  if (attachments.length === 0) return null;

  const urls = attachments.map((a) => mediaUrl(a.url));
  const count = attachments.length;

  return (
    <div className={`message-media-grid message-media-grid--${Math.min(count, 5)}`}>
      {attachments.map((a, i) => (
        <MediaTile
          key={`${a.url}-${i}`}
          attachment={a}
          count={count}
          index={i}
          priority={priority}
          onOpen={(idx) => onOpenLightbox(urls, idx)}
        />
      ))}
    </div>
  );
}
