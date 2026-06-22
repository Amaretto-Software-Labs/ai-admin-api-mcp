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
import {
  OPENROUTER_ACTIVITY_WINDOW_DAYS,
  OPENROUTER_ANALYTICS_COST_METRICS,
  OPENROUTER_ANALYTICS_DEFAULT_USAGE_METRICS,
  OPENROUTER_DEFAULT_DIMENSIONS,
  OPENROUTER_USAGE_SOURCES,
} from "./capabilities.js";
import { OpenRouterAdminClient } from "./client.js";
import {
  OPENROUTER_CURRENCY_WARNING,
  analyticsWarnings,
  normalizeOpenRouterActivityCostRows,
  normalizeOpenRouterActivityUsageRows,
  normalizeOpenRouterAnalyticsCostRows,
  normalizeOpenRouterAnalyticsUsageRows,
  normalizeOpenRouterGenerationCost,
  normalizeOpenRouterGenerationUsage,
} from "./normalize.js";
import type {
  OpenRouterActivityInput,
  OpenRouterActivityResponse,
  OpenRouterAnalyticsMetaResponse,
  OpenRouterAnalyticsQueryInput,
  OpenRouterAnalyticsQueryResponse,
  OpenRouterConfig,
  OpenRouterCostData,
  OpenRouterDashboardInput,
  OpenRouterGenerationInput,
  OpenRouterGenerationResponse,
  OpenRouterGetApiKeyInput,
  OpenRouterListApiKeysInput,
  OpenRouterModelsInput,
  OpenRouterQueryCostsInput,
  OpenRouterQueryUsageInput,
  OpenRouterUsageData,
} from "./types.js";

const DEFAULT_METADATA_CACHE_TTL_SECONDS = 300;
const STATIC_CREDENTIAL_REF = "credential:openrouter:static";
const MANAGEMENT_CREDENTIAL_REF = "credential:openrouter:management";
const API_CREDENTIAL_REF = "credential:openrouter:api";
const BETA_ANALYTICS_WARNING = warning("openrouter_analytics_beta", "OpenRouter analytics metadata and query endpoints are documented as Beta Analytics.");
const ACTIVITY_WINDOW_WARNING = warning("openrouter_activity_window", "OpenRouter activity is limited to the last 30 completed UTC days.");
const GENERATION_POINT_LOOKUP_WARNING = warning("openrouter_generation_point_lookup", "OpenRouter generation metadata is a point lookup and does not list all generations.");

export class OpenRouterProvider {
  readonly id = "openrouter" as const;
  readonly displayName = "OpenRouter";
  readonly version = "0.1.0";
  readonly configured: boolean;
  readonly required: boolean;

  private readonly client: OpenRouterAdminClient;
  private readonly cacheTtlSeconds: number;
  private readonly metadataCacheTtlSeconds: number;
  private readonly metadataCache = new TtlCache<ToolEnvelope<unknown>>();
  private readonly analyticsMetaCache = new TtlCache<OpenRouterAnalyticsMetaResponse>();
  private readonly dashboardCache = new TtlCache<ToolEnvelope<DashboardBundle>>();

  constructor(private readonly config: OpenRouterConfig = {}) {
    this.configured = Boolean(config.managementKey || config.apiKey);
    this.required = config.required ?? false;
    this.cacheTtlSeconds = config.cacheTtlSeconds ?? 60;
    this.metadataCacheTtlSeconds = config.metadataCacheTtlSeconds ?? DEFAULT_METADATA_CACHE_TTL_SECONDS;
    this.client = new OpenRouterAdminClient(config);
  }

  capabilities(): ProviderCapability {
    return {
      provider: "openrouter",
      display_name: this.displayName,
      version: this.version,
      status: this.configured ? "enabled" : "disabled",
      tools: [
        "openrouter_admin_get_current_key",
        "openrouter_admin_list_api_keys",
        "openrouter_admin_get_api_key",
        "openrouter_admin_get_credits",
        "openrouter_admin_get_activity",
        "openrouter_admin_get_analytics_meta",
        "openrouter_admin_query_analytics",
        "openrouter_admin_get_generation",
        "openrouter_admin_list_models",
        "openrouter_admin_query_usage",
        "openrouter_admin_query_costs",
        "openrouter_admin_query_dashboard_bundle",
      ],
      resources: ["openrouter-admin://capabilities"],
      supports_usage: true,
      supports_costs: true,
      direct_queries_can_incur_cost: false,
      freshness_notes: [
        "OpenRouter analytics freshness is provider-defined.",
        "OpenRouter activity covers the provider-supported last completed UTC days window.",
      ],
      cost_coverage_gaps: [
        "Model catalog pricing is not used as authoritative historical spend.",
        "BYOK usage can be returned separately and is preserved in provider details.",
      ],
      dimensions: {
        sources: [...OPENROUTER_USAGE_SOURCES],
        default_dimensions: [...OPENROUTER_DEFAULT_DIMENSIONS],
        normalized_dimensions: ["workspace_id", "user_id", "api_key_id", "model", "service_tier", "line_item", "description"],
      },
      limits: {
        activity_window_days: OPENROUTER_ACTIVITY_WINDOW_DAYS,
        metadata_cache_ttl_seconds: this.metadataCacheTtlSeconds,
        dashboard_cache_ttl_seconds: this.cacheTtlSeconds,
      },
      warnings: [
        BETA_ANALYTICS_WARNING,
        ACTIVITY_WINDOW_WARNING,
        GENERATION_POINT_LOOKUP_WARNING,
        OPENROUTER_CURRENCY_WARNING,
        ...(this.config.managementKey === undefined ? [warning("openrouter_management_key_missing", "OPENROUTER_MANAGEMENT_KEY is required for aggregate OpenRouter reporting tools.")] : []),
      ],
    };
  }

  async getCurrentKey(input: { credential_ref?: string | null; include_raw?: boolean }, context: QueryContext): Promise<ToolEnvelope<unknown>> {
    const credential = await this.resolveAnyCredential(context.credentialResolver, input.credential_ref, "openrouter_admin_get_current_key");
    const raw = await this.client.getCurrentKey(credential);
    return envelope({
      provider: "openrouter",
      tool: "openrouter_admin_get_current_key",
      data: { key: dataObject(raw) },
      raw: input.include_raw === true ? raw : null,
      now: context.now(),
    });
  }

  async listApiKeys(input: OpenRouterListApiKeysInput, context: QueryContext): Promise<ToolEnvelope<unknown>> {
    const query = compact({
      include_disabled: input.include_disabled,
      offset: input.offset ?? undefined,
      workspace_id: input.workspace_id ?? undefined,
    });
    const raw = await this.cachedMetadataTool("openrouter_admin_list_api_keys", "/keys", input, context, query, true);
    return {
      ...raw,
      data: {
        api_keys: dataArray(raw.data),
      },
      raw: input.include_raw === true ? raw.raw : null,
    };
  }

  async getApiKey(input: OpenRouterGetApiKeyInput, context: QueryContext): Promise<ToolEnvelope<unknown>> {
    if (input.hash.trim() === "") {
      throw new AiAdminError("validation_failed", "OpenRouter API key hash is required");
    }
    const raw = await this.cachedMetadataTool("openrouter_admin_get_api_key", `/keys/${encodeURIComponent(input.hash)}`, input, context, {}, true);
    return {
      ...raw,
      data: {
        api_key: dataObject(raw.data),
      },
      raw: input.include_raw === true ? raw.raw : null,
    };
  }

  async getCredits(input: { credential_ref?: string | null; include_raw?: boolean }, context: QueryContext): Promise<ToolEnvelope<unknown>> {
    const credential = await this.resolveManagementCredential(context.credentialResolver, input.credential_ref, "openrouter_admin_get_credits");
    const raw = await this.client.getCredits(credential);
    const totalCredits = numberOrNull(raw.data.total_credits);
    const totalUsage = numberOrNull(raw.data.total_usage);
    const warnings = [
      ...(totalCredits === null || totalUsage === null ? [warning("openrouter_credits_non_numeric", "OpenRouter credits response did not include numeric total_credits and total_usage.")] : []),
      OPENROUTER_CURRENCY_WARNING,
    ];
    return envelope({
      provider: "openrouter",
      tool: "openrouter_admin_get_credits",
      warnings,
      data: {
        total_credits: totalCredits,
        total_usage: totalUsage,
        remaining_credits: totalCredits === null || totalUsage === null ? null : totalCredits - totalUsage,
      },
      raw: input.include_raw === true ? raw : null,
      now: context.now(),
    });
  }

  async getActivity(input: OpenRouterActivityInput, context: QueryContext): Promise<ToolEnvelope<OpenRouterUsageData & OpenRouterCostData, OpenRouterActivityResponse>> {
    validateActivityDate(input.date, context.now());
    const credential = await this.resolveManagementCredential(context.credentialResolver, input.credential_ref, "openrouter_admin_get_activity");
    const raw = await this.client.getActivity(compact({
      date: input.date ?? undefined,
      api_key_hash: input.api_key_hash ?? undefined,
      user_id: input.user_id ?? undefined,
    }), credential);
    const usage = normalizeOpenRouterActivityUsageRows(raw);
    const costResult = normalizeOpenRouterActivityCostRows(raw);
    const warnings = dedupeWarnings([
      ACTIVITY_WINDOW_WARNING,
      ...(input.date === undefined || input.date === null ? [warning("openrouter_activity_provider_window", "OpenRouter returned its provider-defined activity window because no single UTC date was requested.")] : []),
      ...costResult.warnings,
    ]);

    return envelope({
      provider: "openrouter",
      tool: "openrouter_admin_get_activity",
      warnings,
      data: {
        usage,
        costs: costResult.costs,
        pagination: singlePagePagination(),
      },
      raw: input.include_raw === true ? raw : null,
      now: context.now(),
    });
  }

  async getAnalyticsMeta(input: { credential_ref?: string | null; include_raw?: boolean }, context: QueryContext): Promise<ToolEnvelope<OpenRouterAnalyticsMetaResponse["data"], OpenRouterAnalyticsMetaResponse>> {
    const cached = await this.getAnalyticsMetaDataWithCache(input.credential_ref, context);
    const raw = cached.response;
    return envelope({
      provider: "openrouter",
      tool: "openrouter_admin_get_analytics_meta",
      warnings: [BETA_ANALYTICS_WARNING],
      data: raw.data,
      raw: input.include_raw === true ? raw : null,
      cache: { status: cached.status, ttl_seconds: this.metadataCacheTtlSeconds },
      now: context.now(),
    });
  }

  async queryAnalytics(input: OpenRouterAnalyticsQueryInput, context: QueryContext): Promise<ToolEnvelope<OpenRouterUsageData & OpenRouterCostData, OpenRouterAnalyticsQueryResponse>> {
    const range = validateAnalyticsRange(input);
    const meta = await this.getAnalyticsMetaData(input.credential_ref, context);
    const normalized = normalizeAnalyticsInput(input, meta, range, "usage");
    validateAnalyticsInput(normalized, meta);
    const credential = await this.resolveManagementCredential(context.credentialResolver, normalized.credential_ref, "openrouter_admin_query_analytics");
    const raw = await this.client.queryAnalytics(analyticsBody(normalized, range), credential);
    const usage = normalizeOpenRouterAnalyticsUsageRows(raw, range);
    const costResult = normalizeOpenRouterAnalyticsCostRows(raw, range);
    const warnings = dedupeWarnings([
      BETA_ANALYTICS_WARNING,
      ...analyticsWarnings(raw),
      ...costResult.warnings,
    ]);

    return envelope({
      provider: "openrouter",
      tool: "openrouter_admin_query_analytics",
      time_range: range,
      warnings,
      data: {
        usage,
        costs: costResult.costs,
        pagination: singlePagePagination(raw.data.metadata?.truncated === true),
      },
      raw: normalized.include_raw ? raw : null,
      now: context.now(),
    });
  }

  async getGeneration(input: OpenRouterGenerationInput, context: QueryContext): Promise<ToolEnvelope<OpenRouterUsageData & OpenRouterCostData, OpenRouterGenerationResponse>> {
    if (input.id.trim() === "") {
      throw new AiAdminError("validation_failed", "OpenRouter generation id is required");
    }
    const credential = await this.resolveAnyCredential(context.credentialResolver, input.credential_ref, "openrouter_admin_get_generation");
    const raw = await this.client.getGeneration(input.id, credential);
    const usage = normalizeOpenRouterGenerationUsage(raw.data);
    const costResult = normalizeOpenRouterGenerationCost(raw.data);
    const warnings = dedupeWarnings([GENERATION_POINT_LOOKUP_WARNING, ...costResult.warnings]);

    return envelope({
      provider: "openrouter",
      tool: "openrouter_admin_get_generation",
      warnings,
      data: {
        usage: [usage],
        costs: costResult.costs,
        pagination: singlePagePagination(),
      },
      raw: input.include_raw === true ? raw : null,
      now: context.now(),
    });
  }

  async listModels(input: OpenRouterModelsInput, context: QueryContext): Promise<ToolEnvelope<unknown>> {
    const raw = await this.cachedMetadataTool("openrouter_admin_list_models", "/models", input, context, compact({
      category: input.category ?? undefined,
      supported_parameters: input.supported_parameters ?? undefined,
      output_modalities: input.output_modalities ?? undefined,
      sort: input.sort ?? undefined,
    }), false);
    return {
      ...raw,
      warnings: [warning("catalog_pricing_not_spend", "OpenRouter model pricing metadata is not authoritative historical spend.")],
      data: {
        models: dataArray(raw.data),
      },
      raw: input.include_raw === true ? raw.raw : null,
    };
  }

  async queryUsage(input: OpenRouterQueryUsageInput, context: QueryContext): Promise<ToolEnvelope<OpenRouterUsageData>> {
    const range = validateTimeRange({
      start: input.start,
      end: input.end,
      bucket_width: input.bucket_width ?? "1d",
    }, rangeLimits());
    const source = input.source ?? "analytics";

    if (source === "generation") {
      const generationResult = await this.queryGenerationIds(input.generation_ids ?? [], input.credential_ref, input.include_raw === true, context);
      return envelope({
        provider: "openrouter",
        tool: "openrouter_admin_query_usage",
        time_range: range,
        warnings: generationResult.warnings,
        data: {
          usage: generationResult.usage,
          pagination: generationResult.pagination,
        },
        raw: input.include_raw === true ? generationResult.raw : null,
        now: context.now(),
      });
    }

    if (source === "activity") {
      const activity = await this.getActivity(activityInputFromCommon(input, range, context.now()), context);
      return envelope({
        provider: "openrouter",
        tool: "openrouter_admin_query_usage",
        time_range: range,
        warnings: activity.warnings,
        data: {
          usage: activity.data.usage,
          pagination: activity.data.pagination,
        },
        raw: input.include_raw === true ? activity.raw : null,
        now: context.now(),
      });
    }

    const meta = await this.getAnalyticsMetaData(input.credential_ref, context);
    const normalized = normalizeAnalyticsInput(input, meta, range, "usage");
    validateAnalyticsInput(normalized, meta);
    const credential = await this.resolveManagementCredential(context.credentialResolver, normalized.credential_ref, "openrouter_admin_query_usage");
    const raw = await this.client.queryAnalytics(analyticsBody(normalized, range), credential);
    const usage = normalizeOpenRouterAnalyticsUsageRows(raw, range);
    return envelope({
      provider: "openrouter",
      tool: "openrouter_admin_query_usage",
      time_range: range,
      warnings: dedupeWarnings([BETA_ANALYTICS_WARNING, ...analyticsWarnings(raw)]),
      data: {
        usage,
        pagination: singlePagePagination(raw.data.metadata?.truncated === true),
      },
      raw: normalized.include_raw ? raw : null,
      now: context.now(),
    });
  }

  async queryCosts(input: OpenRouterQueryCostsInput, context: QueryContext): Promise<ToolEnvelope<OpenRouterCostData>> {
    const range = validateTimeRange({
      start: input.start,
      end: input.end,
      bucket_width: bucketWidthFromGranularity(input.granularity),
    }, rangeLimits());
    const source = input.source ?? "analytics";

    if (source === "generation") {
      const generationResult = await this.queryGenerationIds(input.generation_ids ?? [], input.credential_ref, input.include_raw === true, context);
      return envelope({
        provider: "openrouter",
        tool: "openrouter_admin_query_costs",
        time_range: range,
        warnings: generationResult.warnings,
        data: {
          costs: generationResult.costs,
          pagination: generationResult.pagination,
        },
        raw: input.include_raw === true ? generationResult.raw : null,
        now: context.now(),
      });
    }

    if (source === "activity") {
      const activity = await this.getActivity(activityInputFromCommon(input, range, context.now()), context);
      return envelope({
        provider: "openrouter",
        tool: "openrouter_admin_query_costs",
        time_range: range,
        warnings: activity.warnings,
        data: {
          costs: activity.data.costs,
          pagination: activity.data.pagination,
        },
        raw: input.include_raw === true ? activity.raw : null,
        now: context.now(),
      });
    }

    const meta = await this.getAnalyticsMetaData(input.credential_ref, context);
    if ((input.metrics === undefined || input.metrics.length === 0) && availableCostMetrics(meta).length === 0) {
      const activityInput = activityInputFromCommon(input, range, context.now());
      if (activityInput.date === undefined) {
        return envelope({
          provider: "openrouter",
          tool: "openrouter_admin_query_costs",
          time_range: range,
          warnings: [
            warning("analytics_cost_metric_unavailable", "OpenRouter analytics metadata did not expose a recognized spend metric."),
            warning("activity_fallback_requires_date", "OpenRouter activity fallback requires a single completed UTC date to avoid returning a provider-defined window for a different requested range."),
          ],
          data: {
            costs: [],
            pagination: singlePagePagination(),
          },
          raw: null,
          now: context.now(),
        });
      }
      const activity = await this.getActivity(activityInput, context);
      return envelope({
        provider: "openrouter",
        tool: "openrouter_admin_query_costs",
        time_range: range,
        warnings: dedupeWarnings([
          warning("analytics_cost_metric_unavailable", "OpenRouter analytics metadata did not expose a recognized spend metric; fell back to activity data."),
          ...activity.warnings,
        ]),
        data: {
          costs: activity.data.costs,
          pagination: activity.data.pagination,
        },
        raw: input.include_raw === true ? activity.raw : null,
        now: context.now(),
      });
    }

    const normalized = normalizeAnalyticsInput(input, meta, range, "costs");
    validateAnalyticsInput(normalized, meta);
    const credential = await this.resolveManagementCredential(context.credentialResolver, normalized.credential_ref, "openrouter_admin_query_costs");
    const raw = await this.client.queryAnalytics(analyticsBody(normalized, range), credential);
    const costResult = normalizeOpenRouterAnalyticsCostRows(raw, range);
    return envelope({
      provider: "openrouter",
      tool: "openrouter_admin_query_costs",
      time_range: range,
      warnings: dedupeWarnings([BETA_ANALYTICS_WARNING, ...analyticsWarnings(raw), ...costResult.warnings]),
      data: {
        costs: costResult.costs,
        pagination: singlePagePagination(raw.data.metadata?.truncated === true),
      },
      raw: normalized.include_raw ? raw : null,
      now: context.now(),
    });
  }

  async queryDashboardBundle(input: OpenRouterDashboardInput, context: QueryContext): Promise<ToolEnvelope<DashboardBundle>> {
    const range = validateTimeRange({
      start: input.start,
      end: input.end,
      bucket_width: input.bucket_width ?? "1d",
    }, rangeLimits());
    const cacheKey = makeCacheKey({
      provider: "openrouter",
      tool: "openrouter_admin_query_dashboard_bundle",
      input: {
        ...input,
        start: range.start,
        end: range.end,
        bucket_width: range.bucket_width,
      },
    });
    const cached = this.dashboardCache.get(cacheKey, context.now());
    if (cached !== null) {
      return withCacheStatus(cached, "hit", this.cacheTtlSeconds);
    }

    const usageResult = await this.queryUsage(dashboardUsageInput(input, range), context);
    const costResult = await this.queryCosts(dashboardCostInput(input, range), context);
    const usageFacts = usageResult.data.usage;
    const costFacts = costResult.data.costs;
    const metadata = input.include_metadata === true ? await this.dashboardMetadata(input.credential_ref, context) : { apiKeys: [], warnings: [] };
    const warnings = dedupeWarnings([
      ...usageResult.warnings,
      ...costResult.warnings,
      ...metadata.warnings,
    ]);
    const bundle: DashboardBundle = {
      provider: "openrouter",
      queried_at: context.now().toISOString(),
      time_range: range,
      summary: {
        provider_reported_cost: summarizeCosts(costFacts).amount,
        input_tokens: sumNumbers(usageFacts.map((fact) => fact.metrics.input_tokens)),
        output_tokens: sumNumbers(usageFacts.map((fact) => fact.metrics.output_tokens)),
        cache_read_input_tokens: sumNumbers(usageFacts.map((fact) => fact.metrics.cache_read_input_tokens)),
        cache_creation_input_tokens: sumNumbers(usageFacts.map((fact) => fact.metrics.cache_creation_input_tokens)),
        request_count: sumNumbers(usageFacts.map((fact) => fact.metrics.request_count)),
        operation_count: sumNumbers(usageFacts.map((fact) => fact.metrics.operation_count)),
        credit_count: sumNumbers(usageFacts.map((fact) => fact.metrics.credit_count)),
      },
      series: {
        cost_by_bucket: costFacts,
        usage_by_bucket: usageFacts,
      },
      top: {
        projects_by_cost: [],
        workspaces_by_cost: [],
        models_by_tokens: topByUsageDimension(usageFacts, "model", input.top_n ?? 10),
        api_keys_by_tokens: topByUsageDimension(usageFacts, "api_key_id", input.top_n ?? 10),
      },
      metadata: {
        projects: [],
        workspaces: [],
        api_keys: metadata.apiKeys,
      },
      warnings,
    };
    const result = envelope({
      provider: "openrouter",
      tool: "openrouter_admin_query_dashboard_bundle",
      time_range: range,
      warnings: bundle.warnings,
      data: bundle,
      cache: { status: "miss", ttl_seconds: this.cacheTtlSeconds },
      now: context.now(),
    });
    this.dashboardCache.set(cacheKey, result, this.cacheTtlSeconds, context.now());
    return result;
  }

  defaultDashboardInput(now: Date): OpenRouterDashboardInput {
    return {
      ...lastCompleteDaysRange(now, 7, "1d"),
      source: "analytics",
      dimensions: [...OPENROUTER_DEFAULT_DIMENSIONS],
      top_n: 10,
      include_metadata: false,
    };
  }

  private async cachedMetadataTool(
    tool: string,
    path: string,
    input: { credential_ref?: string | null; include_raw?: boolean },
    context: QueryContext,
    query: Record<string, unknown>,
    managementOnly: boolean,
  ): Promise<ToolEnvelope<unknown>> {
    const cacheKey = makeCacheKey({ provider: "openrouter", tool, path, query, credential_ref: input.credential_ref ?? null, include_raw: input.include_raw === true });
    const cached = this.metadataCache.get(cacheKey, context.now());
    if (cached !== null) {
      return withCacheStatus(cached, "hit", this.metadataCacheTtlSeconds);
    }

    const credential = managementOnly
      ? await this.resolveManagementCredential(context.credentialResolver, input.credential_ref, tool)
      : await this.resolveAnyCredential(context.credentialResolver, input.credential_ref, tool);
    const raw = await this.client.getMetadata(path, query, credential);
    const result = envelope({
      provider: "openrouter",
      tool,
      data: raw,
      raw: input.include_raw === true ? raw : null,
      cache: { status: "miss", ttl_seconds: this.metadataCacheTtlSeconds },
      now: context.now(),
    });
    this.metadataCache.set(cacheKey, result, this.metadataCacheTtlSeconds, context.now());
    return result;
  }

  private async getAnalyticsMetaData(credentialRef: string | null | undefined, context: QueryContext): Promise<OpenRouterAnalyticsMetaResponse> {
    return (await this.getAnalyticsMetaDataWithCache(credentialRef, context)).response;
  }

  private async getAnalyticsMetaDataWithCache(
    credentialRef: string | null | undefined,
    context: QueryContext,
  ): Promise<{ response: OpenRouterAnalyticsMetaResponse; status: "hit" | "miss" }> {
    const cacheKey = makeCacheKey({ provider: "openrouter", tool: "openrouter_admin_get_analytics_meta", credential_ref: credentialRef ?? "management" });
    const cached = this.analyticsMetaCache.get(cacheKey, context.now());
    if (cached !== null) {
      return { response: cached, status: "hit" };
    }

    const credential = await this.resolveManagementCredential(context.credentialResolver, credentialRef, "openrouter_admin_get_analytics_meta");
    const raw = await this.client.getAnalyticsMeta(credential);
    this.analyticsMetaCache.set(cacheKey, raw, this.metadataCacheTtlSeconds, context.now());
    return { response: raw, status: "miss" };
  }

  private async queryGenerationIds(
    generationIds: string[],
    credentialRef: string | null | undefined,
    includeRaw: boolean,
    context: QueryContext,
  ): Promise<{ usage: OpenRouterUsageData["usage"]; costs: OpenRouterCostData["costs"]; pagination: PaginationInfo; warnings: Warning[]; raw: OpenRouterGenerationResponse[] | null }> {
    const ids = generationIds.filter((id) => id.trim() !== "");
    if (ids.length === 0) {
      throw new AiAdminError("validation_failed", "OpenRouter generation source requires generation_ids");
    }
    const usage: OpenRouterUsageData["usage"] = [];
    const costs: OpenRouterCostData["costs"] = [];
    const warnings: Warning[] = [GENERATION_POINT_LOOKUP_WARNING];
    const rawResponses: OpenRouterGenerationResponse[] = [];
    for (const id of ids) {
      const result = await this.getGeneration({ id, credential_ref: credentialRef ?? null, include_raw: includeRaw }, context);
      usage.push(...result.data.usage);
      costs.push(...result.data.costs);
      warnings.push(...result.warnings);
      if (includeRaw && result.raw !== null) {
        rawResponses.push(result.raw);
      }
    }
    return {
      usage,
      costs,
      pagination: {
        pages_fetched: ids.length,
        provider_request_count: ids.length,
        truncated: false,
        next_page: null,
      },
      warnings: dedupeWarnings(warnings),
      raw: includeRaw ? rawResponses : null,
    };
  }

  private async dashboardMetadata(credentialRef: string | null | undefined, context: QueryContext): Promise<{ apiKeys: Array<Record<string, unknown>>; warnings: Warning[] }> {
    try {
      const keys = await this.listApiKeys({ credential_ref: credentialRef ?? null }, context);
      return {
        apiKeys: dataArray(keys.raw ?? keys.data).filter((item): item is Record<string, unknown> => item !== null && typeof item === "object" && !Array.isArray(item)),
        warnings: [],
      };
    } catch (error) {
      return {
        apiKeys: [],
        warnings: [warning("metadata_unavailable", error instanceof Error ? error.message : "OpenRouter metadata unavailable")],
      };
    }
  }

  private async resolveAnyCredential(resolver: CredentialResolver, credentialRef: string | null | undefined, tool: string) {
    return resolver.resolve({
      provider: "openrouter",
      credential_ref: credentialRef ?? null,
      tool,
    });
  }

  private async resolveManagementCredential(resolver: CredentialResolver, credentialRef: string | null | undefined, tool: string) {
    if (credentialRef === API_CREDENTIAL_REF) {
      throw new AiAdminError("configuration_error", "OpenRouter management tools require OPENROUTER_MANAGEMENT_KEY, not OPENROUTER_API_KEY", {
        credential_ref: credentialRef,
        tool,
      });
    }
    return resolver.resolve({
      provider: "openrouter",
      credential_ref: credentialRef === null || credentialRef === undefined || credentialRef === STATIC_CREDENTIAL_REF ? MANAGEMENT_CREDENTIAL_REF : credentialRef,
      tool,
    });
  }
}

interface NormalizedAnalyticsInput {
  credential_ref: string | null;
  metrics: string[];
  dimensions: string[];
  filters: Array<Record<string, unknown>>;
  granularity: string | null;
  group_limit: number | null;
  limit: number | null;
  order_by: Record<string, unknown> | null;
  include_raw: boolean;
}

function validateAnalyticsRange(input: OpenRouterAnalyticsQueryInput): ReturnType<typeof validateTimeRange> {
  const start = input.time_range?.start;
  const end = input.time_range?.end;
  if (start === undefined || end === undefined) {
    throw new AiAdminError("validation_failed", "OpenRouter analytics query requires time_range.start and time_range.end");
  }
  return validateTimeRange({
    start,
    end,
    bucket_width: bucketWidthFromGranularity(input.granularity),
  }, rangeLimits());
}

function dashboardUsageInput(input: OpenRouterDashboardInput, range: { start: string; end: string; bucket_width: BucketWidth }): OpenRouterQueryUsageInput {
  return stripUndefined({
    credential_ref: input.credential_ref ?? null,
    start: range.start,
    end: range.end,
    bucket_width: range.bucket_width,
    source: input.source ?? "analytics",
    metrics: input.metrics,
    dimensions: input.dimensions,
    filters: input.filters,
    granularity: input.granularity,
    group_limit: input.group_limit,
    limit: input.limit,
    include_raw: false,
  }) as OpenRouterQueryUsageInput;
}

function dashboardCostInput(input: OpenRouterDashboardInput, range: { start: string; end: string }): OpenRouterQueryCostsInput {
  return stripUndefined({
    credential_ref: input.credential_ref ?? null,
    start: range.start,
    end: range.end,
    source: input.source ?? "analytics",
    metrics: input.metrics,
    dimensions: input.dimensions,
    filters: input.filters,
    granularity: input.granularity,
    group_limit: input.group_limit,
    limit: input.limit,
    include_raw: false,
  }) as OpenRouterQueryCostsInput;
}

function normalizeAnalyticsInput(
  input: OpenRouterAnalyticsQueryInput | OpenRouterQueryUsageInput | OpenRouterQueryCostsInput,
  meta: OpenRouterAnalyticsMetaResponse,
  range: { bucket_width: BucketWidth },
  purpose: "usage" | "costs",
): NormalizedAnalyticsInput {
  const metrics = stringArray(input.metrics);
  return {
    credential_ref: typeof input.credential_ref === "string" && input.credential_ref.trim() !== "" ? input.credential_ref : null,
    metrics: metrics.length > 0 ? metrics : defaultMetrics(meta, purpose),
    dimensions: stringArray(input.dimensions),
    filters: Array.isArray(input.filters) ? input.filters as Array<Record<string, unknown>> : [],
    granularity: typeof input.granularity === "string" && input.granularity.trim() !== "" ? input.granularity : granularityFromBucketWidth(range.bucket_width),
    group_limit: finiteNumberOrNull(input.group_limit),
    limit: finiteNumberOrNull(input.limit) ?? 1000,
    order_by: input.order_by !== null && typeof input.order_by === "object" ? input.order_by as Record<string, unknown> : null,
    include_raw: input.include_raw === true,
  };
}

function validateAnalyticsInput(input: NormalizedAnalyticsInput, meta: OpenRouterAnalyticsMetaResponse): void {
  const supportedMetrics = namedSet(meta.data.metrics);
  const supportedDimensions = namedSet(meta.data.dimensions);
  const supportedOperators = namedSet(meta.data.operators);
  const supportedGranularities = namedSet(meta.data.granularities);

  rejectUnsupported("metrics", input.metrics, supportedMetrics);
  rejectUnsupported("dimensions", input.dimensions, supportedDimensions);
  if (input.granularity !== null) {
    rejectUnsupported("granularity", [input.granularity], supportedGranularities);
  }

  const filterOperators = input.filters.flatMap((filter) => typeof filter.operator === "string" ? [filter.operator] : []);
  rejectUnsupported("filter operators", filterOperators, supportedOperators);
  const filterNames = input.filters.flatMap((filter) => {
    const field = firstString(filter.name, filter.field, filter.dimension);
    return field === null ? [] : [field];
  });
  rejectUnsupported("filter dimensions", filterNames, supportedDimensions);
}

function rejectUnsupported(label: string, requested: string[], supported: Set<string>): void {
  if (requested.length === 0 || supported.size === 0) {
    return;
  }
  const unsupported = requested.filter((item) => !supported.has(item));
  if (unsupported.length > 0) {
    throw new AiAdminError("validation_failed", `Unsupported OpenRouter analytics ${label}`, {
      unsupported,
      supported: [...supported],
    });
  }
}

function analyticsBody(input: NormalizedAnalyticsInput, range: { start: string; end: string }): Record<string, unknown> {
  return compact({
    metrics: input.metrics,
    dimensions: input.dimensions.length > 0 ? input.dimensions : undefined,
    filters: input.filters.length > 0 ? input.filters : undefined,
    granularity: input.granularity ?? undefined,
    group_limit: input.group_limit ?? undefined,
    limit: input.limit ?? undefined,
    order_by: input.order_by ?? undefined,
    time_range: {
      start: range.start,
      end: range.end,
    },
  });
}

function defaultMetrics(meta: OpenRouterAnalyticsMetaResponse, purpose: "usage" | "costs"): string[] {
  const available = namedSet(meta.data.metrics);
  const candidates = purpose === "costs" ? OPENROUTER_ANALYTICS_COST_METRICS : OPENROUTER_ANALYTICS_DEFAULT_USAGE_METRICS;
  const selected = candidates.filter((metric) => available.size === 0 || available.has(metric));
  return selected.length > 0 ? selected : ["request_count"];
}

function availableCostMetrics(meta: OpenRouterAnalyticsMetaResponse): string[] {
  const available = namedSet(meta.data.metrics);
  return OPENROUTER_ANALYTICS_COST_METRICS.filter((metric) => available.has(metric));
}

function namedSet(items: Array<{ name: string }> | undefined): Set<string> {
  return new Set((items ?? []).map((item) => item.name));
}

function activityInputFromCommon(
  input: OpenRouterQueryUsageInput | OpenRouterQueryCostsInput,
  range: { start: string; end: string },
  now: Date,
): OpenRouterActivityInput {
  const date = input.date ?? singleCompletedUtcDate(range, now);
  return {
    credential_ref: input.credential_ref ?? null,
    ...(date === null ? {} : { date }),
    api_key_hash: input.api_key_hash ?? null,
    user_id: input.user_id ?? null,
    include_raw: input.include_raw ?? false,
  };
}

function singleCompletedUtcDate(range: { start: string; end: string }, now: Date): string | null {
  const start = new Date(range.start);
  const end = new Date(range.end);
  if (end.getTime() - start.getTime() !== 86_400_000) {
    return null;
  }
  const todayStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  if (start.getUTCHours() !== 0 || start.getUTCMinutes() !== 0 || start.getUTCSeconds() !== 0 || end.getTime() > todayStart) {
    return null;
  }
  return start.toISOString().slice(0, 10);
}

function validateActivityDate(date: string | null | undefined, now: Date): void {
  if (date === null || date === undefined || date === "") {
    return;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new AiAdminError("validation_failed", "OpenRouter activity date must use YYYY-MM-DD format", { date });
  }
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw new AiAdminError("validation_failed", "OpenRouter activity date is invalid", { date });
  }
  const todayStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  if (parsed.getTime() >= todayStart) {
    throw new AiAdminError("validation_failed", "OpenRouter activity date must be a completed UTC day", { date });
  }
  const earliest = todayStart - OPENROUTER_ACTIVITY_WINDOW_DAYS * 86_400_000;
  if (parsed.getTime() < earliest) {
    throw new AiAdminError("validation_failed", `OpenRouter activity date must be within the last ${OPENROUTER_ACTIVITY_WINDOW_DAYS} completed UTC days`, {
      date,
      earliest_date: new Date(earliest).toISOString().slice(0, 10),
    });
  }
}

function summarizeCosts(costs: Array<{ amount: MoneyAmount }>): { amount: MoneyAmount | null; warnings: Warning[] } {
  if (costs.length === 0) {
    return { amount: null, warnings: [] };
  }
  const currencies = new Set(costs.map((cost) => cost.amount.currency));
  if (currencies.size > 1) {
    return {
      amount: null,
      warnings: [warning("mixed_currency_costs", "OpenRouter returned multiple currencies; summary cost is omitted.")],
    };
  }
  const value = sumNumbers(costs.map((cost) => cost.amount.value));
  const currency = costs[0]?.amount.currency ?? "openrouter_credit";
  return {
    amount: value === null ? null : { value, currency, source_unit: "major", raw_value: value },
    warnings: [],
  };
}

function topByUsageDimension(
  usageFacts: OpenRouterUsageData["usage"],
  dimension: "model" | "api_key_id",
  limit: number,
): Array<Record<string, unknown>> {
  const totals = new Map<string, { input_tokens: number; output_tokens: number; request_count: number }>();
  for (const fact of usageFacts) {
    const key = fact.dimensions[dimension];
    if (key === null) {
      continue;
    }
    const existing = totals.get(key) ?? { input_tokens: 0, output_tokens: 0, request_count: 0 };
    existing.input_tokens += fact.metrics.input_tokens ?? 0;
    existing.output_tokens += fact.metrics.output_tokens ?? 0;
    existing.request_count += fact.metrics.request_count ?? 0;
    totals.set(key, existing);
  }
  return [...totals.entries()]
    .map(([key, totalsForKey]) => ({ [dimension]: key, ...totalsForKey, total_tokens: totalsForKey.input_tokens + totalsForKey.output_tokens }))
    .sort((left, right) => Number(right.total_tokens) - Number(left.total_tokens))
    .slice(0, limit);
}

function singlePagePagination(truncated = false): PaginationInfo {
  return {
    pages_fetched: 1,
    provider_request_count: 1,
    truncated,
    next_page: null,
  };
}

function rangeLimits() {
  return {
    maxRangeDays: 90,
    minuteMaxHours: 24,
    hourlyMaxDays: 31,
    dailyMaxDays: 90,
  };
}

function granularityFromBucketWidth(bucketWidth: BucketWidth): string {
  if (bucketWidth === "1m") {
    return "minute";
  }
  if (bucketWidth === "1h") {
    return "hour";
  }
  return "day";
}

function bucketWidthFromGranularity(granularity: string | null | undefined): BucketWidth {
  if (granularity === "minute") {
    return "1m";
  }
  if (granularity === "hour") {
    return "1h";
  }
  return "1d";
}

function finiteNumberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function numberOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim() !== "") {
      return value;
    }
  }
  return null;
}

function dataObject(value: unknown): Record<string, unknown> {
  if (value !== null && typeof value === "object" && !Array.isArray(value) && "data" in value) {
    const data = (value as { data?: unknown }).data;
    return data !== null && typeof data === "object" && !Array.isArray(data) ? data as Record<string, unknown> : {};
  }
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function dataArray(value: unknown): unknown[] {
  if (value !== null && typeof value === "object" && !Array.isArray(value) && "data" in value) {
    const data = (value as { data?: unknown }).data;
    return Array.isArray(data) ? data : [];
  }
  if (value !== null && typeof value === "object" && !Array.isArray(value) && "api_keys" in value) {
    const apiKeys = (value as { api_keys?: unknown }).api_keys;
    return Array.isArray(apiKeys) ? apiKeys : [];
  }
  return Array.isArray(value) ? value : [];
}

function compact(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
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
