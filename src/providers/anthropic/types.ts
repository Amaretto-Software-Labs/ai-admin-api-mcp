import type { BucketWidth, CostFact, PaginationInfo, UsageFact } from "../../core/index.js";

export interface AnthropicConfig {
  adminKey?: string;
  oauthToken?: string;
  baseUrl?: string;
  anthropicVersion?: string;
  betaHeaders?: string[];
  required?: boolean;
  cacheTtlSeconds?: number;
  metadataCacheTtlSeconds?: number;
  fetchImpl?: typeof fetch;
}

export interface AnthropicMessagesUsageInput {
  credential_ref?: string | null;
  start: string;
  end: string;
  bucket_width?: BucketWidth;
  group_by?: string[];
  filters?: {
    api_key_ids?: string[];
    workspace_ids?: string[];
    models?: string[];
    service_tiers?: string[];
    context_windows?: string[];
    inference_geos?: string[];
    speeds?: string[];
  };
  limit?: number | null;
  max_pages?: number;
  include_raw?: boolean;
}

export interface AnthropicCostsInput {
  credential_ref?: string | null;
  start: string;
  end: string;
  group_by?: string[];
  filters?: {
    workspace_ids?: string[];
  };
  limit?: number | null;
  max_pages?: number;
  include_raw?: boolean;
}

export interface AnthropicDashboardInput {
  credential_ref?: string | null;
  start: string;
  end: string;
  bucket_width?: BucketWidth;
  usage_group_by?: string[];
  cost_group_by?: string[];
  top_n?: number;
  include_metadata?: boolean;
}

export interface AnthropicPage<TResult> {
  data?: Array<{
    starting_at?: string;
    ending_at?: string;
    start_time?: string;
    end_time?: string;
    results?: TResult[];
  }>;
  buckets?: Array<{
    starting_at?: string;
    ending_at?: string;
    start_time?: string;
    end_time?: string;
    results?: TResult[];
  }>;
  has_more?: boolean;
  next_page?: string | null;
}

export interface AnthropicUsageResult {
  [key: string]: unknown;
  workspace_id?: string | null;
  api_key_id?: string | null;
  model?: string | null;
  service_tier?: string | null;
  context_window?: string | null;
  inference_geo?: string | null;
  speed?: string | null;
}

export interface AnthropicCostResult {
  [key: string]: unknown;
  workspace_id?: string | null;
  description?: string | null;
  model?: string | null;
  inference_geo?: string | null;
}

export interface AnthropicUsageData {
  usage: UsageFact[];
  pagination: PaginationInfo;
}

export interface AnthropicCostData {
  costs: CostFact[];
  pagination: PaginationInfo;
}
