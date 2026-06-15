import * as z from "zod/v4";
import { AiAdminError, type CredentialRequest } from "../../core/index.js";
import type { ServerConfig } from "../../config.js";
import type { AiAdminProviderPlugin, ProviderRuntime, ProviderToolRegistrar, ProviderPluginContext } from "../../plugin.js";
import { asToolResult } from "../../tool-result.js";
import { OpenAiProvider } from "./provider.js";
import type { OpenAiDashboardInput, OpenAiQueryCostsInput, OpenAiQueryUsageInput } from "./types.js";

const STATIC_CREDENTIAL_REF = "credential:openai:static";
const credentialRefSchema = z.string().nullable().optional();
const openAiListSchema = {
  credential_ref: credentialRefSchema,
  limit: z.number().int().positive().nullable().optional(),
  after: z.string().nullable().optional(),
};

export const openAiProviderPlugin: AiAdminProviderPlugin = {
  apiVersion: "1",
  id: "openai",
  displayName: "OpenAI",
  inferEnabled: ({ config }) => Boolean(config.openai.adminKey),
  createProvider: ({ config }) => openAiRuntime(createOpenAiProvider(config)),
  resolveStaticCredential(request, { config }) {
    if (request.provider !== "openai") {
      return null;
    }
    validateStaticCredentialRef(request, STATIC_CREDENTIAL_REF);
    if (!config.openai.adminKey) {
      throw new AiAdminError("configuration_error", "OPENAI_ADMIN_KEY is required for OpenAI static credential mode");
    }
    return {
      provider: "openai",
      credential_ref: request.credential_ref ?? STATIC_CREDENTIAL_REF,
      type: "bearer",
      secret: config.openai.adminKey,
    };
  },
};

function createOpenAiProvider(config: ServerConfig): OpenAiProvider {
  return new OpenAiProvider({
    ...(config.openai.adminKey === undefined ? {} : { adminKey: config.openai.adminKey }),
    ...(config.openai.baseUrl === undefined ? {} : { baseUrl: config.openai.baseUrl }),
    required: config.requiredProviders.includes("openai"),
    cacheTtlSeconds: config.cacheTtlSeconds,
  });
}

function openAiRuntime(provider: OpenAiProvider): ProviderRuntime {
  return {
    id: provider.id,
    displayName: provider.displayName,
    version: provider.version,
    configured: provider.configured,
    required: provider.required,
    capabilities: () => provider.capabilities(),
    registerTools: (registrar, context) => registerOpenAiTools(registrar, provider, context),
    queryUsage: (input, context) => provider.queryUsage(toOpenAiUsageInput(input), context),
    queryCosts: (input, context) => provider.queryCosts(toOpenAiCostsInput(input), context),
    queryDashboardBundle: (input, context) => provider.queryDashboardBundle(toOpenAiDashboardInput(input), context),
  };
}

function registerOpenAiTools(registrar: ProviderToolRegistrar, provider: OpenAiProvider, context: () => Parameters<OpenAiProvider["queryUsage"]>[1]): void {
  registrar.registerTool(
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
    async (args) => asToolResult(async () => provider.queryUsage(args as OpenAiQueryUsageInput, context())),
  );
  registrar.registerTool(
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
    async (args) => asToolResult(async () => provider.queryCosts(args as OpenAiQueryCostsInput, context())),
  );
  registrar.registerTool("openai_admin_list_projects", {
    description: "List OpenAI projects.",
    inputSchema: openAiListSchema,
    annotations: { readOnlyHint: true },
  }, async (args) =>
    asToolResult(async () => provider.listProjects(stripUndefined(args) as { credential_ref?: string | null; limit?: number | null; after?: string | null }, context())),
  );
  registrar.registerTool("openai_admin_list_users", {
    description: "List OpenAI organization users.",
    inputSchema: openAiListSchema,
    annotations: { readOnlyHint: true },
  }, async (args) =>
    asToolResult(async () => provider.listUsers(stripUndefined(args) as { credential_ref?: string | null; limit?: number | null; after?: string | null }, context())),
  );
  registrar.registerTool(
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
    async (args) => asToolResult(async () => provider.listProjectApiKeys(stripUndefined(args) as { credential_ref?: string | null; project_id: string; limit?: number | null; after?: string | null }, context())),
  );
  registrar.registerTool(
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
    async (args) => asToolResult(async () => provider.queryDashboardBundle(stripUndefined(args) as OpenAiDashboardInput, context())),
  );
}

function toOpenAiUsageInput(input: Record<string, unknown>): OpenAiQueryUsageInput {
  return {
    credential_ref: stringOrNull(input.credential_ref),
    usage_endpoint: (input.usage_endpoint as OpenAiQueryUsageInput["usage_endpoint"] | undefined) ?? "completions",
    start: stringValue(input.start, "start"),
    end: stringValue(input.end, "end"),
    bucket_width: bucketWidth(input.bucket_width),
    group_by: stringArray(input.group_by),
    endpoint_params: recordValue(input.endpoint_params),
    include_raw: booleanValue(input.include_raw),
  };
}

function toOpenAiCostsInput(input: Record<string, unknown>): OpenAiQueryCostsInput {
  return {
    credential_ref: stringOrNull(input.credential_ref),
    start: stringValue(input.start, "start"),
    end: stringValue(input.end, "end"),
    group_by: stringArray(input.group_by),
    filters: recordValue(input.filters) as NonNullable<OpenAiQueryCostsInput["filters"]>,
    include_raw: booleanValue(input.include_raw),
  };
}

function toOpenAiDashboardInput(input: Record<string, unknown>): OpenAiDashboardInput {
  const output: OpenAiDashboardInput = {
    credential_ref: stringOrNull(input.credential_ref),
    start: stringValue(input.start, "start"),
    end: stringValue(input.end, "end"),
    bucket_width: bucketWidth(input.bucket_width),
    top_n: numberValue(input.top_n, 10),
    include_metadata: booleanValue(input.include_metadata),
  };
  if (Array.isArray(input.usage_endpoints)) {
    output.usage_endpoints = input.usage_endpoints as NonNullable<OpenAiDashboardInput["usage_endpoints"]>;
  }
  if (Array.isArray(input.primary_group_by)) {
    output.primary_group_by = stringArray(input.primary_group_by);
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
