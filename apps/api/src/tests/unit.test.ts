import { describe, expect, test } from "bun:test";
import { parseProfilePhotos } from "../lib/userDto";
import {
  parseYandexAccountId,
  resolveRedirectUri,
  resolveVerifiedYandexEmail,
  YandexOAuthError,
} from "../services/yandexOAuth";

describe("parseProfilePhotos", () => {
  test("returns empty for null", () => {
    expect(parseProfilePhotos(null)).toEqual([]);
  });

  test("parses valid JSON array", () => {
    expect(parseProfilePhotos('["/uploads/a.jpg","/uploads/b.jpg"]')).toEqual([
      "/uploads/a.jpg",
      "/uploads/b.jpg",
    ]);
  });

  test("filters non-strings and limits to 12", () => {
    const arr = Array.from({ length: 15 }, (_, i) => `/p${i}.jpg`);
    expect(parseProfilePhotos(JSON.stringify([...arr, 42, null]))).toHaveLength(12);
  });

  test("returns empty on invalid JSON", () => {
    expect(parseProfilePhotos("{bad")).toEqual([]);
  });
});

describe("yandex redirect uri", () => {
  test("allows default web redirect", () => {
    expect(resolveRedirectUri(undefined)).toContain("/auth/yandex/callback");
  });

  test("rejects unknown redirect", () => {
    expect(() => resolveRedirectUri("https://evil.com/callback")).toThrow("not allowed");
  });
});

describe("yandex registration identity", () => {
  test("normalizes verified email", () => {
    expect(resolveVerifiedYandexEmail({ default_email: " Ivan@Mail.ru " })).toBe("ivan@mail.ru");
  });

  test("treats blank default_email as missing", () => {
    expect(resolveVerifiedYandexEmail({ default_email: "   " })).toBeNull();
    expect(resolveVerifiedYandexEmail({})).toBeNull();
  });

  test("rejects invalid yandex ids", () => {
    expect(() => parseYandexAccountId(undefined)).toThrow("missing");
    expect(() => parseYandexAccountId("")).toThrow("invalid");
    expect(parseYandexAccountId(123456)).toBe("123456");
  });

  test("oauth errors expose stable codes", () => {
    const err = new YandexOAuthError("no_email", "Нужна почта");
    expect(err.code).toBe("no_email");
    expect(err.message).toBe("Нужна почта");
  });
});

describe("rate limit key", () => {
  test("extracts first forwarded IP", async () => {
    const { clientKey } = await import("../middleware/rateLimit");
    const req = new Request("http://localhost/", {
      headers: { "x-forwarded-for": "1.2.3.4, 5.6.7.8" },
    });
    expect(clientKey(req)).toBe("1.2.3.4");
  });
});
