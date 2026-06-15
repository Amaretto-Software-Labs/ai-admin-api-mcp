import * as z from "zod/v4";
import { AiAdminError, type CredentialRequest } from "../../core/index.js";
import type { ServerConfig } from "../../config.js";
import type { AiAdminProviderPlugin, ProviderRuntime, ProviderToolRegistrar } from "../../plugin.js";
import { asToolResult } from "../../tool-result.js";
import { ELEVENLABS_FILTER_OPERATIONS, ELEVENLABS_USAGE_GROUP_BY } from "./capabilities.js";
import { ElevenLabsProvider } from "./provider.js";
import type { ElevenLabsColumnFilter, ElevenLabsDashboardInput, ElevenLabsListAuditLogsInput, ElevenLabsListRequestsInput, ElevenLabsQueryUsageInput } from "./types.js";

const STATIC_CREDENTIAL_REF = "credential:elevenlabs:static";
const credentialRefSchema = z.string().nullable().optional();
const elevenLabsFilterSchema = z.object({
  column: z.string(),
  operation: z.enum(ELEVENLABS_FILTER_OPERATIONS),
  values: z.array(z.union([z.string(), z.number(), z.boolean(), z.null()])),
});

export const elevenLabsProviderPlugin: AiAdminProviderPlugin = {
  apiVersion: "1",
  id: "elevenlabs",
  displayName: "ElevenLabs",
  inferEnabled: ({ config }) => Boolean(config.elevenlabs.apiKey),
  createProvider: ({ config }) => elevenLabsRuntime(createElevenLabsProvider(config)),
  resolveStaticCredential(request, { config }) {
    if (request.provider !== "elevenlabs") {
      return null;
    }
    validateStaticCredentialRef(request, STATIC_CREDENTIAL_REF);
    if (!config.elevenlabs.apiKey) {
      throw new AiAdminError("configuration_error", "ELEVENLABS_API_KEY is required for ElevenLabs static credential mode");
    }
    return {
      provider: "elevenlabs",
      credential_ref: request.credential_ref ?? STATIC_CREDENTIAL_REF,
      type: "api_key",
      secret: config.elevenlabs.apiKey,
    };
  },
};

function createElevenLabsProvider(config: ServerConfig): ElevenLabsProvider {
  return new ElevenLabsProvider({
    ...(config.elevenlabs.apiKey === undefined ? {} : { apiKey: config.elevenlabs.apiKey }),
    ...(config.elevenlabs.baseUrl === undefined ? {} : { baseUrl: config.elevenlabs.baseUrl }),
    required: config.requiredProviders.includes("elevenlabs"),
    cacheTtlSeconds: config.cacheTtlSeconds,
  });
}

function elevenLabsRuntime(provider: ElevenLabsProvider): ProviderRuntime {
  return {
    id: provider.id,
    displayName: provider.displayName,
    version: provider.version,
    configured: provider.configured,
    required: provider.required,
    capabilities: () => provider.capabilities(),
    registerTools: (registrar, context) => registerElevenLabsTools(registrar, provider, context),
    queryUsage: (input, context) => provider.queryUsage(toElevenLabsUsageInput(input), context),
    queryDashboardBundle: (input, context) => provider.queryDashboardBundle(toElevenLabsDashboardInput(input), context),
  };
}

function registerElevenLabsTools(registrar: ProviderToolRegistrar, provider: ElevenLabsProvider, context: () => Parameters<ElevenLabsProvider["queryUsage"]>[1]): void {
  registrar.registerTool("elevenlabs_admin_get_user", {
    description: "Return ElevenLabs user metadata for the configured API key.",
    inputSchema: {
      credential_ref: credentialRefSchema,
    },
    annotations: { readOnlyHint: true },
  }, async (args) =>
    asToolResult(async () => provider.getUser(stripUndefined(args) as { credential_ref?: string | null }, context())),
  );
  registrar.registerTool("elevenlabs_admin_get_subscription", {
    description: "Return ElevenLabs subscription metadata for the configured API key.",
    inputSchema: {
      credential_ref: credentialRefSchema,
    },
    annotations: { readOnlyHint: true },
  }, async (args) =>
    asToolResult(async () => provider.getSubscription(stripUndefined(args) as { credential_ref?: string | null }, context())),
  );
  registrar.registerTool("elevenlabs_admin_list_service_accounts", {
    description: "List ElevenLabs workspace service accounts.",
    inputSchema: {
      credential_ref: credentialRefSchema,
    },
    annotations: { readOnlyHint: true },
  }, async (args) =>
    asToolResult(async () => provider.listServiceAccounts(stripUndefined(args) as { credential_ref?: string | null }, context())),
  );
  registrar.registerTool(
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
        provider.listServiceAccountApiKeys(
          stripUndefined(args) as { credential_ref?: string | null; service_account_user_id: string },
          context(),
        )),
  );
  registrar.registerTool(
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
    async (args) => asToolResult(async () => provider.listAuditLogs(stripUndefined(args) as ElevenLabsListAuditLogsInput, context())),
  );
  registrar.registerTool(
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
    async (args) => asToolResult(async () => provider.listApiRequests(stripUndefined(args) as ElevenLabsListRequestsInput, context())),
  );
  registrar.registerTool(
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
    async (args) => asToolResult(async () => provider.queryUsage(args as ElevenLabsQueryUsageInput, context())),
  );
  registrar.registerTool(
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
    async (args) => asToolResult(async () => provider.queryDashboardBundle(stripUndefined(args) as ElevenLabsDashboardInput, context())),
  );
}

function toElevenLabsUsageInput(input: Record<string, unknown>): ElevenLabsQueryUsageInput {
  return {
    credential_ref: stringOrNull(input.credential_ref),
    start: stringValue(input.start, "start"),
    end: stringValue(input.end, "end"),
    bucket_width: bucketWidth(input.bucket_width),
    group_by: stringArray(input.group_by),
    filters: Array.isArray(input.filters) ? input.filters as ElevenLabsColumnFilter[] : [],
    time_zone: typeof input.time_zone === "string" ? input.time_zone : "UTC",
    include_raw: booleanValue(input.include_raw),
  };
}

function toElevenLabsDashboardInput(input: Record<string, unknown>): ElevenLabsDashboardInput {
  return {
    credential_ref: stringOrNull(input.credential_ref),
    start: stringValue(input.start, "start"),
    end: stringValue(input.end, "end"),
    bucket_width: bucketWidth(input.bucket_width),
    group_by: stringArray(input.group_by),
    filters: Array.isArray(input.filters) ? input.filters as ElevenLabsColumnFilter[] : [],
    time_zone: typeof input.time_zone === "string" ? input.time_zone : "UTC",
    top_n: numberValue(input.top_n, 10),
    include_metadata: booleanValue(input.include_metadata),
  };
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
