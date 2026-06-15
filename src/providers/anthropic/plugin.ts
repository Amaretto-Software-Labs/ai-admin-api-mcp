import * as z from "zod/v4";
import { AiAdminError, type CredentialRequest } from "../../core/index.js";
import type { ServerConfig } from "../../config.js";
import type { AiAdminProviderPlugin, ProviderRuntime, ProviderToolRegistrar } from "../../plugin.js";
import { asToolResult } from "../../tool-result.js";
import { AnthropicProvider } from "./provider.js";
import type { AnthropicCostsInput, AnthropicDashboardInput, AnthropicMessagesUsageInput } from "./types.js";

const STATIC_CREDENTIAL_REF = "credential:anthropic:static";
const credentialRefSchema = z.string().nullable().optional();
const anthropicListSchema = {
  credential_ref: credentialRefSchema,
  limit: z.number().int().positive().nullable().optional(),
  page: z.string().nullable().optional(),
};

export const anthropicProviderPlugin: AiAdminProviderPlugin = {
  apiVersion: "1",
  id: "anthropic",
  displayName: "Anthropic",
  inferEnabled: ({ config }) => Boolean(config.anthropic.adminKey || config.anthropic.oauthToken),
  createProvider: ({ config }) => anthropicRuntime(createAnthropicProvider(config)),
  resolveStaticCredential(request, { config }) {
    if (request.provider !== "anthropic") {
      return null;
    }
    validateStaticCredentialRef(request, STATIC_CREDENTIAL_REF);
    if (config.anthropic.oauthToken) {
      return {
        provider: "anthropic",
        credential_ref: request.credential_ref ?? STATIC_CREDENTIAL_REF,
        type: "bearer",
        secret: config.anthropic.oauthToken,
      };
    }
    if (!config.anthropic.adminKey) {
      throw new AiAdminError("configuration_error", "ANTHROPIC_ADMIN_KEY or ANTHROPIC_OAUTH_TOKEN is required for Anthropic static credential mode");
    }
    return {
      provider: "anthropic",
      credential_ref: request.credential_ref ?? STATIC_CREDENTIAL_REF,
      type: "api_key",
      secret: config.anthropic.adminKey,
    };
  },
};

function createAnthropicProvider(config: ServerConfig): AnthropicProvider {
  return new AnthropicProvider({
    ...(config.anthropic.adminKey === undefined ? {} : { adminKey: config.anthropic.adminKey }),
    ...(config.anthropic.oauthToken === undefined ? {} : { oauthToken: config.anthropic.oauthToken }),
    ...(config.anthropic.baseUrl === undefined ? {} : { baseUrl: config.anthropic.baseUrl }),
    ...(config.anthropic.version === undefined ? {} : { anthropicVersion: config.anthropic.version }),
    betaHeaders: config.anthropic.betaHeaders,
    required: config.requiredProviders.includes("anthropic"),
    cacheTtlSeconds: config.cacheTtlSeconds,
  });
}

function anthropicRuntime(provider: AnthropicProvider): ProviderRuntime {
  return {
    id: provider.id,
    displayName: provider.displayName,
    version: provider.version,
    configured: provider.configured,
    required: provider.required,
    capabilities: () => provider.capabilities(),
    registerTools: (registrar, context) => registerAnthropicTools(registrar, provider, context),
    queryUsage: (input, context) => provider.queryMessagesUsage(toAnthropicUsageInput(input), context),
    queryCosts: (input, context) => provider.queryCosts(toAnthropicCostsInput(input), context),
    queryDashboardBundle: (input, context) => provider.queryDashboardBundle(toAnthropicDashboardInput(input), context),
  };
}

function registerAnthropicTools(registrar: ProviderToolRegistrar, provider: AnthropicProvider, context: () => Parameters<AnthropicProvider["queryMessagesUsage"]>[1]): void {
  registrar.registerTool("anthropic_admin_get_organization", {
    description: "Return Anthropic organization metadata.",
    inputSchema: {
      credential_ref: credentialRefSchema,
    },
    annotations: { readOnlyHint: true },
  }, async (args) =>
    asToolResult(async () => provider.getOrganization(stripUndefined(args) as { credential_ref?: string | null }, context())),
  );
  registrar.registerTool("anthropic_admin_list_workspaces", {
    description: "List Anthropic workspaces.",
    inputSchema: anthropicListSchema,
    annotations: { readOnlyHint: true },
  }, async (args) =>
    asToolResult(async () => provider.listWorkspaces(stripUndefined(args) as { credential_ref?: string | null; limit?: number | null; page?: string | null }, context())),
  );
  registrar.registerTool("anthropic_admin_list_api_keys", {
    description: "List Anthropic API keys.",
    inputSchema: anthropicListSchema,
    annotations: { readOnlyHint: true },
  }, async (args) =>
    asToolResult(async () => provider.listApiKeys(stripUndefined(args) as { credential_ref?: string | null; limit?: number | null; page?: string | null }, context())),
  );
  registrar.registerTool(
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
    async (args) => asToolResult(async () => provider.queryMessagesUsage(args as AnthropicMessagesUsageInput, context())),
  );
  registrar.registerTool(
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
    async (args) => asToolResult(async () => provider.queryCosts(args as AnthropicCostsInput, context())),
  );
  registrar.registerTool(
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
    async (args) => asToolResult(async () => provider.queryDashboardBundle(stripUndefined(args) as AnthropicDashboardInput, context())),
  );
}

function toAnthropicUsageInput(input: Record<string, unknown>): AnthropicMessagesUsageInput {
  return {
    credential_ref: stringOrNull(input.credential_ref),
    start: stringValue(input.start, "start"),
    end: stringValue(input.end, "end"),
    bucket_width: bucketWidth(input.bucket_width),
    group_by: stringArray(input.group_by),
    filters: recordValue(input.filters) as NonNullable<AnthropicMessagesUsageInput["filters"]>,
    include_raw: booleanValue(input.include_raw),
  };
}

function toAnthropicCostsInput(input: Record<string, unknown>): AnthropicCostsInput {
  return {
    credential_ref: stringOrNull(input.credential_ref),
    start: stringValue(input.start, "start"),
    end: stringValue(input.end, "end"),
    group_by: stringArray(input.group_by),
    filters: recordValue(input.filters) as NonNullable<AnthropicCostsInput["filters"]>,
    include_raw: booleanValue(input.include_raw),
  };
}

function toAnthropicDashboardInput(input: Record<string, unknown>): AnthropicDashboardInput {
  const output: AnthropicDashboardInput = {
    credential_ref: stringOrNull(input.credential_ref),
    start: stringValue(input.start, "start"),
    end: stringValue(input.end, "end"),
    bucket_width: bucketWidth(input.bucket_width),
    top_n: numberValue(input.top_n, 10),
    include_metadata: booleanValue(input.include_metadata),
  };
  if (Array.isArray(input.usage_group_by)) {
    output.usage_group_by = stringArray(input.usage_group_by);
  }
  if (Array.isArray(input.cost_group_by)) {
    output.cost_group_by = stringArray(input.cost_group_by);
  }
  return output;
}

function validateStaticCredentialRef(request: CredentialRequest, expectedRef: string): void {
  if (request.credential_ref !== null && request.credential_ref !== undefined && request.credential_ref !== expectedRef) {
    throw new AiAdminError("permission_denied", `Unknown credential_ref for static ${request.provider} configuration`, {
      credential_ref: request.credential_ref,
      expected_credential_ref: expectedRef,
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

function recordValue(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function bucketWidth(value: unknown): "1m" | "1h" | "1d" {
  return value === "1m" || value === "1h" || value === "1d" ? value : "1d";
}

function booleanValue(value: unknown): boolean {
  return value === true;
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
