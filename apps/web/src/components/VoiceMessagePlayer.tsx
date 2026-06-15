import { useCallback, useEffect, useRef, useState } from "react";
import { IconPlay, IconPause } from "./Icons";
import { canPlayMediaUrl, mimeFromMediaUrl } from "../utils/mediaMime";
import { claimMediaPlayback, releaseMediaPlayback } from "../utils/mediaPlayback";

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function VoiceMessagePlayer({ src, duration: metaDuration }: { src: string; duration?: number }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const scrubbingRef = useRef(false);
  const wasPlayingRef = useRef(false);
  const stopRef = useRef<() => void>(() => {});

  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(metaDuration ?? 0);
  const [error, setError] = useState(false);
  const [unsupported, setUnsupported] = useState(false);

  const mime = mimeFromMediaUrl(src, "audio");

  const stopPlayback = useCallback(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
    }
    setPlaying(false);
    setProgress(0);
    setCurrent(0);
  }, []);

  stopRef.current = stopPlayback;

  const seekFromClientX = useCallback((clientX: number) => {
    const track = trackRef.current;
    const audio = audioRef.current;
    if (!track || !audio) return;
    const dur = audio.duration;
    if (!dur || !Number.isFinite(dur)) return;
    const rect = track.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const t = pct * dur;
    audio.currentTime = t;
    setProgress(pct);
    setCurrent(t);
  }, []);

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
      const audio = audioRef.current;
      if (audio && wasPlayingRef.current) {
        void audio.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
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
      const audio = audioRef.current;
      if (audio && wasPlayingRef.current) {
        void audio.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
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
    setUnsupported(!canPlayMediaUrl(src, "audio"));
  }, [src]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onTime = () => {
      if (scrubbingRef.current) return;
      if (audio.duration && Number.isFinite(audio.duration)) {
        setProgress(audio.currentTime / audio.duration);
        setCurrent(audio.currentTime);
      }
    };
    const onMeta = () => {
      if (audio.duration && Number.isFinite(audio.duration)) {
        setDuration(Math.round(audio.duration));
      }
    };
    const onEnd = () => {
      setPlaying(false);
      setProgress(0);
      setCurrent(0);
      releaseMediaPlayback(stopRef.current);
    };
    const onAudioError = () => {
      setError(true);
      setPlaying(false);
      releaseMediaPlayback(stopRef.current);
    };
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("loadedmetadata", onMeta);
    audio.addEventListener("ended", onEnd);
    audio.addEventListener("error", onAudioError);
    return () => {
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("loadedmetadata", onMeta);
      audio.removeEventListener("ended", onEnd);
      audio.removeEventListener("error", onAudioError);
    };
  }, [src]);

  useEffect(() => {
    stopPlayback();
    setError(false);
    return () => releaseMediaPlayback(stopRef.current);
  }, [src, stopPlayback]);

  function toggle() {
    const audio = audioRef.current;
    if (!audio || unsupported) return;
    if (playing) {
      audio.pause();
      setPlaying(false);
      releaseMediaPlayback(stopRef.current);
    } else {
      setError(false);
      claimMediaPlayback(stopRef.current);
      void audio.play()
        .then(() => setPlaying(true))
        .catch(() => {
          setError(true);
          setPlaying(false);
          releaseMediaPlayback(stopRef.current);
        });
    }
  }

  function handleScrubDown(e: React.PointerEvent<HTMLDivElement>) {
    if (unsupported) return;
    e.preventDefault();
    e.stopPropagation();
    const audio = audioRef.current;
    wasPlayingRef.current = !!audio && !audio.paused;
    if (audio && wasPlayingRef.current) audio.pause();

    scrubbingRef.current = true;
    seekFromClientX(e.clientX);
    trackRef.current?.setPointerCapture(e.pointerId);
    document.addEventListener("pointermove", scrubHandlersRef.current.onMove, { passive: false });
    document.addEventListener("pointerup", scrubHandlersRef.current.onUp, { passive: false });
    document.addEventListener("pointercancel", scrubHandlersRef.current.onUp, { passive: false });
  }

  const bars = Array.from({ length: 28 }, (_, i) => 4 + ((i * 7 + 3) % 11));

  return (
    <div className="voice-player">
      <audio ref={audioRef} preload="metadata">
        <source src={src} type={mime} />
      </audio>
      <button
        type="button"
        className="voice-player-btn"
        onClick={toggle}
        disabled={unsupported}
        aria-label={playing ? "Пауза" : "Воспроизвести"}
      >
        {playing ? <IconPause size={18} /> : <IconPlay size={18} />}
      </button>
      <div
        className="voice-player-body"
        ref={trackRef}
        onPointerDown={handleScrubDown}
        role="slider"
        aria-valuemin={0}
        aria-valuemax={duration}
        aria-valuenow={Math.round(current)}
        aria-label="Позиция воспроизведения"
      >
        <div className={`voice-player-wave ${playing ? "voice-player-wave-active" : ""}`}>
          {bars.map((h, i) => (
            <span
              key={i}
              className="voice-player-bar"
              style={{ height: `${h}px`, opacity: progress > i / bars.length ? 1 : 0.35 }}
            />
          ))}
        </div>
        <div className="voice-player-track">
          <div className="voice-player-fill" style={{ width: `${progress * 100}%` }} />
        </div>
      </div>
      <span className="voice-player-time">
        {unsupported ? "WebM" : error ? "Ошибка" : `${formatTime(current)} / ${formatTime(duration)}`}
      </span>
    </div>
  );
}
