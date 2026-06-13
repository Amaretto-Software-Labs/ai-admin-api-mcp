#!/usr/bin/env node
import { AiAdminError, safeErrorMessage } from "@ai-admin-api-mcp/core";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig, ensureRequiredProviders } from "./config.js";
import { startHttpServer } from "./http.js";
import { createAiAdminServer } from "./server.js";

interface CliArgs {
  mode: "stdio" | "http";
  port: number;
  unsafeLocalHttp: boolean;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const config = loadConfig();
  ensureRequiredProviders(config);

  if (args.mode === "stdio") {
    const runtime = createAiAdminServer(config);
    await runtime.server.connect(new StdioServerTransport());
    return;
  }

  startHttpServer({
    config,
    port: args.port,
    unsafeLocalHttp: args.unsafeLocalHttp,
  });
  console.error(`ai-admin-api-mcp listening on http://127.0.0.1:${args.port}/mcp`);
}

function parseArgs(argv: string[]): CliArgs {
  let mode: "stdio" | "http" = "stdio";
  let port = 8787;
  let unsafeLocalHttp = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--stdio") {
      mode = "stdio";
    } else if (arg === "--http") {
      mode = "http";
    } else if (arg === "--port") {
      const next = argv[index + 1];
      if (next !== undefined) {
        port = parsePort(next);
        index += 1;
      }
    } else if (arg === "--unsafe-local-http") {
      unsafeLocalHttp = true;
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
  }

  return { mode, port, unsafeLocalHttp };
}

function parsePort(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new AiAdminError("configuration_error", `Invalid port ${value}`);
  }
  return parsed;
}

function printHelp(): void {
  console.log(`ai-admin-api-mcp

Usage:
  ai-admin-api-mcp --stdio
  ai-admin-api-mcp --http --port 8787

Environment:
  AI_ADMIN_ENABLED_PROVIDERS=openai,anthropic
  OPENAI_ADMIN_KEY=...
  ANTHROPIC_ADMIN_KEY=...
  MCP_HTTP_AUTH_TOKEN=...
`);
}

main().catch((error) => {
  console.error(safeErrorMessage(error));
  process.exit(1);
});
