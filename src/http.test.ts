import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { request as httpsRequest } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

      const sseAbort = new AbortController();
      const sse = await fetch(listener.url, {
        method: "GET",
        headers: {
          accept: "text/event-stream",
          authorization: "Bearer local-token",
        },
        signal: sseAbort.signal,
      });
      expect(sse.status).toBe(200);
      expect(sse.headers.get("content-type")).toContain("text/event-stream");
      sseAbort.abort();

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

  it("can serve the MCP endpoint over HTTPS with PEM certificate files", async () => {
    if (!hasOpenSsl()) {
      return;
    }

    const certs = createTemporaryCertificate();
    const listener = startHttpServer({
      config: loadConfig({
        OPENAI_ADMIN_KEY: "sk-test",
        MCP_HTTP_AUTH_TOKEN: "local-token",
      }),
      port: 0,
      tls: {
        certPath: certs.certPath,
        keyPath: certs.keyPath,
      },
    });

    try {
      await listener.ready;
      expect(listener.url.startsWith("https://")).toBe(true);
      const status = await postStatus(listener.url);
      expect(status).toBe(401);
    } finally {
      await listener.close();
      certs.cleanup();
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

function hasOpenSsl(): boolean {
  try {
    execFileSync("openssl", ["version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function createTemporaryCertificate(): { certPath: string; keyPath: string; cleanup: () => void } {
  const directory = mkdtempSync(join(tmpdir(), "ai-admin-api-mcp-tls-"));
  const certPath = join(directory, "localhost.pem");
  const keyPath = join(directory, "localhost.key");
  execFileSync("openssl", [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-keyout",
    keyPath,
    "-out",
    certPath,
    "-subj",
    "/CN=localhost",
    "-addext",
    "subjectAltName=DNS:localhost,IP:127.0.0.1",
    "-days",
    "1",
  ], { stdio: "ignore" });

  return {
    certPath,
    keyPath,
    cleanup: () => rmSync(directory, { recursive: true, force: true }),
  };
}

async function postStatus(url: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const request = httpsRequest(url, {
      method: "POST",
      rejectUnauthorized: false,
      headers: { "content-type": "application/json" },
    }, (response) => {
      response.resume();
      response.on("end", () => resolve(response.statusCode ?? 0));
    });
    request.on("error", reject);
    request.end(JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
      params: {},
    }));
  });
}
