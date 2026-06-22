export const OPENROUTER_USAGE_SOURCES = ["analytics", "activity", "generation"] as const;

export const OPENROUTER_ANALYTICS_DEFAULT_USAGE_METRICS = [
  "request_count",
  "requests",
  "prompt_tokens",
  "completion_tokens",
  "input_tokens",
  "output_tokens",
  "usage",
] as const;

export const OPENROUTER_ANALYTICS_COST_METRICS = [
  "usage",
  "total_cost",
  "cost",
  "spend",
  "upstream_inference_cost",
] as const;

export const OPENROUTER_DEFAULT_DIMENSIONS = [
  "model",
  "api_key_hash",
  "user_id",
  "provider_name",
] as const;

export const OPENROUTER_ACTIVITY_WINDOW_DAYS = 30;
