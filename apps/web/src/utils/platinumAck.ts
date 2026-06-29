const key = (userId: string) => `wm_platinum_ack_${userId}`;

/** Последний баланс, за который уже показали благодарность. */
export function getPlatinumAckBalance(userId: string): number | null {
  const raw = localStorage.getItem(key(userId));
  if (raw === null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export function setPlatinumAckBalance(userId: string, balance: number): void {
  localStorage.setItem(key(userId), String(Math.max(0, Math.floor(balance))));
}
