import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";
import { startHttpServer } from "./http.js";

describe("Streamable HTTP transport", () => {
  it("requires bearer auth and serves MCP requests", async () => {
    const listener = startHttpServer({
      config: loadConfig({
        OPENAI_ADMIN_KEY: "sk-test",
        MCP_HTTP_AUTH_TOKEN: "local-token",
      }),
      port: 0,
    });

    try {
      await listener.ready;
      const unauthorized = await fetch(listener.url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/list",
          params: {},
        }),
      });
      expect(unauthorized.status).toBe(401);

      const client = new Client({ name: "http-test-client", version: "0.1.0" });
      const transport = new StreamableHTTPClientTransport(new URL(listener.url), {
        requestInit: {
          headers: {
            Authorization: "Bearer local-token",
          },
        },
      });

      try {
        await client.connect(transport as never);
        const tools = await client.listTools();
        expect(tools.tools.map((tool) => tool.name)).toContain("openai_admin_query_usage");

        const usage = parseToolJson<{ data: { warnings: { anthropic?: Array<{ code: string }> } } }>(
          await client.callTool({
            name: "ai_admin_query_usage",
            arguments: {
              providers: ["anthropic"],
              start: "2026-06-01T00:00:00Z",
              end: "2026-06-02T00:00:00Z",
              bucket_width: "1d",
            },
          }),
        );
        expect(usage.data.warnings.anthropic?.[0]?.code).toBe("provider_not_enabled");
      } finally {
        await client.close();
      }
    } finally {
      await listener.close();
    }
  });
});

function parseToolJson<T>(result: unknown): T {
  const toolResult = result as { isError?: boolean; content?: unknown };
  expect(toolResult.isError).not.toBe(true);
  expect(Array.isArray(toolResult.content)).toBe(true);
  const content = (toolResult.content as unknown[])[0] as { type?: unknown; text?: unknown } | undefined;
  expect(content?.type).toBe("text");
  expect(typeof content?.text).toBe("string");
  return JSON.parse(content?.text as string) as T;
}
