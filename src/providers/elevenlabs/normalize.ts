import {
  baseDimensions,
  baseUsageMetrics,
  money,
  warning,
  type BucketWidth,
  type CostFact,
  type UsageFact,
  type Warning,
} from "../../core/index.js";
import type { ElevenLabsAnalyticsResponse } from "./types.js";

const CURRENCY_UNITS = new Set(["usd", "eur", "inr", "pln"]);

export function normalizeElevenLabsUsageRows(
  response: ElevenLabsAnalyticsResponse,
  input: { start: string; end: string; bucket_width: BucketWidth },
): UsageFact[] {
  return tableRows(response).map((row, index) => {
    const bucketStart = bucketStartIso(row, input.start);
    const bucketEnd = bucketEndIso(row, input.end, input.bucket_width);
    const dimensions = elevenLabsDimensions(row);
    const creditCount = firstNumber(
      valueByName(row, ["credits", "credit_usage", "credits_used", "usage", "value"]),
      firstNumberByUnit(row, "credits"),
    );

    return {
      id: buildFactId("elevenlabs", "workspace_usage", bucketStart, dimensions, row, index),
      provider: "elevenlabs",
      source_endpoint: "workspace/analytics/query/usage-by-product-over-time",
      bucket_start: bucketStart,
      bucket_end: bucketEnd,
      dimensions,
      metrics: baseUsageMetrics({
        credit_count: creditCount,
        character_count: firstNumber(valueByName(row, ["tts_characters", "characters", "character_count"])),
        request_count: firstNumber(valueByName(row, ["request_count", "requests"])),
        audio_seconds: audioSeconds(row),
      }),
      provider_details: {
        elevenlabs: {
          row: row.record,
          column_units: row.units,
          grouped_dimensions: groupedDimensions(row),
        },
      },
      normalization: {
        null_dimension_labels: {
          project_id: "not_applicable",
          workspace_id: "not_grouped_or_unattributed",
        },
        cost_source: "not_available",
      },
    };
  });
}

export function normalizeElevenLabsCostRows(response: ElevenLabsAnalyticsResponse): { costs: CostFact[]; warnings: Warning[] } {
  const costs = tableRows(response).flatMap((row, index) => {
    const monetary = monetaryValue(row);
    if (monetary === null) {
      return [];
    }
    const bucketStart = bucketStartIso(row, "");
    const bucketEnd = bucketEndIso(row, bucketStart, "1d");
    const dimensions = elevenLabsDimensions(row);
    return [{
      id: buildFactId("elevenlabs", "cost", bucketStart, dimensions, row, index),
      provider: "elevenlabs",
      source_endpoint: "workspace/analytics/query/usage-by-product-over-time",
      bucket_start: bucketStart,
      bucket_end: bucketEnd,
      dimensions,
      amount: money(monetary.value, monetary.currency, monetary.raw, "major"),
      quantity: null,
      provider_details: {
        elevenlabs: {
          row: row.record,
          column_units: row.units,
        },
      },
      normalization: {
        cost_source: "provider_reported",
        coverage_warnings: [],
      },
    } satisfies CostFact];
  });

  return {
    costs,
    warnings: costs.length === 0
      ? [warning("cost_not_available", "ElevenLabs workspace usage analytics did not return monetary columns; credit usage is available in usage facts.")]
      : [],
  };
}

function tableRows(response: ElevenLabsAnalyticsResponse): Array<{
  record: Record<string, unknown>;
  units: Record<string, string | null>;
}> {
  return response.rows.map((row) => {
    const record = Object.fromEntries(response.columns.map((column, index) => [column, row[index] ?? null]));
    const units = Object.fromEntries(response.columns.map((column, index) => [column, response.column_units[index] ?? null]));
    return { record, units };
  });
}

function elevenLabsDimensions(row: { record: Record<string, unknown> }) {
  return baseDimensions({
    workspace_id: stringOrNull(firstDefined(row.record.reporting_workspace_id, row.record.workspace_id)),
    user_id: stringOrNull(row.record.user_id),
    api_key_id: stringOrNull(firstDefined(row.record.api_key_id, row.record.workspace_api_key_id, row.record.hashed_xi_api_key)),
    model: stringOrNull(row.record.model),
    line_item: stringOrNull(firstDefined(row.record.product_type, row.record.fiat_charge_type)),
    description: stringOrNull(firstDefined(row.record.product_type, row.record.resource_id)),
  });
}

function groupedDimensions(row: { record: Record<string, unknown> }): Record<string, unknown> {
  const normalized = new Set([
    "reporting_workspace_id",
    "workspace_id",
    "user_id",
    "api_key_id",
    "workspace_api_key_id",
    "hashed_xi_api_key",
    "model",
    "product_type",
    "fiat_charge_type",
    "resource_id",
  ]);
  return Object.fromEntries(Object.entries(row.record).filter(([key, value]) => !normalized.has(key) && !looksMetric(key, value)));
}

function monetaryValue(row: { record: Record<string, unknown>; units: Record<string, string | null> }): { value: number; currency: string; raw: number | string } | null {
  for (const [key, unit] of Object.entries(row.units)) {
    if (unit !== null && CURRENCY_UNITS.has(unit.toLowerCase())) {
      const raw = row.record[key];
      const value = firstNumber(raw);
      return value === null ? null : { value, currency: unit, raw: raw as number | string };
    }
  }

  const fiat = firstNumber(valueByName(row, ["fiat_units_spent", "cost", "amount"]));
  const currency = stringOrNull(firstDefined(row.record.fiat_currency, row.record.currency)) ?? "usd";
  return fiat === null ? null : { value: fiat, currency, raw: fiat };
}

function valueByName(row: { record: Record<string, unknown> }, names: string[]): unknown {
  for (const name of names) {
    if (name in row.record) {
      return row.record[name];
    }
  }
  return undefined;
}

function firstNumberByUnit(row: { record: Record<string, unknown>; units: Record<string, string | null> }, unitName: string): number | null {
  for (const [key, unit] of Object.entries(row.units)) {
    if (unit === unitName) {
      const value = firstNumber(row.record[key]);
      if (value !== null) {
        return value;
      }
    }
  }
  return null;
}

function audioSeconds(row: { record: Record<string, unknown>; units: Record<string, string | null> }): number | null {
  const direct = firstNumber(valueByName(row, ["audio_seconds", "seconds", "duration_seconds"]));
  if (direct !== null) {
    return direct;
  }
  const minutes = firstNumber(valueByName(row, ["minutes_used"]));
  if (minutes !== null) {
    return minutes * 60;
  }
  for (const [key, unit] of Object.entries(row.units)) {
    if (unit === "min") {
      const value = firstNumber(row.record[key]);
      return value === null ? null : value * 60;
    }
    if (unit === "s") {
      const value = firstNumber(row.record[key]);
      if (value !== null) {
        return value;
      }
    }
  }
  return null;
}

function bucketStartIso(row: { record: Record<string, unknown> }, fallback: string): string {
  const raw = firstDefined(row.record.time, row.record.timestamp, row.record.start_time, row.record.date, row.record.bucket_start);
  const parsed = parseDate(raw);
  return parsed ?? fallback;
}

function bucketEndIso(row: { record: Record<string, unknown> }, fallback: string, bucketWidth: BucketWidth): string {
  const raw = firstDefined(row.record.end_time, row.record.bucket_end);
  const parsed = parseDate(raw);
  if (parsed !== null) {
    return parsed;
  }
  const start = parseDate(firstDefined(row.record.time, row.record.timestamp, row.record.start_time, row.record.date, row.record.bucket_start));
  if (start === null) {
    return fallback;
  }
  return new Date(new Date(start).getTime() + bucketWidthMs(bucketWidth)).toISOString();
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
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  if (typeof value === "string" && value.trim() !== "") {
    const numeric = Number(value);
    const date = Number.isFinite(numeric) && value.trim().match(/^\d+$/) ? new Date(numeric) : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  return null;
}

function firstDefined(...values: unknown[]): unknown {
  return values.find((value) => value !== undefined && value !== null);
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

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function looksMetric(key: string, value: unknown): boolean {
  return typeof value === "number" || key.includes("count") || key.includes("usage") || key.includes("credits") || key.includes("duration");
}

function buildFactId(provider: string, type: string, bucketStart: string, dimensions: object, row: { record: Record<string, unknown> }, index: number): string {
  const dimensionParts = Object.entries(dimensions)
    .filter(([, value]) => value !== null && value !== undefined)
    .map(([key, value]) => `${key}:${String(value)}`);
  const stableParts = ["billing_group_id", "voice_id", "region"]
    .flatMap((key) => {
      const value = row.record[key];
      return value === null || value === undefined ? [] : [`${key}:${String(value)}`];
    });
  const parts = [...dimensionParts, ...stableParts].join(":");
  return parts.length > 0 ? `${provider}:${type}:bucket:${bucketStart}:${parts}` : `${provider}:${type}:bucket:${bucketStart}:row:${index}`;
}
