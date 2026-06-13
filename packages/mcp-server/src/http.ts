import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { safeErrorMessage } from "@ai-admin-api-mcp/core";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { ServerConfig } from "./config.js";
import { createProviderRegistry } from "./providers.js";
import { createAiAdminServer } from "./server.js";

export interface HttpServerOptions {
  config: ServerConfig;
  port: number;
  unsafeLocalHttp?: boolean;
}

export interface StartedHttpServer {
  close: () => Promise<void>;
  port: number;
  ready: Promise<void>;
  url: string;
}

export function startHttpServer(options: HttpServerOptions): StartedHttpServer {
  const app = createMcpExpressApp();
  const registry = createProviderRegistry(options.config);

  app.post("/mcp", async (req: IncomingMessage & { body?: unknown }, res: ServerResponse & {
    status: (code: number) => { json: (body: unknown) => void };
    json: (body: unknown) => void;
  }) => {
    if (!isAuthorized(req.headers.authorization, options.config, options.unsafeLocalHttp ?? false)) {
      res.status(401).json({ error: "missing_or_invalid_bearer_token" });
      return;
    }

    const runtime = createAiAdminServer(options.config, { registry });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined } as never);
    try {
      await runtime.server.connect(transport as never);
      await transport.handleRequest(req, res, req.body);
      res.on("close", () => {
        void transport.close();
        void runtime.server.close();
      });
    } catch (error) {
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: {
            code: -32603,
            message: safeErrorMessage(error),
          },
          id: null,
        });
      }
    }
  });

  app.get("/mcp", (_req: IncomingMessage, res: ServerResponse & { status: (code: number) => { json: (body: unknown) => void } }) => {
    res.status(405).json({ error: "method_not_allowed" });
  });

  app.delete("/mcp", (_req: IncomingMessage, res: ServerResponse & { status: (code: number) => { json: (body: unknown) => void } }) => {
    res.status(405).json({ error: "method_not_allowed" });
  });

  const listener = app.listen(options.port, "127.0.0.1");
  const ready = listener.listening
    ? Promise.resolve()
    : new Promise<void>((resolve, reject) => {
      listener.once("listening", () => resolve());
      listener.once("error", reject);
    });
  const port = () => {
    const address = listener.address();
    return address !== null && typeof address !== "string" ? address.port : options.port;
  };
  return {
    get port() {
      return port();
    },
    ready,
    get url() {
      return `http://127.0.0.1:${port()}/mcp`;
    },
    close: () =>
      new Promise((resolve, reject) => {
        listener.close((error: Error | undefined) => (error ? reject(error) : resolve()));
      }),
  };
}

function isAuthorized(header: string | undefined, config: ServerConfig, unsafeLocalHttp: boolean): boolean {
  if (unsafeLocalHttp) {
    return true;
  }
  if (!config.httpAuthToken) {
    return false;
  }
  return header === `Bearer ${config.httpAuthToken}`;
}
