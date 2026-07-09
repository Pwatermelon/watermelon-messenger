import { useEffect, useRef } from "react";
import { attachVideoPreviewHandlers } from "../utils/videoPreview";
import { useAuthenticatedMediaSrc } from "../hooks/useAuthenticatedMediaSrc";

type Props = {
  src: string;
  poster?: string | null;
  className?: string;
};

export function CircleVideoThumb({ src, poster, className = "chat-info-circle-thumb" }: Props) {
  const ref = useRef<HTMLVideoElement>(null);
  const playbackSrc = useAuthenticatedMediaSrc(src);
  const authPoster = useAuthenticatedMediaSrc(poster);

  useEffect(() => {
    const video = ref.current;
    if (!video || !playbackSrc) return;
    return attachVideoPreviewHandlers(video);
  }, [playbackSrc]);

  if (!playbackSrc) {
    return <span className={`${className} chat-info-media-skeleton`} aria-hidden />;
  }

  return (
    <video
      ref={ref}
      src={playbackSrc}
      poster={authPoster ?? undefined}
      muted
      playsInline
      preload={authPoster ? "metadata" : "auto"}
      className={className}
    />
  );
}
