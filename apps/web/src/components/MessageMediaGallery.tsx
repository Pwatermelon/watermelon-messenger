import { useState, type CSSProperties } from "react";
import type { Message, MessageAttachment } from "@melon/shared";
import { mediaUrl } from "../utils/mediaUrl";
import {
  getMessageAttachments,
  isGifAttachment,
  isVideoAttachment,
} from "../utils/messageAttachments";
import { displayMessageMediaSize } from "../utils/messageMediaSize";
import { MessageVideoPlayer } from "./MessageVideoPlayer";
import { IconPlay } from "./Icons";
import type { MediaLightboxItem } from "./MediaLightbox";

type Props = {
  message: Message;
  priority?: boolean;
  onOpenLightbox: (items: MediaLightboxItem[], index: number) => void;
};

function attachmentToLightboxItem(attachment: MessageAttachment): MediaLightboxItem {
  const isVideo = isVideoAttachment(attachment);
  return {
    url: mediaUrl(attachment.url),
    kind: isVideo ? "video" : "image",
    poster: attachment.posterUrl ? mediaUrl(attachment.posterUrl) : null,
    width: attachment.width,
    height: attachment.height,
    duration: attachment.duration,
    downloadPath: attachment.url,
    fileName: attachment.fileName,
  };
}

function ImageTile({
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
  const [loaded, setLoaded] = useState(src.startsWith("blob:"));

  const w = attachment.width;
  const h = attachment.height;
  let reserveStyle: CSSProperties | undefined;
  if (count === 1 && w && h) {
    const size = displayMessageMediaSize(w, h);
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

function VideoTile({
  attachment,
  count,
  index,
  onOpen,
}: {
  attachment: MessageAttachment;
  count: number;
  index: number;
  onOpen: (index: number) => void;
}) {
  if (count === 1) {
    return (
      <div className="message-media-item message-media-item--1 message-media-item--video-inline">
        <MessageVideoPlayer
          src={mediaUrl(attachment.url)}
          poster={attachment.posterUrl ? mediaUrl(attachment.posterUrl) : null}
          width={attachment.width}
          height={attachment.height}
          duration={attachment.duration}
          onExpand={() => onOpen(index)}
        />
      </div>
    );
  }

  const posterSrc = attachment.posterUrl ? mediaUrl(attachment.posterUrl) : mediaUrl(attachment.url);
  const [failed, setFailed] = useState(false);

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
      className={`message-media-item message-media-item--${count} message-media-item--video`}
      onClick={() => onOpen(index)}
    >
      <img
        src={posterSrc}
        alt=""
        className="message-media-img message-media-video-poster is-loaded"
        loading="lazy"
        decoding="async"
        onError={() => setFailed(true)}
      />
      <span className="message-media-play-badge" aria-hidden>
        <IconPlay size={28} />
      </span>
    </button>
  );
}

export function MessageMediaGallery({ message, priority = false, onOpenLightbox }: Props) {
  const attachments = getMessageAttachments(message);
  if (attachments.length === 0) return null;

  const lightboxItems = attachments.map(attachmentToLightboxItem);
  const count = attachments.length;

  return (
    <div className={`message-media-grid message-media-grid--${Math.min(count, 5)}`}>
      {attachments.map((a, i) =>
        isVideoAttachment(a) ? (
          <VideoTile key={`${a.url}-${i}`} attachment={a} count={count} index={i} onOpen={(idx) => onOpenLightbox(lightboxItems, idx)} />
        ) : (
          <ImageTile
            key={`${a.url}-${i}`}
            attachment={a}
            count={count}
            index={i}
            priority={priority}
            onOpen={(idx) => onOpenLightbox(lightboxItems, idx)}
          />
        )
      )}
    </div>
  );
}
