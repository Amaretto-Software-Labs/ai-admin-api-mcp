import {
  baseDimensions,
  baseUsageMetrics,
  fromUnixSeconds,
  money,
  redactValue,
  type CostFact,
  type UsageFact,
} from "@ai-admin-api-mcp/core";
import type { OpenAiCostResult, OpenAiPage, OpenAiUsageResult } from "./types.js";
import type { OpenAiUsageEndpoint } from "./capabilities.js";

const PROVIDER_SPECIFIC_GROUPS = ["size", "source", "vector_store_id", "context_level"] as const;

export function normalizeOpenAiUsagePage(endpoint: OpenAiUsageEndpoint, page: OpenAiPage<OpenAiUsageResult>): UsageFact[] {
  const facts: UsageFact[] = [];
  for (const bucket of page.data) {
    for (const result of bucket.results) {
      facts.push(normalizeOpenAiUsageResult(endpoint, bucket.start_time, bucket.end_time, result));
    }
  }
  return facts;
}

export function normalizeOpenAiCostPage(page: OpenAiPage<OpenAiCostResult>): CostFact[] {
  const facts: CostFact[] = [];
  for (const bucket of page.data) {
    for (const result of bucket.results) {
      const amount = result.amount ?? {};
      const value = typeof amount.value === "number" ? amount.value : 0;
      const currency = typeof amount.currency === "string" ? amount.currency : "usd";
      const bucketStart = fromUnixSeconds(bucket.start_time);
      const bucketEnd = fromUnixSeconds(bucket.end_time);
      const dimensions = baseDimensions({
        project_id: result.project_id ?? null,
        api_key_id: result.api_key_id ?? null,
        line_item: result.line_item ?? null,
      });

      facts.push({
        id: buildFactId("openai", "cost", bucketStart, dimensions),
        provider: "openai",
        source_endpoint: "organization/costs",
        bucket_start: bucketStart,
        bucket_end: bucketEnd,
        dimensions,
        amount: money(value, currency, value, "major"),
        quantity: result.quantity ?? null,
        provider_details: {
          openai: {
            raw_result: redactValue(result),
          },
        },
        normalization: {
          cost_source: "provider_reported",
          coverage_warnings: [],
        },
      });
    }
  }
  return facts;
}

function normalizeOpenAiUsageResult(
  endpoint: OpenAiUsageEndpoint,
  startTime: number,
  endTime: number,
  result: OpenAiUsageResult,
): UsageFact {
  const bucketStart = fromUnixSeconds(startTime);
  const bucketEnd = fromUnixSeconds(endTime);
  const dimensions = baseDimensions({
    project_id: result.project_id ?? null,
    user_id: result.user_id ?? null,
    api_key_id: result.api_key_id ?? null,
    model: result.model ?? null,
    batch: result.batch ?? null,
    service_tier: result.service_tier ?? null,
  });
  const groupedDimensions = Object.fromEntries(
    PROVIDER_SPECIFIC_GROUPS.flatMap((key) => (key in result ? [[key, result[key]]] : [])),
  );

  return {
    id: buildFactId("openai", endpoint, bucketStart, dimensions, groupedDimensions),
    provider: "openai",
    source_endpoint: `organization/usage/${endpoint}`,
    bucket_start: bucketStart,
    bucket_end: bucketEnd,
    dimensions,
    metrics: baseUsageMetrics({
      input_tokens: numberOrNull(result.input_tokens),
      output_tokens: numberOrNull(result.output_tokens),
      input_cached_tokens: numberOrNull(result.input_cached_tokens),
      input_audio_tokens: numberOrNull(result.input_audio_tokens),
      output_audio_tokens: numberOrNull(result.output_audio_tokens),
      request_count: numberOrNull(result.num_model_requests),
      operation_count: numberOrNull(result.num_requests),
      image_count: numberOrNull(result.images),
      character_count: numberOrNull(result.characters),
      audio_seconds: numberOrNull(result.seconds),
      session_count: numberOrNull(result.num_sessions),
      storage_bytes: numberOrNull(result.usage_bytes),
    }),
    provider_details: {
      openai: {
        usage_endpoint: endpoint,
        raw_metrics: redactValue(extractMetrics(result)) as Record<string, unknown>,
        grouped_dimensions: groupedDimensions,
      },
    },
    normalization: {
      null_dimension_labels: {
        workspace_id: "not_applicable",
      },
      cost_source: "not_available",
    },
  };
}

function extractMetrics(result: OpenAiUsageResult): Record<string, unknown> {
  const dimensionKeys = new Set([
    "project_id",
    "user_id",
    "api_key_id",
    "model",
    "batch",
    "service_tier",
    "size",
    "source",
    "vector_store_id",
    "context_level",
    "object",
  ]);
  return Object.fromEntries(Object.entries(result).filter(([key]) => !dimensionKeys.has(key)));
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function buildFactId(
  provider: string,
  endpoint: string,
  bucketStart: string,
  dimensions: object,
  extra: Record<string, unknown> = {},
): string {
  const parts = Object.entries({ ...dimensions, ...extra })
    .filter(([, value]) => value !== null && value !== undefined)
    .map(([key, value]) => `${key}:${String(value)}`)
    .join(":");
  return parts.length > 0 ? `${provider}:${endpoint}:bucket:${bucketStart}:${parts}` : `${provider}:${endpoint}:bucket:${bucketStart}`;
}
