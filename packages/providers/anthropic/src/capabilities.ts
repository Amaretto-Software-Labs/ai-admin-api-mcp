export const ANTHROPIC_MESSAGES_GROUP_BY = [
  "api_key_id",
  "workspace_id",
  "model",
  "service_tier",
  "context_window",
  "inference_geo",
  "speed",
] as const;

export const ANTHROPIC_MESSAGES_FILTERS = [
  "api_key_ids",
  "workspace_ids",
  "models",
  "service_tiers",
  "context_windows",
  "inference_geos",
  "speeds",
] as const;

export const ANTHROPIC_COST_GROUP_BY = ["workspace_id", "description"] as const;

export const ANTHROPIC_SPEED_BETA = "fast-mode-2026-02-01";

