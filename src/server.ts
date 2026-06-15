import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import { envelope, lastCompleteDaysRange, safeErrorMessage, type ProviderId, type QueryContext, type Warning } from "./core/index.js";
import { ensureSupportedCredentialMode, type ServerConfig } from "./config.js";
import { StaticCredentialResolver } from "./credentials.js";
import { createProviderRegistry, createProviderRegistryWithPlugins, type ProviderRegistry, type ProviderRegistryOptions } from "./providers.js";
import type { ProviderResourceRegistrar, ProviderToolRegistrar } from "./plugin.js";
import { asToolResult } from "./tool-result.js";

export interface AiAdminServerRuntime {
  server: McpServer;
  registry: ProviderRegistry;
}

export interface AiAdminServerOptions extends ProviderRegistryOptions {
  registry?: ProviderRegistry;
}

const providerListSchema = z.array(z.string()).optional();
const credentialRefsSchema = z.record(z.string(), z.string()).optional();
const providerOptionsSchema = z.record(z.string(), z.record(z.string(), z.unknown())).optional();

export function createAiAdminServer(config: ServerConfig, options: AiAdminServerOptions = {}): AiAdminServerRuntime {
  const registry = options.registry ?? createProviderRegistry(config, options);
  return createAiAdminServerFromRegistry(config, registry);
}

export async function createAiAdminServerWithPlugins(config: ServerConfig, options: AiAdminServerOptions = {}): Promise<AiAdminServerRuntime> {
  const registry = options.registry ?? await createProviderRegistryWithPlugins(config, options);
  return createAiAdminServerFromRegistry(config, registry);
}

function createAiAdminServerFromRegistry(config: ServerConfig, registry: ProviderRegistry): AiAdminServerRuntime {
  ensureSupportedCredentialMode(config);
  const credentialResolver = new StaticCredentialResolver(config, registry.plugins);
  const context = (): QueryContext => ({
    credentialResolver,
    now: () => new Date(),
    ...(config.userAgent === undefined ? {} : { userAgent: config.userAgent }),
  });
  const server = new McpServer(
    {
      name: "ai-admin-api-mcp",
      version: "0.1.0",
    },
    {
      capabilities: {
        logging: {},
      },
    },
  );

  registerResources(server, registry);
  registerPrompts(server);
  registerCommonTools(server, registry, context);
  registerProviderExtensions(server, registry, context);

  return { server, registry };
}

function registerResources(server: McpServer, registry: ProviderRegistry): void {
  const resourceRegistrar = resourceRegistrarFor(server);
  resourceRegistrar.registerJsonResource("providers", "ai-admin://providers", () => registry.capabilities);
  resourceRegistrar.registerJsonResource("provider-capability-schema", "ai-admin://schema/provider-capability-v1", providerCapabilitySchema);
  resourceRegistrar.registerJsonResource("usage-fact-schema", "ai-admin://schema/usage-fact-v1", usageFactSchema);
  resourceRegistrar.registerJsonResource("cost-fact-schema", "ai-admin://schema/cost-fact-v1", costFactSchema);
  resourceRegistrar.registerJsonResource("dashboard-bundle-schema", "ai-admin://schema/dashboard-bundle-v1", dashboardBundleSchema);

  for (const provider of registry.providers.values()) {
    const capability = provider.capabilities();
    for (const [index, uri] of capability.resources.entries()) {
      if (uri.endsWith("://capabilities")) {
        resourceRegistrar.registerJsonResource(`${provider.id}-capabilities-${index}`, uri, () => provider.capabilities());
      }
    }
    provider.registerResources?.(resourceRegistrar);
  }

  server.registerResource(
    "provider-capabilities-template",
    new ResourceTemplate("ai-admin://providers/{provider}/capabilities", {
      list: undefined,
      complete: {
        provider: () => registry.capabilities.map((capability) => capability.provider),
      },
    }),
    { mimeType: "application/json" },
    async (uri, variables) => {
      const provider = String(variables.provider);
      const capability = registry.capabilities.find((item) => item.provider === provider) ?? null;
      return {
        contents: [
          {
            uri: uri.toString(),
            mimeType: "application/json",
            text: JSON.stringify(capability, null, 2),
          },
        ],
      };
    },
  );
}

function resourceRegistrarFor(server: McpServer): ProviderResourceRegistrar {
  return {
    registerJsonResource(name, uri, value) {
      server.registerResource(name, uri, { mimeType: "application/json" }, async () => ({
        contents: [
          {
            uri,
            mimeType: "application/json",
            text: JSON.stringify(typeof value === "function" ? value() : value, null, 2),
          },
        ],
      }));
    },
  };
}

function registerPrompts(server: McpServer): void {
  server.registerPrompt(
    "build_usage_dashboard",
    {
      description: "Guide an agent to request normalized dashboard bundles and build a dashboard.",
      argsSchema: {
        provider: z.string().optional(),
      },
    },
    async ({ provider }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Use ai_admin_query_dashboard_bundle${provider ? ` for ${provider}` : ""}, inspect warnings, and render a dashboard without requesting provider credentials in chat.`,
          },
        },
      ],
    }),
  );
  server.registerPrompt("investigate_cost_spike", { description: "Compare recent provider cost buckets against a baseline." }, async () => ({
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: "Use ai_admin_query_costs for the recent and baseline windows, compare provider-reported costs, and explain attribution limits from warnings.",
        },
      },
    ],
  }));
  server.registerPrompt("export_finance_report", { description: "Produce a finance-friendly cost report from provider-reported facts." }, async () => ({
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: "Use ai_admin_query_costs with daily buckets and return a finance-friendly summary. Do not ask users to paste provider credentials.",
        },
      },
    ],
  }));
}

function registerCommonTools(server: McpServer, registry: ProviderRegistry, context: () => QueryContext): void {
  server.registerTool(
    "ai_admin_list_providers",
    {
      description: "List enabled providers, health, configured reporting surfaces, and known limitations.",
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => asToolResult(async () => envelope({ provider: "multiple", tool: "ai_admin_list_providers", data: registry.capabilities })),
  );

  server.registerTool(
    "ai_admin_query_usage",
    {
      description: "Query normalized usage facts from one or more enabled providers. Pass provider-specific options under provider_options[provider_id].",
      inputSchema: {
        providers: providerListSchema,
        credential_refs: credentialRefsSchema,
        provider_options: providerOptionsSchema,
        start: z.string().datetime({ offset: true }),
        end: z.string().datetime({ offset: true }),
        bucket_width: z.enum(["1m", "1h", "1d"]).default("1d"),
        include_raw: z.boolean().default(false),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args) => asToolResult(async () => queryCommonUsage(args as CommonUsageArgs, registry, context())),
  );

  server.registerTool(
    "ai_admin_query_costs",
    {
      description: "Query normalized cost facts from one or more enabled providers. Pass provider-specific options under provider_options[provider_id].",
      inputSchema: {
        providers: providerListSchema,
        credential_refs: credentialRefsSchema,
        provider_options: providerOptionsSchema,
        start: z.string().datetime({ offset: true }),
        end: z.string().datetime({ offset: true }),
        include_raw: z.boolean().default(false),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args) => asToolResult(async () => queryCommonCosts(args as CommonCostsArgs, registry, context())),
  );

  server.registerTool(
    "ai_admin_query_dashboard_bundle",
    {
      description: "Build dashboard bundles across one or more enabled providers. Pass provider-specific options under provider_options[provider_id].",
      inputSchema: {
        providers: providerListSchema,
        credential_refs: credentialRefsSchema,
        provider_options: providerOptionsSchema,
        start: z.string().datetime({ offset: true }).optional(),
        end: z.string().datetime({ offset: true }).optional(),
        bucket_width: z.enum(["1m", "1h", "1d"]).default("1d"),
        top_n: z.number().int().positive().default(10),
        include_metadata: z.boolean().default(false),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args) => asToolResult(async () => queryDashboard(args as CommonDashboardArgs, registry, context())),
  );
}

function registerProviderExtensions(server: McpServer, registry: ProviderRegistry, context: () => QueryContext): void {
  const registrar: ProviderToolRegistrar = {
    registerTool(name, config, callback) {
      server.registerTool(name, config as never, callback as never);
    },
  };
  for (const provider of registry.providers.values()) {
    provider.registerTools?.(registrar, context);
  }
}

interface CommonUsageArgs {
  providers?: ProviderId[] | undefined;
  credential_refs?: Record<ProviderId, string> | undefined;
  provider_options?: Record<ProviderId, Record<string, unknown>> | undefined;
  start: string;
  end: string;
  bucket_width: "1m" | "1h" | "1d";
  include_raw: boolean;
}

async function queryCommonUsage(args: CommonUsageArgs, registry: ProviderRegistry, context: QueryContext): Promise<unknown> {
  const providers = args.providers ?? enabledProviderIds(registry);
  const results: Record<string, unknown> = {};
  const warnings: Record<string, Warning[]> = {};

  for (const providerId of providers) {
    const provider = registry.providers.get(providerId);
    if (provider === undefined) {
      warnings[providerId] = [providerNotEnabledWarning(providerId)];
      continue;
    }
    if (provider.queryUsage === undefined) {
      warnings[providerId] = [providerToolNotSupportedWarning(providerId, "usage")];
      continue;
    }
    try {
      results[providerId] = await provider.queryUsage(commonProviderInput(args, providerId), context);
    } catch (error) {
      warnings[providerId] = [{ code: "provider_failed", message: safeErrorMessage(error) }];
    }
  }

  return envelope({ provider: "multiple", tool: "ai_admin_query_usage", data: { results, warnings } });
}

interface CommonCostsArgs {
  providers?: ProviderId[] | undefined;
  credential_refs?: Record<ProviderId, string> | undefined;
  provider_options?: Record<ProviderId, Record<string, unknown>> | undefined;
  start: string;
  end: string;
  include_raw: boolean;
}

async function queryCommonCosts(args: CommonCostsArgs, registry: ProviderRegistry, context: QueryContext): Promise<unknown> {
  const providers = args.providers ?? enabledProviderIds(registry);
  const results: Record<string, unknown> = {};
  const warnings: Record<string, Warning[]> = {};

  for (const providerId of providers) {
    const provider = registry.providers.get(providerId);
    if (provider === undefined) {
      warnings[providerId] = [providerNotEnabledWarning(providerId)];
      continue;
    }
    if (provider.queryCosts === undefined) {
      warnings[providerId] = [providerToolNotSupportedWarning(providerId, "costs")];
      continue;
    }
    try {
      results[providerId] = await provider.queryCosts(commonProviderInput(args, providerId), context);
    } catch (error) {
      warnings[providerId] = [{ code: "provider_failed", message: safeErrorMessage(error) }];
    }
  }

  return envelope({ provider: "multiple", tool: "ai_admin_query_costs", data: { results, warnings } });
}

interface CommonDashboardArgs {
  providers?: ProviderId[] | undefined;
  credential_refs?: Record<ProviderId, string> | undefined;
  provider_options?: Record<ProviderId, Record<string, unknown>> | undefined;
  start?: string | undefined;
  end?: string | undefined;
  bucket_width: "1m" | "1h" | "1d";
  top_n: number;
  include_metadata: boolean;
}

async function queryDashboard(args: CommonDashboardArgs, registry: ProviderRegistry, context: QueryContext): Promise<unknown> {
  const providers = args.providers ?? enabledProviderIds(registry);
  const fallbackRange = lastCompleteDaysRange(context.now(), 7, args.bucket_width);
  const start = args.start ?? fallbackRange.start;
  const end = args.end ?? fallbackRange.end;
  const results: Record<string, unknown> = {};
  const warnings: Record<string, Warning[]> = {};

  for (const providerId of providers) {
    const provider = registry.providers.get(providerId);
    if (provider === undefined) {
      warnings[providerId] = [providerNotEnabledWarning(providerId)];
      continue;
    }
    if (provider.queryDashboardBundle === undefined) {
      warnings[providerId] = [providerToolNotSupportedWarning(providerId, "dashboard_bundle")];
      continue;
    }
    try {
      results[providerId] = await provider.queryDashboardBundle({
        ...providerOptions(args.provider_options, providerId),
        credential_ref: args.credential_refs?.[providerId] ?? null,
        start,
        end,
        bucket_width: args.bucket_width,
        top_n: args.top_n,
        include_metadata: args.include_metadata,
      }, context);
    } catch (error) {
      warnings[providerId] = [{ code: "provider_failed", message: safeErrorMessage(error) }];
    }
  }

  return envelope({ provider: "multiple", tool: "ai_admin_query_dashboard_bundle", data: { results, warnings } });
}

function commonProviderInput(
  args: Pick<CommonUsageArgs, "credential_refs" | "provider_options" | "start" | "end" | "include_raw"> & { bucket_width?: "1m" | "1h" | "1d" },
  providerId: ProviderId,
): Record<string, unknown> {
  return {
    ...providerOptions(args.provider_options, providerId),
    credential_ref: args.credential_refs?.[providerId] ?? null,
    start: args.start,
    end: args.end,
    ...(args.bucket_width === undefined ? {} : { bucket_width: args.bucket_width }),
    include_raw: args.include_raw,
  };
}

function providerOptions(
  options: Record<ProviderId, Record<string, unknown>> | undefined,
  providerId: ProviderId,
): Record<string, unknown> {
  return options?.[providerId] ?? {};
}

function enabledProviderIds(registry: ProviderRegistry): ProviderId[] {
  return Array.from(registry.providers.keys());
}

function providerNotEnabledWarning(provider: ProviderId): Warning {
  return {
    code: "provider_not_enabled",
    message: `Provider ${provider} is not enabled for this server`,
  };
}

function providerToolNotSupportedWarning(provider: ProviderId, toolKind: string): Warning {
  return {
    code: "provider_tool_not_supported",
    message: `Provider ${provider} does not implement common ${toolKind} queries`,
  };
}

const providerCapabilitySchema = {
  schema: "provider-capability-v1",
  type: "object",
  required: ["provider", "display_name", "version", "status", "tools"],
};

const usageFactSchema = {
  schema: "usage-fact-v1",
  type: "object",
  required: ["id", "provider", "source_endpoint", "bucket_start", "bucket_end", "dimensions", "metrics"],
};

const costFactSchema = {
  schema: "cost-fact-v1",
  type: "object",
  required: ["id", "provider", "source_endpoint", "bucket_start", "bucket_end", "dimensions", "amount"],
};

const dashboardBundleSchema = {
  schema: "dashboard-bundle-v1",
  type: "object",
  required: ["provider", "queried_at", "time_range", "summary", "series", "top", "metadata", "warnings"],
};
