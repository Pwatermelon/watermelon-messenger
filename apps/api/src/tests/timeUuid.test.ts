import { describe, expect, test } from "bun:test";
import { compareMessageId, isMessageIdNewer } from "@melon/shared";

describe("compareMessageId", () => {
  test("orders test uuids chronologically", () => {
    const a = "00000000-0000-0000-0000-000000000010";
    const b = "00000000-0000-0000-0000-000000000020";
    expect(compareMessageId(a, b)).toBeLessThan(0);
    expect(compareMessageId(b, a)).toBeGreaterThan(0);
    expect(isMessageIdNewer(b, a)).toBe(true);
  });

  test("is case-insensitive for equal ids", () => {
    const lower = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    const upper = "AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE";
    expect(compareMessageId(lower, upper)).toBe(0);
  });
});
