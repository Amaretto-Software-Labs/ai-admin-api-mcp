import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";
import { createAiAdminServer } from "./server.js";

describe("MCP server", () => {
  it("exposes provider resources and calls enabled provider tools", async () => {
    const requests: string[] = [];

    await withFixtureServer((url, request, response) => {
      requests.push(url.toString());

      if (url.pathname === "/openai/v1/organization/usage/images") {
        expect(request.headers.authorization).toBe("Bearer sk-test");
        sendJson(response, 200, {
          data: [
            {
              start_time: 1780272000,
              end_time: 1780358400,
              results: [
                {
                  project_id: "proj_mcp",
                  model: "gpt-image-1",
                  images: 3,
                  num_model_requests: 3,
                },
              ],
            },
          ],
          has_more: false,
          next_page: null,
        });
        return;
      }

      if (url.pathname === "/anthropic/v1/organizations/usage_report/messages") {
        expect(request.headers["x-api-key"]).toBe("sk-ant-admin-test");
        sendJson(response, 200, {
          data: [
            {
              starting_at: "2026-06-01T00:00:00Z",
              ending_at: "2026-06-02T00:00:00Z",
              results: [
                {
                  workspace_id: "wrkspc_mcp",
                  model: "claude-sonnet-4-6",
                  uncached_input_tokens: 10,
                  output_tokens: 4,
                },
              ],
            },
          ],
          has_more: false,
          next_page: null,
        });
        return;
      }

      sendJson(response, 404, { error: { message: `Unhandled fixture path ${url.pathname}` } });
    }, async (baseUrl) => {
      const runtime = createAiAdminServer(loadConfig({
        OPENAI_ADMIN_KEY: "sk-test",
        OPENAI_BASE_URL: `${baseUrl}/openai/v1`,
        ANTHROPIC_ADMIN_KEY: "sk-ant-admin-test",
        ANTHROPIC_BASE_URL: `${baseUrl}/anthropic/v1`,
      }));
      const client = new Client({ name: "mcp-test-client", version: "0.1.0" });
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

      try {
        await Promise.all([runtime.server.connect(serverTransport), client.connect(clientTransport)]);

        const tools = await client.listTools();
        const toolNames = tools.tools.map((tool) => tool.name);
        expect(toolNames).toContain("openai_admin_query_usage");
        expect(toolNames).toContain("anthropic_admin_query_messages_usage");

        const prompts = await client.listPrompts();
        expect(prompts.prompts.map((prompt) => prompt.name)).toEqual(expect.arrayContaining([
          "build_usage_dashboard",
          "investigate_cost_spike",
          "export_finance_report",
        ]));

        const resources = await client.listResources();
        expect(resources.resources.map((resource) => resource.uri)).toContain("ai-admin://providers");

        const resourceTemplates = await client.listResourceTemplates();
        expect(resourceTemplates.resourceTemplates.map((template) => template.uriTemplate)).toContain("ai-admin://providers/{provider}/capabilities");

        const providersResource = await client.readResource({ uri: "ai-admin://providers" });
        const providersContent = providersResource.contents[0];
        const providersText = providersContent && "text" in providersContent ? providersContent.text : null;
        expect(providersText).not.toBeNull();
        const providers = JSON.parse(providersText ?? "[]") as Array<{ provider: string; status: string }>;
        expect(providers).toEqual(expect.arrayContaining([
          expect.objectContaining({ provider: "openai", status: "enabled" }),
          expect.objectContaining({ provider: "anthropic", status: "enabled" }),
          expect.objectContaining({ provider: "google-cloud-billing", status: "planned" }),
        ]));

        const openAiResult = parseToolJson<{ data: { usage: Array<{ metrics: { image_count: number | null } }> } }>(
          await client.callTool({
            name: "openai_admin_query_usage",
            arguments: {
              usage_endpoint: "images",
              start: "2026-06-01T00:00:00Z",
              end: "2026-06-02T00:00:00Z",
              group_by: ["project_id", "model"],
              endpoint_params: { project_ids: ["proj_mcp"] },
            },
          }),
        );

        expect(openAiResult.data.usage[0]?.metrics.image_count).toBe(3);

        const anthropicResult = parseToolJson<{ data: { usage: Array<{ metrics: { input_tokens: number | null; output_tokens: number | null } }> } }>(
          await client.callTool({
            name: "anthropic_admin_query_messages_usage",
            arguments: {
              start: "2026-06-01T00:00:00Z",
              end: "2026-06-02T00:00:00Z",
              group_by: ["workspace_id", "model"],
            },
          }),
        );

        expect(anthropicResult.data.usage[0]?.metrics.input_tokens).toBe(10);
        expect(anthropicResult.data.usage[0]?.metrics.output_tokens).toBe(4);
        expect(JSON.stringify(openAiResult)).not.toContain("sk-test");
        expect(JSON.stringify(anthropicResult)).not.toContain("sk-ant-admin-test");
      } finally {
        await client.close();
        await runtime.server.close();
      }
    });

    expect(requests).toEqual(expect.arrayContaining([
      expect.stringContaining("/openai/v1/organization/usage/images"),
      expect.stringContaining("/anthropic/v1/organizations/usage_report/messages"),
    ]));
  });
});

async function withFixtureServer<T>(
  route: (url: URL, request: IncomingMessage, response: ServerResponse) => void,
  run: (baseUrl: string) => Promise<T>,
): Promise<T> {
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    route(url, request, response);
  });
  await listen(server);
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Fixture server did not bind to a TCP port");
  }

  try {
    return await run(`http://127.0.0.1:${(address as AddressInfo).port}`);
  } finally {
    await close(server);
  }
}

async function listen(server: HttpServer): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
}

async function close(server: HttpServer): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

function parseToolJson<T>(result: unknown): T {
  const toolResult = result as { isError?: boolean; content?: unknown };
  expect(toolResult.isError).not.toBe(true);
  expect(Array.isArray(toolResult.content)).toBe(true);
  const content = (toolResult.content as unknown[])[0] as { type?: unknown; text?: unknown } | undefined;
  expect(content?.type).toBe("text");
  expect(typeof content?.text).toBe("string");
  return JSON.parse(content?.text as string) as T;
}
