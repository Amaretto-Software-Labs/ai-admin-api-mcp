#!/usr/bin/env node
import { AiAdminError, safeErrorMessage } from "./core/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig, ensureRequiredProviders } from "./config.js";
import { startHttpServer } from "./http.js";
import { createAiAdminServer } from "./server.js";

interface CliArgs {
  mode: "stdio" | "http";
  port: number;
  tlsCertPath?: string;
  tlsKeyPath?: string;
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

  const listener = startHttpServer({
    config,
    port: args.port,
    ...(args.tlsCertPath === undefined || args.tlsKeyPath === undefined
      ? {}
      : { tls: { certPath: args.tlsCertPath, keyPath: args.tlsKeyPath } }),
    unsafeLocalHttp: args.unsafeLocalHttp,
  });
  await listener.ready;
  console.error(`ai-admin-api-mcp listening on ${listener.url}`);
}

function parseArgs(argv: string[]): CliArgs {
  let mode: "stdio" | "http" = "stdio";
  let port = 8787;
  let unsafeLocalHttp = false;
  let tlsCertPath = optionalString(process.env.MCP_HTTPS_CERT_PATH);
  let tlsKeyPath = optionalString(process.env.MCP_HTTPS_KEY_PATH);
  let wantsHttps = tlsCertPath !== undefined || tlsKeyPath !== undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--stdio") {
      mode = "stdio";
    } else if (arg === "--http") {
      mode = "http";
    } else if (arg === "--https") {
      mode = "http";
      wantsHttps = true;
    } else if (arg === "--port") {
      const next = argv[index + 1];
      if (next !== undefined) {
        port = parsePort(next);
        index += 1;
      }
    } else if (arg === "--tls-cert") {
      const next = argv[index + 1];
      if (next !== undefined) {
        tlsCertPath = next;
        wantsHttps = true;
        index += 1;
      }
    } else if (arg === "--tls-key") {
      const next = argv[index + 1];
      if (next !== undefined) {
        tlsKeyPath = next;
        wantsHttps = true;
        index += 1;
      }
    } else if (arg === "--unsafe-local-http") {
      unsafeLocalHttp = true;
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
  }

  if (wantsHttps && (tlsCertPath === undefined || tlsKeyPath === undefined)) {
    throw new AiAdminError("configuration_error", "HTTPS mode requires --tls-cert and --tls-key, or MCP_HTTPS_CERT_PATH and MCP_HTTPS_KEY_PATH");
  }

  return {
    mode,
    port,
    ...(tlsCertPath === undefined ? {} : { tlsCertPath }),
    ...(tlsKeyPath === undefined ? {} : { tlsKeyPath }),
    unsafeLocalHttp,
  };
}

function parsePort(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new AiAdminError("configuration_error", `Invalid port ${value}`);
  }
  return parsed;
}

function optionalString(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

function printHelp(): void {
  console.log(`ai-admin-api-mcp

Usage:
  ai-admin-api-mcp --stdio
  ai-admin-api-mcp --http --port 8787
  ai-admin-api-mcp --https --port 8787 --tls-cert ./dev.pem --tls-key ./dev.key

Environment:
  AI_ADMIN_ENABLED_PROVIDERS=openai,anthropic
  OPENAI_ADMIN_KEY=...
  ANTHROPIC_ADMIN_KEY=...
  MCP_HTTP_AUTH_TOKEN=...
  MCP_HTTPS_CERT_PATH=...
  MCP_HTTPS_KEY_PATH=...
`);
}

main().catch((error) => {
  console.error(safeErrorMessage(error));
  process.exit(1);
});
