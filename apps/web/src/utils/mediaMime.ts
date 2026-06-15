export function extFromBlobType(mime: string, kind: "audio" | "video"): string {
  const base = mime.split(";")[0].trim().toLowerCase();
  if (base.includes("mp4") || base.includes("aac") || base.includes("m4a")) return kind === "audio" ? "m4a" : "mp4";
  if (base.includes("quicktime")) return "mov";
  if (base.includes("ogg")) return "ogg";
  if (base.includes("mpeg")) return "mp3";
  return kind === "audio" ? "webm" : "webm";
}

function isSafari(): boolean {
  const ua = navigator.userAgent;
  return /Safari/i.test(ua) && !/Chrome|Chromium|CriOS|FxiOS|Edg/i.test(ua);
}

export function pickVoiceMime(): string {
  const types = isSafari()
    ? ["audio/mp4", "audio/aac", "audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/ogg"]
    : ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus", "audio/ogg"];
  for (const t of types) {
    if (MediaRecorder.isTypeSupported(t)) return t;
  }
  return "";
}

export function pickCircleMime(): string {
  const types = isSafari()
    ? ["video/mp4", "video/mp4;codecs=avc1", "video/webm;codecs=vp8,opus", "video/webm"]
    : ["video/mp4", "video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm", "video/mp4;codecs=avc1"];
  for (const t of types) {
    if (MediaRecorder.isTypeSupported(t)) return t;
  }
  return "";
}

export function mimeFromMediaUrl(url: string, kind: "audio" | "video"): string {
  const path = url.split("?")[0].toLowerCase();
  if (path.endsWith(".mp4") || path.endsWith(".m4a")) return kind === "audio" ? "audio/mp4" : "video/mp4";
  if (path.endsWith(".mov")) return "video/quicktime";
  if (path.endsWith(".webm")) return kind === "audio" ? "audio/webm" : "video/webm";
  if (path.endsWith(".ogg")) return kind === "audio" ? "audio/ogg" : "video/ogg";
  if (path.endsWith(".mp3")) return "audio/mpeg";
  return kind === "audio" ? "audio/webm" : "video/webm";
}

export function canPlayMediaUrl(url: string, kind: "audio" | "video"): boolean {
  const el = document.createElement(kind === "audio" ? "audio" : "video");
  const mime = mimeFromMediaUrl(url, kind);
  const result = el.canPlayType(mime);
  return result === "probably" || result === "maybe";
}
