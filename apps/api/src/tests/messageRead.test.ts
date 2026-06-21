import { describe, expect, test } from "bun:test";
import { isMessageReadByCursor } from "../../../web/src/utils/messageRead";

describe("isMessageReadByCursor", () => {
  const msgId = "00000000-0000-0000-0000-000000000010";
  const laterId = "00000000-0000-0000-0000-000000000020";
  const msgAt = "2026-06-21T10:00:00.000Z";
  const readAt = "2026-06-21T10:00:02.000Z";
  const staleReadAt = "2026-06-21T09:00:00.000Z";

  test("cursor behind message is unread", () => {
    expect(isMessageReadByCursor(laterId, msgId, readAt, msgAt)).toBe(false);
  });

  test("exact cursor counts as read even with stale timestamp", () => {
    expect(isMessageReadByCursor(msgId, msgId, staleReadAt, msgAt)).toBe(true);
  });

  test("exact cursor without timestamps counts as read", () => {
    expect(isMessageReadByCursor(msgId, msgId)).toBe(true);
  });

  test("cursor ahead without timestamps is not read", () => {
    expect(isMessageReadByCursor(msgId, laterId)).toBe(false);
  });

  test("cursor ahead with stale timestamp is not read", () => {
    expect(isMessageReadByCursor(msgId, laterId, staleReadAt, msgAt)).toBe(false);
  });

  test("cursor ahead with valid read time counts earlier message as read", () => {
    expect(isMessageReadByCursor(msgId, laterId, readAt, msgAt)).toBe(true);
  });
});
