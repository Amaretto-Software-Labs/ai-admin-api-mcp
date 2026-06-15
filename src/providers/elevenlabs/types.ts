import type { BucketWidth, CostFact, PaginationInfo, UsageFact } from "../../core/index.js";
import type { ELEVENLABS_FILTER_OPERATIONS, ELEVENLABS_USAGE_GROUP_BY } from "./capabilities.js";

export interface ElevenLabsConfig {
  apiKey?: string;
  baseUrl?: string;
  required?: boolean;
  cacheTtlSeconds?: number;
  metadataCacheTtlSeconds?: number;
  fetchImpl?: typeof fetch;
}

export type ElevenLabsUsageGroupBy = (typeof ELEVENLABS_USAGE_GROUP_BY)[number];
export type ElevenLabsFilterOperation = (typeof ELEVENLABS_FILTER_OPERATIONS)[number];

export interface ElevenLabsColumnFilter {
  column: string;
  operation: ElevenLabsFilterOperation;
  values: Array<string | number | boolean | null>;
}

export interface ElevenLabsQueryUsageInput {
  credential_ref?: string | null;
  start: string;
  end: string;
  bucket_width?: BucketWidth;
  group_by?: string[];
  filters?: ElevenLabsColumnFilter[];
  time_zone?: string;
  include_raw?: boolean;
}

export interface ElevenLabsListRequestsInput {
  credential_ref?: string | null;
  start?: string | null;
  end?: string | null;
  limit?: number | null;
  sort?: "asc" | "desc" | null;
  filters?: ElevenLabsColumnFilter[];
  search?: string | null;
}

export interface ElevenLabsListAuditLogsInput {
  credential_ref?: string | null;
  limit?: number | null;
  cursor?: string | null;
  start?: string | null;
  end?: string | null;
  actor_uid?: string | null;
  class_name?: string | null;
  activity_name?: string | null;
}

export interface ElevenLabsDashboardInput {
  credential_ref?: string | null;
  start: string;
  end: string;
  bucket_width?: BucketWidth;
  group_by?: string[];
  filters?: ElevenLabsColumnFilter[];
  time_zone?: string;
  top_n?: number;
  include_metadata?: boolean;
}

export interface ElevenLabsAnalyticsResponse {
  columns: string[];
  column_types: string[];
  rows: Array<Array<string | number | boolean | null>>;
  column_units: Array<string | null>;
}

export interface ElevenLabsUsageData {
  usage: UsageFact[];
  pagination: PaginationInfo;
}

export interface ElevenLabsCostData {
  costs: CostFact[];
  pagination: PaginationInfo;
}

