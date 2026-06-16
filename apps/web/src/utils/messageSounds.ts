export type MessageSoundId = "incoming" | "outgoing" | "notification";

const STORAGE_KEY = "wm:message-sounds";

const SOUND_URLS: Record<MessageSoundId, string> = {
  incoming: "/sounds/incoming.wav",
  outgoing: "/sounds/outgoing.wav",
  notification: "/sounds/notification.wav",
};

const pool = new Map<MessageSoundId, HTMLAudioElement>();
let unlocked = false;

export function areMessageSoundsEnabled(): boolean {
  if (typeof localStorage === "undefined") return true;
  return localStorage.getItem(STORAGE_KEY) !== "0";
}

export function setMessageSoundsEnabled(enabled: boolean): void {
  localStorage.setItem(STORAGE_KEY, enabled ? "1" : "0");
}

function getAudio(id: MessageSoundId): HTMLAudioElement {
  let audio = pool.get(id);
  if (!audio) {
    audio = new Audio(SOUND_URLS[id]);
    audio.preload = "auto";
    pool.set(id, audio);
  }
  return audio;
}

/** Browsers block autoplay until a user gesture — call once after first click/key. */
export function unlockMessageSounds(): void {
  if (unlocked || typeof window === "undefined") return;
  unlocked = true;
  for (const id of Object.keys(SOUND_URLS) as MessageSoundId[]) {
    const audio = getAudio(id);
    const prevVolume = audio.volume;
    audio.volume = 0;
    void audio
      .play()
      .then(() => {
        audio.pause();
        audio.currentTime = 0;
        audio.volume = prevVolume;
      })
      .catch(() => {
        audio.volume = prevVolume;
      });
  }
}

export function playMessageSound(id: MessageSoundId): void {
  if (!areMessageSoundsEnabled() || typeof window === "undefined") return;
  const audio = getAudio(id);
  audio.currentTime = 0;
  void audio.play().catch(() => {});
}
