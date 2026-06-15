import {
  AiAdminError,
  TtlCache,
  envelope,
  lastCompleteDaysRange,
  makeCacheKey,
  sumNumbers,
  validateTimeRange,
  warning,
  withCacheStatus,
  type BucketWidth,
  type CredentialResolver,
  type DashboardBundle,
  type MoneyAmount,
  type PaginationInfo,
  type ProviderCapability,
  type QueryContext,
  type ToolEnvelope,
  type Warning,
} from "../../core/index.js";
import { ELEVENLABS_FILTER_OPERATIONS, ELEVENLABS_USAGE_GROUP_BY } from "./capabilities.js";
import { ElevenLabsAdminClient } from "./client.js";
import { normalizeElevenLabsCostRows, normalizeElevenLabsUsageRows } from "./normalize.js";
import type {
  ElevenLabsAnalyticsResponse,
  ElevenLabsColumnFilter,
  ElevenLabsConfig,
  ElevenLabsDashboardInput,
  ElevenLabsListAuditLogsInput,
  ElevenLabsListRequestsInput,
  ElevenLabsQueryUsageInput,
  ElevenLabsUsageData,
} from "./types.js";

const DEFAULT_METADATA_CACHE_TTL_SECONDS = 300;
const DEFAULT_USAGE_GROUP_BY = ["product_type", "model", "user_id", "hashed_xi_api_key"] as const;
const COST_NOT_AVAILABLE_WARNING = warning(
  "cost_not_available",
  "ElevenLabs workspace analytics reports credit usage. Provider-reported monetary cost is not available from the implemented endpoint.",
);

export class ElevenLabsProvider {
  readonly id = "elevenlabs" as const;
  readonly displayName = "ElevenLabs";
  readonly version = "0.1.0";
  readonly configured: boolean;
  readonly required: boolean;

  private readonly client: ElevenLabsAdminClient;
  private readonly cacheTtlSeconds: number;
  private readonly metadataCacheTtlSeconds: number;
  private readonly metadataCache = new TtlCache<ToolEnvelope<unknown>>();
  private readonly dashboardCache = new TtlCache<ToolEnvelope<DashboardBundle>>();

  constructor(private readonly config: ElevenLabsConfig = {}) {
    this.configured = Boolean(config.apiKey);
    this.required = config.required ?? false;
    this.cacheTtlSeconds = config.cacheTtlSeconds ?? 60;
    this.metadataCacheTtlSeconds = config.metadataCacheTtlSeconds ?? DEFAULT_METADATA_CACHE_TTL_SECONDS;
    this.client = new ElevenLabsAdminClient(config);
  }

  capabilities(): ProviderCapability {
    return {
      provider: "elevenlabs",
      display_name: this.displayName,
      version: this.version,
      status: this.configured ? "enabled" : "disabled",
      tools: [
        "elevenlabs_admin_get_user",
        "elevenlabs_admin_get_subscription",
        "elevenlabs_admin_list_service_accounts",
        "elevenlabs_admin_list_service_account_api_keys",
        "elevenlabs_admin_list_audit_logs",
        "elevenlabs_admin_list_api_requests",
        "elevenlabs_admin_query_usage",
        "elevenlabs_admin_query_dashboard_bundle",
      ],
      resources: ["elevenlabs-admin://capabilities"],
      supports_usage: true,
      supports_costs: false,
      direct_queries_can_incur_cost: false,
      freshness_notes: ["ElevenLabs workspace analytics freshness is provider-defined."],
      cost_coverage_gaps: ["The implemented ElevenLabs analytics endpoint reports credits, not provider-reported monetary cost."],
      dimensions: {
        usage_group_by: [...ELEVENLABS_USAGE_GROUP_BY],
        filter_operations: [...ELEVENLABS_FILTER_OPERATIONS],
      },
      limits: {
        usage_bucket_widths: ["1m", "1h", "1d"],
        request_limit_max: 1000,
        audit_log_limit_max: 100,
        metadata_cache_ttl_seconds: this.metadataCacheTtlSeconds,
        dashboard_cache_ttl_seconds: this.cacheTtlSeconds,
      },
      warnings: [COST_NOT_AVAILABLE_WARNING],
    };
  }

  async getUser(input: { credential_ref?: string | null }, context: QueryContext): Promise<ToolEnvelope<unknown>> {
    return this.metadataTool("elevenlabs_admin_get_user", "/user", input, context);
  }

  async getSubscription(input: { credential_ref?: string | null }, context: QueryContext): Promise<ToolEnvelope<unknown>> {
    return this.metadataTool("elevenlabs_admin_get_subscription", "/user/subscription", input, context);
  }

  async listServiceAccounts(input: { credential_ref?: string | null }, context: QueryContext): Promise<ToolEnvelope<unknown>> {
    return this.metadataTool("elevenlabs_admin_list_service_accounts", "/service-accounts", input, context);
  }

  async listServiceAccountApiKeys(
    input: { credential_ref?: string | null; service_account_user_id: string },
    context: QueryContext,
  ): Promise<ToolEnvelope<unknown>> {
    return this.metadataTool(
      "elevenlabs_admin_list_service_account_api_keys",
      `/service-accounts/${encodeURIComponent(input.service_account_user_id)}/api-keys`,
      input,
      context,
    );
  }

  async listAuditLogs(input: ElevenLabsListAuditLogsInput, context: QueryContext): Promise<ToolEnvelope<unknown>> {
    const query = {
      limit: input.limit ?? undefined,
      cursor: input.cursor ?? undefined,
      time_from_unix_ms: optionalUnixMs(input.start, "start"),
      time_to_unix_ms: optionalUnixMs(input.end, "end"),
      actor_uid: input.actor_uid ?? undefined,
      class_name: input.class_name ?? undefined,
      activity_name: input.activity_name ?? undefined,
    };
    return this.metadataTool("elevenlabs_admin_list_audit_logs", "/workspace/audit-logs", input, context, query);
  }

  async listApiRequests(input: ElevenLabsListRequestsInput, context: QueryContext): Promise<ToolEnvelope<ElevenLabsAnalyticsResponse>> {
    const filters = input.filters ?? [];
    validateFilters(filters);
    const credential = await this.resolveCredential(context.credentialResolver, input.credential_ref, "elevenlabs_admin_list_api_requests");
    const body = compact({
      start_time: optionalUnixMs(input.start, "start"),
      end_time: optionalUnixMs(input.end, "end"),
      limit: input.limit ?? undefined,
      sort: input.sort ?? undefined,
      filters: filters.length > 0 ? filters : undefined,
      search: input.search ?? undefined,
    });
    if (!("start_time" in body) && !("end_time" in body)) {
      throw new AiAdminError("validation_failed", "ElevenLabs API request analytics requires start or end");
    }

    const raw = await this.client.listApiRequests(body, credential);
    return envelope({
      provider: "elevenlabs",
      tool: "elevenlabs_admin_list_api_requests",
      data: raw,
      now: context.now(),
    });
  }

  async queryUsage(input: ElevenLabsQueryUsageInput, context: QueryContext): Promise<ToolEnvelope<ElevenLabsUsageData, ElevenLabsAnalyticsResponse>> {
    const normalized = normalizeUsageInput(input);
    validateUsageInput(normalized);
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
    const credential = await this.resolveCredential(context.credentialResolver, normalized.credential_ref, "elevenlabs_admin_query_usage");
    const raw = await this.client.queryWorkspaceUsage({
      start_time: unixMs(range.start),
      end_time: unixMs(range.end),
      interval_seconds: intervalSeconds(range.bucket_width),
      group_by: normalized.group_by.length > 0 ? normalized.group_by : null,
      filters: normalized.filters.length > 0 ? normalized.filters : null,
      time_zone: normalized.time_zone,
    }, credential);
    const usage = normalizeElevenLabsUsageRows(raw, range);

    return envelope({
      provider: "elevenlabs",
      tool: "elevenlabs_admin_query_usage",
      time_range: range,
      warnings: [COST_NOT_AVAILABLE_WARNING],
      data: {
        usage,
        pagination: singlePagePagination(),
      },
      raw: normalized.include_raw ? raw : null,
      now: context.now(),
    });
  }

  async queryDashboardBundle(input: ElevenLabsDashboardInput, context: QueryContext): Promise<ToolEnvelope<DashboardBundle>> {
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
      provider: "elevenlabs",
      tool: "elevenlabs_admin_query_dashboard_bundle",
      credential_ref: input.credential_ref ?? null,
      start: range.start,
      end: range.end,
      bucket_width: range.bucket_width,
      group_by: input.group_by ?? null,
      filters: input.filters ?? null,
      time_zone: input.time_zone ?? "UTC",
      top_n: input.top_n ?? null,
      include_metadata: input.include_metadata ?? false,
    });
    const cached = this.dashboardCache.get(cacheKey, context.now());
    if (cached !== null) {
      return withCacheStatus(cached, "hit", this.cacheTtlSeconds);
    }

    const usageResult = await this.queryUsage({
      ...(input.credential_ref === undefined ? {} : { credential_ref: input.credential_ref }),
      start: range.start,
      end: range.end,
      bucket_width: range.bucket_width,
      group_by: input.group_by ?? [...DEFAULT_USAGE_GROUP_BY],
      filters: input.filters ?? [],
      time_zone: input.time_zone ?? "UTC",
      include_raw: true,
    }, context);
    const usageFacts = usageResult.data.usage;
    const rawUsage = usageResult.raw;
    const costResult = rawUsage === null
      ? { costs: [], warnings: [COST_NOT_AVAILABLE_WARNING] }
      : normalizeElevenLabsCostRows(rawUsage);
    const costFacts = costResult.costs;
    const costSummary = summarizeCosts(costFacts);
    const warnings = dedupeWarnings([
      ...usageResult.warnings,
      ...costResult.warnings,
      ...costSummary.warnings,
      ...(input.include_metadata ? [warning("metadata_not_included", "ElevenLabs dashboard bundles do not inline metadata; use the dedicated ElevenLabs metadata tools.")] : []),
    ]);
    const bundle: DashboardBundle = {
      provider: "elevenlabs",
      queried_at: context.now().toISOString(),
      time_range: range,
      summary: {
        provider_reported_cost: costSummary.amount,
        input_tokens: null,
        output_tokens: null,
        cache_read_input_tokens: null,
        cache_creation_input_tokens: null,
        request_count: sumNumbers(usageFacts.map((fact) => fact.metrics.request_count)),
        operation_count: null,
        credit_count: sumNumbers(usageFacts.map((fact) => fact.metrics.credit_count)),
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
      warnings,
    };

    const result = envelope({
      provider: "elevenlabs",
      tool: "elevenlabs_admin_query_dashboard_bundle",
      time_range: range,
      warnings: bundle.warnings,
      data: bundle,
      cache: { status: "miss", ttl_seconds: this.cacheTtlSeconds },
      now: context.now(),
    });
    this.dashboardCache.set(cacheKey, result, this.cacheTtlSeconds, context.now());
    return result;
  }

  defaultDashboardInput(now: Date): ElevenLabsDashboardInput {
    const range = lastCompleteDaysRange(now, 7, "1d");
    return {
      ...range,
      group_by: [...DEFAULT_USAGE_GROUP_BY],
      time_zone: "UTC",
      top_n: 10,
      include_metadata: false,
    };
  }

  private async metadataTool(
    tool: string,
    path: string,
    input: { credential_ref?: string | null },
    context: QueryContext,
    query: Record<string, unknown> = {},
  ): Promise<ToolEnvelope<unknown>> {
    const cacheKey = makeCacheKey({
      provider: "elevenlabs",
      tool,
      path,
      input,
      query,
    });
    const cached = this.metadataCache.get(cacheKey, context.now());
    if (cached !== null) {
      return withCacheStatus(cached, "hit", this.metadataCacheTtlSeconds);
    }

    const credential = await this.resolveCredential(context.credentialResolver, input.credential_ref, tool);
    const raw = await this.client.getMetadata(path, query, credential);
    const result = envelope({
      provider: "elevenlabs",
      tool,
      data: raw,
      cache: { status: "miss", ttl_seconds: this.metadataCacheTtlSeconds },
      now: context.now(),
    });
    this.metadataCache.set(cacheKey, result, this.metadataCacheTtlSeconds, context.now());
    return result;
  }

  private async resolveCredential(resolver: CredentialResolver, credentialRef: string | null | undefined, tool: string) {
    return resolver.resolve({
      provider: "elevenlabs",
      credential_ref: credentialRef ?? null,
      tool,
    });
  }
}

function normalizeUsageInput(input: ElevenLabsQueryUsageInput): Required<Omit<ElevenLabsQueryUsageInput, "credential_ref">> & {
  credential_ref: string | null;
} {
  return {
    credential_ref: input.credential_ref ?? null,
    start: input.start,
    end: input.end,
    bucket_width: input.bucket_width ?? "1d",
    group_by: input.group_by ?? [],
    filters: input.filters ?? [],
    time_zone: input.time_zone ?? "UTC",
    include_raw: input.include_raw ?? false,
  };
}

function validateUsageInput(input: ReturnType<typeof normalizeUsageInput>): void {
  const unsupportedGroups = input.group_by.filter((key) => !ELEVENLABS_USAGE_GROUP_BY.includes(key as never));
  if (unsupportedGroups.length > 0) {
    throw new AiAdminError("validation_failed", "Unsupported ElevenLabs usage group_by value", {
      unsupported_group_by: unsupportedGroups,
      supported_group_by: [...ELEVENLABS_USAGE_GROUP_BY],
    });
  }
  validateFilters(input.filters);
}

function validateFilters(filters: ElevenLabsColumnFilter[]): void {
  const unsupportedOperations = filters
    .filter((filter) => !ELEVENLABS_FILTER_OPERATIONS.includes(filter.operation as never))
    .map((filter) => filter.operation);
  if (unsupportedOperations.length > 0) {
    throw new AiAdminError("validation_failed", "Unsupported ElevenLabs filter operation", {
      unsupported_operations: unsupportedOperations,
      supported_operations: [...ELEVENLABS_FILTER_OPERATIONS],
    });
  }
}

function intervalSeconds(bucketWidth: BucketWidth): number {
  if (bucketWidth === "1m") {
    return 60;
  }
  if (bucketWidth === "1h") {
    return 3_600;
  }
  return 86_400;
}

function optionalUnixMs(value: string | null | undefined, field: string): number | undefined {
  if (value === null || value === undefined || value === "") {
    return undefined;
  }
  return unixMs(value, field);
}

function unixMs(value: string, field = "time"): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new AiAdminError("validation_failed", `Invalid ElevenLabs ${field} timestamp`, { [field]: value });
  }
  return parsed;
}

function singlePagePagination(): PaginationInfo {
  return {
    pages_fetched: 1,
    provider_request_count: 1,
    truncated: false,
    next_page: null,
  };
}

function summarizeCosts(costs: Array<{ amount: MoneyAmount }>): { amount: MoneyAmount | null; warnings: Warning[] } {
  if (costs.length === 0) {
    return { amount: null, warnings: [COST_NOT_AVAILABLE_WARNING] };
  }
  const currencies = new Set(costs.map((cost) => cost.amount.currency));
  if (currencies.size > 1) {
    return {
      amount: null,
      warnings: [warning("mixed_currency_costs", "ElevenLabs returned monetary rows in multiple currencies; summary cost is omitted.")],
    };
  }
  const value = sumNumbers(costs.map((cost) => cost.amount.value));
  const currency = costs[0]?.amount.currency ?? "usd";
  return {
    amount: value === null ? null : { value, currency, source_unit: "major", raw_value: value },
    warnings: [],
  };
}

function dedupeWarnings(warnings: Warning[]): Warning[] {
  const seen = new Set<string>();
  return warnings.filter((item) => {
    const key = `${item.code}:${item.message}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function compact(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
}
