import { describe, expect, test } from "bun:test";
import {
  isMessageReadByCursor,
  mergeReadCursor,
} from "../../../web/src/utils/messageRead";

describe("isMessageReadByCursor", () => {
  const msgId = "00000000-0000-0000-0000-000000000010";
  const laterId = "00000000-0000-0000-0000-000000000020";

  test("no cursor means unread", () => {
    expect(isMessageReadByCursor(msgId, null)).toBe(false);
  });

  test("exact cursor is read", () => {
    expect(isMessageReadByCursor(msgId, msgId)).toBe(true);
  });

  test("cursor ahead means earlier message is read", () => {
    expect(isMessageReadByCursor(msgId, laterId)).toBe(true);
  });

  test("cursor behind means unread", () => {
    expect(isMessageReadByCursor(laterId, msgId)).toBe(false);
  });
});

describe("mergeReadCursor", () => {
  test("takes newer id", () => {
    const a = "00000000-0000-0000-0000-000000000010";
    const b = "00000000-0000-0000-0000-000000000020";
    expect(mergeReadCursor(a, b)).toBe(b);
    expect(mergeReadCursor(b, a)).toBe(b);
  });
});
