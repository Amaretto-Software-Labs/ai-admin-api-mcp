import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";
import { createProviderRegistryWithPlugins } from "./providers.js";
import { createAiAdminServerWithPlugins } from "./server.js";

describe("provider plugin system", () => {
  it("loads external provider plugins and routes common usage through the runtime", async () => {
    const config = loadConfig({
      AI_ADMIN_PROVIDER_PLUGINS: "./src/test-fixtures/fixture-provider-plugin.mjs",
      FIXTURE_PROVIDER_ENABLED: "true",
    });
    const registry = await createProviderRegistryWithPlugins(config);

    expect(Array.from(registry.providers.keys())).toContain("fixture-provider");
    expect(registry.capabilities).toEqual(expect.arrayContaining([
      expect.objectContaining({ provider: "fixture-provider", status: "enabled" }),
    ]));
  });

  it("exposes external plugin tools through MCP", async () => {
    const runtime = await createAiAdminServerWithPlugins(loadConfig({
      AI_ADMIN_PROVIDER_PLUGINS: "./src/test-fixtures/fixture-provider-plugin.mjs",
      AI_ADMIN_ENABLED_PROVIDERS: "fixture-provider",
    }));
    const client = new Client({ name: "plugin-test-client", version: "0.1.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    try {
      await Promise.all([runtime.server.connect(serverTransport), client.connect(clientTransport)]);
      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name)).toContain("fixture_provider_ping");

      const usage = parseToolJson<{ data: { results: { "fixture-provider"?: { data: { marker: string | null } } } } }>(
        await client.callTool({
          name: "ai_admin_query_usage",
          arguments: {
            providers: ["fixture-provider"],
            provider_options: {
              "fixture-provider": { marker: "from-common-tool" },
            },
            start: "2026-06-01T00:00:00Z",
            end: "2026-06-02T00:00:00Z",
            bucket_width: "1d",
          },
        }),
      );
      expect(usage.data.results["fixture-provider"]?.data.marker).toBe("from-common-tool");
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
