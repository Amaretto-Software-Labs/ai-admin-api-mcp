import { describe, expect, it } from "vitest";
import type { CredentialResolver } from "@ai-admin-api-mcp/core";
import { AnthropicProvider } from "./provider.js";

const credentialResolver: CredentialResolver = {
  async resolve() {
    return {
      provider: "anthropic",
      credential_ref: null,
      type: "api_key",
      secret: "sk-ant-admin-test",
    };
  },
};

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("AnthropicProvider", () => {
  it("requires the speed beta header for speed usage dimensions", async () => {
    const provider = new AnthropicProvider({
      adminKey: "sk-ant-admin-test",
      fetchImpl: async () => jsonResponse({ data: [], has_more: false, next_page: null }),
    });

    await expect(
      provider.queryMessagesUsage(
        {
          start: "2026-06-01T00:00:00Z",
          end: "2026-06-02T00:00:00Z",
          group_by: ["speed"],
        },
        { credentialResolver, now: () => new Date("2026-06-13T10:15:00Z") },
      ),
    ).rejects.toMatchObject({ code: "validation_failed" });
  });

  it("normalizes message cache metrics", async () => {
    const provider = new AnthropicProvider({
      adminKey: "sk-ant-admin-test",
      fetchImpl: async () =>
        jsonResponse({
          data: [
            {
              starting_at: "2026-06-01T00:00:00Z",
              ending_at: "2026-06-02T00:00:00Z",
              results: [
                {
                  workspace_id: "wrkspc_123",
                  model: "claude-sonnet-4-6",
                  uncached_input_tokens: 100,
                  output_tokens: 50,
                  cache_creation_input_tokens: 25,
                  cache_read_input_tokens: 200,
                },
              ],
            },
          ],
          has_more: false,
          next_page: null,
        }),
    });

    const result = await provider.queryMessagesUsage(
      {
        start: "2026-06-01T00:00:00Z",
        end: "2026-06-02T00:00:00Z",
        group_by: ["workspace_id", "model"],
      },
      { credentialResolver, now: () => new Date("2026-06-13T10:15:00Z") },
    );

    expect(result.data.usage[0]?.metrics.input_tokens).toBe(100);
    expect(result.data.usage[0]?.metrics.cache_creation_input_tokens).toBe(25);
    expect(result.data.usage[0]?.metrics.cache_read_input_tokens).toBe(200);
  });

  it("normalizes cost decimal strings from cents to USD", async () => {
    const provider = new AnthropicProvider({
      adminKey: "sk-ant-admin-test",
      fetchImpl: async () =>
        jsonResponse({
          data: [
            {
              starting_at: "2026-06-01T00:00:00Z",
              ending_at: "2026-06-02T00:00:00Z",
              results: [
                {
                  workspace_id: "wrkspc_123",
                  description: "Input Tokens",
                  amount: "1234.56",
                },
              ],
            },
          ],
          has_more: false,
          next_page: null,
        }),
    });

    const result = await provider.queryCosts(
      {
        start: "2026-06-01T00:00:00Z",
        end: "2026-06-02T00:00:00Z",
        group_by: ["workspace_id", "description"],
      },
      { credentialResolver, now: () => new Date("2026-06-13T10:15:00Z") },
    );

    expect(result.data.costs[0]?.amount.value).toBeCloseTo(12.3456);
    expect(result.warnings.some((item) => item.code === "priority_tier_cost_gap")).toBe(true);
  });

  it("serializes context window filters with Anthropic's singular query key", async () => {
    let capturedUrl: string | null = null;
    const provider = new AnthropicProvider({
      adminKey: "sk-ant-admin-test",
      fetchImpl: async (request) => {
        capturedUrl = request instanceof URL ? request.toString() : String(request);
        return jsonResponse({ data: [], has_more: false, next_page: null });
      },
    });

    await provider.queryMessagesUsage(
      {
        start: "2026-06-01T00:00:00Z",
        end: "2026-06-02T00:00:00Z",
        filters: { context_windows: ["0-200k"] },
      },
      { credentialResolver, now: () => new Date("2026-06-13T10:15:00Z") },
    );

    const url = new URL(capturedUrl ?? "");
    expect(url.searchParams.getAll("context_window[]")).toEqual(["0-200k"]);
    expect(url.searchParams.getAll("context_windows[]")).toEqual([]);
  });
});
