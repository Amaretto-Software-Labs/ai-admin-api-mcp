import {
  baseDimensions,
  baseUsageMetrics,
  money,
  warning,
  type BucketWidth,
  type CostFact,
  type TimeRange,
  type UsageFact,
  type Warning,
} from "../../core/index.js";
import type {
  OpenRouterActivityRow,
  OpenRouterAnalyticsQueryResponse,
  OpenRouterGeneration,
} from "./types.js";

export const OPENROUTER_CURRENCY = "openrouter_credit";

export const OPENROUTER_CURRENCY_WARNING = warning(
  "openrouter_cost_currency",
  "OpenRouter usage and cost fields are provider-reported credit spend; values are normalized as openrouter_credit until USD semantics are confirmed.",
);

export function normalizeOpenRouterActivityUsageRows(response: { data: OpenRouterActivityRow[] }): UsageFact[] {
  return response.data.map((row, index) => {
    const bucketStart = dayStartIso(row.date) ?? "";
    const bucketEnd = bucketStart === "" ? "" : addMs(bucketStart, 86_400_000);
    const dimensions = dimensionsFromRecord(row);

    return {
      id: buildFactId("activity_usage", bucketStart, dimensions, row, index),
      provider: "openrouter",
      source_endpoint: "activity",
      bucket_start: bucketStart,
      bucket_end: bucketEnd,
      dimensions,
      metrics: baseUsageMetrics({
        input_tokens: numberOrNull(row.prompt_tokens),
        output_tokens: numberOrNull(row.completion_tokens),
        request_count: numberOrNull(row.requests),
        credit_count: numberOrNull(row.usage),
      }),
      provider_details: {
        openrouter: providerDetails(row, [
          "prompt_tokens",
          "completion_tokens",
          "requests",
          "usage",
        ]),
      },
      normalization: {
        null_dimension_labels: nullLabels(),
        cost_source: "provider_reported",
      },
    };
  });
}

export function normalizeOpenRouterActivityCostRows(response: { data: OpenRouterActivityRow[] }): { costs: CostFact[]; warnings: Warning[] } {
  const costs = response.data.flatMap((row, index) => {
    const usage = numberOrNull(row.usage);
    if (usage === null) {
      return [];
    }
    const bucketStart = dayStartIso(row.date) ?? "";
    const bucketEnd = bucketStart === "" ? "" : addMs(bucketStart, 86_400_000);
    const dimensions = dimensionsFromRecord(row);
    return [{
      id: buildFactId("activity_cost", bucketStart, dimensions, row, index),
      provider: "openrouter",
      source_endpoint: "activity",
      bucket_start: bucketStart,
      bucket_end: bucketEnd,
      dimensions,
      amount: money(usage, OPENROUTER_CURRENCY, row.usage as number | string | null, "major"),
      quantity: null,
      provider_details: {
        openrouter: providerDetails(row, ["usage"]),
      },
      normalization: {
        cost_source: "provider_reported",
        coverage_warnings: [
          ...(numberOrNull(row.byok_usage_inference) === null ? [] : [warning(
            "openrouter_byok_usage_separate",
            "OpenRouter BYOK usage inference was returned separately and is preserved in provider details.",
          )]),
          OPENROUTER_CURRENCY_WARNING,
        ],
      },
    } satisfies CostFact];
  });

  return {
    costs,
    warnings: costs.length === 0 ? [warning("cost_not_available", "OpenRouter activity did not include provider-reported usage spend.")] : [OPENROUTER_CURRENCY_WARNING],
  };
}

export function normalizeOpenRouterAnalyticsUsageRows(response: OpenRouterAnalyticsQueryResponse, range: TimeRange): UsageFact[] {
  return analyticsRows(response).map((row, index) => {
    const bucketStart = bucketStartIso(row, range.start);
    const bucketEnd = bucketEndIso(row, range.end, range.bucket_width);
    const dimensions = dimensionsFromRecord(row);

    return {
      id: buildFactId("analytics_usage", bucketStart, dimensions, row, index),
      provider: "openrouter",
      source_endpoint: "analytics/query",
      bucket_start: bucketStart,
      bucket_end: bucketEnd,
      dimensions,
      metrics: baseUsageMetrics({
        input_tokens: firstNumberByName(row, ["prompt_tokens", "input_tokens", "tokens_prompt", "native_tokens_prompt"]),
        output_tokens: firstNumberByName(row, ["completion_tokens", "output_tokens", "tokens_completion", "native_tokens_completion"]),
        input_cached_tokens: firstNumberByName(row, ["native_tokens_cached", "input_cached_tokens", "cached_tokens"]),
        request_count: firstNumberByName(row, ["request_count", "requests"]),
        credit_count: firstNumberByName(row, ["usage", "credits", "credit_usage"]),
      }),
      provider_details: {
        openrouter: providerDetails(row, [
          "prompt_tokens",
          "input_tokens",
          "completion_tokens",
          "output_tokens",
          "request_count",
          "requests",
          "usage",
          "credits",
        ]),
      },
      normalization: {
        null_dimension_labels: nullLabels(),
        cost_source: firstNumberByName(row, ["usage", "credits", "credit_usage"]) === null ? "not_available" : "provider_reported",
      },
    };
  });
}

export function normalizeOpenRouterAnalyticsCostRows(response: OpenRouterAnalyticsQueryResponse, range: TimeRange): { costs: CostFact[]; warnings: Warning[] } {
  const costs = analyticsRows(response).flatMap((row, index) => {
    const value = firstNumberByName(row, ["usage", "total_cost", "cost", "spend", "upstream_inference_cost", "credits"]);
    if (value === null) {
      return [];
    }
    const raw = firstDefined(row.usage, row.total_cost, row.cost, row.spend, row.upstream_inference_cost, row.credits) as string | number | null;
    const bucketStart = bucketStartIso(row, range.start);
    const bucketEnd = bucketEndIso(row, range.end, range.bucket_width);
    const dimensions = dimensionsFromRecord(row);
    return [{
      id: buildFactId("analytics_cost", bucketStart, dimensions, row, index),
      provider: "openrouter",
      source_endpoint: "analytics/query",
      bucket_start: bucketStart,
      bucket_end: bucketEnd,
      dimensions,
      amount: money(value, OPENROUTER_CURRENCY, raw, "major"),
      quantity: null,
      provider_details: {
        openrouter: providerDetails(row, ["usage", "total_cost", "cost", "spend", "upstream_inference_cost", "credits"]),
      },
      normalization: {
        cost_source: "provider_reported",
        coverage_warnings: [OPENROUTER_CURRENCY_WARNING],
      },
    } satisfies CostFact];
  });

  return {
    costs,
    warnings: costs.length === 0
      ? [warning("cost_not_available", "OpenRouter analytics rows did not include a recognized provider-reported spend metric.")]
      : [OPENROUTER_CURRENCY_WARNING],
  };
}

export function normalizeOpenRouterGenerationUsage(generation: OpenRouterGeneration): UsageFact {
  const bucketStart = parseDate(firstDefined(generation.created_at)) ?? "";
  const dimensions = dimensionsFromRecord(generation);
  return {
    id: buildFactId("generation_usage", bucketStart, dimensions, generation, 0),
    provider: "openrouter",
    source_endpoint: "generation",
    bucket_start: bucketStart,
    bucket_end: bucketStart,
    dimensions,
    metrics: baseUsageMetrics({
      input_tokens: firstNumberByName(generation, ["tokens_prompt", "native_tokens_prompt", "prompt_tokens"]),
      output_tokens: firstNumberByName(generation, ["tokens_completion", "native_tokens_completion", "completion_tokens"]),
      input_cached_tokens: firstNumberByName(generation, ["native_tokens_cached", "input_cached_tokens"]),
      request_count: 1,
      credit_count: firstNumberByName(generation, ["usage", "total_cost"]),
    }),
    provider_details: {
      openrouter: providerDetails(generation, [
        "tokens_prompt",
        "tokens_completion",
        "native_tokens_prompt",
        "native_tokens_completion",
        "native_tokens_cached",
        "usage",
        "total_cost",
      ]),
    },
    normalization: {
      null_dimension_labels: nullLabels(),
      cost_source: firstNumberByName(generation, ["usage", "total_cost"]) === null ? "not_available" : "provider_reported",
    },
  };
}

export function normalizeOpenRouterGenerationCost(generation: OpenRouterGeneration): { costs: CostFact[]; warnings: Warning[] } {
  const total = firstNumberByName(generation, ["total_cost", "usage"]);
  const upstream = numberOrNull(generation.upstream_inference_cost);
  if (total === null && upstream === null) {
    return {
      costs: [],
      warnings: [warning("cost_not_available", "OpenRouter generation metadata did not include total_cost, usage, or upstream_inference_cost.")],
    };
  }

  const bucketStart = parseDate(firstDefined(generation.created_at)) ?? "";
  const dimensions = dimensionsFromRecord(generation);
  const value = total ?? upstream;
  if (value === null) {
    return {
      costs: [],
      warnings: [warning("cost_not_available", "OpenRouter generation metadata did not include a usable cost value.")],
    };
  }
  const raw = total !== null
    ? firstDefined(generation.total_cost, generation.usage) as string | number | null
    : generation.upstream_inference_cost as string | number | null;
  const dimensionsWithLineItem = total === null
    ? { ...dimensions, line_item: "upstream_inference_cost" }
    : dimensions;

  return {
    costs: [{
      id: buildFactId(total === null ? "generation_upstream_cost" : "generation_cost", bucketStart, dimensionsWithLineItem, generation, 0),
      provider: "openrouter",
      source_endpoint: "generation",
      bucket_start: bucketStart,
      bucket_end: bucketStart,
      dimensions: dimensionsWithLineItem,
      amount: money(value, OPENROUTER_CURRENCY, raw, "major"),
      quantity: null,
      provider_details: {
        openrouter: providerDetails(generation, total === null ? ["upstream_inference_cost"] : ["total_cost", "usage"]),
      },
      normalization: {
        cost_source: "provider_reported",
        coverage_warnings: [OPENROUTER_CURRENCY_WARNING],
      },
    }],
    warnings: [
      OPENROUTER_CURRENCY_WARNING,
      ...(total !== null && upstream !== null ? [warning("openrouter_upstream_cost_included_in_total", "OpenRouter upstream_inference_cost was preserved in provider details and not emitted as a second cost fact to avoid double counting.")] : []),
    ],
  };
}

export function analyticsRows(response: OpenRouterAnalyticsQueryResponse): Array<Record<string, unknown>> {
  return response.data.data ?? [];
}

export function analyticsWarnings(response: OpenRouterAnalyticsQueryResponse): Warning[] {
  return response.data.metadata?.truncated === true
    ? [warning("truncated_response", "OpenRouter analytics reported a truncated response.", response.data.metadata)]
    : [];
}

function dimensionsFromRecord(record: Record<string, unknown>) {
  return baseDimensions({
    workspace_id: stringOrNull(record.workspace_id),
    user_id: stringOrNull(firstDefined(record.user_id, record.external_user, record.creator_user_id)),
    api_key_id: stringOrNull(firstDefined(record.api_key_hash, record.api_key_id, record.hash)),
    model: stringOrNull(firstDefined(record.model, record.model_permaslug)),
    service_tier: stringOrNull(record.service_tier),
    line_item: stringOrNull(firstDefined(record.line_item, record.metric, record.metric_name)),
    description: stringOrNull(firstDefined(record.description, record.provider_name, record.endpoint_id)),
  });
}

function providerDetails(record: Record<string, unknown>, normalizedKeys: string[]): Record<string, unknown> {
  const normalized = new Set([
    "workspace_id",
    "user_id",
    "external_user",
    "creator_user_id",
    "api_key_hash",
    "api_key_id",
    "hash",
    "model",
    "model_permaslug",
    "service_tier",
    "line_item",
    "metric",
    "metric_name",
    "description",
    ...normalizedKeys,
  ]);
  return Object.fromEntries(
    Object.entries(record).filter(([key, value]) => !normalized.has(key) && value !== undefined),
  );
}

function nullLabels(): Record<string, string> {
  return {
    project_id: "not_applicable",
    workspace_id: "not_grouped_or_unattributed",
    user_id: "not_grouped_or_unattributed",
    api_key_id: "not_grouped_or_unattributed",
  };
}

function bucketStartIso(record: Record<string, unknown>, fallback: string): string {
  return parseDate(firstDefined(
    record.date__minute,
    record.date__hour,
    record.date__day,
    record.bucket_start,
    record.start_time,
    record.date,
    record.created_at,
  )) ?? fallback;
}

function bucketEndIso(record: Record<string, unknown>, fallback: string, bucketWidth: BucketWidth): string {
  const explicit = parseDate(firstDefined(record.bucket_end, record.end_time));
  if (explicit !== null) {
    return explicit;
  }
  const start = bucketStartIso(record, "");
  if (start === "") {
    return fallback;
  }
  return addMs(start, bucketWidthMs(bucketWidth));
}

function dayStartIso(value: unknown): string | null {
  const parsed = parseDate(value);
  if (parsed === null) {
    return null;
  }
  const date = new Date(parsed);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())).toISOString();
}

function addMs(iso: string, ms: number): string {
  return new Date(new Date(iso).getTime() + ms).toISOString();
}

function bucketWidthMs(width: BucketWidth): number {
  if (width === "1m") {
    return 60_000;
  }
  if (width === "1h") {
    return 3_600_000;
  }
  return 86_400_000;
}

function parseDate(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    const date = new Date(value < 10_000_000_000 ? value * 1000 : value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  if (typeof value === "string" && value.trim() !== "") {
    const trimmed = value.trim();
    const numeric = Number(trimmed);
    const date = Number.isFinite(numeric) && /^\d+$/.test(trimmed)
      ? new Date(numeric < 10_000_000_000 ? numeric * 1000 : numeric)
      : new Date(trimmed);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  return null;
}

function firstNumberByName(record: Record<string, unknown>, names: string[]): number | null {
  for (const name of names) {
    const value = numberOrNull(record[name]);
    if (value !== null) {
      return value;
    }
  }
  return null;
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

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function firstDefined(...values: unknown[]): unknown {
  return values.find((value) => value !== undefined && value !== null);
}

function buildFactId(
  kind: string,
  bucketStart: string,
  dimensions: ReturnType<typeof dimensionsFromRecord>,
  row: Record<string, unknown>,
  index: number,
): string {
  return [
    "openrouter",
    kind,
    bucketStart,
    dimensions.workspace_id ?? "no_workspace",
    dimensions.user_id ?? "no_user",
    dimensions.api_key_id ?? "no_key",
    dimensions.model ?? "no_model",
    stringOrNull(row.id) ?? stringOrNull(row.endpoint_id) ?? stringOrNull(row.request_id) ?? index,
  ].join(":");
}
