# OpenRouter Provider Plugin Spec

**Status:** Implemented
**Scope:** OpenRouter provider plugin for usage, cost, key, credit, model, and generation reporting
**Last updated:** 2026-06-22

## 1. Summary

Add an OpenRouter provider plugin to the existing AI Admin API MCP server. The plugin must use the same `AiAdminProviderPlugin` contract as the current providers and must expose read-only reporting/admin data through provider-native tools plus the common normalized MCP tools.

Packaging decision for this repo:

- implement OpenRouter as an in-repo provider plugin in the existing `@amaretto-software-labs/ai-admin-api-mcp` package;
- do not introduce a second npm package for the first OpenRouter release;
- keep the provider implementation behind the plugin contract so it can be moved to an external ESM plugin later without changing tool contracts.

The provider id is:

```text
openrouter
```

The provider display name is:

```text
OpenRouter
```

## 2. Source-Checked API Facts

These facts were checked against OpenRouter documentation on 2026-06-22 and should be rechecked before implementation.

Relevant docs:

- [Authentication](https://openrouter.ai/docs/api/reference/authentication)
- [Management API keys](https://openrouter.ai/docs/guides/overview/auth/management-api-keys)
- [Get current API key](https://openrouter.ai/docs/api/api-reference/api-keys/get-current-key)
- [List API keys](https://openrouter.ai/docs/api/api-reference/api-keys/list)
- [Get remaining credits](https://openrouter.ai/docs/api/api-reference/credits/get-credits)
- [Get user activity grouped by endpoint](https://openrouter.ai/docs/api/api-reference/analytics/get-user-activity)
- [Get analytics metadata](https://openrouter.ai/docs/api/api-reference/beta-analytics/get-analytics-meta)
- [Query analytics data](https://openrouter.ai/docs/api/api-reference/beta-analytics/query-analytics)
- [Get generation metadata](https://openrouter.ai/docs/api/api-reference/generations/get-generation)
- [List models](https://openrouter.ai/docs/api/api-reference/models/get-models)

Current relevant endpoints:

| Area | Endpoint | Credential |
| --- | --- | --- |
| Current key | `GET /api/v1/key` | API key or management key for the current auth session |
| Credits | `GET /api/v1/credits` | Management key |
| Activity | `GET /api/v1/activity` | Management key |
| Analytics metadata | `GET /api/v1/analytics/meta` | Management key |
| Analytics query | `POST /api/v1/analytics/query` | Management key |
| Generation metadata | `GET /api/v1/generation?id=...` | Bearer credential for accessible generation |
| API keys | `GET /api/v1/keys` and `GET /api/v1/keys/:hash` | Management key |
| Models | `GET /api/v1/models` | Bearer credential |

Authentication facts:

- OpenRouter uses `Authorization: Bearer <token>`.
- The default base URL is `https://openrouter.ai/api/v1`.
- `httpReferer` and `appTitle` are optional attribution settings in OpenRouter SDK examples. The plugin may send configured `HTTP-Referer` and `X-Title` headers, but they are not credentials and must not be required.
- Management keys are exclusively for administrative operations and cannot be used for completion endpoints. The plugin must not expose completion/inference tools.

Reporting facts:

- `/key` returns current key metadata such as label, limits, remaining limit, usage totals, BYOK usage totals, management-key status, and expiration.
- `/keys` returns API key metadata, including key hash, name, disabled state, limits, usage totals, workspace id, and timestamps. The plugin must not expose create, update, or delete key tools in v1.
- `/credits` returns total credits purchased and total usage for the authenticated user.
- `/activity` returns user activity grouped by endpoint for the last 30 completed UTC days. It supports optional filters for a single UTC `date`, `api_key_hash`, and organization `user_id`.
- `/activity` rows currently include model, model permaslug, provider name, endpoint id, prompt tokens, completion tokens, reasoning tokens, request count, usage, BYOK usage inference, and date.
- `/analytics/meta` returns available analytics metrics, dimensions, operators, and granularities.
- `/analytics/query` executes a beta analytics query with metrics, dimensions, filters, optional granularity, limit, order, and time range. The response includes query metadata such as row count and truncation.
- `/generation` returns point-in-time request and usage metadata for one generation id, including model, upstream provider, token counts, total cost, upstream inference cost, latency, service tier, router, request id, and related metadata.
- `/models` returns model catalog metadata and pricing fields. This is pricing/catalog metadata, not actual spend.

## 3. Goals

1. Support OpenRouter usage and cost dashboards through the common tools:
   - `ai_admin_query_usage`
   - `ai_admin_query_costs`
   - `ai_admin_query_dashboard_bundle`
2. Expose OpenRouter-native read-only tools for key metadata, credits, analytics, recent activity, generation metadata, and model pricing metadata.
3. Use the management-key analytics and activity APIs for aggregate reporting instead of trying to infer aggregate spend from model pricing tables.
4. Preserve provider-returned data without dashboard-side redaction except credential-like values and response headers.
5. Avoid prompt/completion content exposure.
6. Avoid all OpenRouter mutation endpoints in v1.
7. Keep the implementation compatible with static credential mode and the documented pass-through/broker contracts.
8. Validate provider-specific `provider_options.openrouter` values before making provider calls.
9. Surface data-freshness, beta-API, range-limit, and truncation warnings in normal tool envelopes.

## 4. Non-Goals

The OpenRouter plugin must not:

- call chat completion, responses, messages, embeddings, image, speech, transcription, rerank, or video generation endpoints;
- expose stored prompt or completion content for a generation;
- create, update, disable, or delete OpenRouter API keys;
- create or mutate workspaces, budgets, guardrails, BYOK credentials, observability destinations, presets, or organization members;
- calculate authoritative costs from `/models` pricing when OpenRouter reporting APIs provide provider-reported usage or cost fields;
- require a separate npm package for the first implementation;
- implement multi-tenant credential storage inside the OSS server.

## 5. Configuration

Environment variables:

| Variable | Required | Notes |
| --- | --- | --- |
| `OPENROUTER_MANAGEMENT_KEY` | For aggregate reporting in static mode | Preferred credential for analytics, activity, credits, and API key metadata. Sent as bearer auth. |
| `OPENROUTER_API_KEY` | Optional in static mode | Fallback credential for current-key, model, and generation metadata when no management key is available. Sent as bearer auth. |
| `OPENROUTER_BASE_URL` | No | Defaults to `https://openrouter.ai/api/v1`. Mainly for tests or compatible gateways. |
| `OPENROUTER_HTTP_REFERER` | No | Optional `HTTP-Referer` attribution header. |
| `OPENROUTER_APP_TITLE` | No | Optional `X-Title` attribution header. |

Accepted static credential refs:

- `credential:openrouter:static`
- `credential:openrouter:management`
- `credential:openrouter:api`

Credential selection rules:

1. Omitted `credential_ref` should use `OPENROUTER_MANAGEMENT_KEY` when available.
2. Omitted `credential_ref` may fall back to `OPENROUTER_API_KEY` only for tools that do not require a management key.
3. `credential:openrouter:management` requires `OPENROUTER_MANAGEMENT_KEY`.
4. `credential:openrouter:api` requires `OPENROUTER_API_KEY`.
5. `credential:openrouter:static` resolves to the management key when present, otherwise the API key.
6. Tools that require a management key must fail with `configuration_error` if only `OPENROUTER_API_KEY` is configured.

Provider inference:

- `inferEnabled` returns true when either `OPENROUTER_MANAGEMENT_KEY` or `OPENROUTER_API_KEY` is present.
- If `AI_ADMIN_ENABLED_PROVIDERS=openrouter` is set without a usable credential, the provider should initialize as misconfigured and produce actionable capability warnings.

## 6. Provider Capabilities

OpenRouter capabilities should report:

```json
{
  "provider": "openrouter",
  "display_name": "OpenRouter",
  "status": "enabled",
  "supports_usage": true,
  "supports_costs": true,
  "direct_queries_can_incur_cost": false
}
```

`direct_queries_can_incur_cost` is false because this plugin only calls documented read-only management/reporting/catalog endpoints. It must not call inference endpoints.

Capability warnings:

- `openrouter_analytics_beta`: `/analytics/meta` and `/analytics/query` are documented under Beta Analytics.
- `openrouter_activity_window`: `/activity` is limited to the last 30 completed UTC days.
- `openrouter_generation_point_lookup`: `/generation` is a single-generation lookup and does not list all generations.
- `openrouter_cost_currency`: OpenRouter cost/usage fields are provider-reported numeric credit spend; preserve raw values and label currency handling explicitly.

Capability dimensions:

| Normalized dimension | OpenRouter source |
| --- | --- |
| `workspace_id` | `workspace_id` from key metadata when available |
| `user_id` | `user_id`, `external_user`, or `creator_user_id` when available |
| `api_key_id` | API key hash |
| `model` | `model` or `model_permaslug` |
| `service_tier` | `service_tier` |
| `project_id` | Always null |
| `line_item` | Analytics metric or activity usage category when available |
| `description` | Provider-native description or endpoint/provider label when useful |

Provider-only dimensions must live under `provider_details.openrouter`, including:

- `provider_name`
- `endpoint_id`
- `router`
- `data_region`
- `is_byok`
- `app_id`
- `request_id`
- `session_id`
- `origin`
- `http_referer`
- analytics dimensions not represented in the common normalized dimension object

## 7. Provider-Specific Tools

### 7.1 `openrouter_admin_get_current_key`

Endpoint:

```text
GET /key
```

Returns current credential metadata. This is primarily a health/configuration and limit-inspection tool.

Inputs:

- `credential_ref`
- `include_raw`

Output:

- provider tool envelope;
- normalized key metadata under `data.key`;
- raw provider body only when `include_raw = true`.

### 7.2 `openrouter_admin_list_api_keys`

Endpoint:

```text
GET /keys
```

Requires a management key.

Inputs:

- `credential_ref`
- `include_disabled`
- `offset`
- `workspace_id`
- `include_raw`

Output:

- provider tool envelope;
- `data.api_keys`;
- pagination metadata when the response includes enough information.

This tool must not return actual API key secret values. It returns provider metadata such as hashes, labels, names, limits, disabled status, usage totals, workspace ids, and timestamps.

### 7.3 `openrouter_admin_get_api_key`

Endpoint:

```text
GET /keys/:hash
```

Requires a management key.

Inputs:

- `hash`
- `credential_ref`
- `include_raw`

Output:

- one provider API key metadata object.

### 7.4 `openrouter_admin_get_credits`

Endpoint:

```text
GET /credits
```

Requires a management key.

Outputs:

- `total_credits`
- `total_usage`
- `remaining_credits = total_credits - total_usage` when both source fields are numeric
- warnings if fields are missing or non-numeric

Credits are account state, not time-bucketed spend. This tool should not emit `CostFact` rows by itself.

### 7.5 `openrouter_admin_get_activity`

Endpoint:

```text
GET /activity
```

Requires a management key.

Inputs:

- `date` as `YYYY-MM-DD`, optional
- `api_key_hash`, optional
- `user_id`, optional
- `include_raw`

Rules:

- `date` must be a completed UTC day within the provider-supported 30-day window.
- If no date is provided, preserve the provider response window semantics and return a warning that the provider defines the exact window.

Output:

- provider-native activity rows;
- normalized usage facts;
- normalized cost facts when `usage` or equivalent spend fields are present.

### 7.6 `openrouter_admin_get_analytics_meta`

Endpoint:

```text
GET /analytics/meta
```

Requires a management key.

Output:

- available metrics;
- available dimensions;
- operators;
- granularities;
- cached for at least `MCP_CACHE_TTL_SECONDS` and preferably 300 seconds because it is metadata.

### 7.7 `openrouter_admin_query_analytics`

Endpoint:

```text
POST /analytics/query
```

Requires a management key.

Inputs:

- `metrics`
- `dimensions`
- `filters`
- `granularity`
- `group_limit`
- `limit`
- `order_by`
- `time_range`
- `include_raw`

Validation:

- Fetch or use cached `/analytics/meta`.
- Reject unsupported metrics, dimensions, operators, and granularities before calling OpenRouter.
- Validate ISO timestamps.
- Apply server-side max range defaults unless the provider documents stricter limits.

Output:

- provider-native analytics rows;
- normalized usage facts for recognized usage metrics;
- normalized cost facts for recognized spend metrics;
- `truncated_response` warning when provider metadata reports truncation.

### 7.8 `openrouter_admin_get_generation`

Endpoint:

```text
GET /generation?id=...
```

Inputs:

- `id`
- `credential_ref`
- `include_raw`

Output:

- one normalized usage fact;
- one normalized cost fact when `total_cost`, `usage`, or `upstream_inference_cost` is present;
- provider details for latency, upstream provider, router, service tier, BYOK state, request id, and generation metadata.

Rules:

- This is a point lookup. It must not be used as an aggregate history tool unless the caller explicitly supplies generation ids.
- Do not expose the stored prompt/completion content endpoint.

### 7.9 `openrouter_admin_list_models`

Endpoint:

```text
GET /models
```

Inputs:

- documented OpenRouter model filters when implemented;
- `include_raw`

Output:

- model catalog;
- pricing metadata under `data.models[*].pricing`;
- warnings that catalog pricing is not authoritative historical spend.

## 8. Common Tool Behavior

### 8.1 `ai_admin_query_usage`

Common usage calls with `providers: ["openrouter"]` should route to OpenRouter `queryUsage`.

Default strategy:

1. Prefer `/analytics/query` for date ranges and dimensions that can be represented by current `/analytics/meta`.
2. Use `/activity` only when `provider_options.openrouter.source = "activity"` or when analytics metadata is unavailable and the requested range fits the last-30-completed-days constraint.
3. Use `/generation` only when the caller passes explicit `generation_ids`.

OpenRouter provider options:

```json
{
  "source": "analytics",
  "metrics": ["request_count"],
  "dimensions": ["model"],
  "filters": [],
  "granularity": "day",
  "limit": 1000,
  "group_limit": null,
  "generation_ids": []
}
```

Supported `source` values:

- `analytics`
- `activity`
- `generation`

Normalization:

- `prompt_tokens` and `native_tokens_prompt` map to `input_tokens`.
- `completion_tokens` and `native_tokens_completion` map to `output_tokens`.
- cached token fields map to `input_cached_tokens` when they represent provider-native cache reads or cached prompt tokens.
- `reasoning_tokens` and `native_tokens_reasoning` stay in `provider_details.openrouter` until the common schema adds a reasoning-token field.
- `requests` and `request_count` map to `request_count`.
- OpenRouter credit usage can map to `credit_count` when it is not safe to normalize as money.

### 8.2 `ai_admin_query_costs`

Default strategy:

1. Prefer `/analytics/query` when available metrics include a spend/cost/usage metric suitable for cost facts.
2. Use `/activity` for the last 30 completed UTC days when it returns `usage` or BYOK usage spend fields.
3. Use `/generation` for explicit generation ids.
4. Do not derive cost from `/models` pricing for aggregate reports.

Cost normalization:

- Set `cost_source = "provider_reported"` for OpenRouter `usage`, `total_cost`, and `upstream_inference_cost` fields returned by reporting endpoints.
- Preserve raw numeric values in `provider_details.openrouter`.
- Use `currency = "USD"` only if implementation confirms OpenRouter reports these values as USD-equivalent account credits. Otherwise use `currency = "openrouter_credit"` and include `openrouter_cost_currency` warning.
- For BYOK usage, keep `byok_usage_inference` separate in provider details and add a coverage warning if it is not included in the normalized total.

### 8.3 `ai_admin_query_dashboard_bundle`

The OpenRouter dashboard bundle includes:

- summary request count;
- summary input and output tokens;
- summary provider-reported cost or credit usage;
- top models by tokens;
- top API keys by tokens when key hash dimensions are available;
- API key metadata when `include_metadata = true`;
- warnings for beta analytics, truncation, currency uncertainty, and partial coverage.

Credits remain available through `openrouter_admin_get_credits`; the shared dashboard bundle metadata contract does not inline provider-specific credit balances.

When the analytics response indicates truncation, the bundle must:

- set a warning;
- preserve provider metadata;
- avoid presenting summaries as complete unless provider metadata shows completeness.

## 9. Raw Data And Redaction

Default behavior:

- return normalized records and curated metadata;
- set `raw = null`.

When `include_raw = true`:

- include provider response bodies;
- do not redact provider-returned usage, cost, model, key hash, workspace id, user id, endpoint id, or request id fields;
- redact only credential-like values, outbound authorization headers, cookies, and other secret-bearing headers.

The plugin must not invent additional dashboard-level redaction. If OpenRouter returns a redacted label or hash, preserve it as the provider returned it.

## 10. Caching And Freshness

Recommended caching:

| Data | TTL |
| --- | --- |
| `/analytics/meta` | 300 seconds |
| `/models` | 300 seconds |
| key metadata | 60 seconds |
| credits | 60 seconds |
| dashboard bundle | `MCP_CACHE_TTL_SECONDS` |

Freshness handling:

- return `queried_at` on every envelope;
- preserve OpenRouter activity dates as provider reporting dates;
- include a warning when `/activity` is used without an explicit `date`;
- include a warning when analytics data is beta or truncated.

## 11. Errors

Use existing MCP error conventions:

| Condition | Error code |
| --- | --- |
| Missing management key for management-only tool | `configuration_error` |
| Unsupported analytics metric/dimension/operator/granularity | `validation_failed` |
| Activity date outside supported completed UTC window | `validation_failed` |
| Invalid generation id | `validation_failed` |
| OpenRouter 401 or 403 | provider auth error mapped through existing HTTP client conventions |
| OpenRouter 429 | provider rate-limit error with retry metadata when available |
| OpenRouter 5xx | provider upstream error |

Validation must happen before provider calls whenever possible.

## 12. Implementation Plan

1. Add `src/providers/openrouter` with:
   - `client.ts`
   - `plugin.ts`
   - `provider.ts`
   - `normalize.ts`
   - `types.ts`
   - focused tests and fixtures
2. Add OpenRouter to the built-in provider plugin array in `src/providers.ts`.
3. Add `openrouter` to documented provider ids and README provider notes.
4. Add credential resolution for:
   - `OPENROUTER_MANAGEMENT_KEY`
   - `OPENROUTER_API_KEY`
   - the accepted static credential refs
5. Implement provider-native tools first:
   - current key
   - list/get API keys
   - credits
   - activity
   - analytics meta
   - analytics query
   - generation metadata
   - model list
6. Implement normalized common methods:
   - `queryUsage`
   - `queryCosts`
   - `queryDashboardBundle`
7. Add docs:
   - `docs/openrouter-admin.md`
   - README configuration, tools, provider notes
8. Add release notes for the first OpenRouter release:
   - read-only provider plugin;
   - management key requirement for aggregate reporting;
   - no inference calls;
   - no OpenRouter mutation tools;
   - analytics API is beta;
   - `/activity` is limited to the last 30 completed UTC days.

## 13. Tests

Required tests:

- provider enables when `OPENROUTER_MANAGEMENT_KEY` or `OPENROUTER_API_KEY` exists;
- required provider reports misconfiguration when enabled without credentials;
- static credential refs resolve to the intended credential;
- management-only tools fail when only `OPENROUTER_API_KEY` is configured;
- outbound requests send bearer auth and optional attribution headers;
- `openrouter_admin_query_analytics` validates metrics/dimensions/operators against meta fixtures;
- analytics truncation produces warnings;
- `/activity` date validation rejects non-completed or out-of-window dates;
- generation metadata normalizes tokens, cost, provider details, and warnings;
- model list preserves pricing metadata but does not emit cost facts;
- common `provider_options.openrouter` route through the OpenRouter runtime;
- no create/update/delete OpenRouter tools are registered.

Live tests:

- skip unless `OPENROUTER_MANAGEMENT_KEY` is present;
- query `/key`, `/credits`, and `/analytics/meta`;
- optionally query `/activity` for a completed date when explicitly enabled;
- never call inference endpoints.

## 14. V1 Decisions

Resolved for v1:

1. OpenRouter cost facts normalize `usage` and `total_cost` as `openrouter_credit` until live account semantics confirm whether these values should be labeled as USD.
2. Common dashboard analytics metrics default to provider-supported usage metrics selected from `/analytics/meta`.
3. Dashboard defaults group by `api_key_hash`; direct usage and cost tools only group by API key when the caller passes that dimension.
