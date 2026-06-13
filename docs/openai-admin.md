# OpenAI Admin Provider

The OpenAI provider queries organization Admin API usage, costs, and metadata surfaces and returns normalized facts.

## Credentials

Set `OPENAI_ADMIN_KEY` in static mode. The outbound request uses `Authorization: Bearer <key>`.

Optional:

- `OPENAI_BASE_URL` for tests or compatible gateways. Defaults to `https://api.openai.com/v1`.

Accepted static credential ref:

- `credential:openai:static`

## Usage Endpoints

The provider validates filters and `group_by` values per endpoint before calling OpenAI.

| Endpoint | Path | Filters | Group by | Normalized metrics |
| --- | --- | --- | --- | --- |
| `audio_speeches` | `/organization/usage/audio_speeches` | `project_ids`, `user_ids`, `api_key_ids`, `models` | `project_id`, `user_id`, `api_key_id`, `model` | `character_count`, `request_count` |
| `audio_transcriptions` | `/organization/usage/audio_transcriptions` | `project_ids`, `user_ids`, `api_key_ids`, `models` | `project_id`, `user_id`, `api_key_id`, `model` | `audio_seconds`, `request_count` |
| `code_interpreter_sessions` | `/organization/usage/code_interpreter_sessions` | `project_ids` | `project_id` | `session_count` |
| `completions` | `/organization/usage/completions` | `project_ids`, `user_ids`, `api_key_ids`, `models`, `batch` | `project_id`, `user_id`, `api_key_id`, `model`, `batch`, `service_tier` | `input_tokens`, `output_tokens`, `input_cached_tokens`, audio tokens, `request_count` |
| `embeddings` | `/organization/usage/embeddings` | `project_ids`, `user_ids`, `api_key_ids`, `models` | `project_id`, `user_id`, `api_key_id`, `model` | `input_tokens`, `request_count` |
| `file_search_calls` | `/organization/usage/file_search_calls` | `project_ids`, `user_ids`, `api_key_ids`, `vector_store_ids` | `project_id`, `user_id`, `api_key_id`, `vector_store_id` | `operation_count` |
| `images` | `/organization/usage/images` | `project_ids`, `user_ids`, `api_key_ids`, `models`, `sources`, `sizes` | `project_id`, `user_id`, `api_key_id`, `model`, `size`, `source` | `image_count`, `request_count` |
| `moderations` | `/organization/usage/moderations` | `project_ids`, `user_ids`, `api_key_ids`, `models` | `project_id`, `user_id`, `api_key_id`, `model` | `input_tokens`, `request_count` |
| `vector_stores` | `/organization/usage/vector_stores` | `project_ids` | `project_id` | `storage_bytes` |
| `web_search_calls` | `/organization/usage/web_search_calls` | `project_ids`, `user_ids`, `api_key_ids`, `models`, `context_levels` | `project_id`, `user_id`, `api_key_id`, `model`, `context_level` | `request_count`, `operation_count` |

## Costs

`openai_admin_query_costs` queries `/organization/costs` and normalizes provider-reported cost facts. Supported groupings are `project_id`, `line_item`, and `api_key_id`.

## Dashboard Bundles

`openai_admin_query_dashboard_bundle` combines usage and cost facts for a dashboard-friendly response. It defaults to completion usage plus daily costs unless endpoints or groupings are provided.
