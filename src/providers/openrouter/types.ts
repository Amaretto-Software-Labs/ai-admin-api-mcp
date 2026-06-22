import type { BucketWidth, CostFact, PaginationInfo, TimeRange, UsageFact } from "../../core/index.js";
import type { OPENROUTER_USAGE_SOURCES } from "./capabilities.js";

export interface OpenRouterConfig {
  managementKey?: string;
  apiKey?: string;
  baseUrl?: string;
  httpReferer?: string;
  appTitle?: string;
  required?: boolean;
  cacheTtlSeconds?: number;
  metadataCacheTtlSeconds?: number;
  fetchImpl?: typeof fetch;
}

export type OpenRouterUsageSource = (typeof OPENROUTER_USAGE_SOURCES)[number];

export interface OpenRouterBaseInput {
  credential_ref?: string | null;
  include_raw?: boolean;
}

export interface OpenRouterListApiKeysInput extends OpenRouterBaseInput {
  include_disabled?: boolean | string | null;
  offset?: number | null;
  workspace_id?: string | null;
}

export interface OpenRouterGetApiKeyInput extends OpenRouterBaseInput {
  hash: string;
}

export interface OpenRouterActivityInput extends OpenRouterBaseInput {
  date?: string | null;
  api_key_hash?: string | null;
  user_id?: string | null;
}

export interface OpenRouterAnalyticsFilter {
  name?: string;
  field?: string;
  dimension?: string;
  operator?: string;
  value?: unknown;
  values?: unknown[];
}

export interface OpenRouterAnalyticsOrderBy {
  field?: string;
  name?: string;
  direction?: "asc" | "desc";
  [key: string]: unknown;
}

export interface OpenRouterAnalyticsQueryInput extends OpenRouterBaseInput {
  metrics?: string[];
  dimensions?: string[];
  filters?: OpenRouterAnalyticsFilter[];
  granularity?: string | null;
  group_limit?: number | null;
  limit?: number | null;
  order_by?: OpenRouterAnalyticsOrderBy | null;
  time_range?: {
    start?: string;
    end?: string;
  } | null;
}

export interface OpenRouterGenerationInput extends OpenRouterBaseInput {
  id: string;
}

export interface OpenRouterModelsInput extends OpenRouterBaseInput {
  category?: string | null;
  supported_parameters?: string | null;
  output_modalities?: string | null;
  sort?: string | null;
}

export interface OpenRouterQueryUsageInput extends OpenRouterBaseInput {
  start: string;
  end: string;
  bucket_width?: BucketWidth;
  source?: OpenRouterUsageSource;
  metrics?: string[];
  dimensions?: string[];
  filters?: OpenRouterAnalyticsFilter[];
  granularity?: string | null;
  group_limit?: number | null;
  limit?: number | null;
  order_by?: OpenRouterAnalyticsOrderBy | null;
  generation_ids?: string[];
  date?: string | null;
  api_key_hash?: string | null;
  user_id?: string | null;
}

export interface OpenRouterQueryCostsInput extends OpenRouterBaseInput {
  start: string;
  end: string;
  source?: OpenRouterUsageSource;
  metrics?: string[];
  dimensions?: string[];
  filters?: OpenRouterAnalyticsFilter[];
  granularity?: string | null;
  group_limit?: number | null;
  limit?: number | null;
  order_by?: OpenRouterAnalyticsOrderBy | null;
  generation_ids?: string[];
  date?: string | null;
  api_key_hash?: string | null;
  user_id?: string | null;
}

export interface OpenRouterDashboardInput extends OpenRouterBaseInput {
  start: string;
  end: string;
  bucket_width?: BucketWidth;
  source?: OpenRouterUsageSource;
  metrics?: string[];
  dimensions?: string[];
  filters?: OpenRouterAnalyticsFilter[];
  granularity?: string | null;
  group_limit?: number | null;
  limit?: number | null;
  top_n?: number;
  include_metadata?: boolean;
}

export interface OpenRouterEnvelope<TData> {
  data: TData;
}

export interface OpenRouterCreditsData {
  total_credits?: number | string | null;
  total_usage?: number | string | null;
}

export type OpenRouterCreditsResponse = OpenRouterEnvelope<OpenRouterCreditsData>;

export interface OpenRouterAnalyticsMetaResponse {
  data: {
    dimensions?: Array<{ name: string; display_label?: string }>;
    granularities?: Array<{ name: string; display_label?: string }>;
    metrics?: Array<{ name: string; display_label?: string; display_format?: string; is_rate?: boolean }>;
    operators?: Array<{ name: string; value_type?: string }>;
  };
}

export interface OpenRouterAnalyticsQueryResponse {
  data: {
    data?: Array<Record<string, unknown>>;
    metadata?: {
      query_time_ms?: number;
      row_count?: number;
      truncated?: boolean;
      [key: string]: unknown;
    };
  };
}

export interface OpenRouterActivityRow {
  [key: string]: unknown;
  byok_usage_inference?: number | string | null;
  completion_tokens?: number | string | null;
  date?: string | null;
  endpoint_id?: string | null;
  model?: string | null;
  model_permaslug?: string | null;
  prompt_tokens?: number | string | null;
  provider_name?: string | null;
  reasoning_tokens?: number | string | null;
  requests?: number | string | null;
  usage?: number | string | null;
}

export type OpenRouterActivityResponse = OpenRouterEnvelope<OpenRouterActivityRow[]>;

export interface OpenRouterGeneration {
  [key: string]: unknown;
  created_at?: string | null;
  external_user?: string | null;
  id?: string | null;
  is_byok?: boolean | null;
  latency?: number | null;
  model?: string | null;
  native_tokens_cached?: number | string | null;
  native_tokens_completion?: number | string | null;
  native_tokens_prompt?: number | string | null;
  native_tokens_reasoning?: number | string | null;
  provider_name?: string | null;
  request_id?: string | null;
  router?: string | null;
  service_tier?: string | null;
  tokens_completion?: number | string | null;
  tokens_prompt?: number | string | null;
  total_cost?: number | string | null;
  upstream_inference_cost?: number | string | null;
  usage?: number | string | null;
}

export type OpenRouterGenerationResponse = OpenRouterEnvelope<OpenRouterGeneration>;

export interface OpenRouterModelsResponse {
  data: Array<Record<string, unknown>>;
}

export interface OpenRouterUsageData {
  usage: UsageFact[];
  pagination: PaginationInfo;
}

export interface OpenRouterCostData {
  costs: CostFact[];
  pagination: PaginationInfo;
}

export interface OpenRouterTimeRange extends TimeRange {}
