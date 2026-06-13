# Anthropic Admin Provider

The Anthropic provider queries organization metadata, messages usage, and cost reports and returns normalized facts.

## Credentials

Static mode accepts either:

- `ANTHROPIC_ADMIN_KEY`, sent as `x-api-key`
- `ANTHROPIC_OAUTH_TOKEN`, sent as `Authorization: Bearer <token>`

Optional:

- `ANTHROPIC_BASE_URL`, default `https://api.anthropic.com/v1`
- `ANTHROPIC_VERSION`, default `2023-06-01`
- `ANTHROPIC_BETA`, comma-separated beta headers

Accepted static credential ref:

- `credential:anthropic:static`

## Messages Usage

Tool: `anthropic_admin_query_messages_usage`

Supported `group_by` values:

- `api_key_id`
- `workspace_id`
- `model`
- `service_tier`
- `context_window`
- `inference_geo`
- `speed`

Supported filters:

- `api_key_ids`
- `workspace_ids`
- `models`
- `service_tiers`
- `context_windows`
- `inference_geos`
- `speeds`

The MCP input uses `context_windows`; outbound Anthropic requests serialize this as `context_window[]`.

The `speed` dimension requires:

```sh
ANTHROPIC_BETA=fast-mode-2026-02-01
```

## Costs

Tool: `anthropic_admin_query_costs`

Supported `group_by` values:

- `workspace_id`
- `description`

Anthropic reports costs in minor currency units. The provider normalizes those values to USD major units while preserving the source unit in normalized cost facts.

Priority Tier costs are not included in Anthropic's cost endpoint. Cost responses include a `priority_tier_cost_gap` warning.

## Freshness and Limits

Anthropic documents usage and cost data as typically available within about 5 minutes. The provider enforces conservative range checks for minute, hourly, and daily buckets.
