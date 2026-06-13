import {
  AiAdminError,
  TtlCache,
  envelope,
  lastCompleteDaysRange,
  makeCacheKey,
  paginateCursor,
  redactValue,
  sumNumbers,
  validateTimeRange,
  withCacheStatus,
  type CredentialResolver,
  type DashboardBundle,
  type ProviderCapability,
  type QueryContext,
  type ToolEnvelope,
} from "@ai-admin-api-mcp/core";
import { OPENAI_COST_GROUP_BY, OPENAI_USAGE_CAPABILITIES, OPENAI_USAGE_ENDPOINTS, type OpenAiUsageEndpoint } from "./capabilities.js";
import { OpenAiAdminClient } from "./client.js";
import { normalizeOpenAiCostPage, normalizeOpenAiUsagePage } from "./normalize.js";
import type { OpenAiConfig, OpenAiCostData, OpenAiDashboardInput, OpenAiQueryCostsInput, OpenAiQueryUsageInput, OpenAiUsageData } from "./types.js";

const DEFAULT_MAX_PAGES = 20;
const DEFAULT_METADATA_CACHE_TTL_SECONDS = 300;

export class OpenAiProvider {
  readonly id = "openai" as const;
  readonly displayName = "OpenAI";
  readonly version = "0.1.0";
  readonly configured: boolean;
  readonly required: boolean;

  private readonly client: OpenAiAdminClient;
  private readonly cacheTtlSeconds: number;
  private readonly metadataCacheTtlSeconds: number;
  private readonly metadataCache = new TtlCache<ToolEnvelope<unknown>>();
  private readonly dashboardCache = new TtlCache<ToolEnvelope<DashboardBundle>>();

  constructor(private readonly config: OpenAiConfig = {}) {
    this.configured = Boolean(config.adminKey);
    this.required = config.required ?? false;
    this.cacheTtlSeconds = config.cacheTtlSeconds ?? 60;
    this.metadataCacheTtlSeconds = config.metadataCacheTtlSeconds ?? DEFAULT_METADATA_CACHE_TTL_SECONDS;
    this.client = new OpenAiAdminClient(config);
  }

  capabilities(): ProviderCapability {
    return {
      provider: "openai",
      display_name: this.displayName,
      version: this.version,
      status: this.configured ? "enabled" : "disabled",
      tools: [
        "openai_admin_list_projects",
        "openai_admin_list_users",
        "openai_admin_list_project_api_keys",
        "openai_admin_query_usage",
        "openai_admin_query_costs",
        "openai_admin_query_dashboard_bundle",
      ],
      resources: ["openai-admin://capabilities"],
      supports_usage: true,
      supports_costs: true,
      direct_queries_can_incur_cost: false,
      freshness_notes: ["OpenAI reporting freshness varies by usage and cost endpoint."],
      cost_coverage_gaps: ["Costs cannot currently group by user_id; user-level cost joins must be labeled estimated."],
      dimensions: {
        usage_endpoints: [...OPENAI_USAGE_ENDPOINTS],
        cost_group_by: [...OPENAI_COST_GROUP_BY],
      },
      limits: {
        usage_bucket_widths: ["1m", "1h", "1d"],
        cost_bucket_widths: ["1d"],
        metadata_cache_ttl_seconds: this.metadataCacheTtlSeconds,
        dashboard_cache_ttl_seconds: this.cacheTtlSeconds,
      },
      warnings: [],
    };
  }

  async listProjects(input: { credential_ref?: string | null; limit?: number | null; after?: string | null }, context: QueryContext): Promise<ToolEnvelope<unknown>> {
    return this.metadataTool("openai_admin_list_projects", "/organization/projects", input, context);
  }

  async listUsers(input: { credential_ref?: string | null; limit?: number | null; after?: string | null }, context: QueryContext): Promise<ToolEnvelope<unknown>> {
    return this.metadataTool("openai_admin_list_users", "/organization/users", input, context);
  }

  async listProjectApiKeys(
    input: { credential_ref?: string | null; project_id: string; limit?: number | null; after?: string | null },
    context: QueryContext,
  ): Promise<ToolEnvelope<unknown>> {
    return this.metadataTool("openai_admin_list_project_api_keys", `/organization/projects/${encodeURIComponent(input.project_id)}/api_keys`, input, context);
  }

  async queryUsage(input: OpenAiQueryUsageInput, context: QueryContext): Promise<ToolEnvelope<OpenAiUsageData>> {
    const normalized = normalizeUsageInput(input);
    const capability = OPENAI_USAGE_CAPABILITIES[normalized.usage_endpoint];
    validateOpenAiUsageInput(normalized, capability);
    const range = validateTimeRange({
      start: normalized.start,
      end: normalized.end,
      bucket_width: normalized.bucket_width,
    }, {
      maxRangeDays: 90,
      minuteMaxHours: 24,
      hourlyMaxDays: 7,
      dailyMaxDays: 31,
    });
    const credential = await this.resolveCredential(context.credentialResolver, normalized.credential_ref, "openai_admin_query_usage");
    const queryBase = {
      start_time: Math.floor(new Date(range.start).getTime() / 1000),
      end_time: Math.floor(new Date(range.end).getTime() / 1000),
      bucket_width: range.bucket_width,
      group_by: normalized.group_by,
      limit: normalized.limit ?? undefined,
      ...normalized.endpoint_params,
    };
    const pageResult = await paginateCursor(
      (page) => this.client.getUsagePage(capability.endpointPath, { ...queryBase, page }, credential),
      normalized.max_pages,
    );
    const usage = pageResult.pages.flatMap((page) => normalizeOpenAiUsagePage(normalized.usage_endpoint, page));

    return envelope({
      provider: "openai",
      tool: "openai_admin_query_usage",
      time_range: range,
      warnings: pageResult.warnings,
      data: {
        usage,
        pagination: pageResult.info,
      },
      raw: normalized.include_raw ? redactValue(pageResult.pages) : null,
      now: context.now(),
    });
  }

  async queryCosts(input: OpenAiQueryCostsInput, context: QueryContext): Promise<ToolEnvelope<OpenAiCostData>> {
    const normalized = normalizeCostsInput(input);
    validateCostGroupBy(normalized.group_by);
    const range = validateTimeRange({
      start: normalized.start,
      end: normalized.end,
      bucket_width: "1d",
    }, {
      maxRangeDays: 180,
      dailyMaxDays: 180,
    });
    const credential = await this.resolveCredential(context.credentialResolver, normalized.credential_ref, "openai_admin_query_costs");
    const queryBase = {
      start_time: Math.floor(new Date(range.start).getTime() / 1000),
      end_time: Math.floor(new Date(range.end).getTime() / 1000),
      bucket_width: "1d",
      group_by: normalized.group_by,
      limit: normalized.limit ?? undefined,
      project_ids: normalized.filters.project_ids,
      api_key_ids: normalized.filters.api_key_ids,
    };
    const pageResult = await paginateCursor((page) => this.client.getCostsPage({ ...queryBase, page }, credential), normalized.max_pages);
    const costs = pageResult.pages.flatMap((page) => normalizeOpenAiCostPage(page));

    return envelope({
      provider: "openai",
      tool: "openai_admin_query_costs",
      time_range: range,
      warnings: pageResult.warnings,
      data: {
        costs,
        pagination: pageResult.info,
      },
      raw: normalized.include_raw ? redactValue(pageResult.pages) : null,
      now: context.now(),
    });
  }

  async queryDashboardBundle(input: OpenAiDashboardInput, context: QueryContext): Promise<ToolEnvelope<DashboardBundle>> {
    const range = validateTimeRange({
      start: input.start,
      end: input.end,
      bucket_width: input.bucket_width ?? "1d",
    }, {
      maxRangeDays: 90,
      minuteMaxHours: 24,
      hourlyMaxDays: 7,
      dailyMaxDays: 31,
    });
    const cacheKey = makeCacheKey({
      provider: "openai",
      tool: "openai_admin_query_dashboard_bundle",
      credential_ref: input.credential_ref ?? null,
      start: range.start,
      end: range.end,
      bucket_width: range.bucket_width,
      usage_endpoints: input.usage_endpoints ?? ["completions"],
      primary_group_by: input.primary_group_by ?? null,
      cost_group_by: input.cost_group_by ?? null,
      top_n: input.top_n ?? null,
      include_metadata: input.include_metadata ?? false,
    });
    const cached = this.dashboardCache.get(cacheKey, context.now());
    if (cached !== null) {
      return withCacheStatus(cached, "hit", this.cacheTtlSeconds);
    }

    const usageEndpoints = input.usage_endpoints ?? ["completions"];
    const usageResults = await Promise.all(
      usageEndpoints.map((usage_endpoint) =>
        this.queryUsage({
          ...(input.credential_ref === undefined ? {} : { credential_ref: input.credential_ref }),
          usage_endpoint,
          start: range.start,
          end: range.end,
          bucket_width: range.bucket_width,
          ...(input.primary_group_by === undefined ? {} : { group_by: input.primary_group_by }),
          endpoint_params: {},
          max_pages: DEFAULT_MAX_PAGES,
          include_raw: false,
        }, context),
      ),
    );
    const costResult = await this.queryCosts({
      ...(input.credential_ref === undefined ? {} : { credential_ref: input.credential_ref }),
      start: range.start,
      end: range.end,
      group_by: input.cost_group_by ?? ["project_id", "line_item"],
      max_pages: DEFAULT_MAX_PAGES,
      include_raw: false,
    }, context);
    const usageFacts = usageResults.flatMap((result) => result.data.usage);
    const costFacts = costResult.data.costs;
    const providerCost = sumNumbers(costFacts.map((fact) => fact.amount.value));
    const bundle: DashboardBundle = {
      provider: "openai",
      queried_at: context.now().toISOString(),
      time_range: range,
      summary: {
        provider_reported_cost: providerCost === null ? null : { value: providerCost, currency: "usd", source_unit: "major", raw_value: providerCost },
        input_tokens: sumNumbers(usageFacts.map((fact) => fact.metrics.input_tokens)),
        output_tokens: sumNumbers(usageFacts.map((fact) => fact.metrics.output_tokens)),
        cache_read_input_tokens: null,
        cache_creation_input_tokens: null,
        request_count: sumNumbers(usageFacts.map((fact) => fact.metrics.request_count)),
        operation_count: sumNumbers(usageFacts.map((fact) => fact.metrics.operation_count)),
      },
      series: {
        cost_by_bucket: costFacts,
        usage_by_bucket: usageFacts,
      },
      top: {
        projects_by_cost: [],
        workspaces_by_cost: [],
        models_by_tokens: [],
        api_keys_by_tokens: [],
      },
      metadata: {
        projects: [],
        workspaces: [],
        api_keys: [],
      },
      warnings: [...usageResults.flatMap((result) => result.warnings), ...costResult.warnings],
    };

    const result = envelope({
      provider: "openai",
      tool: "openai_admin_query_dashboard_bundle",
      time_range: range,
      warnings: bundle.warnings,
      data: bundle,
      cache: { status: "miss", ttl_seconds: this.cacheTtlSeconds },
      now: context.now(),
    });
    this.dashboardCache.set(cacheKey, result, this.cacheTtlSeconds, context.now());
    return result;
  }

  defaultDashboardInput(now: Date): OpenAiDashboardInput {
    const range = lastCompleteDaysRange(now, 7, "1d");
    return {
      ...range,
      usage_endpoints: ["completions"],
      primary_group_by: ["project_id", "model"],
      cost_group_by: ["project_id", "line_item"],
      top_n: 10,
      include_metadata: false,
    };
  }

  private async metadataTool(
    tool: string,
    path: string,
    input: { credential_ref?: string | null; limit?: number | null; after?: string | null },
    context: QueryContext,
  ): Promise<ToolEnvelope<unknown>> {
    const cacheKey = makeCacheKey({
      provider: "openai",
      tool,
      path,
      input,
    });
    const cached = this.metadataCache.get(cacheKey, context.now());
    if (cached !== null) {
      return withCacheStatus(cached, "hit", this.metadataCacheTtlSeconds);
    }

    const credential = await this.resolveCredential(context.credentialResolver, input.credential_ref, tool);
    const raw = await this.client.getMetadata(path, listQuery(input), credential);
    const result = envelope({
      provider: "openai",
      tool,
      data: redactValue(raw),
      raw: null,
      cache: { status: "miss", ttl_seconds: this.metadataCacheTtlSeconds },
      now: context.now(),
    });
    this.metadataCache.set(cacheKey, result, this.metadataCacheTtlSeconds, context.now());
    return result;
  }

  private async resolveCredential(resolver: CredentialResolver, credentialRef: string | null | undefined, tool: string) {
    return resolver.resolve({
      provider: "openai",
      credential_ref: credentialRef ?? null,
      tool,
    });
  }
}

function normalizeUsageInput(input: OpenAiQueryUsageInput): Required<Omit<OpenAiQueryUsageInput, "credential_ref" | "limit">> & {
  credential_ref: string | null;
  limit: number | null;
} {
  return {
    credential_ref: input.credential_ref ?? null,
    usage_endpoint: input.usage_endpoint,
    start: input.start,
    end: input.end,
    bucket_width: input.bucket_width ?? "1d",
    group_by: input.group_by ?? [],
    endpoint_params: input.endpoint_params ?? {},
    limit: input.limit ?? null,
    max_pages: input.max_pages ?? DEFAULT_MAX_PAGES,
    include_raw: input.include_raw ?? false,
  };
}

function normalizeCostsInput(input: OpenAiQueryCostsInput): Required<Omit<OpenAiQueryCostsInput, "credential_ref" | "limit">> & {
  credential_ref: string | null;
  limit: number | null;
} {
  return {
    credential_ref: input.credential_ref ?? null,
    start: input.start,
    end: input.end,
    group_by: input.group_by ?? [],
    filters: input.filters ?? {},
    limit: input.limit ?? null,
    max_pages: input.max_pages ?? DEFAULT_MAX_PAGES,
    include_raw: input.include_raw ?? false,
  };
}

function validateOpenAiUsageInput(
  input: ReturnType<typeof normalizeUsageInput>,
  capability: (typeof OPENAI_USAGE_CAPABILITIES)[OpenAiUsageEndpoint],
): void {
  const unsupportedParams = Object.keys(input.endpoint_params).filter((key) => !capability.filters.includes(key));
  const unsupportedGroups = input.group_by.filter((key) => !capability.groupBy.includes(key));
  if (unsupportedParams.length > 0 || unsupportedGroups.length > 0) {
    throw new AiAdminError("validation_failed", `Unsupported OpenAI usage parameters for ${input.usage_endpoint}`, {
      usage_endpoint: input.usage_endpoint,
      unsupported_endpoint_params: unsupportedParams,
      unsupported_group_by: unsupportedGroups,
      supported_endpoint_params: capability.filters,
      supported_group_by: capability.groupBy,
    });
  }
}

function validateCostGroupBy(groupBy: string[]): void {
  const unsupported = groupBy.filter((key) => !OPENAI_COST_GROUP_BY.includes(key as (typeof OPENAI_COST_GROUP_BY)[number]));
  if (unsupported.length > 0) {
    throw new AiAdminError("validation_failed", "Unsupported OpenAI costs group_by value", {
      unsupported_group_by: unsupported,
      supported_group_by: [...OPENAI_COST_GROUP_BY],
    });
  }
}

function listQuery(input: { limit?: number | null; after?: string | null }): Record<string, unknown> {
  return {
    limit: input.limit ?? undefined,
    after: input.after ?? undefined,
  };
}
