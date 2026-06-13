export const OPENAI_USAGE_ENDPOINTS = [
  "audio_speeches",
  "audio_transcriptions",
  "code_interpreter_sessions",
  "completions",
  "embeddings",
  "file_search_calls",
  "images",
  "moderations",
  "vector_stores",
  "web_search_calls",
] as const;

export type OpenAiUsageEndpoint = (typeof OPENAI_USAGE_ENDPOINTS)[number];

export interface OpenAiUsageEndpointCapability {
  endpoint: OpenAiUsageEndpoint;
  endpointPath: string;
  filters: string[];
  groupBy: string[];
  metrics: string[];
}

export const OPENAI_USAGE_CAPABILITIES: Record<OpenAiUsageEndpoint, OpenAiUsageEndpointCapability> = {
  audio_speeches: {
    endpoint: "audio_speeches",
    endpointPath: "/organization/usage/audio_speeches",
    filters: ["project_ids", "user_ids", "api_key_ids", "models"],
    groupBy: ["project_id", "user_id", "api_key_id", "model"],
    metrics: ["characters", "num_model_requests"],
  },
  audio_transcriptions: {
    endpoint: "audio_transcriptions",
    endpointPath: "/organization/usage/audio_transcriptions",
    filters: ["project_ids", "user_ids", "api_key_ids", "models"],
    groupBy: ["project_id", "user_id", "api_key_id", "model"],
    metrics: ["seconds", "num_model_requests"],
  },
  code_interpreter_sessions: {
    endpoint: "code_interpreter_sessions",
    endpointPath: "/organization/usage/code_interpreter_sessions",
    filters: ["project_ids"],
    groupBy: ["project_id"],
    metrics: ["num_sessions"],
  },
  completions: {
    endpoint: "completions",
    endpointPath: "/organization/usage/completions",
    filters: ["project_ids", "user_ids", "api_key_ids", "models", "batch"],
    groupBy: ["project_id", "user_id", "api_key_id", "model", "batch", "service_tier"],
    metrics: [
      "input_tokens",
      "output_tokens",
      "input_cached_tokens",
      "input_audio_tokens",
      "output_audio_tokens",
      "num_model_requests",
    ],
  },
  embeddings: {
    endpoint: "embeddings",
    endpointPath: "/organization/usage/embeddings",
    filters: ["project_ids", "user_ids", "api_key_ids", "models"],
    groupBy: ["project_id", "user_id", "api_key_id", "model"],
    metrics: ["input_tokens", "num_model_requests"],
  },
  file_search_calls: {
    endpoint: "file_search_calls",
    endpointPath: "/organization/usage/file_search_calls",
    filters: ["project_ids", "user_ids", "api_key_ids", "vector_store_ids"],
    groupBy: ["project_id", "user_id", "api_key_id", "vector_store_id"],
    metrics: ["num_requests"],
  },
  images: {
    endpoint: "images",
    endpointPath: "/organization/usage/images",
    filters: ["project_ids", "user_ids", "api_key_ids", "models", "sources", "sizes"],
    groupBy: ["project_id", "user_id", "api_key_id", "model", "size", "source"],
    metrics: ["images", "num_model_requests"],
  },
  moderations: {
    endpoint: "moderations",
    endpointPath: "/organization/usage/moderations",
    filters: ["project_ids", "user_ids", "api_key_ids", "models"],
    groupBy: ["project_id", "user_id", "api_key_id", "model"],
    metrics: ["input_tokens", "num_model_requests"],
  },
  vector_stores: {
    endpoint: "vector_stores",
    endpointPath: "/organization/usage/vector_stores",
    filters: ["project_ids"],
    groupBy: ["project_id"],
    metrics: ["usage_bytes"],
  },
  web_search_calls: {
    endpoint: "web_search_calls",
    endpointPath: "/organization/usage/web_search_calls",
    filters: ["project_ids", "user_ids", "api_key_ids", "models", "context_levels"],
    groupBy: ["project_id", "user_id", "api_key_id", "model", "context_level"],
    metrics: ["num_model_requests", "num_requests"],
  },
};

export const OPENAI_COST_GROUP_BY = ["project_id", "line_item", "api_key_id"] as const;

