export type MessageSoundId = "incoming" | "outgoing" | "notification";

const STORAGE_KEY = "wm:message-sounds";

const SOUND_URLS: Record<MessageSoundId, string> = {
  incoming: "/sounds/incoming.wav",
  outgoing: "/sounds/outgoing.wav",
  notification: "/sounds/notification.wav",
};

const audioPool = new Map<MessageSoundId, HTMLAudioElement>();
let unlocked = false;

export function areMessageSoundsEnabled(): boolean {
  if (typeof localStorage === "undefined") return true;
  return localStorage.getItem(STORAGE_KEY) !== "0";
}

export function setMessageSoundsEnabled(enabled: boolean): void {
  localStorage.setItem(STORAGE_KEY, enabled ? "1" : "0");
}

function getAudio(id: MessageSoundId): HTMLAudioElement {
  let el = audioPool.get(id);
  if (!el) {
    el = new Audio(SOUND_URLS[id]);
    el.preload = "auto";
    audioPool.set(id, el);
  }
  return el;
}

function preloadAll(): void {
  for (const id of Object.keys(SOUND_URLS) as MessageSoundId[]) {
    const el = getAudio(id);
    el.load();
  }
}

/** Browsers block autoplay until a user gesture — call once after first click/key. */
export function unlockMessageSounds(): void {
  if (unlocked || typeof window === "undefined") return;
  unlocked = true;
  preloadAll();
}

export function playMessageSound(id: MessageSoundId): void {
  if (!areMessageSoundsEnabled() || typeof window === "undefined") return;
  try {
    const el = getAudio(id);
    el.currentTime = 0;
    void el.play().catch(() => {});
  } catch {
    // ignore playback errors
  }
}
