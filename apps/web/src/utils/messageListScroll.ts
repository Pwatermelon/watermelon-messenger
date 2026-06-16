export type PrependScrollState = {
  anchorMessageId: string | null;
  /** scrollTop − anchor content top at capture time */
  anchorOffset: number;
  scrollHeight: number;
  scrollTop: number;
};

function findFirstVisibleMessageId(listEl: HTMLElement): string | null {
  const listTop = listEl.getBoundingClientRect().top + 4;
  for (const el of listEl.querySelectorAll("[data-message-id]")) {
    const rect = el.getBoundingClientRect();
    if (rect.bottom > listTop) {
      return el.getAttribute("data-message-id");
    }
  }
  return null;
}

function getMessageContentTop(listEl: HTMLElement, messageId: string): number | null {
  const el = listEl.querySelector(`[data-message-id="${messageId}"]`) as HTMLElement | null;
  if (!el) return null;
  const listRect = listEl.getBoundingClientRect();
  const elRect = el.getBoundingClientRect();
  return elRect.top - listRect.top + listEl.scrollTop;
}

export function capturePrependScroll(listEl: HTMLElement): PrependScrollState {
  const anchorMessageId = findFirstVisibleMessageId(listEl);
  const anchorTop = anchorMessageId ? getMessageContentTop(listEl, anchorMessageId) : null;
  return {
    anchorMessageId,
    anchorOffset: anchorTop != null ? listEl.scrollTop - anchorTop : 0,
    scrollHeight: listEl.scrollHeight,
    scrollTop: listEl.scrollTop,
  };
}

export function restorePrependScroll(listEl: HTMLElement, state: PrependScrollState): void {
  if (state.anchorMessageId) {
    const anchorTop = getMessageContentTop(listEl, state.anchorMessageId);
    if (anchorTop != null) {
      listEl.scrollTop = anchorTop + state.anchorOffset;
      return;
    }
  }
  const delta = listEl.scrollHeight - state.scrollHeight;
  listEl.scrollTop = state.scrollTop + delta;
}
