export const PROVIDER_IDS = ["openai", "anthropic", "google-cloud-billing"] as const;

export type ProviderId = (typeof PROVIDER_IDS)[number];
export type ImplementedProviderId = "openai" | "anthropic";
export type BucketWidth = "1m" | "1h" | "1d";
export type CacheStatus = "hit" | "miss" | "bypass" | "disabled";
export type CostSource =
  | "provider_reported"
  | "provider_billing_export"
  | "estimated_from_usage"
  | "not_available";

export interface TimeRange {
  start: string;
  end: string;
  bucket_width: BucketWidth;
}

export interface Warning {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface CacheInfo {
  status: CacheStatus;
  ttl_seconds: number | null;
}

export interface ToolEnvelope<TData, TRaw = unknown> {
  provider: ProviderId | "multiple";
  tool: string;
  queried_at: string;
  time_range: TimeRange | null;
  cache: CacheInfo;
  warnings: Warning[];
  data: TData;
  raw: TRaw | null;
}

export interface PaginationInfo {
  pages_fetched: number;
  provider_request_count: number;
  truncated: boolean;
  next_page: string | null;
}

export interface NormalizedDimensions {
  project_id: string | null;
  workspace_id: string | null;
  user_id: string | null;
  api_key_id: string | null;
  model: string | null;
  service_tier: string | null;
  batch: boolean | null;
  line_item: string | null;
  description: string | null;
}

export interface UsageMetrics {
  input_tokens: number | null;
  output_tokens: number | null;
  input_cached_tokens: number | null;
  cache_read_input_tokens: number | null;
  cache_creation_input_tokens: number | null;
  input_audio_tokens: number | null;
  output_audio_tokens: number | null;
  request_count: number | null;
  operation_count: number | null;
  image_count: number | null;
  character_count: number | null;
  audio_seconds: number | null;
  session_count: number | null;
  storage_bytes: number | null;
  server_tool_uses: Record<string, number>;
}

export interface UsageFact {
  id: string;
  provider: ImplementedProviderId;
  source_endpoint: string;
  bucket_start: string;
  bucket_end: string;
  dimensions: NormalizedDimensions;
  metrics: UsageMetrics;
  provider_details: Record<string, unknown>;
  normalization: {
    null_dimension_labels: Record<string, string>;
    cost_source: CostSource;
  };
}

export interface MoneyAmount {
  value: number;
  currency: string;
  source_unit: "major" | "minor" | "unknown";
  raw_value: string | number | null;
}

export interface CostFact {
  id: string;
  provider: ImplementedProviderId;
  source_endpoint: string;
  bucket_start: string;
  bucket_end: string;
  dimensions: NormalizedDimensions;
  amount: MoneyAmount;
  quantity: unknown | null;
  provider_details: Record<string, unknown>;
  normalization: {
    cost_source: CostSource;
    coverage_warnings: Warning[];
  };
}

export interface DashboardBundle {
  provider: ImplementedProviderId | "multiple";
  queried_at: string;
  time_range: TimeRange;
  summary: {
    provider_reported_cost: MoneyAmount | null;
    input_tokens: number | null;
    output_tokens: number | null;
    cache_read_input_tokens: number | null;
    cache_creation_input_tokens: number | null;
    request_count: number | null;
    operation_count: number | null;
  };
  series: {
    cost_by_bucket: unknown[];
    usage_by_bucket: unknown[];
  };
  top: {
    projects_by_cost: Array<Record<string, unknown>>;
    workspaces_by_cost: Array<Record<string, unknown>>;
    models_by_tokens: Array<Record<string, unknown>>;
    api_keys_by_tokens: Array<Record<string, unknown>>;
  };
  metadata: {
    projects: Array<Record<string, unknown>>;
    workspaces: Array<Record<string, unknown>>;
    api_keys: Array<Record<string, unknown>>;
  };
  warnings: Warning[];
}

export interface ProviderCredential {
  provider: ImplementedProviderId;
  credential_ref: string | null;
  type: "bearer" | "api_key";
  secret: string;
}

export interface CredentialRequest {
  provider: ImplementedProviderId;
  credential_ref?: string | null;
  tool: string;
}

export interface CredentialResolver {
  resolve(request: CredentialRequest): Promise<ProviderCredential>;
}

export interface QueryContext {
  credentialResolver: CredentialResolver;
  now: () => Date;
  userAgent?: string;
}

export interface ProviderCapability {
  provider: ImplementedProviderId | "google-cloud-billing";
  display_name: string;
  version: string;
  status: "enabled" | "disabled" | "planned" | "misconfigured";
  tools: string[];
  resources: string[];
  supports_usage: boolean;
  supports_costs: boolean;
  direct_queries_can_incur_cost: boolean;
  freshness_notes: string[];
  cost_coverage_gaps: string[];
  dimensions: Record<string, string[]>;
  limits: Record<string, unknown>;
  warnings: Warning[];
}

export interface ProviderModule {
  id: ImplementedProviderId;
  displayName: string;
  version: string;
  configured: boolean;
  required: boolean;
  capabilities(): ProviderCapability;
}
