const MONTHS_RU = [
  "января",
  "февраля",
  "марта",
  "апреля",
  "мая",
  "июня",
  "июля",
  "августа",
  "сентября",
  "октября",
  "ноября",
  "декабря",
];

function startOfLocalDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

export function messageDayKey(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

export function formatMessageDateLabel(iso: string | null | undefined, now = new Date()): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;

  const today = startOfLocalDay(now);
  const day = startOfLocalDay(d);
  const diffDays = Math.round((today - day) / 86_400_000);

  if (diffDays === 0) return "Сегодня";
  if (diffDays === 1) return "Вчера";

  const dayNum = d.getDate();
  const month = MONTHS_RU[d.getMonth()] ?? "";
  if (d.getFullYear() === now.getFullYear()) {
    return `${dayNum} ${month}`;
  }
  return `${dayNum} ${month} ${d.getFullYear()}`;
}

export function shouldShowDateDivider(
  currentIso: string | null | undefined,
  previousIso: string | null | undefined
): boolean {
  const cur = messageDayKey(currentIso);
  if (!cur) return false;
  if (!previousIso) return true;
  return messageDayKey(previousIso) !== cur;
}
