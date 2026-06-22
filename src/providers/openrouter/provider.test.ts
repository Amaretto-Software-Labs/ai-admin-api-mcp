import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../../config.js";
import { StaticCredentialResolver } from "../../credentials.js";
import { BUILTIN_PROVIDER_PLUGINS } from "../../providers.js";
import { createAiAdminServer } from "../../server.js";
import type { CredentialResolver } from "../../core/index.js";
import { OpenRouterProvider } from "./provider.js";

const now = () => new Date("2026-06-22T12:00:00Z");

const managementCredentialResolver: CredentialResolver = {
  async resolve(request) {
    return {
      provider: "openrouter",
      credential_ref: request.credential_ref ?? "credential:openrouter:management",
      type: "bearer",
      secret: "or-mgmt-test",
    };
  },
};

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function analyticsMeta() {
  return {
    data: {
      dimensions: [{ name: "model" }, { name: "api_key_hash" }],
      granularities: [{ name: "day" }, { name: "hour" }],
      metrics: [{ name: "request_count" }, { name: "usage" }, { name: "prompt_tokens" }, { name: "completion_tokens" }],
      operators: [{ name: "eq" }],
    },
  };
}

describe("OpenRouterProvider", () => {
  it("sends bearer auth and optional attribution headers", async () => {
    let capturedAuthorization: string | null = null;
    let capturedReferer: string | null = null;
    let capturedTitle: string | null = null;
    const provider = new OpenRouterProvider({
      managementKey: "or-mgmt-test",
      httpReferer: "https://example.test",
      appTitle: "AI Admin Test",
      fetchImpl: async (_request, init) => {
        const headers = new Headers(init?.headers);
        capturedAuthorization = headers.get("Authorization");
        capturedReferer = headers.get("HTTP-Referer");
        capturedTitle = headers.get("X-Title");
        return jsonResponse({ data: { total_credits: 100, total_usage: 25 } });
      },
    });

    await provider.getCredits({}, { credentialResolver: managementCredentialResolver, now });

    expect(capturedAuthorization).toBe("Bearer or-mgmt-test");
    expect(capturedReferer).toBe("https://example.test");
    expect(capturedTitle).toBe("AI Admin Test");
  });

  it("requires a management key for management-only tools", async () => {
    const config = loadConfig({ OPENROUTER_API_KEY: "or-api-test" });
    const provider = new OpenRouterProvider({ apiKey: "or-api-test" });
    const resolver = new StaticCredentialResolver(config, BUILTIN_PROVIDER_PLUGINS);

    await expect(
      provider.getCredits({}, { credentialResolver: resolver, now }),
    ).rejects.toMatchObject({
      code: "configuration_error",
    });
  });

  it("validates analytics metrics against provider metadata before querying", async () => {
    let requestCount = 0;
    const provider = new OpenRouterProvider({
      managementKey: "or-mgmt-test",
      fetchImpl: async () => {
        requestCount += 1;
        return jsonResponse(analyticsMeta());
      },
    });

    await expect(
      provider.queryAnalytics(
        {
          metrics: ["not_a_metric"],
          dimensions: ["model"],
          time_range: {
            start: "2026-06-01T00:00:00Z",
            end: "2026-06-02T00:00:00Z",
          },
        },
        { credentialResolver: managementCredentialResolver, now },
      ),
    ).rejects.toMatchObject({
      code: "validation_failed",
    });
    expect(requestCount).toBe(1);
  });

  it("normalizes analytics rows and surfaces truncation", async () => {
    const provider = new OpenRouterProvider({
      managementKey: "or-mgmt-test",
      fetchImpl: async (request) => {
        const url = request instanceof URL ? request : new URL(String(request));
        if (url.pathname.endsWith("/analytics/meta")) {
          return jsonResponse(analyticsMeta());
        }
        return jsonResponse({
          data: {
            data: [
              {
                date__day: "2026-06-01T00:00:00.000Z",
                model: "openai/gpt-4.1",
                request_count: 7,
                prompt_tokens: 100,
                completion_tokens: 50,
                usage: 0.015,
              },
            ],
            metadata: { truncated: true, row_count: 1 },
          },
        });
      },
    });

    const result = await provider.queryAnalytics(
      {
        metrics: ["request_count", "usage", "prompt_tokens", "completion_tokens"],
        dimensions: ["model"],
        time_range: {
          start: "2026-06-01T00:00:00Z",
          end: "2026-06-02T00:00:00Z",
        },
      },
      { credentialResolver: managementCredentialResolver, now },
    );

    expect(result.warnings.map((item) => item.code)).toContain("truncated_response");
    expect(result.data.usage[0]?.metrics.request_count).toBe(7);
    expect(result.data.usage[0]?.metrics.input_tokens).toBe(100);
    expect(result.data.costs[0]?.amount.currency).toBe("openrouter_credit");
  });

  it("does not auto-fallback cost queries to provider-window activity without an exact date", async () => {
    const requestedPaths: string[] = [];
    const provider = new OpenRouterProvider({
      managementKey: "or-mgmt-test",
      fetchImpl: async (request) => {
        const url = request instanceof URL ? request : new URL(String(request));
        requestedPaths.push(url.pathname);
        return jsonResponse({
          data: {
            dimensions: [{ name: "model" }],
            granularities: [{ name: "day" }],
            metrics: [{ name: "request_count" }],
            operators: [{ name: "eq" }],
          },
        });
      },
    });

    const result = await provider.queryCosts(
      {
        start: "2026-06-01T00:00:00Z",
        end: "2026-06-10T00:00:00Z",
      },
      { credentialResolver: managementCredentialResolver, now },
    );

    expect(result.data.costs).toEqual([]);
    expect(result.warnings.map((item) => item.code)).toContain("activity_fallback_requires_date");
    expect(requestedPaths).toEqual(["/api/v1/analytics/meta"]);
  });

  it("rejects OpenRouter activity dates outside completed UTC window", async () => {
    const provider = new OpenRouterProvider({ managementKey: "or-mgmt-test" });

    await expect(
      provider.getActivity(
        { date: "2026-06-22" },
        { credentialResolver: managementCredentialResolver, now },
      ),
    ).rejects.toMatchObject({ code: "validation_failed" });

    await expect(
      provider.getActivity(
        { date: "2026-05-01" },
        { credentialResolver: managementCredentialResolver, now },
      ),
    ).rejects.toMatchObject({ code: "validation_failed" });
  });

  it("normalizes generation metadata without double-counting upstream cost", async () => {
    const provider = new OpenRouterProvider({
      apiKey: "or-api-test",
      fetchImpl: async () =>
        jsonResponse({
          data: {
            id: "gen-123",
            created_at: "2026-06-01T12:00:00Z",
            model: "anthropic/claude-sonnet-4.5",
            provider_name: "Anthropic",
            native_tokens_prompt: 20,
            native_tokens_completion: 30,
            total_cost: 0.002,
            upstream_inference_cost: 0.0015,
            request_id: "req-123",
          },
        }),
    });

    const result = await provider.getGeneration(
      { id: "gen-123" },
      { credentialResolver: managementCredentialResolver, now },
    );

    expect(result.data.usage).toHaveLength(1);
    expect(result.data.usage[0]?.metrics.input_tokens).toBe(20);
    expect(result.data.costs).toHaveLength(1);
    expect(result.data.costs[0]?.amount.value).toBe(0.002);
    expect(result.warnings.map((item) => item.code)).toContain("openrouter_upstream_cost_included_in_total");
  });

  it("returns model pricing metadata without producing cost facts", async () => {
    const provider = new OpenRouterProvider({
      apiKey: "or-api-test",
      fetchImpl: async () =>
        jsonResponse({
          data: [
            {
              id: "openai/gpt-4.1",
              pricing: {
                prompt: "0.00003",
                completion: "0.00006",
              },
            },
          ],
        }),
    });

    const result = await provider.listModels({}, { credentialResolver: managementCredentialResolver, now });

    expect((result.data as { models?: Array<{ pricing?: unknown }> }).models?.[0]?.pricing).toEqual({
      prompt: "0.00003",
      completion: "0.00006",
    });
    expect((result.data as { costs?: unknown }).costs).toBeUndefined();
    expect(result.warnings.map((item) => item.code)).toContain("catalog_pricing_not_spend");
  });
});

describe("OpenRouter MCP integration", () => {
  it("routes provider_options.openrouter through common usage tools", async () => {
    const requestedUrls: string[] = [];
    vi.stubGlobal("fetch", async (request: unknown) => {
      const url = request instanceof URL ? request : new URL(String(request));
      requestedUrls.push(url.toString());
      return jsonResponse({
        data: [
          {
            date: "2026-06-21",
            model: "openai/gpt-4.1",
            provider_name: "OpenAI",
            prompt_tokens: 10,
            completion_tokens: 5,
            requests: 1,
            usage: 0.001,
          },
        ],
      });
    });
    const runtime = createAiAdminServer(loadConfig({
      AI_ADMIN_ENABLED_PROVIDERS: "openrouter",
      OPENROUTER_MANAGEMENT_KEY: "or-mgmt-test",
    }));
    const client = new Client({ name: "openrouter-test-client", version: "0.1.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    try {
      await Promise.all([runtime.server.connect(serverTransport), client.connect(clientTransport)]);
      const tools = await client.listTools();
      const toolNames = tools.tools.map((tool) => tool.name);
      expect(toolNames).toContain("openrouter_admin_query_usage");
      expect(toolNames).not.toContain("openrouter_admin_create_api_key");
      expect(toolNames).not.toContain("openrouter_admin_delete_api_key");
      expect(toolNames).not.toContain("openrouter_admin_update_api_key");

      const usage = parseToolJson<{
        data: {
          results: {
            openrouter?: {
              data: {
                usage: Array<{ metrics: { request_count: number | null } }>;
              };
            };
          };
        };
      }>(await client.callTool({
        name: "ai_admin_query_usage",
        arguments: {
          providers: ["openrouter"],
          provider_options: {
            openrouter: {
              source: "activity",
              date: "2026-06-21",
            },
          },
          start: "2026-06-21T00:00:00Z",
          end: "2026-06-22T00:00:00Z",
          bucket_width: "1d",
        },
      }));

      expect(usage.data.results.openrouter?.data.usage[0]?.metrics.request_count).toBe(1);
      expect(requestedUrls.some((url) => url.includes("/activity?date=2026-06-21"))).toBe(true);
    } finally {
      await client.close();
      await runtime.server.close();
    }
  });
});

function parseToolJson<T>(result: unknown): T {
  const toolResult = result as { isError?: boolean; content?: unknown; structuredContent?: unknown };
  expect(toolResult.isError).not.toBe(true);
  if (toolResult.structuredContent !== undefined) {
    return toolResult.structuredContent as T;
  }

  expect(Array.isArray(toolResult.content)).toBe(true);
  const content = (toolResult.content as unknown[])[0] as { type?: unknown; text?: unknown } | undefined;
  expect(content?.type).toBe("text");
  expect(typeof content?.text).toBe("string");
  return JSON.parse(content?.text as string) as T;
}
