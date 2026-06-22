import * as z from "zod/v4";
import { AiAdminError, type CredentialRequest } from "../../core/index.js";
import type { ServerConfig } from "../../config.js";
import type { AiAdminProviderPlugin, ProviderRuntime, ProviderToolRegistrar } from "../../plugin.js";
import { asToolResult } from "../../tool-result.js";
import { OPENROUTER_USAGE_SOURCES } from "./capabilities.js";
import { OpenRouterProvider } from "./provider.js";
import type {
  OpenRouterActivityInput,
  OpenRouterAnalyticsFilter,
  OpenRouterAnalyticsOrderBy,
  OpenRouterAnalyticsQueryInput,
  OpenRouterDashboardInput,
  OpenRouterGenerationInput,
  OpenRouterGetApiKeyInput,
  OpenRouterListApiKeysInput,
  OpenRouterModelsInput,
  OpenRouterQueryCostsInput,
  OpenRouterQueryUsageInput,
} from "./types.js";

const STATIC_CREDENTIAL_REF = "credential:openrouter:static";
const MANAGEMENT_CREDENTIAL_REF = "credential:openrouter:management";
const API_CREDENTIAL_REF = "credential:openrouter:api";
const credentialRefSchema = z.string().nullable().optional();
const analyticsFilterSchema = z.record(z.string(), z.unknown());
const analyticsOrderBySchema = z.record(z.string(), z.unknown()).nullable().optional();

export const openRouterProviderPlugin: AiAdminProviderPlugin = {
  apiVersion: "1",
  id: "openrouter",
  displayName: "OpenRouter",
  inferEnabled: ({ config }) => Boolean(config.openrouter.managementKey || config.openrouter.apiKey),
  createProvider: ({ config }) => openRouterRuntime(createOpenRouterProvider(config)),
  resolveStaticCredential(request, { config }) {
    if (request.provider !== "openrouter") {
      return null;
    }
    const ref = request.credential_ref ?? STATIC_CREDENTIAL_REF;
    validateStaticCredentialRef(request);
    if (ref === MANAGEMENT_CREDENTIAL_REF) {
      return managementCredential(config, request);
    }
    if (ref === API_CREDENTIAL_REF) {
      return apiCredential(config, request);
    }
    if (config.openrouter.managementKey !== undefined) {
      return managementCredential(config, request, STATIC_CREDENTIAL_REF);
    }
    return apiCredential(config, request, STATIC_CREDENTIAL_REF);
  },
};

function createOpenRouterProvider(config: ServerConfig): OpenRouterProvider {
  return new OpenRouterProvider({
    ...(config.openrouter.managementKey === undefined ? {} : { managementKey: config.openrouter.managementKey }),
    ...(config.openrouter.apiKey === undefined ? {} : { apiKey: config.openrouter.apiKey }),
    ...(config.openrouter.baseUrl === undefined ? {} : { baseUrl: config.openrouter.baseUrl }),
    ...(config.openrouter.httpReferer === undefined ? {} : { httpReferer: config.openrouter.httpReferer }),
    ...(config.openrouter.appTitle === undefined ? {} : { appTitle: config.openrouter.appTitle }),
    required: config.requiredProviders.includes("openrouter"),
    cacheTtlSeconds: config.cacheTtlSeconds,
  });
}

function openRouterRuntime(provider: OpenRouterProvider): ProviderRuntime {
  return {
    id: provider.id,
    displayName: provider.displayName,
    version: provider.version,
    configured: provider.configured,
    required: provider.required,
    capabilities: () => provider.capabilities(),
    registerTools: (registrar, context) => registerOpenRouterTools(registrar, provider, context),
    queryUsage: (input, context) => provider.queryUsage(toOpenRouterUsageInput(input), context),
    queryCosts: (input, context) => provider.queryCosts(toOpenRouterCostsInput(input), context),
    queryDashboardBundle: (input, context) => provider.queryDashboardBundle(toOpenRouterDashboardInput(input), context),
  };
}

function registerOpenRouterTools(registrar: ProviderToolRegistrar, provider: OpenRouterProvider, context: () => Parameters<OpenRouterProvider["queryUsage"]>[1]): void {
  registrar.registerTool("openrouter_admin_get_current_key", {
    description: "Return OpenRouter metadata for the current credential.",
    inputSchema: {
      credential_ref: credentialRefSchema,
      include_raw: z.boolean().default(false),
    },
    annotations: { readOnlyHint: true },
  }, async (args) => asToolResult(async () => provider.getCurrentKey(stripUndefined(args) as { credential_ref?: string | null; include_raw?: boolean }, context())));

  registrar.registerTool("openrouter_admin_list_api_keys", {
    description: "List OpenRouter API key metadata. Requires a management key.",
    inputSchema: {
      credential_ref: credentialRefSchema,
      include_disabled: z.union([z.boolean(), z.string()]).nullable().optional(),
      offset: z.number().int().min(0).nullable().optional(),
      workspace_id: z.string().nullable().optional(),
      include_raw: z.boolean().default(false),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, async (args) => asToolResult(async () => provider.listApiKeys(stripUndefined(args) as OpenRouterListApiKeysInput, context())));

  registrar.registerTool("openrouter_admin_get_api_key", {
    description: "Get one OpenRouter API key metadata object by hash. Requires a management key.",
    inputSchema: {
      hash: z.string(),
      credential_ref: credentialRefSchema,
      include_raw: z.boolean().default(false),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, async (args) => asToolResult(async () => provider.getApiKey(stripUndefined(args) as OpenRouterGetApiKeyInput, context())));

  registrar.registerTool("openrouter_admin_get_credits", {
    description: "Return OpenRouter total credits, usage, and remaining credits. Requires a management key.",
    inputSchema: {
      credential_ref: credentialRefSchema,
      include_raw: z.boolean().default(false),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, async (args) => asToolResult(async () => provider.getCredits(stripUndefined(args) as { credential_ref?: string | null; include_raw?: boolean }, context())));

  registrar.registerTool("openrouter_admin_get_activity", {
    description: "Return OpenRouter activity rows and normalized facts for the provider-supported activity window. Requires a management key.",
    inputSchema: {
      credential_ref: credentialRefSchema,
      date: z.string().nullable().optional(),
      api_key_hash: z.string().nullable().optional(),
      user_id: z.string().nullable().optional(),
      include_raw: z.boolean().default(false),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, async (args) => asToolResult(async () => provider.getActivity(stripUndefined(args) as OpenRouterActivityInput, context())));

  registrar.registerTool("openrouter_admin_get_analytics_meta", {
    description: "Return OpenRouter analytics metrics, dimensions, operators, and granularities. Requires a management key.",
    inputSchema: {
      credential_ref: credentialRefSchema,
      include_raw: z.boolean().default(false),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, async (args) => asToolResult(async () => provider.getAnalyticsMeta(stripUndefined(args) as { credential_ref?: string | null; include_raw?: boolean }, context())));

  registrar.registerTool("openrouter_admin_query_analytics", {
    description: "Query OpenRouter beta analytics and return provider-native rows plus normalized facts. Requires a management key.",
    inputSchema: {
      credential_ref: credentialRefSchema,
      metrics: z.array(z.string()).optional(),
      dimensions: z.array(z.string()).optional(),
      filters: z.array(analyticsFilterSchema).optional(),
      granularity: z.string().nullable().optional(),
      group_limit: z.number().int().positive().nullable().optional(),
      limit: z.number().int().positive().nullable().optional(),
      order_by: analyticsOrderBySchema,
      time_range: z.object({
        start: z.string().datetime({ offset: true }),
        end: z.string().datetime({ offset: true }),
      }),
      include_raw: z.boolean().default(false),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, async (args) => asToolResult(async () => provider.queryAnalytics(stripUndefined(args) as OpenRouterAnalyticsQueryInput, context())));

  registrar.registerTool("openrouter_admin_get_generation", {
    description: "Return request and usage metadata for one OpenRouter generation id.",
    inputSchema: {
      id: z.string(),
      credential_ref: credentialRefSchema,
      include_raw: z.boolean().default(false),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, async (args) => asToolResult(async () => provider.getGeneration(stripUndefined(args) as OpenRouterGenerationInput, context())));

  registrar.registerTool("openrouter_admin_list_models", {
    description: "List OpenRouter model catalog and pricing metadata. Pricing metadata is not historical spend.",
    inputSchema: {
      credential_ref: credentialRefSchema,
      category: z.string().nullable().optional(),
      supported_parameters: z.string().nullable().optional(),
      output_modalities: z.string().nullable().optional(),
      sort: z.string().nullable().optional(),
      include_raw: z.boolean().default(false),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, async (args) => asToolResult(async () => provider.listModels(stripUndefined(args) as OpenRouterModelsInput, context())));

  registrar.registerTool("openrouter_admin_query_usage", {
    description: "Query OpenRouter usage through analytics, activity, or explicit generation ids.",
    inputSchema: commonQueryInputSchema(true),
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, async (args) => asToolResult(async () => provider.queryUsage(stripUndefined(args) as OpenRouterQueryUsageInput, context())));

  registrar.registerTool("openrouter_admin_query_costs", {
    description: "Query OpenRouter provider-reported cost or credit spend through analytics, activity, or explicit generation ids.",
    inputSchema: commonQueryInputSchema(false),
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, async (args) => asToolResult(async () => provider.queryCosts(stripUndefined(args) as OpenRouterQueryCostsInput, context())));

  registrar.registerTool("openrouter_admin_query_dashboard_bundle", {
    description: "Query OpenRouter dashboard usage, cost, and metadata for a dashboard range.",
    inputSchema: {
      ...commonQueryInputSchema(true),
      top_n: z.number().int().positive().default(10),
      include_metadata: z.boolean().default(false),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, async (args) => asToolResult(async () => provider.queryDashboardBundle(stripUndefined(args) as OpenRouterDashboardInput, context())));
}

function commonQueryInputSchema(includeBucketWidth: boolean) {
  return {
    credential_ref: credentialRefSchema,
    start: z.string().datetime({ offset: true }),
    end: z.string().datetime({ offset: true }),
    ...(includeBucketWidth ? { bucket_width: z.enum(["1m", "1h", "1d"]).default("1d") } : {}),
    source: z.enum(OPENROUTER_USAGE_SOURCES).default("analytics"),
    metrics: z.array(z.string()).optional(),
    dimensions: z.array(z.string()).optional(),
    filters: z.array(analyticsFilterSchema).optional(),
    granularity: z.string().nullable().optional(),
    group_limit: z.number().int().positive().nullable().optional(),
    limit: z.number().int().positive().nullable().optional(),
    order_by: analyticsOrderBySchema,
    generation_ids: z.array(z.string()).optional(),
    date: z.string().nullable().optional(),
    api_key_hash: z.string().nullable().optional(),
    user_id: z.string().nullable().optional(),
    include_raw: z.boolean().default(false),
  };
}

function toOpenRouterUsageInput(input: Record<string, unknown>): OpenRouterQueryUsageInput {
  return {
    credential_ref: stringOrNull(input.credential_ref),
    start: stringValue(input.start, "start"),
    end: stringValue(input.end, "end"),
    bucket_width: bucketWidth(input.bucket_width),
    source: sourceValue(input.source),
    metrics: stringArray(input.metrics),
    dimensions: stringArray(input.dimensions),
    filters: Array.isArray(input.filters) ? input.filters as OpenRouterAnalyticsFilter[] : [],
    granularity: stringOrNull(input.granularity),
    group_limit: numberOrNull(input.group_limit),
    limit: numberOrNull(input.limit),
    order_by: recordOrNull(input.order_by) as OpenRouterAnalyticsOrderBy | null,
    generation_ids: stringArray(input.generation_ids),
    date: stringOrNull(input.date),
    api_key_hash: stringOrNull(input.api_key_hash),
    user_id: stringOrNull(input.user_id),
    include_raw: booleanValue(input.include_raw),
  };
}

function toOpenRouterCostsInput(input: Record<string, unknown>): OpenRouterQueryCostsInput {
  const usageInput = toOpenRouterUsageInput(input);
  return {
    credential_ref: usageInput.credential_ref ?? null,
    start: usageInput.start,
    end: usageInput.end,
    source: usageInput.source ?? "analytics",
    metrics: usageInput.metrics ?? [],
    dimensions: usageInput.dimensions ?? [],
    filters: usageInput.filters ?? [],
    granularity: usageInput.granularity ?? null,
    group_limit: usageInput.group_limit ?? null,
    limit: usageInput.limit ?? null,
    order_by: usageInput.order_by ?? null,
    generation_ids: usageInput.generation_ids ?? [],
    date: usageInput.date ?? null,
    api_key_hash: usageInput.api_key_hash ?? null,
    user_id: usageInput.user_id ?? null,
    include_raw: usageInput.include_raw ?? false,
  };
}

function toOpenRouterDashboardInput(input: Record<string, unknown>): OpenRouterDashboardInput {
  const usageInput = toOpenRouterUsageInput(input);
  return {
    ...usageInput,
    top_n: numberValue(input.top_n, 10),
    include_metadata: booleanValue(input.include_metadata),
  };
}

function managementCredential(config: ServerConfig, request: CredentialRequest, credentialRef = MANAGEMENT_CREDENTIAL_REF) {
  if (config.openrouter.managementKey === undefined) {
    throw new AiAdminError("configuration_error", "OPENROUTER_MANAGEMENT_KEY is required for OpenRouter management tools", {
      credential_ref: request.credential_ref,
      tool: request.tool,
    });
  }
  return {
    provider: "openrouter",
    credential_ref: request.credential_ref ?? credentialRef,
    type: "bearer" as const,
    secret: config.openrouter.managementKey,
  };
}

function apiCredential(config: ServerConfig, request: CredentialRequest, credentialRef = API_CREDENTIAL_REF) {
  if (config.openrouter.apiKey === undefined) {
    throw new AiAdminError("configuration_error", "OPENROUTER_API_KEY is required for OpenRouter API credential mode", {
      credential_ref: request.credential_ref,
      tool: request.tool,
    });
  }
  return {
    provider: "openrouter",
    credential_ref: request.credential_ref ?? credentialRef,
    type: "bearer" as const,
    secret: config.openrouter.apiKey,
  };
}

function validateStaticCredentialRef(request: CredentialRequest): void {
  const ref = request.credential_ref;
  if (ref !== null && ref !== undefined && ref !== STATIC_CREDENTIAL_REF && ref !== MANAGEMENT_CREDENTIAL_REF && ref !== API_CREDENTIAL_REF) {
    throw new AiAdminError("permission_denied", `Unknown credential_ref for static ${request.provider} configuration`, {
      credential_ref: ref,
      expected_credential_refs: [STATIC_CREDENTIAL_REF, MANAGEMENT_CREDENTIAL_REF, API_CREDENTIAL_REF],
      tool: request.tool,
    });
  }
}

function stringValue(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new AiAdminError("validation_failed", `Missing ${field}`);
  }
  return value;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function recordOrNull(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function bucketWidth(value: unknown): "1m" | "1h" | "1d" {
  return value === "1m" || value === "1h" || value === "1d" ? value : "1d";
}

function sourceValue(value: unknown): NonNullable<OpenRouterQueryUsageInput["source"]> {
  return value === "activity" || value === "generation" || value === "analytics" ? value : "analytics";
}

function booleanValue(value: unknown): boolean {
  return value === true;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function numberValue(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
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
