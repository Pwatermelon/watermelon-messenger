import { useCallback, useEffect, useRef, useState } from "react";
import { useVoiceRecorder } from "../hooks/useVoiceRecorder";
import { useCircleRecorder } from "../hooks/useCircleRecorder";
import { IconCircle, IconMic, IconSend } from "./Icons";
import { unlockMessageSounds } from "../utils/messageSounds";

type RecordMode = "voice" | "circle";
type Gesture = "none" | "cancel" | "lock";

const HOLD_MS = 220;
const MOVE_PX = 12;
const MIN_VOICE_BYTES = 200;
const MIN_CIRCLE_BYTES = 200;

interface ComposeRecorderProps {
  disabled?: boolean;
  onVoiceSend: (blob: Blob, duration: number) => void | Promise<void>;
  onCircleSend: (blob: Blob, duration: number) => void | Promise<void>;
}

export function ComposeRecorder({ disabled, onVoiceSend, onCircleSend }: ComposeRecorderProps) {
  const voice = useVoiceRecorder();
  const circle = useCircleRecorder();
  const [mode, setMode] = useState<RecordMode>(() => {
    try {
      return localStorage.getItem("wm_record_mode") === "circle" ? "circle" : "voice";
    } catch {
      return "voice";
    }
  });
  const [locked, setLocked] = useState(false);
  const [gesture, setGesture] = useState<Gesture>("none");
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  const [recordError, setRecordError] = useState<string | null>(null);

  const btnRef = useRef<HTMLButtonElement>(null);
  const originRef = useRef({ x: 0, y: 0 });
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdActivatedRef = useRef(false);
  const recordingStartedRef = useRef(false);
  const startPromiseRef = useRef<Promise<boolean> | null>(null);
  const movedRef = useRef(false);
  const gestureRef = useRef<Gesture>("none");
  const sendingRef = useRef(false);
  const pressActiveRef = useRef(false);
  const lockedRef = useRef(false);
  const disabledRef = useRef(false);
  const modeRef = useRef(mode);
  const recordingRef = useRef(false);
  const recordErrorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const activeMode = mode;
  const recording = activeMode === "voice" ? voice.recording : circle.recording;
  const duration = activeMode === "voice" ? voice.duration : circle.duration;
  const maxDuration = circle.maxDuration;
  const active = recording || locked;
  const voiceLevel =
    activeMode === "voice" && active
      ? voice.levels.reduce((sum, v) => sum + v, 0) / voice.levels.length
      : 0;

  useEffect(() => {
    gestureRef.current = gesture;
  }, [gesture]);
  useEffect(() => {
    lockedRef.current = locked;
  }, [locked]);
  useEffect(() => {
    disabledRef.current = Boolean(disabled);
  }, [disabled]);
  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);
  useEffect(() => {
    recordingRef.current = voice.recording || circle.recording;
  }, [voice.recording, circle.recording]);

  const attachPreview = useCallback((el: HTMLVideoElement | null) => {
    if (el && circle.previewStream) {
      if (el.srcObject !== circle.previewStream) {
        el.srcObject = circle.previewStream;
      }
      el.setAttribute("playsinline", "true");
      el.setAttribute("webkit-playsinline", "true");
      void el.play().catch(() => {});
    }
  }, [circle.previewStream]);

  useEffect(() => {
    if (circle.error) setRecordError(circle.error);
  }, [circle.error]);

  useEffect(() => {
    if (!recordError) return;
    if (recordErrorTimerRef.current) clearTimeout(recordErrorTimerRef.current);
    recordErrorTimerRef.current = setTimeout(() => setRecordError(null), 4500);
    return () => {
      if (recordErrorTimerRef.current) {
        clearTimeout(recordErrorTimerRef.current);
        recordErrorTimerRef.current = null;
      }
    };
  }, [recordError]);

  useEffect(() => {
    if (activeMode === "circle" && circle.recording && circle.duration >= maxDuration) {
      void finishSend();
    }
  }, [activeMode, circle.recording, circle.duration, maxDuration]);

  function persistMode(next: RecordMode) {
    setMode(next);
    modeRef.current = next;
    try {
      localStorage.setItem("wm_record_mode", next);
    } catch {}
  }

  function updateAnchor() {
    const rect = btnRef.current?.getBoundingClientRect();
    if (!rect) return;
    const rawX = rect.left + rect.width / 2;
    const pad = 100;
    const x = Math.min(window.innerWidth - pad, Math.max(pad, rawX));
    const y = rect.top + rect.height / 2;
    setAnchor({ x, y });
  }

  async function finishSend() {
    if (sendingRef.current) return;
    sendingRef.current = true;
    const isVoice = modeRef.current === "voice";
    const shownDuration = isVoice ? voice.duration : circle.duration;
    const { blob, duration: d } = isVoice ? await voice.stop() : await circle.stop();
    setLocked(false);
    lockedRef.current = false;
    setGesture("none");
    setAnchor(null);
    holdActivatedRef.current = false;
    const hadRecording = recordingStartedRef.current;
    recordingStartedRef.current = false;
    const effectiveDuration = Math.max(d, shownDuration);
    const min = isVoice ? MIN_VOICE_BYTES : MIN_CIRCLE_BYTES;
    if (!hadRecording && effectiveDuration < 1) {
      sendingRef.current = false;
      activeRecorder().releaseAcquire();
      return;
    }
    if (blob.size < min) {
      setRecordError(
        effectiveDuration >= 1
          ? isVoice
            ? "Не удалось сохранить запись"
            : "Не удалось записать кружок"
          : isVoice
            ? "Слишком короткая запись"
            : "Не удалось записать кружок — удерживайте кнопку дольше"
      );
      sendingRef.current = false;
      activeRecorder().releaseAcquire();
      return;
    }
    setRecordError(null);
    if (isVoice) await onVoiceSend(blob, effectiveDuration);
    else await onCircleSend(blob, effectiveDuration);
    sendingRef.current = false;
  }

  function activeRecorder() {
    return modeRef.current === "voice" ? voice : circle;
  }

  function releaseInactiveAcquire() {
    if (modeRef.current === "voice") circle.releaseAcquire();
    else voice.releaseAcquire();
  }

  function cancelRecording() {
    if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
    holdTimerRef.current = null;
    voice.cancel();
    circle.cancel();
    holdActivatedRef.current = false;
    recordingStartedRef.current = false;
    startPromiseRef.current = null;
    setLocked(false);
    lockedRef.current = false;
    setGesture("none");
    setAnchor(null);
    setRecordError(null);
  }

  async function acquireRecording(): Promise<boolean> {
    releaseInactiveAcquire();
    return activeRecorder().acquire();
  }

  async function beginRecording(): Promise<boolean> {
    updateAnchor();
    setRecordError(null);
    const ok = await activeRecorder().begin();
    if (ok) recordingStartedRef.current = true;
    else {
      setAnchor(null);
      setRecordError("Не удалось начать запись");
    }
    return ok;
  }

  function updateGesture(clientX: number, clientY: number) {
    const dx = clientX - originRef.current.x;
    const dy = clientY - originRef.current.y;
    if (Math.abs(dx) > MOVE_PX || Math.abs(dy) > MOVE_PX) movedRef.current = true;
    if (!recordingStartedRef.current || lockedRef.current) return;
    if (dx < -70) setGesture("cancel");
    else if (dy < -70) setGesture("lock");
    else setGesture("none");
  }

  function clearPressListeners() {
    document.removeEventListener("pointermove", onDocPointerMove);
    document.removeEventListener("pointerup", onDocPointerUp);
    document.removeEventListener("pointercancel", onDocPointerUp);
    document.removeEventListener("touchmove", onDocTouchMove);
    document.removeEventListener("touchend", onDocTouchEnd);
    document.removeEventListener("touchcancel", onDocTouchEnd);
    pressActiveRef.current = false;
  }

  async function endPress() {
    if (!pressActiveRef.current) return;
    clearPressListeners();

    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }

    if (startPromiseRef.current) {
      await startPromiseRef.current;
    }

    if (!holdActivatedRef.current && !movedRef.current) {
      cancelRecording();
      persistMode(modeRef.current === "voice" ? "circle" : "voice");
      return;
    }

    const g = gestureRef.current;
    const isRecording = recordingStartedRef.current || recordingRef.current;

    if (g === "cancel") {
      cancelRecording();
      return;
    }
    if (g === "lock" && isRecording) {
      setLocked(true);
      lockedRef.current = true;
      setGesture("none");
      holdActivatedRef.current = false;
      return;
    }
    if (isRecording && !lockedRef.current) {
      await finishSend();
      holdActivatedRef.current = false;
      return;
    }
    if (holdActivatedRef.current) {
      if (!isRecording) {
        setRecordError("Не удалось начать запись");
      }
      cancelRecording();
    }
    holdActivatedRef.current = false;
  }

  function onDocPointerMove(e: PointerEvent) {
    if (!pressActiveRef.current) return;
    e.preventDefault();
    updateGesture(e.clientX, e.clientY);
  }

  function onDocPointerUp(e: PointerEvent) {
    if (!pressActiveRef.current) return;
    e.preventDefault();
    void endPress();
  }

  function onDocTouchMove(e: TouchEvent) {
    if (!pressActiveRef.current || e.touches.length !== 1) return;
    e.preventDefault();
    const t = e.touches[0];
    updateGesture(t.clientX, t.clientY);
  }

  function onDocTouchEnd(e: TouchEvent) {
    if (!pressActiveRef.current) return;
    e.preventDefault();
    void endPress();
  }

  function beginPress(clientX: number, clientY: number) {
    if (disabledRef.current || lockedRef.current || pressActiveRef.current) return;
    unlockMessageSounds();
    pressActiveRef.current = true;
    originRef.current = { x: clientX, y: clientY };
    movedRef.current = false;
    holdActivatedRef.current = false;
    recordingStartedRef.current = false;
    setGesture("none");
    setRecordError(null);
    startPromiseRef.current = null;

    document.addEventListener("pointermove", onDocPointerMove, { passive: false });
    document.addEventListener("pointerup", onDocPointerUp, { passive: false });
    document.addEventListener("pointercancel", onDocPointerUp, { passive: false });
    document.addEventListener("touchmove", onDocTouchMove, { passive: false });
    document.addEventListener("touchend", onDocTouchEnd, { passive: false });
    document.addEventListener("touchcancel", onDocTouchEnd, { passive: false });

    void (async () => {
      const p = acquireRecording();
      startPromiseRef.current = p;
      await p;
    })();

    holdTimerRef.current = setTimeout(() => {
      holdActivatedRef.current = true;
    }, HOLD_MS);

    void (async () => {
      const p = (async () => {
        const acquired = await acquireRecording();
        if (!acquired) return false;
        return beginRecording();
      })();
      startPromiseRef.current = p;
      await p;
    })();
  }

  useEffect(() => () => clearPressListeners(), []);

  function handlePointerDown(e: React.PointerEvent<HTMLButtonElement>) {
    if (disabled || locked) return;
    if (e.pointerType === "touch") return;
    e.preventDefault();
    e.stopPropagation();
    beginPress(e.clientX, e.clientY);
  }

  function handleTouchStart(e: React.TouchEvent<HTMLButtonElement>) {
    if (disabled || locked) return;
    if (e.touches.length !== 1) return;
    e.preventDefault();
    e.stopPropagation();
    const t = e.touches[0];
    beginPress(t.clientX, t.clientY);
  }

  const overlayStyle = anchor
    ? ({ "--rec-x": `${anchor.x}px`, "--rec-y": `${anchor.y}px` } as React.CSSProperties)
    : undefined;

  return (
    <div className="compose-record-wrap">
      {active && (
        <div
          className={`record-overlay record-overlay-${activeMode}`}
          style={overlayStyle}
          aria-live="polite"
        >
          {activeMode === "circle" && (
            <div className={`record-circle-preview ${gesture === "cancel" ? "record-circle-cancel" : ""}`}>
              <video
                ref={attachPreview}
                className="record-circle-video"
                muted
                playsInline
                autoPlay
              />
              <div className="record-circle-ring" />
              <span className="record-circle-timer">{duration}s / {maxDuration}s</span>
            </div>
          )}
          {activeMode === "voice" && (
            <div className={`record-voice-viz ${gesture === "cancel" ? "record-voice-cancel" : ""}`} aria-hidden>
              {voice.levels.map((h, i) => (
                <span
                  key={i}
                  className="record-voice-bar"
                  style={{ transform: `scaleY(${h.toFixed(3)})` }}
                />
              ))}
            </div>
          )}
          <div
            className={`record-hint-panel ${locked ? "record-hint-panel-locked" : ""} ${gesture === "cancel" ? "record-hint-cancel" : ""} ${gesture === "lock" ? "record-hint-lock" : ""}`}
          >
            {locked ? (
              <button
                type="button"
                className="record-hint record-hint-left record-hint-cancel-btn"
                onClick={cancelRecording}
                disabled={disabled}
              >
                ← Отмена
              </button>
            ) : (
              <span className={`record-hint record-hint-left ${gesture === "cancel" ? "active" : ""}`}>← Отмена</span>
            )}
            <span className="record-hint-timer">{duration}s</span>
            <span className={`record-hint record-hint-right ${gesture === "lock" ? "active" : ""}`}>
              {locked ? "Заблокировано" : "↑ Без удержания"}
            </span>
          </div>
        </div>
      )}
      {recordError && !active && (
        <span className="compose-record-error" role="alert">{recordError}</span>
      )}
      {locked ? (
        <button
          type="button"
          className="compose-btn compose-btn-icon compose-btn-record-stop"
          onClick={() => void finishSend()}
          disabled={disabled}
          aria-label="Отправить"
          title="Отправить"
        >
          <IconSend size={20} />
        </button>
      ) : (
        <button
          ref={btnRef}
          type="button"
          className={`compose-btn compose-btn-icon compose-btn-record ${recording ? "compose-btn-recording" : ""}`}
          disabled={disabled}
          onPointerDown={handlePointerDown}
          onTouchStart={handleTouchStart}
          title={activeMode === "voice" ? "Клик — кружок, удержание — голос" : "Клик — голос, удержание — кружок"}
          data-testid="compose-record-btn"
          data-mode={activeMode}
          style={
            activeMode === "voice" && recording
              ? {
                  boxShadow: `0 0 ${10 + voiceLevel * 24}px rgba(232, 72, 85, ${0.25 + voiceLevel * 0.45})`,
                }
              : undefined
          }
        >
          {activeMode === "voice" ? <IconMic size={22} /> : <IconCircle size={22} />}
        </button>
      )}
    </div>
  );
}
