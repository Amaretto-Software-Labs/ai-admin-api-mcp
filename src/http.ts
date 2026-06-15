import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { safeErrorMessage } from "./core/index.js";
import { readFileSync } from "node:fs";
import type { IncomingMessage, Server as NodeHttpServer, ServerResponse } from "node:http";
import { createServer as createHttpsServer, type ServerOptions as HttpsServerOptions } from "node:https";
import type { ServerConfig } from "./config.js";
import { createProviderRegistryWithPlugins } from "./providers.js";
import { createAiAdminServer } from "./server.js";

type McpRequest = IncomingMessage & { body?: unknown };
type JsonResponse = ServerResponse & {
  status: (code: number) => { json: (body: unknown) => void };
  json: (body: unknown) => void;
};

export interface TlsFileOptions {
  certPath: string;
  keyPath: string;
}

export interface HttpServerOptions {
  config: ServerConfig;
  port: number;
  host?: string;
  tls?: TlsFileOptions;
  unsafeLocalHttp?: boolean;
}

export interface StartedHttpServer {
  close: () => Promise<void>;
  port: number;
  ready: Promise<void>;
  url: string;
}

export async function startHttpServer(options: HttpServerOptions): Promise<StartedHttpServer> {
  const app = createMcpExpressApp();
  const registry = await createProviderRegistryWithPlugins(options.config);
  const host = options.host ?? "127.0.0.1";
  const scheme = options.tls === undefined ? "http" : "https";

  const handleMcpRequest = async (req: McpRequest, res: JsonResponse) => {
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
  };

  app.post("/mcp", handleMcpRequest);
  app.get("/mcp", handleMcpRequest);
  app.delete("/mcp", handleMcpRequest);

  const listener: NodeHttpServer = options.tls === undefined
    ? app.listen(options.port, host)
    : createHttpsServer(loadTlsOptions(options.tls), app as never).listen(options.port, host);
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
      return `${scheme}://${host}:${port()}/mcp`;
    },
    close: () =>
      new Promise((resolve, reject) => {
        listener.close((error: Error | undefined) => (error ? reject(error) : resolve()));
      }),
  };
}

function loadTlsOptions(options: TlsFileOptions): HttpsServerOptions {
  return {
    cert: readFileSync(options.certPath),
    key: readFileSync(options.keyPath),
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
