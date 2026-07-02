import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { IconPlay, IconPause } from "./Icons";
import { canPlayMediaUrl } from "../utils/mediaMime";
import { claimMediaPlayback, releaseMediaPlayback } from "../utils/mediaPlayback";
import { resolvePlaybackDuration } from "../utils/mediaPlaybackDuration";
import { attachVideoPreviewHandlers, primeVideoPreviewFrame } from "../utils/videoPreview";
import { useAuthenticatedMediaSrc } from "../hooks/useAuthenticatedMediaSrc";

const DEFAULT_SIZE = 220;

function circleMetrics(outer: number) {
  const ring = 5;
  const ringHit = 28;
  const r = (outer - ring) / 2;
  return { outer, ring, ringHit, r, circumference: 2 * Math.PI * r };
}

type Props = {
  src: string;
  duration?: number;
  size?: number;
  poster?: string | null;
};

function formatTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `0:${s.toString().padStart(2, "0")}`;
}

function angleFromPointer(clientX: number, clientY: number, rect: DOMRect): number {
  const x = clientX - rect.left - rect.width / 2;
  const y = clientY - rect.top - rect.height / 2;
  let angle = Math.atan2(y, x) + Math.PI / 2;
  if (angle < 0) angle += Math.PI * 2;
  return angle / (Math.PI * 2);
}

export function CircleMessagePlayer({ src, duration: metaDuration, size = DEFAULT_SIZE, poster }: Props) {
  const playbackSrc = useAuthenticatedMediaSrc(src);
  const authPoster = useAuthenticatedMediaSrc(poster);
  const { outer, ring, ringHit, r, circumference } = useMemo(() => circleMetrics(size), [size]);
  const cx = outer / 2;

  const videoRef = useRef<HTMLVideoElement>(null);
  const ringRef = useRef<SVGSVGElement>(null);
  const scrubbingRef = useRef(false);
  const wasPlayingRef = useRef(false);
  const stopRef = useRef<() => void>(() => {});

  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [current, setCurrent] = useState(0);
  const [mediaDuration, setMediaDuration] = useState(metaDuration ?? 0);
  const [error, setError] = useState(false);
  const [unsupported, setUnsupported] = useState(false);
  const [previewReady, setPreviewReady] = useState(Boolean(poster));
  const displayPoster = authPoster ?? poster ?? undefined;
  const posterClearedRef = useRef(false);

  const duration = resolvePlaybackDuration(metaDuration, mediaDuration);

  const primeInitialPreview = useCallback(() => {
    const video = videoRef.current;
    if (!video || !video.paused || video.currentTime >= 0.05) return;
    primeVideoPreviewFrame(video);
  }, []);

  /** Pause without moving the playhead — used when user pauses or another player takes over. */
  const interruptPlayback = useCallback(() => {
    videoRef.current?.pause();
    setPlaying(false);
  }, []);

  /** Full reset when the message/source changes. */
  const resetPlayback = useCallback(() => {
    const video = videoRef.current;
    if (video) {
      video.pause();
      primeInitialPreview();
    }
    setPlaying(false);
    setProgress(0);
    setCurrent(0);
  }, [primeInitialPreview]);

  stopRef.current = interruptPlayback;

  const seekFromPointer = useCallback((clientX: number, clientY: number) => {
    const rect = ringRef.current?.getBoundingClientRect();
    if (!rect) return;
    const video = videoRef.current;
    if (!video) return;
    const dur = resolvePlaybackDuration(metaDuration, video.duration) || video.duration;
    if (!dur || !Number.isFinite(dur)) return;
    const pct = angleFromPointer(clientX, clientY, rect);
    const t = Math.max(0, Math.min(1, pct)) * dur;
    const maxT = video.duration && Number.isFinite(video.duration) ? video.duration : t;
    video.currentTime = Math.min(t, maxT);
    setProgress(video.currentTime / dur);
    setCurrent(video.currentTime);
  }, [metaDuration]);

  const scrubHandlersRef = useRef({
    onMove: (e: PointerEvent) => {
      if (!scrubbingRef.current) return;
      e.preventDefault();
      seekFromPointer(e.clientX, e.clientY);
    },
    onUp: (e: PointerEvent) => {
      if (!scrubbingRef.current) return;
      e.preventDefault();
      seekFromPointer(e.clientX, e.clientY);
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
      seekFromPointer(e.clientX, e.clientY);
    };
    scrubHandlersRef.current.onUp = (e: PointerEvent) => {
      if (!scrubbingRef.current) return;
      e.preventDefault();
      seekFromPointer(e.clientX, e.clientY);
      scrubbingRef.current = false;
      const video = videoRef.current;
      if (video && wasPlayingRef.current) {
        void video.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
      }
      document.removeEventListener("pointermove", scrubHandlersRef.current.onMove);
      document.removeEventListener("pointerup", scrubHandlersRef.current.onUp);
      document.removeEventListener("pointercancel", scrubHandlersRef.current.onUp);
    };
  }, [seekFromPointer]);

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
  }, [src]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const onTime = () => {
      if (scrubbingRef.current) return;
      const dur = resolvePlaybackDuration(metaDuration, video.duration);
      if (dur > 0) {
        setProgress(Math.min(1, video.currentTime / dur));
        setCurrent(video.currentTime);
      }
    };
    const onMeta = () => {
      if (video.duration && Number.isFinite(video.duration)) {
        setMediaDuration(video.duration);
      }
    };
    const onEnd = () => {
      setPlaying(false);
      const dur = resolvePlaybackDuration(metaDuration, video.duration);
      setProgress(1);
      setCurrent(dur > 0 ? dur : 0);
      primeInitialPreview();
      releaseMediaPlayback(stopRef.current);
    };
    const onVideoError = () => {
      setError(true);
      setPlaying(false);
      releaseMediaPlayback(stopRef.current);
    };

    video.addEventListener("timeupdate", onTime);
    video.addEventListener("loadedmetadata", onMeta);
    video.addEventListener("ended", onEnd);
    video.addEventListener("error", onVideoError);
    return () => {
      video.removeEventListener("timeupdate", onTime);
      video.removeEventListener("loadedmetadata", onMeta);
      video.removeEventListener("ended", onEnd);
      video.removeEventListener("error", onVideoError);
    };
  }, [src, metaDuration, primeInitialPreview]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    posterClearedRef.current = false;
    setPreviewReady(Boolean(poster));
    return attachVideoPreviewHandlers(video, () => setPreviewReady(true));
  }, [src, poster]);

  useEffect(() => {
    setMediaDuration(metaDuration ?? 0);
    resetPlayback();
    setError(false);
    return () => releaseMediaPlayback(stopRef.current);
  }, [src, metaDuration, resetPlayback]);

  function togglePlay() {
    const video = videoRef.current;
    if (!video || unsupported) return;
    if (playing) {
      video.pause();
      setPlaying(false);
      releaseMediaPlayback(stopRef.current);
    } else {
      setError(false);
      if (!posterClearedRef.current) {
        video.removeAttribute("poster");
        posterClearedRef.current = true;
      }
      claimMediaPlayback(stopRef.current);
      video.playsInline = true;
      void video.play()
        .then(() => setPlaying(true))
        .catch(() => {
          setError(true);
          setPlaying(false);
          releaseMediaPlayback(stopRef.current);
        });
    }
  }

  function handleRingPointerDown(e: React.PointerEvent<SVGCircleElement>) {
    if (unsupported) return;
    e.preventDefault();
    e.stopPropagation();
    const video = videoRef.current;
    wasPlayingRef.current = !!video && !video.paused;
    if (video && wasPlayingRef.current) video.pause();

    scrubbingRef.current = true;
    seekFromPointer(e.clientX, e.clientY);
    ringRef.current?.setPointerCapture(e.pointerId);
    document.addEventListener("pointermove", scrubHandlersRef.current.onMove, { passive: false });
    document.addEventListener("pointerup", scrubHandlersRef.current.onUp, { passive: false });
    document.addEventListener("pointercancel", scrubHandlersRef.current.onUp, { passive: false });
  }

  const offset = circumference * (1 - Math.min(1, progress));

  return (
    <div className="circle-player-stack">
      <div className="circle-player" style={{ width: outer, height: outer }}>
      <button
        type="button"
        className={`circle-player-video-btn${previewReady ? " has-preview" : ""}`}
        onClick={togglePlay}
        disabled={unsupported}
        aria-label={playing ? "Пауза" : "Воспроизвести"}
      >
        <video
          ref={videoRef}
          className="circle-player-video"
          src={playbackSrc ?? undefined}
          poster={displayPoster}
          playsInline
          preload="metadata"
          muted={false}
          disablePictureInPicture
          controls={false}
          controlsList="nodownload nofullscreen noremoteplayback"
          onContextMenu={(e) => e.preventDefault()}
        />
        <span className={`circle-player-overlay${playing ? " is-playing" : ""}`}>
          {unsupported ? (
            <span className="circle-player-error" title="Safari не воспроизводит WebM">!</span>
          ) : error ? (
            <span className="circle-player-error">!</span>
          ) : playing ? (
            <IconPause size={32} />
          ) : (
            <IconPlay size={36} />
          )}
        </span>
      </button>
      <svg
        ref={ringRef}
        className="circle-player-ring"
        width={outer}
        height={outer}
        viewBox={`0 0 ${outer} ${outer}`}
        aria-hidden
      >
        <circle
          cx={cx}
          cy={cx}
          r={r}
          className="circle-player-ring-hit"
          fill="none"
          strokeWidth={ringHit}
          onPointerDown={handleRingPointerDown}
        />
        <circle cx={cx} cy={cx} r={r} className="circle-player-ring-bg" fill="none" strokeWidth={ring} />
        <circle
          cx={cx}
          cy={cx}
          r={r}
          className="circle-player-ring-progress"
          fill="none"
          strokeWidth={ring}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          transform={`rotate(-90 ${cx} ${cx})`}
        />
      </svg>
      </div>
      <span className="circle-player-time">
        {unsupported ? "WebM" : error ? "Ошибка" : `${formatTime(current)}${duration ? ` / ${formatTime(duration)}` : ""}`}
      </span>
    </div>
  );
}
