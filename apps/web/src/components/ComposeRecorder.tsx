import { useEffect, useRef, useState } from "react";
import { useVoiceRecorder } from "../hooks/useVoiceRecorder";
import { useCircleRecorder } from "../hooks/useCircleRecorder";
import { IconCircle, IconMic } from "./Icons";

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
  const previewRef = useRef<HTMLVideoElement>(null);
  const sendingRef = useRef(false);
  const pressActiveRef = useRef(false);
  const lockedRef = useRef(false);
  const disabledRef = useRef(false);
  const modeRef = useRef(mode);

  const activeMode = mode;
  const recording = activeMode === "voice" ? voice.recording : circle.recording;
  const duration = activeMode === "voice" ? voice.duration : circle.duration;
  const maxDuration = circle.maxDuration;
  const active = recording || locked;

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
    const el = previewRef.current;
    if (el && circle.previewStream) {
      el.srcObject = circle.previewStream;
      el.setAttribute("playsinline", "true");
      el.setAttribute("webkit-playsinline", "true");
      void el.play().catch(() => {});
    }
  }, [circle.previewStream]);

  useEffect(() => {
    if (circle.error) setRecordError(circle.error);
  }, [circle.error]);

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
    const { blob, duration: d } = isVoice ? await voice.stop() : await circle.stop();
    setLocked(false);
    lockedRef.current = false;
    setGesture("none");
    setAnchor(null);
    holdActivatedRef.current = false;
    recordingStartedRef.current = false;
    const min = isVoice ? MIN_VOICE_BYTES : MIN_CIRCLE_BYTES;
    if (isVoice && blob.size >= min) await onVoiceSend(blob, d);
    if (!isVoice && blob.size >= min) await onCircleSend(blob, d);
    sendingRef.current = false;
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
  }

  async function startRecording(): Promise<boolean> {
    updateAnchor();
    setRecordError(null);
    const p = (async () => {
      if (modeRef.current === "voice") return voice.start();
      return circle.start();
    })();
    startPromiseRef.current = p;
    try {
      const ok = await p;
      if (ok) recordingStartedRef.current = true;
      else {
        setAnchor(null);
        setRecordError("Не удалось начать запись");
      }
      return ok;
    } catch {
      setAnchor(null);
      setRecordError("Не удалось начать запись");
      return false;
    } finally {
      startPromiseRef.current = null;
    }
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
      persistMode(modeRef.current === "voice" ? "circle" : "voice");
      return;
    }

    const g = gestureRef.current;
    if (g === "cancel") {
      cancelRecording();
      return;
    }
    if (g === "lock") {
      setLocked(true);
      lockedRef.current = true;
      setGesture("none");
      holdActivatedRef.current = false;
      return;
    }
    if (recordingStartedRef.current && !lockedRef.current) {
      await finishSend();
    } else if (holdActivatedRef.current) {
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
    pressActiveRef.current = true;
    originRef.current = { x: clientX, y: clientY };
    movedRef.current = false;
    holdActivatedRef.current = false;
    recordingStartedRef.current = false;
    setGesture("none");
    setRecordError(null);

    document.addEventListener("pointermove", onDocPointerMove, { passive: false });
    document.addEventListener("pointerup", onDocPointerUp, { passive: false });
    document.addEventListener("pointercancel", onDocPointerUp, { passive: false });
    document.addEventListener("touchmove", onDocTouchMove, { passive: false });
    document.addEventListener("touchend", onDocTouchEnd, { passive: false });
    document.addEventListener("touchcancel", onDocTouchEnd, { passive: false });

    holdTimerRef.current = setTimeout(() => {
      holdActivatedRef.current = true;
      void startRecording();
    }, HOLD_MS);
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
                ref={previewRef}
                className="record-circle-video"
                muted
                playsInline
                autoPlay
              />
              <div className="record-circle-ring" />
              <span className="record-circle-timer">{duration}s / {maxDuration}s</span>
            </div>
          )}
          <div
            className={`record-hint-panel ${gesture === "cancel" ? "record-hint-cancel" : ""} ${gesture === "lock" ? "record-hint-lock" : ""}`}
          >
            <span className={`record-hint record-hint-left ${gesture === "cancel" ? "active" : ""}`}>← Отмена</span>
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
        >
          {duration}s
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
        >
          {activeMode === "voice" ? <IconMic size={22} /> : <IconCircle size={22} />}
        </button>
      )}
    </div>
  );
}
