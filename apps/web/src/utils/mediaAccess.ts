export type RecordMediaKind = "voice" | "circle";

const CIRCLE_CONSTRAINTS_KEY = "wm_circle_constraints_v1";

export async function queryMediaPermission(
  name: "microphone" | "camera"
): Promise<PermissionState | "unknown"> {
  if (!navigator.permissions?.query) return "unknown";
  try {
    const result = await navigator.permissions.query({ name: name as PermissionName });
    return result.state;
  } catch {
    return "unknown";
  }
}

/** Запрашивать поток сразу на pointerdown — пока жест активен (Safari / «один раз»). */
export async function shouldAcquireMediaEarly(kind: RecordMediaKind): Promise<boolean> {
  if (kind === "circle") return true;
  const mic = await queryMediaPermission("microphone");
  return mic === "prompt" || mic === "unknown";
}

export function readCachedCircleConstraintIndex(): number | null {
  try {
    const raw = localStorage.getItem(CIRCLE_CONSTRAINTS_KEY);
    if (raw == null) return null;
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) && n >= 0 ? n : null;
  } catch {
    return null;
  }
}

export function writeCachedCircleConstraintIndex(index: number): void {
  try {
    localStorage.setItem(CIRCLE_CONSTRAINTS_KEY, String(index));
  } catch {}
}
