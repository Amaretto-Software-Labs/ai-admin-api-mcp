import type { BucketWidth, CostFact, PaginationInfo, TimeRange, UsageFact } from "@ai-admin-api-mcp/core";
import type { OpenAiUsageEndpoint } from "./capabilities.js";

export interface OpenAiConfig {
  adminKey?: string;
  baseUrl?: string;
  required?: boolean;
  cacheTtlSeconds?: number;
  metadataCacheTtlSeconds?: number;
  fetchImpl?: typeof fetch;
}

export interface OpenAiQueryUsageInput {
  credential_ref?: string | null;
  usage_endpoint: OpenAiUsageEndpoint;
  start: string;
  end: string;
  bucket_width?: BucketWidth;
  group_by?: string[];
  endpoint_params?: Record<string, unknown>;
  limit?: number | null;
  max_pages?: number;
  include_raw?: boolean;
}

export interface OpenAiQueryCostsInput {
  credential_ref?: string | null;
  start: string;
  end: string;
  group_by?: string[];
  filters?: {
    project_ids?: string[];
    api_key_ids?: string[];
  };
  limit?: number | null;
  max_pages?: number;
  include_raw?: boolean;
}

export interface OpenAiDashboardInput {
  credential_ref?: string | null;
  start: string;
  end: string;
  bucket_width?: BucketWidth;
  usage_endpoints?: OpenAiUsageEndpoint[];
  primary_group_by?: string[];
  cost_group_by?: string[];
  top_n?: number;
  include_metadata?: boolean;
}

export interface OpenAiPage<TResult> {
  object?: string;
  data: Array<{
    object?: string;
    start_time: number;
    end_time: number;
    results: TResult[];
  }>;
  has_more?: boolean;
  next_page?: string | null;
}

export interface OpenAiUsageResult {
  [key: string]: unknown;
  project_id?: string | null;
  user_id?: string | null;
  api_key_id?: string | null;
  model?: string | null;
  batch?: boolean | null;
  service_tier?: string | null;
  size?: string | null;
  source?: string | null;
  vector_store_id?: string | null;
  context_level?: string | null;
}

export interface OpenAiCostResult {
  amount?: {
    value?: number;
    currency?: string;
  };
  line_item?: string | null;
  project_id?: string | null;
  api_key_id?: string | null;
  quantity?: unknown | null;
}

export interface OpenAiUsageData {
  usage: UsageFact[];
  pagination: PaginationInfo;
}

export interface OpenAiCostData {
  costs: CostFact[];
  pagination: PaginationInfo;
}

export type OpenAiTimeRange = TimeRange;
