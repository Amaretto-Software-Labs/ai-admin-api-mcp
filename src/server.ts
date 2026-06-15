import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import { envelope, lastCompleteDaysRange, safeErrorMessage, type ImplementedProviderId, type QueryContext, type Warning } from "./core/index.js";
import type { AnthropicCostsInput, AnthropicMessagesUsageInput } from "./providers/anthropic/index.js";
import { ELEVENLABS_FILTER_OPERATIONS, ELEVENLABS_USAGE_GROUP_BY, type ElevenLabsColumnFilter, type ElevenLabsListAuditLogsInput, type ElevenLabsListRequestsInput, type ElevenLabsQueryUsageInput } from "./providers/elevenlabs/index.js";
import type { OpenAiQueryCostsInput, OpenAiQueryUsageInput } from "./providers/openai/index.js";
import { ensureSupportedCredentialMode, type ServerConfig } from "./config.js";
import { StaticCredentialResolver } from "./credentials.js";
import { createProviderRegistry, type ProviderRegistry } from "./providers.js";
import { asToolResult } from "./tool-result.js";

export interface AiAdminServerRuntime {
  server: McpServer;
  registry: ProviderRegistry;
}

export interface AiAdminServerOptions {
  registry?: ProviderRegistry;
}

const providerListSchema = z.array(z.enum(["openai", "anthropic", "elevenlabs"])).optional();
const credentialRefsSchema = z.record(z.enum(["openai", "anthropic", "elevenlabs"]), z.string()).optional();
const credentialRefSchema = z.string().nullable().optional();
const elevenLabsFilterSchema = z.object({
  column: z.string(),
  operation: z.enum(ELEVENLABS_FILTER_OPERATIONS),
  values: z.array(z.union([z.string(), z.number(), z.boolean(), z.null()])),
});
const openAiListSchema = {
  credential_ref: credentialRefSchema,
  limit: z.number().int().positive().nullable().optional(),
  after: z.string().nullable().optional(),
};
const anthropicListSchema = {
  credential_ref: credentialRefSchema,
  limit: z.number().int().positive().nullable().optional(),
  page: z.string().nullable().optional(),
};

export function createAiAdminServer(config: ServerConfig, options: AiAdminServerOptions = {}): AiAdminServerRuntime {
  ensureSupportedCredentialMode(config);
  const registry = options.registry ?? createProviderRegistry(config);
  const credentialResolver = new StaticCredentialResolver(config);
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
  registerOpenAiTools(server, registry, context);
  registerAnthropicTools(server, registry, context);
  registerElevenLabsTools(server, registry, context);

  return { server, registry };
}

function registerResources(server: McpServer, registry: ProviderRegistry): void {
  registerJsonResource(server, "providers", "ai-admin://providers", () => registry.capabilities);
  registerJsonResource(server, "provider-capability-schema", "ai-admin://schema/provider-capability-v1", providerCapabilitySchema);
  registerJsonResource(server, "usage-fact-schema", "ai-admin://schema/usage-fact-v1", usageFactSchema);
  registerJsonResource(server, "cost-fact-schema", "ai-admin://schema/cost-fact-v1", costFactSchema);
  registerJsonResource(server, "dashboard-bundle-schema", "ai-admin://schema/dashboard-bundle-v1", dashboardBundleSchema);
  registerJsonResource(server, "openai-capabilities", "openai-admin://capabilities", () => registry.openai?.capabilities() ?? null);
  registerJsonResource(server, "anthropic-capabilities", "anthropic-admin://capabilities", () => registry.anthropic?.capabilities() ?? null);
  registerJsonResource(server, "elevenlabs-capabilities", "elevenlabs-admin://capabilities", () => registry.elevenlabs?.capabilities() ?? null);
  server.registerResource(
    "provider-capabilities-template",
    new ResourceTemplate("ai-admin://providers/{provider}/capabilities", {
      list: undefined,
      complete: {
        provider: () => ["openai", "anthropic", "elevenlabs", "google-cloud-billing"],
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

function registerJsonResource(server: McpServer, name: string, uri: string, value: unknown | (() => unknown)): void {
  server.registerResource(name, uri, { mimeType: "application/json" }, async () => ({
    contents: [
      {
        uri,
        mimeType: "application/json",
        text: JSON.stringify(typeof value === "function" ? value() : value, null, 2),
      },
    ],
  }));
}

function registerPrompts(server: McpServer): void {
  server.registerPrompt(
    "build_usage_dashboard",
    {
      description: "Guide an agent to request normalized dashboard bundles and build a dashboard.",
      argsSchema: {
        provider: z.enum(["openai", "anthropic", "elevenlabs"]).optional(),
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
      description: "Query normalized usage facts from one or more enabled providers.",
      inputSchema: {
        providers: providerListSchema,
        credential_refs: credentialRefsSchema,
        start: z.string().datetime({ offset: true }),
        end: z.string().datetime({ offset: true }),
        bucket_width: z.enum(["1m", "1h", "1d"]).default("1d"),
        include_raw: z.boolean().default(false),
        openai: z.object({
          usage_endpoint: z.enum([
            "audio_speeches",
            "audio_transcriptions",
            "code_interpreter_sessions",
            "completions",
            "embeddings",
            "file_search_calls",
            "images",
            "moderations",
            "vector_stores",
            "web_search_calls",
          ]).default("completions"),
          group_by: z.array(z.string()).optional(),
          endpoint_params: z.record(z.string(), z.unknown()).optional(),
        }).optional(),
        anthropic: z.object({
          group_by: z.array(z.string()).optional(),
          filters: z.record(z.string(), z.array(z.string())).optional(),
        }).optional(),
        elevenlabs: z.object({
          group_by: z.array(z.enum(ELEVENLABS_USAGE_GROUP_BY)).optional(),
          filters: z.array(elevenLabsFilterSchema).optional(),
          time_zone: z.string().optional(),
        }).optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args) => asToolResult(async () => queryCommonUsage(args as CommonUsageArgs, registry, context())),
  );

  server.registerTool(
    "ai_admin_query_costs",
    {
      description: "Query normalized cost facts from one or more enabled providers.",
      inputSchema: {
        providers: providerListSchema,
        credential_refs: credentialRefsSchema,
        start: z.string().datetime({ offset: true }),
        end: z.string().datetime({ offset: true }),
        include_raw: z.boolean().default(false),
        openai: z.object({
          group_by: z.array(z.string()).optional(),
          filters: z.object({
            project_ids: z.array(z.string()).optional(),
            api_key_ids: z.array(z.string()).optional(),
          }).optional(),
        }).optional(),
        anthropic: z.object({
          group_by: z.array(z.string()).optional(),
          filters: z.object({
            workspace_ids: z.array(z.string()).optional(),
          }).optional(),
        }).optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args) => asToolResult(async () => queryCommonCosts(args as CommonCostsArgs, registry, context())),
  );

  server.registerTool(
    "ai_admin_query_dashboard_bundle",
    {
      description: "Build dashboard bundles across one or more enabled providers.",
      inputSchema: {
        providers: providerListSchema,
        credential_refs: credentialRefsSchema,
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

function registerOpenAiTools(server: McpServer, registry: ProviderRegistry, context: () => QueryContext): void {
  if (!registry.openai) {
    return;
  }
  server.registerTool(
    "openai_admin_query_usage",
    {
      description: "Query one OpenAI organization usage endpoint and return normalized usage facts.",
      inputSchema: {
        credential_ref: z.string().nullable().optional(),
        usage_endpoint: z.enum([
          "audio_speeches",
          "audio_transcriptions",
          "code_interpreter_sessions",
          "completions",
          "embeddings",
          "file_search_calls",
          "images",
          "moderations",
          "vector_stores",
          "web_search_calls",
        ]),
        start: z.string().datetime({ offset: true }),
        end: z.string().datetime({ offset: true }),
        bucket_width: z.enum(["1m", "1h", "1d"]).default("1d"),
        group_by: z.array(z.string()).default([]),
        endpoint_params: z.record(z.string(), z.unknown()).default({}),
        limit: z.number().int().positive().nullable().optional(),
        max_pages: z.number().int().positive().default(20),
        include_raw: z.boolean().default(false),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args) => asToolResult(async () => registry.openai?.queryUsage(args as OpenAiQueryUsageInput, context())),
  );
  server.registerTool(
    "openai_admin_query_costs",
    {
      description: "Query OpenAI organization costs and return normalized cost facts.",
      inputSchema: {
        credential_ref: z.string().nullable().optional(),
        start: z.string().datetime({ offset: true }),
        end: z.string().datetime({ offset: true }),
        group_by: z.array(z.string()).default([]),
        filters: z.object({
          project_ids: z.array(z.string()).optional(),
          api_key_ids: z.array(z.string()).optional(),
        }).optional(),
        limit: z.number().int().positive().nullable().optional(),
        max_pages: z.number().int().positive().default(20),
        include_raw: z.boolean().default(false),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args) => asToolResult(async () => registry.openai?.queryCosts(args as OpenAiQueryCostsInput, context())),
  );
  server.registerTool("openai_admin_list_projects", {
    description: "List OpenAI projects.",
    inputSchema: openAiListSchema,
    annotations: { readOnlyHint: true },
  }, async (args) =>
    asToolResult(async () => registry.openai?.listProjects(stripUndefined(args) as { credential_ref?: string | null; limit?: number | null; after?: string | null }, context())),
  );
  server.registerTool("openai_admin_list_users", {
    description: "List OpenAI organization users.",
    inputSchema: openAiListSchema,
    annotations: { readOnlyHint: true },
  }, async (args) =>
    asToolResult(async () => registry.openai?.listUsers(stripUndefined(args) as { credential_ref?: string | null; limit?: number | null; after?: string | null }, context())),
  );
  server.registerTool(
    "openai_admin_list_project_api_keys",
    {
      description: "List OpenAI API keys for one project.",
      inputSchema: {
        project_id: z.string(),
        credential_ref: credentialRefSchema,
        limit: z.number().int().positive().nullable().optional(),
        after: z.string().nullable().optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async (args) => asToolResult(async () => registry.openai?.listProjectApiKeys(stripUndefined(args) as { credential_ref?: string | null; project_id: string; limit?: number | null; after?: string | null }, context())),
  );
  server.registerTool(
    "openai_admin_query_dashboard_bundle",
    {
      description: "Query OpenAI usage and costs for a dashboard range.",
      inputSchema: {
        credential_ref: z.string().nullable().optional(),
        start: z.string().datetime({ offset: true }),
        end: z.string().datetime({ offset: true }),
        bucket_width: z.enum(["1m", "1h", "1d"]).default("1d"),
        usage_endpoints: z.array(z.enum([
          "audio_speeches",
          "audio_transcriptions",
          "code_interpreter_sessions",
          "completions",
          "embeddings",
          "file_search_calls",
          "images",
          "moderations",
          "vector_stores",
          "web_search_calls",
        ])).optional(),
        primary_group_by: z.array(z.string()).optional(),
        cost_group_by: z.array(z.string()).optional(),
        top_n: z.number().int().positive().default(10),
        include_metadata: z.boolean().default(false),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args) => asToolResult(async () => registry.openai?.queryDashboardBundle(stripUndefined(args) as Parameters<NonNullable<typeof registry.openai>["queryDashboardBundle"]>[0], context())),
  );
}

function registerAnthropicTools(server: McpServer, registry: ProviderRegistry, context: () => QueryContext): void {
  if (!registry.anthropic) {
    return;
  }
  server.registerTool("anthropic_admin_get_organization", {
    description: "Return Anthropic organization metadata.",
    inputSchema: {
      credential_ref: credentialRefSchema,
    },
    annotations: { readOnlyHint: true },
  }, async (args) =>
    asToolResult(async () => registry.anthropic?.getOrganization(stripUndefined(args) as { credential_ref?: string | null }, context())),
  );
  server.registerTool("anthropic_admin_list_workspaces", {
    description: "List Anthropic workspaces.",
    inputSchema: anthropicListSchema,
    annotations: { readOnlyHint: true },
  }, async (args) =>
    asToolResult(async () => registry.anthropic?.listWorkspaces(stripUndefined(args) as { credential_ref?: string | null; limit?: number | null; page?: string | null }, context())),
  );
  server.registerTool("anthropic_admin_list_api_keys", {
    description: "List Anthropic API keys.",
    inputSchema: anthropicListSchema,
    annotations: { readOnlyHint: true },
  }, async (args) =>
    asToolResult(async () => registry.anthropic?.listApiKeys(stripUndefined(args) as { credential_ref?: string | null; limit?: number | null; page?: string | null }, context())),
  );
  server.registerTool(
    "anthropic_admin_query_messages_usage",
    {
      description: "Query Anthropic messages usage and return normalized usage facts.",
      inputSchema: {
        credential_ref: z.string().nullable().optional(),
        start: z.string().datetime({ offset: true }),
        end: z.string().datetime({ offset: true }),
        bucket_width: z.enum(["1m", "1h", "1d"]).default("1d"),
        group_by: z.array(z.string()).default([]),
        filters: z.object({
          api_key_ids: z.array(z.string()).optional(),
          workspace_ids: z.array(z.string()).optional(),
          models: z.array(z.string()).optional(),
          service_tiers: z.array(z.string()).optional(),
          context_windows: z.array(z.string()).optional(),
          inference_geos: z.array(z.string()).optional(),
          speeds: z.array(z.string()).optional(),
        }).optional(),
        limit: z.number().int().positive().nullable().optional(),
        max_pages: z.number().int().positive().default(20),
        include_raw: z.boolean().default(false),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args) => asToolResult(async () => registry.anthropic?.queryMessagesUsage(args as AnthropicMessagesUsageInput, context())),
  );
  server.registerTool(
    "anthropic_admin_query_costs",
    {
      description: "Query Anthropic cost reports and return normalized cost facts.",
      inputSchema: {
        credential_ref: z.string().nullable().optional(),
        start: z.string().datetime({ offset: true }),
        end: z.string().datetime({ offset: true }),
        group_by: z.array(z.string()).default([]),
        filters: z.object({
          workspace_ids: z.array(z.string()).optional(),
        }).optional(),
        limit: z.number().int().positive().nullable().optional(),
        max_pages: z.number().int().positive().default(20),
        include_raw: z.boolean().default(false),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args) => asToolResult(async () => registry.anthropic?.queryCosts(args as AnthropicCostsInput, context())),
  );
  server.registerTool(
    "anthropic_admin_query_dashboard_bundle",
    {
      description: "Query Anthropic usage and costs for a dashboard range.",
      inputSchema: {
        credential_ref: z.string().nullable().optional(),
        start: z.string().datetime({ offset: true }),
        end: z.string().datetime({ offset: true }),
        bucket_width: z.enum(["1m", "1h", "1d"]).default("1d"),
        usage_group_by: z.array(z.string()).optional(),
        cost_group_by: z.array(z.string()).optional(),
        top_n: z.number().int().positive().default(10),
        include_metadata: z.boolean().default(false),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args) => asToolResult(async () => registry.anthropic?.queryDashboardBundle(stripUndefined(args) as Parameters<NonNullable<typeof registry.anthropic>["queryDashboardBundle"]>[0], context())),
  );
}

function registerElevenLabsTools(server: McpServer, registry: ProviderRegistry, context: () => QueryContext): void {
  if (!registry.elevenlabs) {
    return;
  }
  server.registerTool("elevenlabs_admin_get_user", {
    description: "Return ElevenLabs user metadata for the configured API key.",
    inputSchema: {
      credential_ref: credentialRefSchema,
    },
    annotations: { readOnlyHint: true },
  }, async (args) =>
    asToolResult(async () => registry.elevenlabs?.getUser(stripUndefined(args) as { credential_ref?: string | null }, context())),
  );
  server.registerTool("elevenlabs_admin_get_subscription", {
    description: "Return ElevenLabs subscription metadata for the configured API key.",
    inputSchema: {
      credential_ref: credentialRefSchema,
    },
    annotations: { readOnlyHint: true },
  }, async (args) =>
    asToolResult(async () => registry.elevenlabs?.getSubscription(stripUndefined(args) as { credential_ref?: string | null }, context())),
  );
  server.registerTool("elevenlabs_admin_list_service_accounts", {
    description: "List ElevenLabs workspace service accounts.",
    inputSchema: {
      credential_ref: credentialRefSchema,
    },
    annotations: { readOnlyHint: true },
  }, async (args) =>
    asToolResult(async () => registry.elevenlabs?.listServiceAccounts(stripUndefined(args) as { credential_ref?: string | null }, context())),
  );
  server.registerTool(
    "elevenlabs_admin_list_service_account_api_keys",
    {
      description: "List ElevenLabs API keys for one service account.",
      inputSchema: {
        service_account_user_id: z.string(),
        credential_ref: credentialRefSchema,
      },
      annotations: { readOnlyHint: true },
    },
    async (args) =>
      asToolResult(async () =>
        registry.elevenlabs?.listServiceAccountApiKeys(
          stripUndefined(args) as { credential_ref?: string | null; service_account_user_id: string },
          context(),
        )),
  );
  server.registerTool(
    "elevenlabs_admin_list_audit_logs",
    {
      description: "List ElevenLabs workspace audit logs. This requires an ElevenLabs enterprise tier and audit-log permission.",
      inputSchema: {
        credential_ref: credentialRefSchema,
        limit: z.number().int().positive().max(100).nullable().optional(),
        cursor: z.string().nullable().optional(),
        start: z.string().datetime({ offset: true }).nullable().optional(),
        end: z.string().datetime({ offset: true }).nullable().optional(),
        actor_uid: z.string().nullable().optional(),
        class_name: z.string().nullable().optional(),
        activity_name: z.string().nullable().optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args) => asToolResult(async () => registry.elevenlabs?.listAuditLogs(stripUndefined(args) as ElevenLabsListAuditLogsInput, context())),
  );
  server.registerTool(
    "elevenlabs_admin_list_api_requests",
    {
      description: "List ElevenLabs workspace API request analytics in the provider tabular format.",
      inputSchema: {
        credential_ref: credentialRefSchema,
        start: z.string().datetime({ offset: true }).nullable().optional(),
        end: z.string().datetime({ offset: true }).nullable().optional(),
        limit: z.number().int().positive().max(1000).nullable().optional(),
        sort: z.enum(["asc", "desc"]).nullable().optional(),
        filters: z.array(elevenLabsFilterSchema).default([]),
        search: z.string().nullable().optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args) => asToolResult(async () => registry.elevenlabs?.listApiRequests(stripUndefined(args) as ElevenLabsListRequestsInput, context())),
  );
  server.registerTool(
    "elevenlabs_admin_query_usage",
    {
      description: "Query ElevenLabs workspace credit usage and return normalized usage facts.",
      inputSchema: {
        credential_ref: z.string().nullable().optional(),
        start: z.string().datetime({ offset: true }),
        end: z.string().datetime({ offset: true }),
        bucket_width: z.enum(["1m", "1h", "1d"]).default("1d"),
        group_by: z.array(z.enum(ELEVENLABS_USAGE_GROUP_BY)).default([]),
        filters: z.array(elevenLabsFilterSchema).default([]),
        time_zone: z.string().default("UTC"),
        include_raw: z.boolean().default(false),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args) => asToolResult(async () => registry.elevenlabs?.queryUsage(args as ElevenLabsQueryUsageInput, context())),
  );
  server.registerTool(
    "elevenlabs_admin_query_dashboard_bundle",
    {
      description: "Query ElevenLabs workspace credit usage for a dashboard range.",
      inputSchema: {
        credential_ref: z.string().nullable().optional(),
        start: z.string().datetime({ offset: true }),
        end: z.string().datetime({ offset: true }),
        bucket_width: z.enum(["1m", "1h", "1d"]).default("1d"),
        group_by: z.array(z.enum(ELEVENLABS_USAGE_GROUP_BY)).optional(),
        filters: z.array(elevenLabsFilterSchema).optional(),
        time_zone: z.string().default("UTC"),
        top_n: z.number().int().positive().default(10),
        include_metadata: z.boolean().default(false),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args) => asToolResult(async () => registry.elevenlabs?.queryDashboardBundle(stripUndefined(args) as Parameters<NonNullable<typeof registry.elevenlabs>["queryDashboardBundle"]>[0], context())),
  );
}

interface CommonUsageArgs {
  providers?: ImplementedProviderId[] | undefined;
  credential_refs?: Record<ImplementedProviderId, string> | undefined;
  start: string;
  end: string;
  bucket_width: "1m" | "1h" | "1d";
  include_raw: boolean;
  openai?: { usage_endpoint?: OpenAiQueryUsageInput["usage_endpoint"] | undefined; group_by?: string[] | undefined; endpoint_params?: Record<string, unknown> | undefined } | undefined;
  anthropic?: { group_by?: string[] | undefined; filters?: AnthropicMessagesUsageInput["filters"] | undefined } | undefined;
  elevenlabs?: { group_by?: string[] | undefined; filters?: ElevenLabsColumnFilter[] | undefined; time_zone?: string | undefined } | undefined;
}

async function queryCommonUsage(args: CommonUsageArgs, registry: ProviderRegistry, context: QueryContext): Promise<unknown> {
  const providers = args.providers ?? enabledProviderIds(registry);
  const results: Record<string, unknown> = {};
  const warnings: Record<string, Warning[]> = {};

  for (const provider of providers) {
    try {
      if (provider === "openai") {
        if (!registry.openai) {
          warnings[provider] = [providerNotEnabledWarning(provider)];
          continue;
        }
        results.openai = await registry.openai.queryUsage({
          credential_ref: args.credential_refs?.openai ?? null,
          usage_endpoint: args.openai?.usage_endpoint ?? "completions",
          start: args.start,
          end: args.end,
          bucket_width: args.bucket_width,
          group_by: args.openai?.group_by ?? [],
          endpoint_params: args.openai?.endpoint_params ?? {},
          include_raw: args.include_raw,
        }, context);
      }
      if (provider === "anthropic") {
        if (!registry.anthropic) {
          warnings[provider] = [providerNotEnabledWarning(provider)];
          continue;
        }
        results.anthropic = await registry.anthropic.queryMessagesUsage({
          credential_ref: args.credential_refs?.anthropic ?? null,
          start: args.start,
          end: args.end,
          bucket_width: args.bucket_width,
          group_by: args.anthropic?.group_by ?? [],
          filters: args.anthropic?.filters ?? {},
          include_raw: args.include_raw,
        }, context);
      }
      if (provider === "elevenlabs") {
        if (!registry.elevenlabs) {
          warnings[provider] = [providerNotEnabledWarning(provider)];
          continue;
        }
        results.elevenlabs = await registry.elevenlabs.queryUsage({
          credential_ref: args.credential_refs?.elevenlabs ?? null,
          start: args.start,
          end: args.end,
          bucket_width: args.bucket_width,
          group_by: args.elevenlabs?.group_by ?? [],
          filters: args.elevenlabs?.filters ?? [],
          time_zone: args.elevenlabs?.time_zone ?? "UTC",
          include_raw: args.include_raw,
        }, context);
      }
    } catch (error) {
      warnings[provider] = [{ code: "provider_failed", message: safeErrorMessage(error) }];
    }
  }

  return envelope({ provider: "multiple", tool: "ai_admin_query_usage", data: { results, warnings } });
}

interface CommonCostsArgs {
  providers?: ImplementedProviderId[] | undefined;
  credential_refs?: Record<ImplementedProviderId, string> | undefined;
  start: string;
  end: string;
  include_raw: boolean;
  openai?: { group_by?: string[] | undefined; filters?: OpenAiQueryCostsInput["filters"] | undefined } | undefined;
  anthropic?: { group_by?: string[] | undefined; filters?: AnthropicCostsInput["filters"] | undefined } | undefined;
}

async function queryCommonCosts(args: CommonCostsArgs, registry: ProviderRegistry, context: QueryContext): Promise<unknown> {
  const providers = args.providers ?? enabledProviderIds(registry);
  const results: Record<string, unknown> = {};
  const warnings: Record<string, Warning[]> = {};

  for (const provider of providers) {
    try {
      if (provider === "openai") {
        if (!registry.openai) {
          warnings[provider] = [providerNotEnabledWarning(provider)];
          continue;
        }
        results.openai = await registry.openai.queryCosts({
          credential_ref: args.credential_refs?.openai ?? null,
          start: args.start,
          end: args.end,
          group_by: args.openai?.group_by ?? [],
          filters: args.openai?.filters ?? {},
          include_raw: args.include_raw,
        }, context);
      }
      if (provider === "anthropic") {
        if (!registry.anthropic) {
          warnings[provider] = [providerNotEnabledWarning(provider)];
          continue;
        }
        results.anthropic = await registry.anthropic.queryCosts({
          credential_ref: args.credential_refs?.anthropic ?? null,
          start: args.start,
          end: args.end,
          group_by: args.anthropic?.group_by ?? [],
          filters: args.anthropic?.filters ?? {},
          include_raw: args.include_raw,
        }, context);
      }
      if (provider === "elevenlabs") {
        warnings[provider] = [{
          code: "costs_not_supported",
          message: "ElevenLabs support currently exposes credit usage, not provider-reported monetary costs.",
        }];
      }
    } catch (error) {
      warnings[provider] = [{ code: "provider_failed", message: safeErrorMessage(error) }];
    }
  }

  return envelope({ provider: "multiple", tool: "ai_admin_query_costs", data: { results, warnings } });
}

interface CommonDashboardArgs {
  providers?: ImplementedProviderId[] | undefined;
  credential_refs?: Record<ImplementedProviderId, string> | undefined;
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

  for (const provider of providers) {
    try {
      if (provider === "openai") {
        if (!registry.openai) {
          warnings[provider] = [providerNotEnabledWarning(provider)];
          continue;
        }
        results.openai = await registry.openai.queryDashboardBundle({
          credential_ref: args.credential_refs?.openai ?? null,
          start,
          end,
          bucket_width: args.bucket_width,
          top_n: args.top_n,
          include_metadata: args.include_metadata,
        }, context);
      }
      if (provider === "anthropic") {
        if (!registry.anthropic) {
          warnings[provider] = [providerNotEnabledWarning(provider)];
          continue;
        }
        results.anthropic = await registry.anthropic.queryDashboardBundle({
          credential_ref: args.credential_refs?.anthropic ?? null,
          start,
          end,
          bucket_width: args.bucket_width,
          top_n: args.top_n,
          include_metadata: args.include_metadata,
        }, context);
      }
      if (provider === "elevenlabs") {
        if (!registry.elevenlabs) {
          warnings[provider] = [providerNotEnabledWarning(provider)];
          continue;
        }
        results.elevenlabs = await registry.elevenlabs.queryDashboardBundle({
          credential_ref: args.credential_refs?.elevenlabs ?? null,
          start,
          end,
          bucket_width: args.bucket_width,
          top_n: args.top_n,
          include_metadata: args.include_metadata,
        }, context);
      }
    } catch (error) {
      warnings[provider] = [{ code: "provider_failed", message: safeErrorMessage(error) }];
    }
  }

  return envelope({ provider: "multiple", tool: "ai_admin_query_dashboard_bundle", data: { results, warnings } });
}

function enabledProviderIds(registry: ProviderRegistry): ImplementedProviderId[] {
  return [
    ...(registry.openai ? ["openai" as const] : []),
    ...(registry.anthropic ? ["anthropic" as const] : []),
    ...(registry.elevenlabs ? ["elevenlabs" as const] : []),
  ];
}

function providerNotEnabledWarning(provider: ImplementedProviderId): Warning {
  return {
    code: "provider_not_enabled",
    message: `Provider ${provider} is not enabled for this server`,
  };
}

function stripUndefined<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => stripUndefined(item)) as T;
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).flatMap(([key, nested]) => (nested === undefined ? [] : [[key, stripUndefined(nested)]])),
    ) as T;
  }
  return value;
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
