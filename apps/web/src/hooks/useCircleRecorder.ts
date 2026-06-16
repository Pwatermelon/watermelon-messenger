import { useState, useRef, useCallback, useEffect } from "react";
import { pickCircleMime, isSafariBrowser } from "../utils/mediaMime";
import {
  readCachedCircleConstraintIndex,
  writeCachedCircleConstraintIndex,
} from "../utils/mediaAccess";

const MAX_DURATION = 60;

const CIRCLE_CONSTRAINTS: MediaStreamConstraints[] = [
  { video: { facingMode: "user", width: { ideal: 480 }, height: { ideal: 480 } }, audio: true },
  { video: { width: { ideal: 480 }, height: { ideal: 480 } }, audio: true },
  { video: true, audio: true },
];

function isPermissionDenied(err: unknown): boolean {
  return err instanceof DOMException && (err.name === "NotAllowedError" || err.name === "PermissionDeniedError");
}

async function getCircleStream(): Promise<MediaStream> {
  const cached = readCachedCircleConstraintIndex();
  const order = [...CIRCLE_CONSTRAINTS.keys()];
  if (cached != null && cached >= 0 && cached < CIRCLE_CONSTRAINTS.length) {
    order.splice(order.indexOf(cached), 1);
    order.unshift(cached);
  }

  let lastErr: unknown;
  for (const index of order) {
    const constraints = CIRCLE_CONSTRAINTS[index]!;
    try {
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      writeCachedCircleConstraintIndex(index);
      return stream;
    } catch (e) {
      lastErr = e;
      if (isPermissionDenied(e)) throw e;
    }
  }
  throw lastErr ?? new Error("Camera unavailable");
}

export function useCircleRecorder() {
  const [recording, setRecording] = useState(false);
  const [duration, setDuration] = useState(0);
  const [previewStream, setPreviewStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const acquiredStreamRef = useRef<MediaStream | null>(null);
  const startTimeRef = useRef<number | null>(null);

  const cleanup = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    acquiredStreamRef.current?.getTracks().forEach((t) => t.stop());
    acquiredStreamRef.current = null;
    setPreviewStream(null);
    mediaRecorderRef.current = null;
    setRecording(false);
    setDuration(0);
    startTimeRef.current = null;
  }, []);

  useEffect(() => () => cleanup(), [cleanup]);

  const releaseAcquire = useCallback(() => {
    if (mediaRecorderRef.current) return;
    acquiredStreamRef.current?.getTracks().forEach((t) => t.stop());
    acquiredStreamRef.current = null;
    setPreviewStream(null);
  }, []);

  const acquire = useCallback(async (): Promise<boolean> => {
    if (mediaRecorderRef.current || acquiredStreamRef.current) return true;
    setError(null);
    try {
      const stream = await getCircleStream();
      acquiredStreamRef.current = stream;
      setPreviewStream(stream);
      return true;
    } catch (err) {
      console.error("Circle acquire failed:", err);
      setError(err instanceof Error ? err.message : "Не удалось открыть камеру");
      return false;
    }
  }, []);

  const begin = useCallback(async (): Promise<boolean> => {
    if (mediaRecorderRef.current) return true;
    setError(null);
    try {
      let stream = acquiredStreamRef.current;
      if (!stream) {
        const ok = await acquire();
        if (!ok) return false;
        stream = acquiredStreamRef.current;
      }
      if (!stream) return false;
      acquiredStreamRef.current = null;
      streamRef.current = stream;
      setPreviewStream(stream);

      const mime = pickCircleMime();
      const recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size) chunksRef.current.push(e.data);
      };
      mediaRecorderRef.current = recorder;
      recorder.start(250);
      setRecording(true);
      setDuration(0);
      const startTime = Date.now();
      startTimeRef.current = startTime;
      timerRef.current = setInterval(() => {
        const d = Math.floor((Date.now() - startTime) / 1000);
        setDuration(d);
      }, 200);
      return true;
    } catch (err) {
      console.error("Circle recording failed:", err);
      setError(err instanceof Error ? err.message : "Не удалось открыть камеру");
      cleanup();
      return false;
    }
  }, [acquire, cleanup]);

  const start = useCallback(async (): Promise<boolean> => {
    const ok = await acquire();
    if (!ok) return false;
    return begin();
  }, [acquire, begin]);

  const stop = useCallback((): Promise<{ blob: Blob; duration: number }> => {
    return new Promise((resolve) => {
      const recorder = mediaRecorderRef.current;
      if (!recorder || recorder.state === "inactive") {
        cleanup();
        resolve({ blob: new Blob(), duration: 0 });
        return;
      }
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      const startedAt = startTimeRef.current;
      const wallDuration = startedAt
        ? Math.max(1, Math.round((Date.now() - startedAt) / 1000))
        : 1;
      const mime = recorder.mimeType || pickCircleMime() || "video/webm";
      let finalized = false;
      const finish = () => {
        if (finalized) return;
        finalized = true;
        const blob = new Blob(chunksRef.current, { type: mime });
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        setPreviewStream(null);
        mediaRecorderRef.current = null;
        setRecording(false);
        setDuration(0);
        startTimeRef.current = null;
        resolve({ blob, duration: wallDuration });
      };
      recorder.onstop = () => {
        const delay = isSafariBrowser() ? 150 : 0;
        if (delay) setTimeout(finish, delay);
        else requestAnimationFrame(() => requestAnimationFrame(finish));
      };
      if (recorder.state === "recording") {
        recorder.requestData?.();
        recorder.stop();
      } else {
        finish();
      }
    });
  }, [cleanup]);

  const cancel = useCallback(() => {
    setError(null);
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state === "recording") {
      recorder.onstop = () => cleanup();
      recorder.stop();
    } else {
      cleanup();
    }
  }, [cleanup]);

  return {
    recording,
    duration,
    previewStream,
    error,
    acquire,
    begin,
    releaseAcquire,
    start,
    stop,
    cancel,
    maxDuration: MAX_DURATION,
  };
}
