/** Only one voice/circle player at a time. */
let activeStop: (() => void) | null = null;

export function claimMediaPlayback(stop: () => void): void {
  if (activeStop && activeStop !== stop) activeStop();
  activeStop = stop;
}

export function releaseMediaPlayback(stop: () => void): void {
  if (activeStop === stop) activeStop = null;
}
