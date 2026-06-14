import { describe, expect, it } from "vitest";
import { AiAdminError, makeCacheKey, paginateCursor, redactValue, toAiAdminError, toUnixSeconds, validateTimeRange } from "./index.js";

describe("time validation", () => {
  it("converts ISO UTC timestamps to Unix seconds", () => {
    expect(toUnixSeconds("2026-06-01T00:00:00Z")).toBe(1780272000);
  });

  it("rejects inverted ranges", () => {
    expect(() =>
      validateTimeRange({
        start: "2026-06-02T00:00:00Z",
        end: "2026-06-01T00:00:00Z",
        bucket_width: "1d",
      }),
    ).toThrow(/end must be after start/);
  });
});

describe("redaction", () => {
  it("redacts token-like fields recursively", () => {
    expect(
      redactValue({
        headers: { authorization: "Bearer abcdefghijklmnopqrstuvwxyz" },
        nested: [{ api_key: "sk-test_secret_value" }],
        dimensions: { api_key_id: "key_123" },
      }),
    ).toEqual({
      headers: { authorization: "[REDACTED]" },
      nested: [{ api_key: "[REDACTED]" }],
      dimensions: { api_key_id: "key_123" },
    });
  });

  it("redacts converted error messages and details without losing IDs", () => {
    const safe = toAiAdminError(
      new AiAdminError("auth_failed", "bad key sk-abcdefghijklmnopqrstuvwxyz", {
        api_key: "sk-abcdefghijklmnopqrstuvwxyz",
        api_key_id: "key_123",
      }),
    );

    expect(safe.message).toBe("bad key [REDACTED]");
    expect(safe.details).toEqual({
      api_key: "[REDACTED]",
      api_key_id: "key_123",
    });
  });
});

describe("cache keys", () => {
  it("stable-stringifies object keys", () => {
    expect(makeCacheKey({ b: 1, a: ["x", "y"] })).toBe(makeCacheKey({ a: ["x", "y"], b: 1 }));
  });
});

describe("pagination", () => {
  it("follows cursors until exhausted", async () => {
    const pages = await paginateCursor(
      async (page) => ({
        has_more: page === null,
        next_page: page === null ? "next" : null,
      }),
      5,
    );

    expect(pages.info.pages_fetched).toBe(2);
    expect(pages.info.truncated).toBe(false);
  });

  it("warns when max_pages truncates results", async () => {
    const pages = await paginateCursor(
      async () => ({
        has_more: true,
        next_page: "next",
      }),
      1,
    );

    expect(pages.info.truncated).toBe(true);
    expect(pages.warnings[0]?.code).toBe("pagination_truncated");
  });
});
