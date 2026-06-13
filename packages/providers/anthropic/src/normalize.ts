import { baseDimensions, baseUsageMetrics, money, redactValue, warning, type CostFact, type UsageFact } from "@ai-admin-api-mcp/core";
import type { AnthropicCostResult, AnthropicPage, AnthropicUsageResult } from "./types.js";

export function normalizeAnthropicUsagePage(page: AnthropicPage<AnthropicUsageResult>): UsageFact[] {
  return pageBuckets(page).flatMap((bucket) =>
    (bucket.results ?? []).map((result) => {
      const bucketStart = bucket.starting_at ?? bucket.start_time ?? "";
      const bucketEnd = bucket.ending_at ?? bucket.end_time ?? "";
      return {
        id: buildFactId("anthropic", "messages", bucketStart, result),
        provider: "anthropic",
        source_endpoint: "organizations/usage_report/messages",
        bucket_start: bucketStart,
        bucket_end: bucketEnd,
        dimensions: baseDimensions({
          workspace_id: result.workspace_id ?? null,
          api_key_id: result.api_key_id ?? null,
          model: result.model ?? null,
          service_tier: result.service_tier ?? null,
        }),
        metrics: baseUsageMetrics({
          input_tokens: firstNumber(result.uncached_input_tokens, result.input_tokens),
          output_tokens: firstNumber(result.output_tokens),
          cache_creation_input_tokens: firstNumber(result.cache_creation_input_tokens, result.cache_creation_tokens),
          cache_read_input_tokens: firstNumber(result.cache_read_input_tokens, result.cache_read_tokens),
          request_count: firstNumber(result.request_count, result.requests, result.num_model_requests),
          server_tool_uses: serverToolUses(result),
        }),
        provider_details: {
          anthropic: {
            raw_metrics: redactValue(extractMetrics(result)) as Record<string, unknown>,
            grouped_dimensions: {
              context_window: result.context_window ?? null,
              inference_geo: result.inference_geo ?? null,
              speed: result.speed ?? null,
            },
          },
        },
        normalization: {
          null_dimension_labels: {
            project_id: "not_applicable",
            workspace_id: result.workspace_id === null ? "default_workspace" : "not_grouped_or_unattributed",
          },
          cost_source: "not_available",
        },
      } satisfies UsageFact;
    }),
  );
}

export function normalizeAnthropicCostPage(page: AnthropicPage<AnthropicCostResult>): CostFact[] {
  return pageBuckets(page).flatMap((bucket) =>
    (bucket.results ?? []).map((result) => {
      const bucketStart = bucket.starting_at ?? bucket.start_time ?? "";
      const bucketEnd = bucket.ending_at ?? bucket.end_time ?? "";
      const rawAmount = firstRaw(result.amount, result.cost, result.cost_usd, result.amount_usd);
      const majorValue = parseMinorUsd(rawAmount);
      const coverageWarnings = [
        warning("priority_tier_cost_gap", "Priority Tier costs are not included in the Anthropic cost endpoint."),
      ];

      return {
        id: buildFactId("anthropic", "cost", bucketStart, result),
        provider: "anthropic",
        source_endpoint: "organizations/cost_report",
        bucket_start: bucketStart,
        bucket_end: bucketEnd,
        dimensions: baseDimensions({
          workspace_id: result.workspace_id ?? null,
          model: result.model ?? null,
          description: result.description ?? null,
        }),
        amount: money(majorValue, "usd", rawAmount, "minor"),
        quantity: result.quantity ?? null,
        provider_details: {
          anthropic: {
            raw_result: redactValue(result),
            parsed_description: {
              inference_geo: result.inference_geo ?? null,
            },
          },
        },
        normalization: {
          cost_source: "provider_reported",
          coverage_warnings: coverageWarnings,
        },
      } satisfies CostFact;
    }),
  );
}

function pageBuckets<TResult>(page: AnthropicPage<TResult>): Array<{
  starting_at?: string;
  ending_at?: string;
  start_time?: string;
  end_time?: string;
  results?: TResult[];
}> {
  return page.data ?? page.buckets ?? [];
}

function firstNumber(...values: unknown[]): number | null {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
      return Number(value);
    }
  }
  return null;
}

function firstRaw(...values: unknown[]): string | number | null {
  for (const value of values) {
    if (typeof value === "number" || typeof value === "string") {
      return value;
    }
  }
  return null;
}

function parseMinorUsd(raw: string | number | null): number {
  if (raw === null) {
    return 0;
  }
  const numeric = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(numeric) ? numeric / 100 : 0;
}

function serverToolUses(result: AnthropicUsageResult): Record<string, number> {
  const raw = result.server_tool_uses ?? result.server_tool_usage;
  if (raw !== null && typeof raw === "object" && !Array.isArray(raw)) {
    return Object.fromEntries(
      Object.entries(raw).flatMap(([key, value]) => (typeof value === "number" ? [[key, value]] : [])),
    );
  }
  return {};
}

function extractMetrics(result: AnthropicUsageResult): Record<string, unknown> {
  const dimensions = new Set(["workspace_id", "api_key_id", "model", "service_tier", "context_window", "inference_geo", "speed"]);
  return Object.fromEntries(Object.entries(result).filter(([key]) => !dimensions.has(key)));
}

function buildFactId(provider: string, type: string, bucketStart: string, result: Record<string, unknown>): string {
  const parts = ["workspace_id", "api_key_id", "model", "service_tier", "description"]
    .flatMap((key) => {
      const value = result[key];
      return value === null || value === undefined ? [] : [`${key}:${String(value)}`];
    })
    .join(":");
  return parts.length > 0 ? `${provider}:${type}:bucket:${bucketStart}:${parts}` : `${provider}:${type}:bucket:${bucketStart}`;
}
