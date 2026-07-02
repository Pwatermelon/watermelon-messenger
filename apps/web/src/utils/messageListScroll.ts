import { findMessageElement } from "./chatUnread";

export function isPinnedToBottom(listEl: HTMLElement, slack = 8): boolean {
  return listEl.scrollHeight - listEl.scrollTop - listEl.clientHeight <= slack;
}

/** Scroll to the true bottom (scrollTop only — scrollIntoView fights touch/wheel on mobile). */
export function scrollListToBottom(listEl: HTMLElement, _endEl?: HTMLElement | null): void {
  const maxTop = Math.max(0, listEl.scrollHeight - listEl.clientHeight);
  if (Math.abs(listEl.scrollTop - maxTop) > 0.5) {
    listEl.scrollTop = maxTop;
  }
}

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
  const el = findMessageElement(listEl, messageId);
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

export function restorePrependScroll(listEl: HTMLElement, state: PrependScrollState): boolean {
  if (state.anchorMessageId) {
    const anchorTop = getMessageContentTop(listEl, state.anchorMessageId);
    if (anchorTop != null) {
      listEl.scrollTop = anchorTop + state.anchorOffset;
      return true;
    }
  }
  const delta = listEl.scrollHeight - state.scrollHeight;
  if (delta > 0) {
    listEl.scrollTop = state.scrollTop + delta;
    return true;
  }
  return false;
}
