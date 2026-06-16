import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { IconPlay, IconPause } from "./Icons";
import { canPlayMediaUrl } from "../utils/mediaMime";
import { claimMediaPlayback, releaseMediaPlayback } from "../utils/mediaPlayback";

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

export function CircleMessagePlayer({ src, duration: metaDuration, size = DEFAULT_SIZE }: Props) {
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
  const [duration, setDuration] = useState(metaDuration ?? 0);
  const [error, setError] = useState(false);
  const [unsupported, setUnsupported] = useState(false);

  const stopPlayback = useCallback(() => {
    const video = videoRef.current;
    if (video) {
      video.pause();
      video.currentTime = 0;
    }
    setPlaying(false);
    setProgress(0);
    setCurrent(0);
  }, []);

  stopRef.current = stopPlayback;

  const seekFromPointer = useCallback((clientX: number, clientY: number) => {
    const rect = ringRef.current?.getBoundingClientRect();
    if (!rect) return;
    const video = videoRef.current;
    if (!video) return;
    const dur = video.duration;
    if (!dur || !Number.isFinite(dur)) return;
    const pct = angleFromPointer(clientX, clientY, rect);
    const t = Math.max(0, Math.min(1, pct)) * dur;
    video.currentTime = t;
    setProgress(t / dur);
    setCurrent(t);
  }, []);

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
      if (video.duration && Number.isFinite(video.duration)) {
        setProgress(video.currentTime / video.duration);
        setCurrent(video.currentTime);
      }
    };
    const onMeta = () => {
      if (video.duration && Number.isFinite(video.duration)) {
        setDuration(Math.round(video.duration));
      }
    };
    const onEnd = () => {
      setPlaying(false);
      setProgress(0);
      setCurrent(0);
      video.currentTime = 0;
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
  }, [src]);

  useEffect(() => {
    stopPlayback();
    setError(false);
    return () => releaseMediaPlayback(stopRef.current);
  }, [src, stopPlayback]);

  function togglePlay() {
    const video = videoRef.current;
    if (!video || unsupported) return;
    if (playing) {
      video.pause();
      setPlaying(false);
      releaseMediaPlayback(stopRef.current);
    } else {
      setError(false);
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

  const offset = circumference * (1 - progress);

  return (
    <div className="circle-player-stack">
      <div className="circle-player" style={{ width: outer, height: outer }}>
      <button
        type="button"
        className="circle-player-video-btn"
        onClick={togglePlay}
        disabled={unsupported}
        aria-label={playing ? "Пауза" : "Воспроизвести"}
      >
        <video
          ref={videoRef}
          className="circle-player-video"
          src={src}
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
