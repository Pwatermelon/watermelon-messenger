import type { Message, MessageAttachment } from "@melon/shared";
import { mediaUrl } from "../utils/mediaUrl";
import { getMessageAttachments, isGifAttachment } from "../utils/messageAttachments";

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

  return (
    <button
      type="button"
      className={`message-media-item message-media-item--${count}${index === 0 && count === 3 ? " message-media-item--lead" : ""}`}
      onClick={() => onOpen(index)}
    >
      <img
        src={src}
        alt=""
        className={`message-media-img${isGif ? " message-media-img-gif" : ""}`}
        loading={priority ? "eager" : "lazy"}
        decoding="async"
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
