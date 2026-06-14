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
} from "../../core/index.js";
import {
  ANTHROPIC_COST_GROUP_BY,
  ANTHROPIC_MESSAGES_FILTERS,
  ANTHROPIC_MESSAGES_GROUP_BY,
  ANTHROPIC_SPEED_BETA,
} from "./capabilities.js";
import { AnthropicAdminClient } from "./client.js";
import { normalizeAnthropicCostPage, normalizeAnthropicUsagePage } from "./normalize.js";
import type { AnthropicConfig, AnthropicCostData, AnthropicCostsInput, AnthropicDashboardInput, AnthropicMessagesUsageInput, AnthropicUsageData } from "./types.js";

const DEFAULT_MAX_PAGES = 20;
const DEFAULT_METADATA_CACHE_TTL_SECONDS = 300;

export class AnthropicProvider {
  readonly id = "anthropic" as const;
  readonly displayName = "Anthropic";
  readonly version = "0.1.0";
  readonly configured: boolean;
  readonly required: boolean;

  private readonly client: AnthropicAdminClient;
  private readonly betaHeaders: string[];
  private readonly cacheTtlSeconds: number;
  private readonly metadataCacheTtlSeconds: number;
  private readonly metadataCache = new TtlCache<ToolEnvelope<unknown>>();
  private readonly dashboardCache = new TtlCache<ToolEnvelope<DashboardBundle>>();

  constructor(private readonly config: AnthropicConfig = {}) {
    this.configured = Boolean(config.adminKey || config.oauthToken);
    this.required = config.required ?? false;
    this.betaHeaders = config.betaHeaders ?? [];
    this.cacheTtlSeconds = config.cacheTtlSeconds ?? 60;
    this.metadataCacheTtlSeconds = config.metadataCacheTtlSeconds ?? DEFAULT_METADATA_CACHE_TTL_SECONDS;
    this.client = new AnthropicAdminClient(config);
  }

  capabilities(): ProviderCapability {
    return {
      provider: "anthropic",
      display_name: this.displayName,
      version: this.version,
      status: this.configured ? "enabled" : "disabled",
      tools: [
        "anthropic_admin_get_organization",
        "anthropic_admin_list_workspaces",
        "anthropic_admin_list_api_keys",
        "anthropic_admin_query_messages_usage",
        "anthropic_admin_query_costs",
        "anthropic_admin_query_dashboard_bundle",
      ],
      resources: ["anthropic-admin://capabilities"],
      supports_usage: true,
      supports_costs: true,
      direct_queries_can_incur_cost: false,
      freshness_notes: ["Anthropic documents usage and cost data as typically available within about 5 minutes."],
      cost_coverage_gaps: ["Priority Tier costs are not included in the cost endpoint."],
      dimensions: {
        messages_group_by: [...ANTHROPIC_MESSAGES_GROUP_BY],
        cost_group_by: [...ANTHROPIC_COST_GROUP_BY],
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

  async getOrganization(input: { credential_ref?: string | null }, context: QueryContext): Promise<ToolEnvelope<unknown>> {
    return this.metadataTool("anthropic_admin_get_organization", "/organizations/me", input, context);
  }

  async listWorkspaces(input: { credential_ref?: string | null; limit?: number | null; page?: string | null }, context: QueryContext): Promise<ToolEnvelope<unknown>> {
    return this.metadataTool("anthropic_admin_list_workspaces", "/organizations/workspaces", input, context);
  }

  async listApiKeys(input: { credential_ref?: string | null; limit?: number | null; page?: string | null }, context: QueryContext): Promise<ToolEnvelope<unknown>> {
    return this.metadataTool("anthropic_admin_list_api_keys", "/organizations/api_keys", input, context);
  }

  async queryMessagesUsage(input: AnthropicMessagesUsageInput, context: QueryContext): Promise<ToolEnvelope<AnthropicUsageData>> {
    const normalized = normalizeUsageInput(input);
    validateMessagesInput(normalized, this.betaHeaders);
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
    const credential = await this.resolveCredential(context.credentialResolver, normalized.credential_ref, "anthropic_admin_query_messages_usage");
    const queryBase = {
      starting_at: range.start,
      ending_at: range.end,
      bucket_width: range.bucket_width,
      "group_by[]": normalized.group_by,
      limit: normalized.limit ?? undefined,
      ...arrayFilterParams(normalized.filters),
    };
    const pageResult = await paginateCursor((page) => this.client.getMessagesUsagePage({ ...queryBase, page }, credential), normalized.max_pages);
    const usage = pageResult.pages.flatMap((page) => normalizeAnthropicUsagePage(page));

    return envelope({
      provider: "anthropic",
      tool: "anthropic_admin_query_messages_usage",
      time_range: range,
      warnings: pageResult.warnings,
      data: { usage, pagination: pageResult.info },
      raw: normalized.include_raw ? redactValue(pageResult.pages) : null,
      now: context.now(),
    });
  }

  async queryCosts(input: AnthropicCostsInput, context: QueryContext): Promise<ToolEnvelope<AnthropicCostData>> {
    const normalized = normalizeCostsInput(input);
    validateCostInput(normalized.group_by);
    const range = validateTimeRange({
      start: normalized.start,
      end: normalized.end,
      bucket_width: "1d",
    }, {
      maxRangeDays: 180,
      dailyMaxDays: 180,
    });
    const credential = await this.resolveCredential(context.credentialResolver, normalized.credential_ref, "anthropic_admin_query_costs");
    const pageResult = await paginateCursor(
      (page) =>
        this.client.getCostPage({
          starting_at: range.start,
          ending_at: range.end,
          "group_by[]": normalized.group_by,
          "workspace_ids[]": normalized.filters.workspace_ids,
          limit: normalized.limit ?? undefined,
          page,
        }, credential),
      normalized.max_pages,
    );
    const costs = pageResult.pages.flatMap((page) => normalizeAnthropicCostPage(page));
    const warnings = [
      ...pageResult.warnings,
      {
        code: "priority_tier_cost_gap",
        message: "Priority Tier costs are not included in the Anthropic cost endpoint.",
      },
    ];

    return envelope({
      provider: "anthropic",
      tool: "anthropic_admin_query_costs",
      time_range: range,
      warnings,
      data: { costs, pagination: pageResult.info },
      raw: normalized.include_raw ? redactValue(pageResult.pages) : null,
      now: context.now(),
    });
  }

  async queryDashboardBundle(input: AnthropicDashboardInput, context: QueryContext): Promise<ToolEnvelope<DashboardBundle>> {
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
      provider: "anthropic",
      tool: "anthropic_admin_query_dashboard_bundle",
      credential_ref: input.credential_ref ?? null,
      start: range.start,
      end: range.end,
      bucket_width: range.bucket_width,
      usage_group_by: input.usage_group_by ?? null,
      cost_group_by: input.cost_group_by ?? null,
      top_n: input.top_n ?? null,
      include_metadata: input.include_metadata ?? false,
    });
    const cached = this.dashboardCache.get(cacheKey, context.now());
    if (cached !== null) {
      return withCacheStatus(cached, "hit", this.cacheTtlSeconds);
    }

    const usageResult = await this.queryMessagesUsage({
      ...(input.credential_ref === undefined ? {} : { credential_ref: input.credential_ref }),
      start: range.start,
      end: range.end,
      bucket_width: range.bucket_width,
      group_by: input.usage_group_by ?? ["workspace_id", "model", "service_tier"],
      max_pages: DEFAULT_MAX_PAGES,
      include_raw: false,
    }, context);
    const costResult = await this.queryCosts({
      ...(input.credential_ref === undefined ? {} : { credential_ref: input.credential_ref }),
      start: range.start,
      end: range.end,
      group_by: input.cost_group_by ?? ["workspace_id", "description"],
      max_pages: DEFAULT_MAX_PAGES,
      include_raw: false,
    }, context);
    const usageFacts = usageResult.data.usage;
    const costFacts = costResult.data.costs;
    const totalCost = sumNumbers(costFacts.map((fact) => fact.amount.value));
    const bundle: DashboardBundle = {
      provider: "anthropic",
      queried_at: context.now().toISOString(),
      time_range: range,
      summary: {
        provider_reported_cost: totalCost === null ? null : { value: totalCost, currency: "usd", source_unit: "major", raw_value: totalCost },
        input_tokens: sumNumbers(usageFacts.map((fact) => fact.metrics.input_tokens)),
        output_tokens: sumNumbers(usageFacts.map((fact) => fact.metrics.output_tokens)),
        cache_read_input_tokens: sumNumbers(usageFacts.map((fact) => fact.metrics.cache_read_input_tokens)),
        cache_creation_input_tokens: sumNumbers(usageFacts.map((fact) => fact.metrics.cache_creation_input_tokens)),
        request_count: sumNumbers(usageFacts.map((fact) => fact.metrics.request_count)),
        operation_count: null,
      },
      series: { cost_by_bucket: costFacts, usage_by_bucket: usageFacts },
      top: { projects_by_cost: [], workspaces_by_cost: [], models_by_tokens: [], api_keys_by_tokens: [] },
      metadata: { projects: [], workspaces: [], api_keys: [] },
      warnings: [...usageResult.warnings, ...costResult.warnings],
    };

    const result = envelope({
      provider: "anthropic",
      tool: "anthropic_admin_query_dashboard_bundle",
      time_range: range,
      warnings: bundle.warnings,
      data: bundle,
      cache: { status: "miss", ttl_seconds: this.cacheTtlSeconds },
      now: context.now(),
    });
    this.dashboardCache.set(cacheKey, result, this.cacheTtlSeconds, context.now());
    return result;
  }

  defaultDashboardInput(now: Date): AnthropicDashboardInput {
    const range = lastCompleteDaysRange(now, 7, "1d");
    return {
      ...range,
      usage_group_by: ["workspace_id", "model", "service_tier"],
      cost_group_by: ["workspace_id", "description"],
      top_n: 10,
      include_metadata: false,
    };
  }

  private async metadataTool(
    tool: string,
    path: string,
    input: { credential_ref?: string | null; limit?: number | null; page?: string | null },
    context: QueryContext,
  ): Promise<ToolEnvelope<unknown>> {
    const cacheKey = makeCacheKey({
      provider: "anthropic",
      tool,
      path,
      input,
    });
    const cached = this.metadataCache.get(cacheKey, context.now());
    if (cached !== null) {
      return withCacheStatus(cached, "hit", this.metadataCacheTtlSeconds);
    }

    const credential = await this.resolveCredential(context.credentialResolver, input.credential_ref, tool);
    const raw = await this.client.getMetadata(path, { limit: input.limit ?? undefined, page: input.page ?? undefined }, credential);
    const result = envelope({
      provider: "anthropic",
      tool,
      data: redactValue(raw),
      cache: { status: "miss", ttl_seconds: this.metadataCacheTtlSeconds },
      now: context.now(),
    });
    this.metadataCache.set(cacheKey, result, this.metadataCacheTtlSeconds, context.now());
    return result;
  }

  private async resolveCredential(resolver: CredentialResolver, credentialRef: string | null | undefined, tool: string) {
    return resolver.resolve({
      provider: "anthropic",
      credential_ref: credentialRef ?? null,
      tool,
    });
  }
}

function normalizeUsageInput(input: AnthropicMessagesUsageInput): Required<Omit<AnthropicMessagesUsageInput, "credential_ref" | "limit">> & {
  credential_ref: string | null;
  limit: number | null;
} {
  return {
    credential_ref: input.credential_ref ?? null,
    start: input.start,
    end: input.end,
    bucket_width: input.bucket_width ?? "1d",
    group_by: input.group_by ?? [],
    filters: input.filters ?? {},
    limit: input.limit ?? null,
    max_pages: input.max_pages ?? DEFAULT_MAX_PAGES,
    include_raw: input.include_raw ?? false,
  };
}

function normalizeCostsInput(input: AnthropicCostsInput): Required<Omit<AnthropicCostsInput, "credential_ref" | "limit">> & {
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

function validateMessagesInput(input: ReturnType<typeof normalizeUsageInput>, betaHeaders: string[]): void {
  const unsupportedFilters = Object.keys(input.filters).filter((key) => !ANTHROPIC_MESSAGES_FILTERS.includes(key as never));
  const unsupportedGroups = input.group_by.filter((key) => !ANTHROPIC_MESSAGES_GROUP_BY.includes(key as never));
  if (unsupportedFilters.length > 0 || unsupportedGroups.length > 0) {
    throw new AiAdminError("validation_failed", "Unsupported Anthropic messages usage parameter", {
      unsupported_filters: unsupportedFilters,
      unsupported_group_by: unsupportedGroups,
      supported_filters: [...ANTHROPIC_MESSAGES_FILTERS],
      supported_group_by: [...ANTHROPIC_MESSAGES_GROUP_BY],
    });
  }

  const usesSpeed = input.group_by.includes("speed") || (input.filters.speeds?.length ?? 0) > 0;
  if (usesSpeed && !betaHeaders.includes(ANTHROPIC_SPEED_BETA)) {
    throw new AiAdminError("validation_failed", "Anthropic speed dimension requires beta header", {
      required_beta: ANTHROPIC_SPEED_BETA,
    });
  }
}

function validateCostInput(groupBy: string[]): void {
  const unsupported = groupBy.filter((key) => !ANTHROPIC_COST_GROUP_BY.includes(key as never));
  if (unsupported.length > 0) {
    throw new AiAdminError("validation_failed", "Unsupported Anthropic cost group_by value", {
      unsupported_group_by: unsupported,
      supported_group_by: [...ANTHROPIC_COST_GROUP_BY],
    });
  }
}

function arrayFilterParams(filters: Record<string, string[] | undefined>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(filters).map(([key, value]) => {
      const queryKey = key === "context_windows" ? "context_window" : key;
      return [`${queryKey}[]`, value];
    }),
  );
}
