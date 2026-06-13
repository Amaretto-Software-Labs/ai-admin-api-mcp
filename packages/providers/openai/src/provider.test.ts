import { describe, expect, it } from "vitest";
import type { CredentialResolver } from "@ai-admin-api-mcp/core";
import { AiAdminError } from "@ai-admin-api-mcp/core";
import { OpenAiProvider } from "./provider.js";

const credentialResolver: CredentialResolver = {
  async resolve() {
    return {
      provider: "openai",
      credential_ref: null,
      type: "bearer",
      secret: "sk-test",
    };
  },
};

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("OpenAiProvider", () => {
  it("rejects unsupported endpoint params instead of dropping them", async () => {
    const provider = new OpenAiProvider({
      adminKey: "sk-test",
      fetchImpl: async () => jsonResponse({ data: [], has_more: false, next_page: null }),
    });

    await expect(
      provider.queryUsage(
        {
          usage_endpoint: "vector_stores",
          start: "2026-06-01T00:00:00Z",
          end: "2026-06-02T00:00:00Z",
          group_by: ["model"],
          endpoint_params: { models: ["gpt-5.5"] },
        },
        { credentialResolver, now: () => new Date("2026-06-13T10:15:00Z") },
      ),
    ).rejects.toMatchObject({
      code: "validation_failed",
    });
  });

  it("normalizes image usage into common metrics and provider details", async () => {
    const provider = new OpenAiProvider({
      adminKey: "sk-test",
      fetchImpl: async () =>
        jsonResponse({
          data: [
            {
              start_time: 1780272000,
              end_time: 1780358400,
              results: [
                {
                  images: 2,
                  num_model_requests: 2,
                  project_id: "proj_123",
                  model: "gpt-image-1",
                  size: "1024x1024",
                  source: "image.generation",
                },
              ],
            },
          ],
          has_more: false,
          next_page: null,
        }),
    });

    const result = await provider.queryUsage(
      {
        usage_endpoint: "images",
        start: "2026-06-01T00:00:00Z",
        end: "2026-06-02T00:00:00Z",
        group_by: ["project_id", "model", "size", "source"],
        endpoint_params: { project_ids: ["proj_123"], sizes: ["1024x1024"] },
      },
      { credentialResolver, now: () => new Date("2026-06-13T10:15:00Z") },
    );

    expect(result.data.usage[0]?.metrics.image_count).toBe(2);
    expect(result.data.usage[0]?.metrics.request_count).toBe(2);
    expect(result.data.usage[0]?.provider_details).toEqual({
      openai: {
        usage_endpoint: "images",
        raw_metrics: {
          images: 2,
          num_model_requests: 2,
        },
        grouped_dimensions: {
          size: "1024x1024",
          source: "image.generation",
        },
      },
    });
  });

  it("serializes supported OpenAI query arrays", async () => {
    let capturedUrl: string | null = null;
    const provider = new OpenAiProvider({
      adminKey: "sk-test",
      fetchImpl: async (request) => {
        capturedUrl = request instanceof URL ? request.toString() : String(request);
        return jsonResponse({ data: [], has_more: false, next_page: null });
      },
    });

    await provider.queryUsage(
      {
        usage_endpoint: "completions",
        start: "2026-06-01T00:00:00Z",
        end: "2026-06-02T00:00:00Z",
        group_by: ["project_id", "model"],
        endpoint_params: { project_ids: ["proj_123", "proj_456"], batch: false },
      },
      { credentialResolver, now: () => new Date("2026-06-13T10:15:00Z") },
    );

    expect(capturedUrl).toContain("group_by=project_id");
    expect(capturedUrl).toContain("group_by=model");
    expect(capturedUrl).toContain("project_ids=proj_123");
    expect(capturedUrl).toContain("project_ids=proj_456");
    expect(capturedUrl).toContain("batch=false");
  });

  it("caches dashboard bundles by normalized input", async () => {
    let requestCount = 0;
    const provider = new OpenAiProvider({
      adminKey: "sk-test",
      cacheTtlSeconds: 60,
      fetchImpl: async () => {
        requestCount += 1;
        return jsonResponse({ data: [], has_more: false, next_page: null });
      },
    });
    const input = {
      start: "2026-06-01T00:00:00Z",
      end: "2026-06-02T00:00:00Z",
      bucket_width: "1d" as const,
    };

    const first = await provider.queryDashboardBundle(input, { credentialResolver, now: () => new Date("2026-06-13T10:15:00Z") });
    const second = await provider.queryDashboardBundle(input, { credentialResolver, now: () => new Date("2026-06-13T10:15:30Z") });

    expect(first.cache.status).toBe("miss");
    expect(second.cache.status).toBe("hit");
    expect(requestCount).toBe(2);
  });
});
