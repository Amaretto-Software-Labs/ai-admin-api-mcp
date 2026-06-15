import { describe, expect, it } from "vitest";
import type { CredentialResolver } from "../../core/index.js";
import { ElevenLabsProvider } from "./provider.js";

const credentialResolver: CredentialResolver = {
  async resolve() {
    return {
      provider: "elevenlabs",
      credential_ref: null,
      type: "api_key",
      secret: "xi-test",
    };
  },
};

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("ElevenLabsProvider", () => {
  it("normalizes workspace analytics credit usage and sends documented request fields", async () => {
    let capturedUrl: string | null = null;
    let capturedBody: unknown = null;
    let capturedApiKey: string | null = null;
    const provider = new ElevenLabsProvider({
      apiKey: "xi-test",
      fetchImpl: async (request, init) => {
        capturedUrl = request instanceof URL ? request.toString() : String(request);
        capturedBody = JSON.parse(String(init?.body ?? "{}"));
        capturedApiKey = new Headers(init?.headers).get("xi-api-key");
        return jsonResponse({
          columns: ["time", "product_type", "model", "user_id", "hashed_xi_api_key", "credits", "request_count"],
          column_types: ["DateTime", "String", "String", "String", "String", "Float", "Int"],
          column_units: [null, null, null, null, null, "credits", null],
          rows: [["2026-06-01T00:00:00Z", "tts", "eleven_multilingual_v2", "user_123", "hash_abc", 42, 7]],
        });
      },
    });

    const result = await provider.queryUsage(
      {
        start: "2026-06-01T00:00:00Z",
        end: "2026-06-01T01:00:00Z",
        bucket_width: "1h",
        group_by: ["product_type", "model", "user_id", "hashed_xi_api_key"],
        filters: [{ column: "product_type", operation: "eq", values: ["tts"] }],
        time_zone: "UTC",
      },
      { credentialResolver, now: () => new Date("2026-06-13T10:15:00Z") },
    );

    expect(capturedUrl).toContain("/workspace/analytics/query/usage-by-product-over-time");
    expect(capturedApiKey).toBe("xi-test");
    expect(capturedBody).toEqual({
      start_time: 1780272000000,
      end_time: 1780275600000,
      interval_seconds: 3600,
      group_by: ["product_type", "model", "user_id", "hashed_xi_api_key"],
      filters: [{ column: "product_type", operation: "eq", values: ["tts"] }],
      time_zone: "UTC",
    });
    expect(result.data.usage[0]?.metrics.credit_count).toBe(42);
    expect(result.data.usage[0]?.metrics.request_count).toBe(7);
    expect(result.data.usage[0]?.dimensions).toMatchObject({
      api_key_id: "hash_abc",
      line_item: "tts",
      model: "eleven_multilingual_v2",
      user_id: "user_123",
    });
    expect(result.warnings.some((item) => item.code === "cost_not_available")).toBe(true);
  });

  it("rejects unsupported usage grouping before provider calls", async () => {
    let requested = false;
    const provider = new ElevenLabsProvider({
      apiKey: "xi-test",
      fetchImpl: async () => {
        requested = true;
        return jsonResponse({ columns: [], column_types: [], column_units: [], rows: [] });
      },
    });

    await expect(
      provider.queryUsage(
        {
          start: "2026-06-01T00:00:00Z",
          end: "2026-06-02T00:00:00Z",
          group_by: ["workspace_id"],
        },
        { credentialResolver, now: () => new Date("2026-06-13T10:15:00Z") },
      ),
    ).rejects.toMatchObject({ code: "validation_failed" });
    expect(requested).toBe(false);
  });

  it("lists service account API keys with the xi-api-key header", async () => {
    let capturedUrl: string | null = null;
    let capturedApiKey: string | null = null;
    const provider = new ElevenLabsProvider({
      apiKey: "xi-test",
      fetchImpl: async (request, init) => {
        capturedUrl = request instanceof URL ? request.toString() : String(request);
        capturedApiKey = new Headers(init?.headers).get("xi-api-key");
        return jsonResponse({ api_keys: [{ id: "key_123" }] });
      },
    });

    const result = await provider.listServiceAccountApiKeys(
      { service_account_user_id: "svc_123" },
      { credentialResolver, now: () => new Date("2026-06-13T10:15:00Z") },
    );

    expect(capturedUrl).toContain("/service-accounts/svc_123/api-keys");
    expect(capturedApiKey).toBe("xi-test");
    expect(result.data).toEqual({ api_keys: [{ id: "key_123" }] });
  });
});
