import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { IconExpand, IconPause, IconPlay } from "./Icons";
import { canPlayMediaUrl, mimeFromMediaUrl } from "../utils/mediaMime";
import { claimMediaPlayback, releaseMediaPlayback } from "../utils/mediaPlayback";
import { displayMessageMediaSize, lightboxViewportMediaSize } from "../utils/messageMediaSize";
import { resolvePlaybackDuration } from "../utils/mediaPlaybackDuration";
import {
  getVideoMetaCache,
  getVideoPosterCache,
  probeVideoMeta,
  setVideoMetaCache,
  setVideoPosterCache,
} from "../utils/videoMetaCache";
import { captureVideoFramePoster } from "../utils/videoPoster";
import { attachVideoPreviewHandlers } from "../utils/videoPreview";
import { useAuthenticatedMediaSrc } from "../hooks/useAuthenticatedMediaSrc";

function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function resolveDims(
  width?: number,
  height?: number,
  src?: string
): { w: number; h: number } | null {
  if (width && height) return { w: width, h: height };
  if (src) {
    const cached = getVideoMetaCache(src);
    if (cached) return { w: cached.width, h: cached.height };
  }
  return null;
}

type Props = {
  src: string;
  poster?: string | null;
  width?: number;
  height?: number;
  duration?: number;
  variant?: "inline" | "lightbox";
  autoPlay?: boolean;
  onExpand?: () => void;
};

export function MessageVideoPlayer({
  src,
  poster,
  width,
  height,
  duration: metaDuration,
  variant = "inline",
  autoPlay = false,
  onExpand,
}: Props) {
  const playbackSrc = useAuthenticatedMediaSrc(src);
  const authPoster = useAuthenticatedMediaSrc(poster);
  const videoRef = useRef<HTMLVideoElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const scrubbingRef = useRef(false);
  const wasPlayingRef = useRef(false);
  const stopRef = useRef<() => void>(() => {});

  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [current, setCurrent] = useState(0);
  const [mediaDuration, setMediaDuration] = useState(metaDuration ?? 0);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(() => resolveDims(width, height, src));
  const [posterSrc, setPosterSrc] = useState<string | null>(() => poster ?? getVideoPosterCache(src));
  const [showFrame, setShowFrame] = useState(false);
  const [unsupported, setUnsupported] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [bufferedRatio, setBufferedRatio] = useState(0);
  const [lightboxLayout, setLightboxLayout] = useState<{ width: number; height: number } | null>(null);
  const wantPlayRef = useRef(false);

  const duration = resolvePlaybackDuration(metaDuration, mediaDuration);
  const mime = mimeFromMediaUrl(src, "video");
  const isLightbox = variant === "lightbox";

  const refreshBufferedRatio = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    const dur = resolvePlaybackDuration(metaDuration, video.duration) || video.duration;
    if (!dur || !Number.isFinite(dur) || dur <= 0) {
      setBufferedRatio(0);
      return;
    }
    const ranges = video.buffered;
    if (!ranges.length) {
      setBufferedRatio(0);
      return;
    }
    let end = 0;
    for (let i = 0; i < ranges.length; i++) {
      end = Math.max(end, ranges.end(i));
    }
    setBufferedRatio(Math.min(1, end / dur));
  }, [metaDuration]);

  const stopPlayback = useCallback(() => {
    wantPlayRef.current = false;
    videoRef.current?.pause();
    setPlaying(false);
    setBuffering(false);
  }, []);

  stopRef.current = () => {
    wantPlayRef.current = false;
    videoRef.current?.pause();
    setPlaying(false);
    setBuffering(false);
  };

  const seekFromClientX = useCallback(
    (clientX: number) => {
      const track = trackRef.current;
      const video = videoRef.current;
      if (!track || !video) return;
      const dur = resolvePlaybackDuration(metaDuration, video.duration) || video.duration;
      if (!dur || !Number.isFinite(dur)) return;
      const rect = track.getBoundingClientRect();
      const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      const t = pct * dur;
      const maxT = video.duration && Number.isFinite(video.duration) ? video.duration : t;
      video.currentTime = Math.min(t, maxT);
      setProgress(pct);
      setCurrent(video.currentTime);
      setShowFrame(true);
    },
    [metaDuration]
  );

  const scrubHandlersRef = useRef({
    onMove: (e: PointerEvent) => {
      if (!scrubbingRef.current) return;
      e.preventDefault();
      seekFromClientX(e.clientX);
    },
    onUp: (e: PointerEvent) => {
      if (!scrubbingRef.current) return;
      e.preventDefault();
      seekFromClientX(e.clientX);
      scrubbingRef.current = false;
      const video = videoRef.current;
      if (video && wasPlayingRef.current) {
        void video.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
      }
      document.removeEventListener("pointermove", scrubHandlersRef.current.onMove);
      document.removeEventListener("pointerup", scrubHandlersRef.current.onUp);
      document.removeEventListener("pointercancel", scrubHandlersRef.current.onUp);
    },
  });

  useEffect(() => {
    scrubHandlersRef.current.onMove = (e: PointerEvent) => {
      if (!scrubbingRef.current) return;
      e.preventDefault();
      seekFromClientX(e.clientX);
    };
    scrubHandlersRef.current.onUp = (e: PointerEvent) => {
      if (!scrubbingRef.current) return;
      e.preventDefault();
      seekFromClientX(e.clientX);
      scrubbingRef.current = false;
      const video = videoRef.current;
      if (video && wasPlayingRef.current) {
        void video.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
      }
      document.removeEventListener("pointermove", scrubHandlersRef.current.onMove);
      document.removeEventListener("pointerup", scrubHandlersRef.current.onUp);
      document.removeEventListener("pointercancel", scrubHandlersRef.current.onUp);
    };
  }, [seekFromClientX]);

  useEffect(() => {
    return () => {
      scrubbingRef.current = false;
      document.removeEventListener("pointermove", scrubHandlersRef.current.onMove);
      document.removeEventListener("pointerup", scrubHandlersRef.current.onUp);
      document.removeEventListener("pointercancel", scrubHandlersRef.current.onUp);
    };
  }, []);

  useEffect(() => {
    setUnsupported(!canPlayMediaUrl(src, "video"));
    setPlaying(false);
    setProgress(0);
    setCurrent(0);
    setMediaDuration(metaDuration ?? 0);
    setShowFrame(false);
    setDims(resolveDims(width, height, src));
    setPosterSrc(poster ?? getVideoPosterCache(src));
    setBuffering(false);
    setBufferedRatio(0);
    wantPlayRef.current = false;
    return () => releaseMediaPlayback(stopRef.current);
  }, [src, poster, width, height, metaDuration]);

  useEffect(() => {
    if (dims) return;
    if (!playbackSrc) return;
    let cancelled = false;
    void probeVideoMeta(playbackSrc).then((meta) => {
      if (cancelled || !meta) return;
      setDims({ w: meta.width, h: meta.height });
      if (meta.duration) setMediaDuration(meta.duration);
    });
    return () => {
      cancelled = true;
    };
  }, [playbackSrc, dims]);

  useEffect(() => {
    if (authPoster || posterSrc) return;
    if (!playbackSrc) return;
    let cancelled = false;
    void captureVideoFramePoster(playbackSrc).then((blobUrl) => {
      if (cancelled || !blobUrl) return;
      setVideoPosterCache(src, blobUrl);
      setPosterSrc(blobUrl);
    });
    return () => {
      cancelled = true;
    };
  }, [src, playbackSrc, authPoster, posterSrc]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !playbackSrc) return;
    return attachVideoPreviewHandlers(video, () => setShowFrame(true));
  }, [playbackSrc]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const onTimeUpdate = () => {
      if (scrubbingRef.current) return;
      const dur = resolvePlaybackDuration(metaDuration, video.duration);
      if (dur > 0) {
        setProgress(Math.min(1, video.currentTime / dur));
        setCurrent(video.currentTime);
      }
      refreshBufferedRatio();
    };
    const onEnded = () => {
      wantPlayRef.current = false;
      setPlaying(false);
      setBuffering(false);
      const dur = resolvePlaybackDuration(metaDuration, video.duration);
      setProgress(1);
      setCurrent(dur > 0 ? dur : 0);
      setShowFrame(false);
      releaseMediaPlayback(stopRef.current);
    };
    const onMeta = () => {
      if (video.videoWidth > 0 && video.videoHeight > 0) {
        const meta = {
          width: video.videoWidth,
          height: video.videoHeight,
          duration: video.duration && Number.isFinite(video.duration) ? video.duration : undefined,
        };
        setVideoMetaCache(src, meta);
        setDims((prev) => prev ?? { w: meta.width, h: meta.height });
      }
      if (video.duration && Number.isFinite(video.duration)) {
        setMediaDuration(video.duration);
      }
      refreshBufferedRatio();
    };
    const onPlaying = () => {
      setPlaying(true);
      setBuffering(false);
    };
    const onPause = () => {
      if (wantPlayRef.current && !video.ended) return;
      setPlaying(false);
      setBuffering(false);
    };
    const onWaiting = () => {
      if (wantPlayRef.current) setBuffering(true);
    };
    const onStalled = () => {
      if (wantPlayRef.current) setBuffering(true);
    };
    const onSeeking = () => {
      if (wantPlayRef.current) setBuffering(true);
    };
    const onSeeked = () => {
      refreshBufferedRatio();
      if (video.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) {
        setBuffering(false);
      }
    };
    const onCanPlay = () => {
      refreshBufferedRatio();
      if (!wantPlayRef.current) {
        setBuffering(false);
        return;
      }
      setBuffering(false);
      if (video.paused && !video.ended) {
        void video.play().catch(() => {
          setPlaying(false);
          wantPlayRef.current = false;
        });
      }
    };
    const onProgress = () => refreshBufferedRatio();

    video.addEventListener("timeupdate", onTimeUpdate);
    video.addEventListener("ended", onEnded);
    video.addEventListener("loadedmetadata", onMeta);
    video.addEventListener("playing", onPlaying);
    video.addEventListener("pause", onPause);
    video.addEventListener("waiting", onWaiting);
    video.addEventListener("stalled", onStalled);
    video.addEventListener("seeking", onSeeking);
    video.addEventListener("seeked", onSeeked);
    video.addEventListener("canplay", onCanPlay);
    video.addEventListener("progress", onProgress);
    return () => {
      video.removeEventListener("timeupdate", onTimeUpdate);
      video.removeEventListener("ended", onEnded);
      video.removeEventListener("loadedmetadata", onMeta);
      video.removeEventListener("playing", onPlaying);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("waiting", onWaiting);
      video.removeEventListener("stalled", onStalled);
      video.removeEventListener("seeking", onSeeking);
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("canplay", onCanPlay);
      video.removeEventListener("progress", onProgress);
    };
  }, [playbackSrc, metaDuration, refreshBufferedRatio]);

  const startPlayback = useCallback(() => {
    const video = videoRef.current;
    if (!video || unsupported) return;
    setShowFrame(true);
    wantPlayRef.current = true;
    setBuffering(true);
    claimMediaPlayback(stopRef.current);
    void video
      .play()
      .then(() => {
        setPlaying(true);
        if (video.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) {
          setBuffering(false);
        }
      })
      .catch(() => {
        wantPlayRef.current = false;
        setPlaying(false);
        setBuffering(false);
        releaseMediaPlayback(stopRef.current);
      });
  }, [unsupported]);

  useEffect(() => {
    if (!autoPlay || unsupported) return;
    const video = videoRef.current;
    if (!video) return;
    if (video.readyState >= HTMLMediaElement.HAVE_METADATA) {
      startPlayback();
      return;
    }
    const onReady = () => startPlayback();
    video.addEventListener("loadedmetadata", onReady, { once: true });
    return () => video.removeEventListener("loadedmetadata", onReady);
  }, [autoPlay, playbackSrc, unsupported, startPlayback]);

  useEffect(() => {
    if (!isLightbox) {
      setLightboxLayout(null);
      return;
    }
    const compute = () => {
      const ar = dims ?? { w: 16, h: 9 };
      setLightboxLayout(lightboxViewportMediaSize(ar.w, ar.h));
    };
    compute();
    window.addEventListener("resize", compute);
    return () => window.removeEventListener("resize", compute);
  }, [isLightbox, dims]);

  let boxStyle: CSSProperties;
  if (isLightbox) {
    const size = lightboxLayout ?? lightboxViewportMediaSize(dims?.w ?? 16, dims?.h ?? 9);
    boxStyle = {
      width: size.width,
      height: size.height,
      maxWidth: "96vw",
      maxHeight: "85dvh",
      flexShrink: 0,
    };
  } else if (dims) {
    const size = displayMessageMediaSize(dims.w, dims.h);
    boxStyle = { width: size.width, height: size.height };
  } else {
    const size = displayMessageMediaSize(9, 16);
    boxStyle = { width: size.width, height: size.height };
  }

  const displayPoster = authPoster ?? posterSrc;
  const showPoster = !playing && !showFrame && Boolean(displayPoster);

  function togglePlay(e?: React.MouseEvent) {
    e?.stopPropagation();
    const video = videoRef.current;
    if (!video || unsupported) return;
    if (playing) {
      wantPlayRef.current = false;
      video.pause();
      setPlaying(false);
      setBuffering(false);
      releaseMediaPlayback(stopRef.current);
      return;
    }
    startPlayback();
  }

  function handleScrubDown(e: React.PointerEvent<HTMLDivElement>) {
    if (unsupported) return;
    e.preventDefault();
    e.stopPropagation();
    const video = videoRef.current;
    wasPlayingRef.current = !!video && !video.paused;
    if (video && wasPlayingRef.current) video.pause();

    scrubbingRef.current = true;
    seekFromClientX(e.clientX);
    trackRef.current?.setPointerCapture(e.pointerId);
    document.addEventListener("pointermove", scrubHandlersRef.current.onMove, { passive: false });
    document.addEventListener("pointerup", scrubHandlersRef.current.onUp, { passive: false });
    document.addEventListener("pointercancel", scrubHandlersRef.current.onUp, { passive: false });
  }

  function handleExpand(e: React.MouseEvent) {
    e.stopPropagation();
    stopPlayback();
    releaseMediaPlayback(stopRef.current);
    onExpand?.();
  }

  return (
    <div
      className={`message-video-player${isLightbox ? " message-video-player--lightbox" : ""}${playing ? " is-playing" : ""}${buffering ? " is-buffering" : ""}`}
      style={boxStyle}
    >
      <div
        className="message-video-stage message-video-stage--interactive"
        onClick={togglePlay}
        role="button"
        tabIndex={0}
        aria-label={playing ? "Пауза" : "Воспроизвести"}
        onKeyDown={(e) => {
          if (e.key === " " || e.key === "Enter") {
            e.preventDefault();
            togglePlay();
          }
        }}
      >
        {showPoster && (
          <img src={displayPoster!} alt="" className="message-video-poster" draggable={false} />
        )}
        {!displayPoster && !showFrame && !playing && (
          <span className="message-video-skeleton" aria-hidden />
        )}
        <video
          ref={videoRef}
          className={`message-video-el${showPoster ? " is-hidden" : ""}`}
          src={playbackSrc ?? undefined}
          playsInline
          preload="auto"
          muted={false}
          controls={false}
          disablePictureInPicture
          controlsList="nodownload nofullscreen noremoteplayback noplaybackrate"
          onContextMenu={(e) => e.preventDefault()}
        >
          {playbackSrc ? <source src={playbackSrc} type={mime} /> : null}
        </video>
        <span className={`message-video-center-play${playing ? " is-playing" : ""}`} aria-hidden>
          {unsupported ? (
            "!"
          ) : buffering ? (
            <span className="message-video-buffer-spinner" />
          ) : playing ? (
            <IconPause size={30} />
          ) : (
            <IconPlay size={30} />
          )}
        </span>
        {buffering && (
          <span className="message-video-buffer-label" aria-live="polite">
            Загрузка…
          </span>
        )}
      </div>
      <div className="message-video-bar" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          className="message-video-bar-btn"
          onClick={togglePlay}
          disabled={unsupported}
          aria-label={buffering ? "Загрузка" : playing ? "Пауза" : "Воспроизвести"}
        >
          {buffering ? (
            <span className="message-video-buffer-spinner message-video-buffer-spinner--small" />
          ) : playing ? (
            <IconPause size={16} />
          ) : (
            <IconPlay size={16} />
          )}
        </button>
        <div
          className="message-video-scrub"
          ref={trackRef}
          onPointerDown={handleScrubDown}
          role="slider"
          aria-valuemin={0}
          aria-valuemax={Math.round(duration)}
          aria-valuenow={Math.round(current)}
          aria-label="Позиция воспроизведения"
        >
          <div className="message-video-scrub-track">
            <div className="message-video-scrub-buffer" style={{ width: `${bufferedRatio * 100}%` }} />
            <div className="message-video-scrub-fill" style={{ width: `${progress * 100}%` }} />
          </div>
        </div>
        <span className="message-video-bar-time">
          {buffering ? "Загрузка…" : `${formatTime(current)} / ${formatTime(duration)}`}
        </span>
        {onExpand && !isLightbox && (
          <button type="button" className="message-video-bar-btn" onClick={handleExpand} aria-label="На весь экран">
            <IconExpand size={15} />
          </button>
        )}
      </div>
    </div>
  );
}
