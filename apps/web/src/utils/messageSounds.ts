export type MessageSoundId = "incoming" | "outgoing" | "notification";

const STORAGE_KEY = "wm:message-sounds";
/** WAV-файлы записаны тихо — усиливаем выше лимита audio.volume (max 1). */
const PLAYBACK_GAIN = 2.8;

const SOUND_URLS: Record<MessageSoundId, string> = {
  incoming: "/sounds/incoming.wav",
  outgoing: "/sounds/outgoing.wav",
  notification: "/sounds/notification.wav",
};

const buffers = new Map<MessageSoundId, AudioBuffer>();
let audioCtx: AudioContext | null = null;
let unlocked = false;

export function areMessageSoundsEnabled(): boolean {
  if (typeof localStorage === "undefined") return true;
  return localStorage.getItem(STORAGE_KEY) !== "0";
}

export function setMessageSoundsEnabled(enabled: boolean): void {
  localStorage.setItem(STORAGE_KEY, enabled ? "1" : "0");
}

function getAudioContext(): AudioContext {
  if (!audioCtx) {
    audioCtx = new AudioContext();
  }
  return audioCtx;
}

async function ensureContextRunning(): Promise<AudioContext> {
  const ctx = getAudioContext();
  if (ctx.state === "suspended") {
    await ctx.resume();
  }
  return ctx;
}

async function loadBuffer(id: MessageSoundId): Promise<AudioBuffer> {
  const cached = buffers.get(id);
  if (cached) return cached;
  const res = await fetch(SOUND_URLS[id]);
  if (!res.ok) throw new Error(`Sound load failed: ${id}`);
  const data = await res.arrayBuffer();
  const ctx = await ensureContextRunning();
  const buffer = await ctx.decodeAudioData(data);
  buffers.set(id, buffer);
  return buffer;
}

function preloadAll(): void {
  for (const id of Object.keys(SOUND_URLS) as MessageSoundId[]) {
    void loadBuffer(id).catch(() => {});
  }
}

/** Browsers block autoplay until a user gesture — call once after first click/key. */
export function unlockMessageSounds(): void {
  if (unlocked || typeof window === "undefined") return;
  unlocked = true;
  void ensureContextRunning().then(() => preloadAll());
}

export function playMessageSound(id: MessageSoundId): void {
  if (!areMessageSoundsEnabled() || typeof window === "undefined") return;
  void (async () => {
    try {
      const ctx = await ensureContextRunning();
      const buffer = await loadBuffer(id);
      const source = ctx.createBufferSource();
      const gain = ctx.createGain();
      source.buffer = buffer;
      gain.gain.value = PLAYBACK_GAIN;
      source.connect(gain);
      gain.connect(ctx.destination);
      source.start(0);
    } catch {
      // ignore playback errors (autoplay policy, missing file, etc.)
    }
  })();
}
