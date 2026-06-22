# OpenRouter Admin Provider

The OpenRouter provider queries read-only OpenRouter administration and reporting endpoints and returns normalized usage, cost, and dashboard facts.

## Credentials

Set `OPENROUTER_MANAGEMENT_KEY` for aggregate reporting. Management keys are required for credits, activity, analytics, and API key metadata.

Optional:

- `OPENROUTER_API_KEY` for current-key, model catalog, and generation metadata when a management key is not configured.
- `OPENROUTER_BASE_URL` for tests or compatible gateways. Defaults to `https://openrouter.ai/api/v1`.
- `OPENROUTER_HTTP_REFERER` to send the optional OpenRouter `HTTP-Referer` attribution header.
- `OPENROUTER_APP_TITLE` to send the optional OpenRouter `X-Title` attribution header.

Accepted static credential refs:

- `credential:openrouter:static`
- `credential:openrouter:management`
- `credential:openrouter:api`

When omitted, `credential_ref` uses the management key if present and falls back to the API key only for tools that do not require management credentials.

## Usage And Costs

Tools:

- `openrouter_admin_query_usage`
- `openrouter_admin_query_costs`
- `openrouter_admin_query_dashboard_bundle`

Supported sources:

- `analytics`: uses `POST /analytics/query`; validates metrics, dimensions, operators, and granularities against `GET /analytics/meta`.
- `activity`: uses `GET /activity`; limited by OpenRouter to the recent completed UTC-day activity window.
- `generation`: uses `GET /generation?id=...`; requires explicit `generation_ids` and is a point lookup, not an aggregate history endpoint.

OpenRouter spend fields are normalized as `openrouter_credit` until live account semantics confirm whether the values should be labeled as USD. Raw provider values are preserved in `provider_details.openrouter` and in `raw` when `include_raw = true`.

## Metadata

Read-only metadata tools:

- `openrouter_admin_get_current_key`
- `openrouter_admin_list_api_keys`
- `openrouter_admin_get_api_key`
- `openrouter_admin_get_credits`
- `openrouter_admin_get_activity`
- `openrouter_admin_get_analytics_meta`
- `openrouter_admin_query_analytics`
- `openrouter_admin_get_generation`
- `openrouter_admin_list_models`

The provider does not expose OpenRouter create, update, delete, inference, prompt-content, completion-content, workspace mutation, guardrail mutation, BYOK mutation, preset mutation, or observability-destination mutation endpoints.

## Common Tool Options

Common query tools route OpenRouter-specific arguments through `provider_options.openrouter`:

```json
{
  "providers": ["openrouter"],
  "provider_options": {
    "openrouter": {
      "source": "analytics",
      "metrics": ["request_count", "usage"],
      "dimensions": ["model"],
      "granularity": "day"
    }
  },
  "start": "2026-06-01T00:00:00Z",
  "end": "2026-06-02T00:00:00Z",
  "bucket_width": "1d"
}
```

For recent activity:

```json
{
  "providers": ["openrouter"],
  "provider_options": {
    "openrouter": {
      "source": "activity",
      "date": "2026-06-21"
    }
  },
  "start": "2026-06-21T00:00:00Z",
  "end": "2026-06-22T00:00:00Z",
  "bucket_width": "1d"
}
```
