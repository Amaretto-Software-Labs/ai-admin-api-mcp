import type { NormalizedDimensions, UsageMetrics, MoneyAmount, Warning } from "./types.js";

export function baseDimensions(overrides: Partial<NormalizedDimensions> = {}): NormalizedDimensions {
  return {
    project_id: null,
    workspace_id: null,
    user_id: null,
    api_key_id: null,
    model: null,
    service_tier: null,
    batch: null,
    line_item: null,
    description: null,
    ...overrides,
  };
}

export function baseUsageMetrics(overrides: Partial<UsageMetrics> = {}): UsageMetrics {
  return {
    input_tokens: null,
    output_tokens: null,
    input_cached_tokens: null,
    cache_read_input_tokens: null,
    cache_creation_input_tokens: null,
    input_audio_tokens: null,
    output_audio_tokens: null,
    request_count: null,
    operation_count: null,
    image_count: null,
    character_count: null,
    audio_seconds: null,
    session_count: null,
    storage_bytes: null,
    server_tool_uses: {},
    ...overrides,
  };
}

export function money(value: number, currency: string, raw_value: string | number | null, source_unit: MoneyAmount["source_unit"]): MoneyAmount {
  return {
    value,
    currency: currency.toLowerCase(),
    source_unit,
    raw_value,
  };
}

export function sumNumbers(values: Array<number | null | undefined>): number | null {
  let total = 0;
  let seen = false;
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) {
      total += value;
      seen = true;
    }
  }

  return seen ? total : null;
}

export function warning(code: string, message: string, details?: Record<string, unknown>): Warning {
  return details === undefined ? { code, message } : { code, message, details };
}

