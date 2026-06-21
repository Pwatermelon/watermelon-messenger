const UUID_RE =
  /^([0-9a-f]{8})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{12})$/i;

/** Extract TimeUUID timestamp (100-ns since UUID epoch). */
function timeUuid100ns(uuid: string): bigint | null {
  const m = uuid.trim().match(UUID_RE);
  if (!m) return null;
  const timeLow = BigInt(`0x${m[1]}`);
  const timeMid = BigInt(`0x${m[2]}`);
  const timeHi = BigInt(`0x${m[3]}`) & 0x0fffn;
  return (timeHi << 48n) | (timeMid << 32n) | timeLow;
}

/** Compare Scylla/Cassandra TimeUUID message ids (chronological). */
export function compareMessageId(a: string, b: string): number {
  const ta = timeUuid100ns(a);
  const tb = timeUuid100ns(b);
  if (ta !== null && tb !== null) {
    if (ta < tb) return -1;
    if (ta > tb) return 1;
  }
  const na = a.trim().toLowerCase();
  const nb = b.trim().toLowerCase();
  if (na < nb) return -1;
  if (na > nb) return 1;
  return 0;
}

export function isMessageIdNewer(a: string, b: string): boolean {
  return compareMessageId(a, b) > 0;
}
