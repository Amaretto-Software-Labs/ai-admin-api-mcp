# AI Admin API MCP Server Spec

**Status:** Proposed
**Scope:** Standalone open-source multi-provider MCP server for provider usage, cost, and admin reporting
**Last updated:** 2026-06-13

## 1. Summary

Create one standalone, open-source, read-only MCP server:

- `ai-admin-api-mcp`

The server exposes provider-native usage, cost, and administrative reporting metadata through provider modules. Initial modules should cover OpenAI and Anthropic. The architecture must leave room for Google/Gemini, OpenRouter, Azure OpenAI, Bedrock, Vertex AI, and other AI providers whose reporting APIs do not share the same shape.

The product goal is general-purpose observability: users should be able to connect one MCP server to MCP-capable clients and build live, provider-backed dashboards for spend, token consumption, cache efficiency, API key attribution, workspace/project attribution, and cost trends across enabled providers.

The server must stand on its own for local users, self-hosted teams, MCP-compatible clients, and dashboard-building agents without requiring any product-specific runtime dependency.

The v1 server must be safe by default:

- read-only MCP tools only;
- no provider admin mutations;
- no cost-incurring API calls;
- no credential echoing in logs, tool results, or errors;
- stable normalized result shapes for dashboard builders;
- provider-native raw data available only behind explicit `include_raw` options.

## 2. Problem Statement

AI providers expose usage and cost data through different admin APIs, billing exports, cloud billing systems, and dashboard-only surfaces. Users who want custom dashboards still need to write provider-specific polling, pagination, grouping, authentication, and normalization code.

Current gaps:

1. Users cannot plug AI provider usage/cost reporting into MCP clients as one reusable tool surface.
2. OpenAI, Anthropic, Google, and other providers expose different time formats, dimensions, bucket limits, currencies, pagination shapes, freshness windows, and cost coverage.
3. Provider cost APIs are authoritative for billing reconciliation, while token usage APIs are better for operational attribution. Consumers need both.
4. Some useful dashboard questions require metadata enrichment, such as OpenAI projects/API keys, Anthropic workspaces/API keys, or Google Cloud billing projects/SKUs.
5. MCP-compatible clients do not have one curated OSS server contract for provider admin usage/cost data.
6. Provider admin credentials are high-impact secrets, so any open-source implementation needs a strict read-only surface and clear deployment guidance.
7. A two-server model does not scale well once Google, Azure, Bedrock, OpenRouter, or other provider modules are added.

## 3. Goals

1. Ship one standalone MCP server with no product-specific runtime dependency.
2. Support STDIO for local MCP clients and Streamable HTTP for self-hosted or gateway-compatible deployments.
3. Expose provider modules for OpenAI and Anthropic in v1.
4. Define a provider module interface so Google/Gemini and other AI providers can be added without forking the MCP server.
5. Expose provider-native usage and cost report tools with pagination handled by the server.
6. Expose normalized usage and cost records that are stable across providers.
7. Expose provider capability resources so clients can discover supported dimensions, granularities, limits, and known gaps.
8. Support dashboard-friendly aggregate tools that return current spend, trend series, top dimensions, and freshness metadata in one call.
9. Support cross-provider dashboard tools when more than one provider is enabled.
10. Keep all v1 tools read-only and non-cost-incurring.
11. Support per-call credential selection through opaque credential references.
12. Keep provider admin/reporting secrets out of model-visible tool arguments, prompts, resources, logs, and persisted MCP state.
13. Support stateless HTTP deployments for operators that want to host the server behind a gateway or reverse proxy.
14. Make the server easy to self-host as a single-tenant service.
15. Keep the public tool contracts stable enough that future products can adopt them without changing the OSS server.

## 4. Non-Goals

This spec does not attempt to:

- expose provider admin mutations such as user, role, workspace, project, API key, service account, spend alert, rate limit, or model permission changes;
- compute authoritative provider bills from model pricing tables when provider cost APIs are available;
- fully implement Google/Gemini, Azure OpenAI, OpenAI through third-party gateways, Amazon Bedrock Claude, Vertex AI Claude, Microsoft Foundry Claude, Claude Platform on AWS, or OpenRouter usage reports in v1;
- support Claude Enterprise Analytics API as part of the Anthropic Admin API server v1;
- expose customer prompt, completion, file, or trace content;
- build a hosted multi-tenant SaaS in v1;
- implement a product-specific integration in v1;
- make any product billing ledger depend on provider admin API availability;
- ingest provider cost data into a product database automatically before a separate product implementation is specified.

## 5. Current Provider API Facts

The implementation must treat the following as current API facts checked on 2026-06-13. These facts should be rechecked before implementation because provider admin APIs are moving surfaces.

### 5.1 OpenAI Admin API

Relevant sources:

- [OpenAI Admin APIs guide](https://developers.openai.com/api/docs/guides/admin-apis)
- [OpenAI Usage API and Cost API cookbook](https://developers.openai.com/cookbook/examples/completions_usage_api)
- OpenAI OpenAPI spec entries for `/v1/organization/usage/*` and `/v1/organization/costs`

OpenAI exposes Admin API key authenticated organization usage and cost endpoints under `https://api.openai.com/v1`.

Relevant current endpoints:

| Area | Endpoint |
| --- | --- |
| Costs | `GET /organization/costs` |
| Completions usage | `GET /organization/usage/completions` |
| Embeddings usage | `GET /organization/usage/embeddings` |
| Images usage | `GET /organization/usage/images` |
| Moderations usage | `GET /organization/usage/moderations` |
| Audio speeches usage | `GET /organization/usage/audio_speeches` |
| Audio transcriptions usage | `GET /organization/usage/audio_transcriptions` |
| Code Interpreter sessions usage | `GET /organization/usage/code_interpreter_sessions` |
| File search calls usage | `GET /organization/usage/file_search_calls` |
| Vector stores usage | `GET /organization/usage/vector_stores` |
| Web search calls usage | `GET /organization/usage/web_search_calls` |
| Projects | `GET /organization/projects` |
| Users | `GET /organization/users` |
| Project API keys | `GET /organization/projects/{project_id}/api_keys` |
| Admin API keys | `GET /organization/admin_api_keys` |

OpenAI usage endpoints share these common query rules:

- `start_time` as required Unix seconds;
- optional `end_time`;
- `bucket_width` values `1m`, `1h`, and `1d`;
- cursor pagination through `page` and `next_page`;
- `limit` with endpoint-independent bucket defaults and max values by bucket width;
- endpoint-specific filters, group-by dimensions, and metric fields.

OpenAI usage endpoint capabilities currently differ by endpoint:

| Usage endpoint | Filters beyond time/bucket/page/limit | Supported `group_by` values | Primary metrics |
| --- | --- | --- | --- |
| `audio_speeches` | `project_ids`, `user_ids`, `api_key_ids`, `models` | `project_id`, `user_id`, `api_key_id`, `model` | `characters`, `num_model_requests` |
| `audio_transcriptions` | `project_ids`, `user_ids`, `api_key_ids`, `models` | `project_id`, `user_id`, `api_key_id`, `model` | `seconds`, `num_model_requests` |
| `code_interpreter_sessions` | `project_ids` | `project_id` | `num_sessions` |
| `completions` | `project_ids`, `user_ids`, `api_key_ids`, `models`, `batch` | `project_id`, `user_id`, `api_key_id`, `model`, `batch`, `service_tier` | `input_tokens`, `output_tokens`, `input_cached_tokens`, `input_audio_tokens`, `output_audio_tokens`, `num_model_requests` |
| `embeddings` | `project_ids`, `user_ids`, `api_key_ids`, `models` | `project_id`, `user_id`, `api_key_id`, `model` | `input_tokens`, `num_model_requests` |
| `file_search_calls` | `project_ids`, `user_ids`, `api_key_ids`, `vector_store_ids` | `project_id`, `user_id`, `api_key_id`, `vector_store_id` | `num_requests` |
| `images` | `project_ids`, `user_ids`, `api_key_ids`, `models`, `sources`, `sizes` | `project_id`, `user_id`, `api_key_id`, `model`, `size`, `source` | `images`, `num_model_requests` |
| `moderations` | `project_ids`, `user_ids`, `api_key_ids`, `models` | `project_id`, `user_id`, `api_key_id`, `model` | `input_tokens`, `num_model_requests` |
| `vector_stores` | `project_ids` | `project_id` | `usage_bytes` |
| `web_search_calls` | `project_ids`, `user_ids`, `api_key_ids`, `models`, `context_levels` | `project_id`, `user_id`, `api_key_id`, `model`, `context_level` | `num_model_requests`, `num_requests` |

The OpenAI provider module must use this capability matrix for:

- input schema generation;
- request serialization;
- validation of unsupported filters and unsupported `group_by` values;
- normalized mapping into common metrics and `provider_details.openai`.

The server must reject an OpenAI usage request with `validation_failed` when the selected `usage_endpoint` receives a filter or `group_by` value that endpoint does not support. It must not silently drop unsupported filters.

OpenAI costs currently support:

- `start_time` as required Unix seconds;
- optional `end_time`;
- daily buckets only;
- filters for project IDs and API key IDs;
- grouping by `project_id`, `line_item`, `api_key_id`, or combinations;
- cursor pagination through `page` and `next_page`;
- `amount.value` and `amount.currency`, plus optional line item, project, API key, and quantity fields.

Implementation caution:

- Usage can group by `user_id`; costs cannot currently group by `user_id`. User-level costs must be labeled as estimates if derived from token proportions.
- Null grouped dimensions mean "not grouped", "default", or "unattributed" depending on the query and provider response. The server must preserve raw nulls and add explicit normalized labels.

### 5.2 Anthropic Admin API

Relevant sources:

- [Anthropic Admin API](https://platform.claude.com/docs/en/manage-claude/admin-api)
- [Anthropic Usage and Cost API](https://platform.claude.com/docs/en/manage-claude/usage-cost-api)
- [Anthropic Usage and Cost Admin API cookbook](https://platform.claude.com/cookbook/observability-usage-cost-api)

Anthropic exposes organization Admin API endpoints under `https://api.anthropic.com/v1`. The Admin API is unavailable for individual accounts. It accepts either an Admin API key in `x-api-key` or an OAuth bearer token with `org:admin`, and requests require `anthropic-version: 2023-06-01`.

Relevant current endpoints:

| Area | Endpoint |
| --- | --- |
| Organization info | `GET /organizations/me` |
| Messages usage report | `GET /organizations/usage_report/messages` |
| Cost report | `GET /organizations/cost_report` |
| Workspaces | `GET /organizations/workspaces` |
| API keys | `GET /organizations/api_keys` |
| Rate limits | `GET /organizations/rate_limits` |
| Claude Code usage | `GET /organizations/usage_report/claude_code` |

Anthropic messages usage currently supports:

- `starting_at` and `ending_at` as ISO timestamps;
- `bucket_width` values `1m`, `1h`, and `1d`;
- filters and grouping by API key, workspace, model, service tier, context window, inference geography, and speed when the relevant beta header is present;
- token fields including uncached input, output, cache creation, cache reads, and server tool usage;
- cursor pagination through `page` and `next_page`.

Anthropic cost reports currently support:

- daily granularity only;
- costs in USD, returned as decimal strings in lowest units;
- grouping by workspace or description;
- cost types covering token usage, web search, and code execution;
- cursor pagination through `page` and `next_page`.

Implementation caution:

- Anthropic documents that Usage and Cost data typically appears within about 5 minutes, but the API is for historical analysis and dashboard polling, not true streaming.
- Anthropic documents sustained polling once per minute as acceptable; the server should default to caching dashboard bundles for at least 60 seconds.
- Priority Tier costs use a different billing model and are not included in the cost endpoint. Priority usage can be tracked through the usage endpoint and must be surfaced as a cost coverage gap.
- Claude Platform on AWS does not currently expose programmatic Usage and Cost API endpoints. That deployment path is out of scope for v1.
- Claude Enterprise analytics uses a different API and key type. That can be a separate server or v2 feature.

### 5.3 Google/Gemini Reporting Surfaces

Relevant sources:

- [Google Cloud Billing export to BigQuery](https://docs.cloud.google.com/billing/docs/how-to/export-data-bigquery)
- [Gemini API billing](https://ai.google.dev/gemini-api/docs/billing)

Google does not currently present one OpenAI/Anthropic-style "Gemini Admin Usage and Cost API" in the same shape as OpenAI organization usage/cost endpoints or Anthropic organization usage/cost reports.

The most durable Google cost-reporting path is Cloud Billing export to BigQuery:

- Cloud Billing can export detailed billing data, including usage, estimated costs, and pricing data, to BigQuery throughout the day.
- Export types include Standard usage cost, Detailed usage cost, Pricing data, and FOCUS usage cost export.
- Standard usage cost includes billing account ID, invoice date, services, SKUs, projects, labels, locations, cost, usage, credits, adjustments, and currency.
- Detailed usage cost adds more resource-level data.
- FOCUS usage cost export uses the FinOps Open Cost and Usage Specification shape.
- Querying billing exports incurs BigQuery storage/query costs, so an MCP tool that queries BigQuery is not automatically cost-free.

Gemini API billing is tied to billing accounts and tiers. The provider module should treat Google as a cloud billing data source, not as a direct Admin API clone.

Implementation caution:

- Google support should be a v2 provider module unless a narrower Gemini-specific reporting API is confirmed before implementation.
- Google tools must require an explicit BigQuery billing-export dataset/table configuration.
- Google tools must expose query-cost warnings and optionally support dry-run estimates before executing BigQuery queries.
- The normalized data contract should prefer FOCUS-compatible fields where possible because Google already supports a FOCUS usage cost export.
- Google module support should not imply that all Gemini Developer API, Vertex AI, Firebase AI Logic, and Google Cloud AI costs can be attributed by model/API key in the same way.

## 6. Product Decisions

### 6.1 One server, provider modules

Ship one MCP server with a provider module interface. OpenAI, Anthropic, Google, and future providers have distinct credentials, endpoints, rate limits, dimensions, and failure modes, but users should install and connect one MCP server.

Reasons:

- Users and operators configure one MCP endpoint instead of one endpoint per provider.
- Cross-provider dashboard tools can work inside one server without another aggregation layer.
- Provider modules can share auth redaction, time validation, pagination, caching, schemas, transports, and release tooling.
- Adding Google or OpenRouter later does not require a new top-level server product.

Provider modules must be independently enabled. A missing or misconfigured Anthropic credential must not prevent a correctly configured OpenAI module from working unless the operator marks Anthropic as required.

Recommended open-source layout:

```text
ai-admin-api-mcp/
  packages/
    admin-usage-core/
    mcp-server/
    providers/
      openai/
      anthropic/
      google-cloud-billing/
  examples/
    static-dashboard/
    gateway-config/
  docs/
    openai-admin.md
    anthropic-admin.md
    google-cloud-billing.md
```

Final package names can change before publish, but the public binary should be provider-neutral:

- `ai-admin-api-mcp`

### 6.2 Provider module interface

Each provider module must declare:

- provider ID, display name, and version;
- required and optional configuration variables;
- required credentials and credential validation strategy;
- supported tools, resources, and prompts;
- supported usage endpoints or export tables;
- supported cost endpoints or export tables;
- dimensions, filters, bucket widths, and max/default range limits;
- freshness expectations;
- cost coverage gaps;
- whether direct queries can incur provider costs;
- normalized schema mappings;
- live smoke-test capabilities.

The server uses this declaration to build:

- `ai-admin://providers`
- `ai-admin://providers/{provider}/capabilities`
- provider-prefixed tools;
- cross-provider validation warnings.

### 6.3 Read-only observability first

The server must not expose write, delete, invite, role, key, workspace, project, service account, rate limit, model permission, billing account, export configuration, or spend alert mutation tools in v1.

Metadata list tools are allowed only when they support dashboard enrichment. For example, listing OpenAI projects or Anthropic workspaces is useful because usage and cost reports group by those IDs.

### 6.4 Provider-native cost APIs are authoritative

The server should use provider cost APIs or provider billing exports for authoritative cost reporting.

Token-based cost estimates are allowed only as secondary values and must be labeled:

- `cost_source = "provider_reported"` for provider cost endpoint rows;
- `cost_source = "provider_billing_export"` for Google Cloud Billing export rows or equivalent billing-export data;
- `cost_source = "estimated_from_usage"` for derived costs;
- `cost_source = "not_available"` for unsupported breakdowns.

### 6.5 "Live" means pollable and freshness-labeled

These provider APIs and exports are reporting surfaces, not event streams. The dashboard contract should support near-live polling by returning:

- `queried_at`;
- `provider_data_available_through` when inferable;
- `cache_status`;
- `freshness_notes`;
- `partial_data_warnings`.

### 6.6 Raw responses are optional and redacted

Default tool results should return normalized records only. `include_raw = true` may include provider response fragments for debugging, but the server must still redact credential-like values and response headers.

### 6.7 Cross-provider tools are additive

Provider-native tools remain the canonical source for detailed data. Cross-provider tools are convenience aggregators that call enabled provider modules and normalize the results.

Required cross-provider tools:

- `ai_admin_list_providers`
- `ai_admin_query_dashboard_bundle`
- `ai_admin_query_costs`
- `ai_admin_query_usage`

Cross-provider tools must return per-provider warnings instead of failing the whole call when one provider is unavailable, unless the provider is explicitly requested with `required = true`.

### 6.8 Open-source first, integration-friendly later

The public server must not require product-specific concepts, services, packages, credential stores, or hosting assumptions.

Future products should be able to adopt the server by using the same public MCP tools and resources that any other client uses. If a product needs hosted credential brokering, runtime policy, or managed containers, that should be implemented as a product-side gateway around the OSS server, not as a hard dependency inside the OSS server.

### 6.9 Normalized tools and provider-specific tools both ship

The server should expose two layers:

| Layer | Examples | Purpose |
| --- | --- | --- |
| Common normalized tools | `ai_admin_query_usage`, `ai_admin_query_costs`, `ai_admin_query_dashboard_bundle` | Portable dashboard and reporting flows |
| Provider-specific tools | `openai_admin_query_usage`, `anthropic_admin_query_messages_usage`, `google_billing_query_costs` | Provider-native precision, metadata enrichment, and unsupported dimensions |

The common tools are the stable consumption surface. They normalize provider results into shared `usage_fact`, `cost_fact`, and `dashboard_bundle` schemas.

The provider-specific tools preserve real provider behavior. They should not be hidden behind a fake universal API because provider capabilities are materially different. For example, OpenAI exposes projects and multiple usage endpoints, Anthropic exposes workspaces and different usage dimensions, and Google is likely billing-export based.

Provider-specific results should still use the common result envelope and normalized fact schemas where possible, with provider-only fields under explicit `provider_details` objects and raw responses only behind `include_raw`.

## 7. Deployment Modes

### 7.1 Local STDIO

STDIO is for local MCP clients such as developer desktops, CLI agents, and dashboard-building agents.

Example shape:

```bash
AI_ADMIN_ENABLED_PROVIDERS=openai,anthropic \
OPENAI_ADMIN_KEY=<admin-api-key> \
ANTHROPIC_ADMIN_KEY=sk-ant-admin... \
npx ai-admin-api-mcp --stdio
```

### 7.2 Single-tenant Streamable HTTP

Streamable HTTP is required for self-hosted team deployments and compatibility with MCP gateways or reverse proxies.

Example shape:

```bash
AI_ADMIN_ENABLED_PROVIDERS=openai,anthropic \
OPENAI_ADMIN_KEY=<admin-api-key> \
ANTHROPIC_ADMIN_KEY=sk-ant-admin... \
MCP_HTTP_AUTH_TOKEN=local-proxy-token \
npx ai-admin-api-mcp --http --port 8787
```

The MCP HTTP endpoint should require an inbound bearer token unless explicitly started with an unsafe local-only mode. The inbound MCP bearer token protects the MCP server. Upstream provider credentials remain in server environment or secret storage.

### 7.3 Docker

The server should ship a small Docker image:

```bash
docker run --rm -p 8787:8787 \
  -e AI_ADMIN_ENABLED_PROVIDERS=openai,anthropic \
  -e OPENAI_ADMIN_KEY \
  -e ANTHROPIC_ADMIN_KEY \
  -e MCP_HTTP_AUTH_TOKEN \
  ghcr.io/<org>/ai-admin-api-mcp:latest --http --port 8787
```

### 7.4 Operator-hosted shared service

The OSS server may be run as a shared service by an organization or third-party operator, but multi-tenant hosted SaaS is out of scope for v1.

If an operator hosts the server for multiple tenants, the operator must provide the external tenant isolation, credential brokering, audit, and policy layer. The OSS server should support that pattern through stateless HTTP, per-token policy, optional per-call credential references, and out-of-band credential material, but it should not implement a full SaaS control plane in v1.

## 8. Authentication And Configuration

Auth has three separate layers:

1. **MCP client -> MCP server:** controls who can call this MCP server.
2. **MCP server -> provider APIs/exports:** controls how the server reads OpenAI, Anthropic, Google, or future provider reporting data.
3. **Optional credential broker -> MCP server:** controls which externally stored provider credential is available for each specific tool call.

Tool arguments may include an opaque `credential_ref` so the caller can select which stored provider credential to use. The actual provider secret must come from local configuration, host secret storage, or an out-of-band gateway/broker mechanism, never as a normal tool argument.

### 8.1 Server-level configuration

Environment variables:

| Variable | Required | Notes |
| --- | --- | --- |
| `AI_ADMIN_ENABLED_PROVIDERS` | No | Comma-separated provider IDs. Defaults to every provider with enough config to initialize. |
| `AI_ADMIN_REQUIRED_PROVIDERS` | No | Comma-separated provider IDs that must initialize successfully or server startup fails. |
| `AI_ADMIN_PROVIDER_CONFIG_FILE` | No | Optional JSON/YAML config file for provider settings. Environment variables override file values. |
| `AI_ADMIN_CREDENTIAL_MODE` | No | `static`, `pass_through`, or `hybrid`. Defaults to `static` for OSS self-hosting. |
| `MCP_HTTP_AUTH_TOKEN` | HTTP mode | Inbound MCP bearer token for Streamable HTTP mode. |
| `MCP_CACHE_TTL_SECONDS` | No | Defaults to `60` for dashboard bundle tools. |
| `MCP_USER_AGENT` | No | Sent on outbound provider requests when supported. |

### 8.2 Inbound MCP auth

#### STDIO mode

STDIO mode is local-process auth by placement:

- the MCP client launches the server process;
- provider credentials come from that process environment or local secret integration;
- there is no network listener;
- no additional inbound bearer token is required.

This mode is for local developer tools and personal MCP clients.

#### Streamable HTTP mode

Streamable HTTP mode must require inbound auth by default.

The v1 open-source server should support:

- static bearer token auth via `MCP_HTTP_AUTH_TOKEN`;
- optional multiple tokens through a config file;
- per-token policy when multiple tokens are configured.

Recommended per-token policy shape:

```json
{
  "tokens": [
    {
      "name": "team-dashboard",
      "token_hash": "sha256:...",
      "allowed_providers": ["openai", "anthropic"],
      "allowed_tools": ["*_query_usage", "*_query_costs", "ai_admin_query_dashboard_bundle"],
      "max_range_days": 90,
      "allow_raw": false,
      "allow_metadata": true,
      "max_google_bytes_billed": 1000000000
    }
  ]
}
```

Only token hashes should be stored in config files. The raw inbound MCP token should be shown once when generated.

Future inbound auth options can add:

- OAuth protected resource metadata for MCP clients that support OAuth;
- mTLS for enterprise-hosted deployments;
- reverse-proxy auth headers from an internal identity-aware proxy.

These are not required for v1.

### 8.3 Per-call credential selection

Every provider-specific query tool and every cross-provider query tool should accept an optional credential selector.

Provider-specific tool input:

```json
{
  "credential_ref": "credential:openai:prod-admin",
  "start": "2026-06-01T00:00:00Z",
  "end": "2026-06-13T00:00:00Z",
  "group_by": ["project_id", "model"]
}
```

Cross-provider tool input:

```json
{
  "providers": ["openai", "anthropic"],
  "credential_refs": {
    "openai": "credential:openai:prod-admin",
    "anthropic": "credential:anthropic:prod-admin"
  },
  "start": "2026-06-01T00:00:00Z",
  "end": "2026-06-13T00:00:00Z"
}
```

`credential_ref` is not a secret. It is an opaque selector that a gateway, operator, or credential broker can resolve to a provider credential after checking caller, tenant, tool, and policy.

The MCP server must validate that the out-of-band credential envelope or broker token matches:

- provider;
- credential reference;
- requested tool;
- caller identity, tenant identity, or MCP connection identity when available;
- allowed date range;
- expiration;
- nonce/request id.

The server must reject the call if the tool input names one credential reference but the out-of-band credential envelope names another.

### 8.4 Outbound provider auth modes

Each provider module owns its outbound auth strategy. The core server owns secret redaction, configuration loading, pass-through validation, and policy enforcement.

#### Static credential mode

Static mode is for local or customer self-hosted deployments.

Provider credentials can come from:

- environment variables;
- a host secret store mounted as environment or files;
- local keychain integration in a future desktop-friendly mode.

Static mode is the default v1 OSS mode. It is simple and appropriate for local or single-tenant self-hosted deployments.

#### Pass-through envelope mode

Pass-through envelope mode is for gateway-hosted deployments where a separate trusted component owns provider credentials.

In this mode:

1. The operator stores provider credentials in an external encrypted secret store.
2. The gateway chooses a `credential_ref` based on tenant, caller, tool, and provider policy.
3. The gateway attaches a short-lived out-of-band credential envelope to the MCP HTTP request.
4. The MCP server validates the envelope and uses the provider credential only in memory for that tool call.
5. The MCP server never persists the credential and never returns it.

Recommended HTTP header:

```text
X-AI-Admin-Credential-Envelope: <compact-jwe-or-signed-token>
```

Recommended envelope claims:

```json
{
  "iss": "credential-gateway",
  "aud": "ai-admin-api-mcp",
  "exp": 1781366100,
  "jti": "cred-env-123",
  "tenant_id": "team_123",
  "provider": "openai",
  "credential_ref": "credential:openai:prod-admin",
  "allowed_tools": ["openai_admin_query_usage", "openai_admin_query_costs"],
  "max_range_days": 90,
  "allow_raw": false,
  "auth": {
    "type": "bearer",
    "secret": "<encrypted-provider-secret>"
  }
}
```

The envelope should be encrypted to the MCP server deployment public key or protected by an internal KMS-backed service-to-service channel. It must be short-lived, single-audience, and non-cacheable.

#### Credential broker mode

Credential broker mode avoids putting the provider secret directly in the MCP HTTP request.

In this mode:

1. Tool input includes `credential_ref`.
2. A gateway attaches a short-lived broker token to the MCP request.
3. The MCP server calls a credential broker endpoint with the broker token, provider, credential reference, and requested tool.
4. The broker returns a short-lived provider credential, request-signer, or provider-specific access token.
5. The MCP server uses it for the provider call and discards it.

Recommended HTTP header:

```text
X-AI-Admin-Credential-Broker-Token: <signed-short-lived-token>
```

Broker mode is more moving parts than envelope mode, but it can centralize auditing, rotation, and provider-specific token exchange.

Provider credentials cannot come from:

- MCP tool arguments;
- prompt text;
- resource URIs;
- dashboard bundle inputs;
- MCP resources.

In static mode, the server should validate provider credentials at startup for required providers and lazily on first use for optional providers. In pass-through or broker mode, startup validation should validate provider module configuration and credential-envelope/broker configuration, then validate the actual provider credential per call.

### 8.5 OpenAI provider

Environment variables:

| Variable | Required | Notes |
| --- | --- | --- |
| `OPENAI_ADMIN_KEY` | When OpenAI is enabled in static mode | Preferred Admin API key name. In pass-through mode this arrives in the per-call envelope or broker response. |
| `OPENAI_BASE_URL` | No | Defaults to `https://api.openai.com/v1`; mainly for tests. |

OpenAI requests use:

- `Authorization: Bearer <OPENAI_ADMIN_KEY>`
- `Content-Type: application/json`

The operator should use the least-privileged OpenAI Admin API credential that can read usage, cost, and metadata needed for dashboard enrichment. The server must not require write-capable OpenAI admin permissions.

### 8.6 Anthropic provider

Environment variables:

| Variable | Required | Notes |
| --- | --- | --- |
| `ANTHROPIC_ADMIN_KEY` | One of key/token when Anthropic is enabled in static mode | Admin API key sent with `x-api-key`. In pass-through mode this arrives in the per-call envelope or broker response. |
| `ANTHROPIC_OAUTH_TOKEN` | One of key/token when Anthropic is enabled in static mode | Optional OAuth bearer token with `org:admin`. In pass-through mode this arrives in the per-call envelope or broker response. |
| `ANTHROPIC_VERSION` | No | Defaults to `2023-06-01`. |
| `ANTHROPIC_BETA` | No | Optional comma-separated beta headers, such as speed dimensions when needed. |
| `ANTHROPIC_BASE_URL` | No | Defaults to `https://api.anthropic.com/v1`; mainly for tests. |

Anthropic requests use either:

- `x-api-key: <ANTHROPIC_ADMIN_KEY>`; or
- `Authorization: Bearer <ANTHROPIC_OAUTH_TOKEN>`.

All Anthropic requests also send:

- `anthropic-version: 2023-06-01` by default.

The operator should use the least-privileged Anthropic Admin API credential or OAuth token that can read organization usage/cost reports and metadata needed for dashboard enrichment.

### 8.7 Google Cloud Billing provider

The Google module is v2/planned, but the configuration contract should be reserved now.

Environment variables:

| Variable | Required | Notes |
| --- | --- | --- |
| `GOOGLE_APPLICATION_CREDENTIALS` | When Google is enabled in static mode | Service account or ADC path with BigQuery read permissions. In pass-through mode this arrives in the per-call envelope or broker response. |
| `GOOGLE_BILLING_EXPORT_PROJECT_ID` | When Google is enabled | Project that hosts the billing export dataset. This may be static configuration or per-credential metadata from a broker. |
| `GOOGLE_BILLING_EXPORT_DATASET` | When Google is enabled | BigQuery dataset containing billing export tables. This may be static configuration or per-credential metadata from a broker. |
| `GOOGLE_BILLING_EXPORT_TABLE` | When Google is enabled | Standard, detailed, or FOCUS export table. This may be static configuration or per-credential metadata from a broker. |
| `GOOGLE_BILLING_EXPORT_KIND` | When Google is enabled | `standard`, `detailed`, or `focus`. This may be static configuration or per-credential metadata from a broker. |
| `GOOGLE_BILLING_MAX_BYTES_BILLED` | No | BigQuery query cost guardrail. |
| `GOOGLE_BILLING_REQUIRE_DRY_RUN` | No | If true, query tools must dry-run and return estimated bytes before execution unless explicitly confirmed. |

The operator should use a service account with read-only BigQuery access to the billing export dataset and no billing-account mutation permissions. The server must not create, update, or enable Cloud Billing exports.

### 8.8 Recommended OSS auth modes

#### Local developer mode

Local users can run STDIO with credentials in their shell environment. The README must warn that this gives the local MCP client read access to enabled provider usage/cost data.

#### Self-hosted team service

For the v1 OSS release, the recommended team deployment is single-tenant Streamable HTTP:

1. The team hosts `ai-admin-api-mcp`.
2. The team stores upstream provider credentials in its own infrastructure.
3. The team configures `MCP_HTTP_AUTH_TOKEN` or a multi-token policy file.
4. MCP clients connect to the HTTP endpoint through a private network, VPN, reverse proxy, or identity-aware proxy.
5. The server reads provider usage/cost data with static credentials or local host secret integration.

This should be the primary documented production path for v1.

#### Gateway-hosted service

Operators can run one or more stateless HTTP instances behind their own gateway.

In this mode:

1. The operator stores provider credentials in an external secret store.
2. The gateway resolves `credential_ref` per request.
3. The gateway sends an encrypted credential envelope or broker token out-of-band on the MCP HTTP request.
4. The MCP server uses the credential only for that request.
5. Scaling is by normal horizontal replicas, not by tenant-specific server state.

The OSS server should support this pattern, but the gateway, tenant model, credential store, audit system, and hosting control plane are outside v1 scope.

## 9. MCP Surface

### 9.1 Common resource contract

The server should expose:

| Resource URI | Purpose |
| --- | --- |
| `ai-admin://providers` | Enabled provider modules, initialization status, and high-level capabilities. |
| `ai-admin://schema/provider-capability-v1` | Provider module declaration JSON schema. |
| `ai-admin://schema/usage-fact-v1` | Normalized usage fact JSON schema. |
| `ai-admin://schema/cost-fact-v1` | Normalized cost fact JSON schema. |
| `ai-admin://schema/dashboard-bundle-v1` | Dashboard bundle JSON schema. |
| `<provider>-admin://capabilities` | Supported endpoints, dimensions, granularities, limits, and known gaps. |
| `<provider>-admin://schema/usage-fact-v1` | Normalized usage fact JSON schema. |
| `<provider>-admin://schema/cost-fact-v1` | Normalized cost fact JSON schema. |
| `<provider>-admin://schema/dashboard-bundle-v1` | Dashboard bundle JSON schema. |

### 9.2 Common prompt contract

Prompts are optional, but useful for general-purpose MCP clients:

| Prompt | Purpose |
| --- | --- |
| `build_usage_dashboard` | Guides an agent to request normalized dashboard bundles and build a dashboard without calling raw provider APIs directly. |
| `investigate_cost_spike` | Guides an agent to compare recent cost buckets against a baseline and return likely attribution dimensions. |
| `export_finance_report` | Guides an agent to request daily cost facts and produce a finance-friendly CSV or summary. |

Prompts must not contain provider credentials or ask users to paste credentials into chat.

### 9.3 Common tool result envelope

All tools return the same envelope:

```json
{
  "provider": "openai",
  "tool": "openai_admin_query_costs",
  "queried_at": "2026-06-13T10:15:00Z",
  "time_range": {
    "start": "2026-06-01T00:00:00Z",
    "end": "2026-06-13T00:00:00Z",
    "bucket_width": "1d"
  },
  "cache": {
    "status": "miss",
    "ttl_seconds": 60
  },
  "warnings": [],
  "data": {},
  "raw": null
}
```

`raw` is `null` unless `include_raw = true`.

### 9.4 Common tools

| Tool | Purpose |
| --- | --- |
| `ai_admin_list_providers` | List enabled providers, health, configured reporting surfaces, and known limitations. |
| `ai_admin_query_usage` | Query normalized usage facts from one or more enabled providers. |
| `ai_admin_query_costs` | Query normalized cost facts from one or more enabled providers. |
| `ai_admin_query_dashboard_bundle` | Build one dashboard bundle across one or more enabled providers. |

Common tool inputs include:

```json
{
  "providers": ["openai", "anthropic"],
  "credential_refs": {
    "openai": "credential:openai:prod-admin",
    "anthropic": "credential:anthropic:prod-admin"
  },
  "start": "2026-06-01T00:00:00Z",
  "end": "2026-06-13T00:00:00Z",
  "bucket_width": "1d",
  "top_n": 10,
  "include_metadata": true,
  "include_raw": false
}
```

If `providers` is omitted, the tool uses all enabled providers. The result envelope must include a per-provider `results` object and a per-provider `warnings` object so a partial provider failure does not hide other providers' data.

## 10. OpenAI Provider Module

### 10.1 Tools

| Tool | Purpose |
| --- | --- |
| `openai_admin_list_projects` | List organization projects for ID/name enrichment. |
| `openai_admin_list_users` | List organization users for usage attribution enrichment where permissions allow. |
| `openai_admin_list_project_api_keys` | List API keys for one project for ID/name enrichment. |
| `openai_admin_query_usage` | Query one OpenAI organization usage endpoint and return normalized usage facts. |
| `openai_admin_query_costs` | Query organization costs and return normalized cost facts. |
| `openai_admin_query_dashboard_bundle` | Query usage and costs for a dashboard range and return summary, trend, and top-dimension data. |

### 10.2 `openai_admin_query_usage`

Common input:

```json
{
  "credential_ref": "credential:openai:prod-admin",
  "usage_endpoint": "completions",
  "start": "2026-06-01T00:00:00Z",
  "end": "2026-06-13T00:00:00Z",
  "bucket_width": "1d",
  "group_by": ["project_id", "model"],
  "endpoint_params": {
    "project_ids": [],
    "user_ids": [],
    "api_key_ids": [],
    "models": [],
    "batch": null
  },
  "limit": null,
  "max_pages": 20,
  "include_raw": false
}
```

`endpoint_params` is validated against the selected `usage_endpoint`. It is intentionally endpoint-specific so the server does not pretend all OpenAI usage endpoints support the same filters, groupings, or metric fields.

`usage_endpoint` values:

- `audio_speeches`
- `audio_transcriptions`
- `code_interpreter_sessions`
- `completions`
- `embeddings`
- `file_search_calls`
- `images`
- `moderations`
- `vector_stores`
- `web_search_calls`

Endpoint-specific input capabilities:

| `usage_endpoint` | Allowed `endpoint_params` | Allowed `group_by` | Normalized metric mapping |
| --- | --- | --- | --- |
| `audio_speeches` | `project_ids`, `user_ids`, `api_key_ids`, `models` | `project_id`, `user_id`, `api_key_id`, `model` | `characters` -> `character_count`; `num_model_requests` -> `request_count` |
| `audio_transcriptions` | `project_ids`, `user_ids`, `api_key_ids`, `models` | `project_id`, `user_id`, `api_key_id`, `model` | `seconds` -> `audio_seconds`; `num_model_requests` -> `request_count` |
| `code_interpreter_sessions` | `project_ids` | `project_id` | `num_sessions` -> `session_count` |
| `completions` | `project_ids`, `user_ids`, `api_key_ids`, `models`, `batch` | `project_id`, `user_id`, `api_key_id`, `model`, `batch`, `service_tier` | token fields and `num_model_requests` map to common token/request metrics |
| `embeddings` | `project_ids`, `user_ids`, `api_key_ids`, `models` | `project_id`, `user_id`, `api_key_id`, `model` | `input_tokens` -> `input_tokens`; `num_model_requests` -> `request_count` |
| `file_search_calls` | `project_ids`, `user_ids`, `api_key_ids`, `vector_store_ids` | `project_id`, `user_id`, `api_key_id`, `vector_store_id` | `num_requests` -> `operation_count` |
| `images` | `project_ids`, `user_ids`, `api_key_ids`, `models`, `sources`, `sizes` | `project_id`, `user_id`, `api_key_id`, `model`, `size`, `source` | `images` -> `image_count`; `num_model_requests` -> `request_count` |
| `moderations` | `project_ids`, `user_ids`, `api_key_ids`, `models` | `project_id`, `user_id`, `api_key_id`, `model` | `input_tokens` -> `input_tokens`; `num_model_requests` -> `request_count` |
| `vector_stores` | `project_ids` | `project_id` | `usage_bytes` -> `storage_bytes` |
| `web_search_calls` | `project_ids`, `user_ids`, `api_key_ids`, `models`, `context_levels` | `project_id`, `user_id`, `api_key_id`, `model`, `context_level` | `num_requests` -> `operation_count`; `num_model_requests` -> `request_count` |

The server converts ISO timestamps to Unix seconds for OpenAI.

The tool must return `validation_failed` with the endpoint capability list when callers pass unsupported `endpoint_params` keys or unsupported `group_by` values. Provider-specific dimensions such as `size`, `source`, `vector_store_id`, and `context_level` should be preserved under `provider_details.openai` unless the normalized schema later promotes them to common dimensions.

### 10.3 `openai_admin_query_costs`

Input:

```json
{
  "credential_ref": "credential:openai:prod-admin",
  "start": "2026-06-01T00:00:00Z",
  "end": "2026-06-13T00:00:00Z",
  "group_by": ["project_id", "line_item"],
  "filters": {
    "project_ids": [],
    "api_key_ids": []
  },
  "limit": null,
  "max_pages": 20,
  "include_raw": false
}
```

The server should enforce `bucket_width = "1d"` because OpenAI costs currently support daily buckets only.

### 10.4 `openai_admin_query_dashboard_bundle`

Input:

```json
{
  "credential_ref": "credential:openai:prod-admin",
  "start": "2026-06-01T00:00:00Z",
  "end": "2026-06-13T00:00:00Z",
  "bucket_width": "1d",
  "usage_endpoints": ["completions", "embeddings", "images"],
  "primary_group_by": ["project_id", "model"],
  "cost_group_by": ["project_id", "line_item"],
  "top_n": 10,
  "include_metadata": true
}
```

Output should include:

- total provider-reported cost;
- total input/output/cache/audio tokens where available;
- total request or operation counts where available;
- cost trend by bucket;
- usage trend by bucket;
- top projects by cost;
- top models by usage;
- top API keys where requested and available;
- warnings for unsupported cost/user joins.

## 11. Anthropic Provider Module

### 11.1 Tools

| Tool | Purpose |
| --- | --- |
| `anthropic_admin_get_organization` | Return organization ID and name for connection verification. |
| `anthropic_admin_list_workspaces` | List workspaces for ID/name enrichment. |
| `anthropic_admin_list_api_keys` | List API keys for ID/name enrichment. |
| `anthropic_admin_query_messages_usage` | Query messages usage and return normalized usage facts. |
| `anthropic_admin_query_costs` | Query cost reports and return normalized cost facts. |
| `anthropic_admin_query_dashboard_bundle` | Query usage and costs for a dashboard range and return summary, trend, and top-dimension data. |
| `anthropic_admin_query_claude_code_usage` | Optional v1.1 tool for Claude Code analytics, disabled until the core usage/cost server is stable. |

### 11.2 `anthropic_admin_query_messages_usage`

Input:

```json
{
  "credential_ref": "credential:anthropic:prod-admin",
  "start": "2026-06-01T00:00:00Z",
  "end": "2026-06-13T00:00:00Z",
  "bucket_width": "1d",
  "group_by": ["workspace_id", "model"],
  "filters": {
    "api_key_ids": [],
    "workspace_ids": [],
    "models": [],
    "service_tiers": [],
    "context_windows": [],
    "inference_geos": [],
    "speeds": []
  },
  "limit": null,
  "max_pages": 20,
  "include_raw": false
}
```

The server passes ISO timestamps through to Anthropic.

If `group_by` or `filters` include `speed`, the server must either:

- send a configured beta header; or
- return a validation error that tells the operator which beta header is required.

### 11.3 `anthropic_admin_query_costs`

Input:

```json
{
  "credential_ref": "credential:anthropic:prod-admin",
  "start": "2026-06-01T00:00:00Z",
  "end": "2026-06-13T00:00:00Z",
  "group_by": ["workspace_id", "description"],
  "filters": {
    "workspace_ids": []
  },
  "limit": null,
  "max_pages": 20,
  "include_raw": false
}
```

The server should enforce daily buckets because Anthropic cost reports currently support daily granularity only.

Cost amounts should be normalized to major USD units while preserving the raw lowest-unit value:

```json
{
  "amount": {
    "value": 12.3456,
    "currency": "usd",
    "source_unit": "minor",
    "raw_value": "1234.56"
  }
}
```

### 11.4 `anthropic_admin_query_dashboard_bundle`

Input:

```json
{
  "credential_ref": "credential:anthropic:prod-admin",
  "start": "2026-06-01T00:00:00Z",
  "end": "2026-06-13T00:00:00Z",
  "bucket_width": "1d",
  "usage_group_by": ["workspace_id", "model", "service_tier"],
  "cost_group_by": ["workspace_id", "description"],
  "top_n": 10,
  "include_metadata": true
}
```

Output should include:

- total provider-reported cost;
- total uncached input tokens;
- total output tokens;
- cache creation tokens by retention class where present;
- cache read input tokens;
- server tool usage counts;
- usage trend by bucket;
- cost trend by bucket;
- top workspaces by cost and tokens;
- top models by usage;
- warnings for Priority Tier cost gaps;
- warnings when the default workspace is represented by `null`.

## 12. Google Cloud Billing Provider Module

Google support should be a planned v2 module unless implementation reconfirms a narrower Gemini-specific admin reporting API.

### 12.1 Tools

| Tool | Purpose |
| --- | --- |
| `google_billing_get_export_status` | Validate BigQuery billing export table access and return schema/freshness metadata. |
| `google_billing_query_costs` | Query normalized cost facts from a configured billing export table. |
| `google_billing_query_usage` | Query normalized usage facts from a configured billing export table when usage fields are available. |
| `google_billing_query_dashboard_bundle` | Return Google cost/usage dashboard data with query-cost warnings. |
| `google_billing_estimate_query_cost` | Dry-run a planned BigQuery billing export query and return bytes/cost guardrail data. |

### 12.2 `google_billing_query_costs`

Input:

```json
{
  "credential_ref": "credential:google-cloud-billing:prod-billing",
  "start": "2026-06-01T00:00:00Z",
  "end": "2026-06-13T00:00:00Z",
  "export_kind": "focus",
  "group_by": ["billing_account_id", "project_id", "service", "sku"],
  "filters": {
    "billing_account_ids": [],
    "project_ids": [],
    "services": ["Vertex AI", "Gemini API"],
    "labels": {}
  },
  "max_bytes_billed": 1000000000,
  "dry_run": true,
  "confirm_query": false,
  "include_raw": false
}
```

If `dry_run = true` and `confirm_query = false`, the tool returns the generated query, estimated bytes processed, and guardrail status without running the query. This is necessary because BigQuery billing-export queries can themselves incur costs.

### 12.3 Google-specific warnings

The Google module must return warnings when:

- billing export is not enabled;
- the configured export table is missing expected columns;
- the export kind is `standard` or `detailed` and cannot map cleanly to FOCUS fields;
- the query can incur BigQuery costs;
- model-level or API-key-level attribution is unavailable in billing export rows;
- data freshness depends on Cloud Billing export timing rather than provider API polling.

### 12.4 Normalization

When using the FOCUS export, map FOCUS fields into the normalized cost fact first and keep provider-specific fields under `provider_details.google`.

When using Standard or Detailed exports, map at least:

- billing account;
- project;
- service;
- SKU;
- location;
- labels;
- usage amount and unit;
- cost;
- credits;
- currency;
- invoice month;
- export table type.

## 13. Normalized Data Model

### 13.1 Usage fact

```json
{
  "id": "openai:completions:bucket:2026-06-01T00:00:00Z:project:proj_123:model:gpt-5.5",
  "provider": "openai",
  "source_endpoint": "organization/usage/completions",
  "bucket_start": "2026-06-01T00:00:00Z",
  "bucket_end": "2026-06-02T00:00:00Z",
  "dimensions": {
    "project_id": "proj_123",
    "workspace_id": null,
    "user_id": null,
    "api_key_id": null,
    "model": "gpt-5.5",
    "service_tier": "default",
    "batch": false,
    "line_item": null,
    "description": null
  },
  "metrics": {
    "input_tokens": 1000,
    "output_tokens": 500,
    "input_cached_tokens": 800,
    "cache_read_input_tokens": null,
    "cache_creation_input_tokens": null,
    "input_audio_tokens": 0,
    "output_audio_tokens": 0,
    "request_count": 5,
    "operation_count": null,
    "image_count": null,
    "character_count": null,
    "audio_seconds": null,
    "session_count": null,
    "storage_bytes": null,
    "server_tool_uses": {}
  },
  "provider_details": {
    "openai": {
      "usage_endpoint": "completions",
      "raw_metrics": {
        "num_model_requests": 5
      },
      "grouped_dimensions": {
        "batch": false,
        "service_tier": "default"
      }
    }
  },
  "normalization": {
    "null_dimension_labels": {
      "workspace_id": "not_applicable"
    },
    "cost_source": "not_available"
  }
}
```

OpenAI usage endpoints that expose provider-specific grouped dimensions, such as image `size` and `source`, file-search `vector_store_id`, or web-search `context_level`, should preserve those values under `provider_details.openai.grouped_dimensions`. Endpoints that expose non-token usage metrics should map them to the closest common metric field above and preserve the provider-native metric names in `provider_details.openai.raw_metrics`.

### 13.2 Cost fact

```json
{
  "id": "anthropic:cost:bucket:2026-06-01T00:00:00Z:workspace:wrkspc_123:description:Input Tokens",
  "provider": "anthropic",
  "source_endpoint": "organizations/cost_report",
  "bucket_start": "2026-06-01T00:00:00Z",
  "bucket_end": "2026-06-02T00:00:00Z",
  "dimensions": {
    "project_id": null,
    "workspace_id": "wrkspc_123",
    "user_id": null,
    "api_key_id": null,
    "model": "claude-sonnet-4-6",
    "line_item": null,
    "description": "Input Tokens"
  },
  "amount": {
    "value": 12.34,
    "currency": "usd",
    "source_unit": "minor",
    "raw_value": "1234"
  },
  "quantity": null,
  "normalization": {
    "cost_source": "provider_reported",
    "coverage_warnings": []
  }
}
```

### 13.3 Dashboard bundle

```json
{
  "provider": "anthropic",
  "queried_at": "2026-06-13T10:15:00Z",
  "time_range": {
    "start": "2026-06-01T00:00:00Z",
    "end": "2026-06-13T00:00:00Z",
    "bucket_width": "1d"
  },
  "summary": {
    "provider_reported_cost": {
      "value": 123.45,
      "currency": "usd"
    },
    "input_tokens": 1000000,
    "output_tokens": 250000,
    "cache_read_input_tokens": 500000,
    "cache_creation_input_tokens": 100000,
    "request_count": null
  },
  "series": {
    "cost_by_bucket": [],
    "usage_by_bucket": []
  },
  "top": {
    "workspaces_by_cost": [],
    "models_by_tokens": [],
    "api_keys_by_tokens": []
  },
  "metadata": {
    "workspaces": [],
    "projects": [],
    "api_keys": []
  },
  "warnings": []
}
```

## 14. Dashboard Consumer Experience

A general MCP client should be able to ask:

- "Build an OpenAI spend dashboard for the last 30 days grouped by project and model."
- "Compare Anthropic cache reads vs uncached input tokens this week."
- "Show cost spikes by OpenAI project and line item."
- "Export Anthropic daily cost by workspace for finance."
- "Tell me which OpenAI API keys are driving completions usage."
- "Compare OpenAI and Anthropic spend this week."
- "Show Google Cloud AI costs from the configured billing export once Google is enabled."

The server should make those tasks practical by:

- returning bounded results by default;
- exposing top-N aggregation;
- hiding pagination;
- enriching IDs with display names where list permissions allow;
- returning enough warnings for the client to avoid false precision.

The server should not render UI itself. Dashboard rendering belongs to the MCP client, generated artifacts, or future product integrations.

## 15. Future Product Integration Notes

The v1 project should optimize for standalone OSS adoption. Future products can adopt it later without changing the public MCP contracts.

Recommended future integration boundary:

1. The product connects to `ai-admin-api-mcp` over Streamable HTTP.
2. The product discovers the same public tools/resources as any MCP client.
3. The product handles user/workspace policy, credential storage, audit, and hosting lifecycle outside the OSS server.
4. The product passes provider credentials through static self-hosted configuration, encrypted per-call envelopes, or broker tokens.
5. Native product dashboards consume the normalized `usage_fact`, `cost_fact`, and `dashboard_bundle` schemas.

Future product-specific hosting choices, such as a shared managed service or managed container runtime, should live in separate implementation plans rather than driving the OSS server design.

## 16. Security And Privacy

### 16.1 Credential handling

Requirements:

- Load provider credentials from environment variables, host secret stores, pass-through credential envelopes, or broker exchange responses.
- Never accept provider credentials as MCP tool arguments.
- Never return provider credentials in MCP results.
- Never persist pass-through provider credentials.
- Never include pass-through provider credentials in cache keys, logs, traces, metrics, resources, or prompt-visible data.
- Redact `Authorization`, `x-api-key`, `OPENAI_ADMIN_KEY`, `ANTHROPIC_ADMIN_KEY`, `ANTHROPIC_OAUTH_TOKEN`, and token-like values from logs.
- Avoid logging full URLs when query strings may contain sensitive IDs unless structured redaction is applied.

### 16.2 Read-only enforcement

The public tool registry should contain no mutation tools in v1. Tests must fail if a tool name includes high-risk verbs such as:

- `create`
- `update`
- `delete`
- `archive`
- `invite`
- `remove`
- `revoke`
- `activate`
- `deactivate`
- `set`

Metadata "list" and "get" tools are allowed.

### 16.3 Data sensitivity

Usage and cost data can expose:

- internal project names;
- workspace names;
- API key names;
- user IDs;
- service tiers;
- spend trends;
- operational volumes.

The server should default to returning IDs and display names only when requested through `include_metadata = true`. Shared hosted deployments are acceptable only in pass-through or broker mode where provider credentials are not statically stored in the MCP service and every request is tenant-scoped by a credential envelope or broker token.

### 16.4 Operator-hosted isolation

If an organization or third party runs the server as a shared hosted service, the hosting layer must provide the tenant boundary. The OSS server should help by staying stateless and by supporting per-call credential material, but it must not claim to provide a complete multi-tenant SaaS isolation model in v1.

Minimum recommendations:

- run only reviewed images;
- avoid static provider credentials in shared containers when using multiple tenants;
- use per-call pass-through envelopes or broker tokens for provider credentials;
- enforce CPU, memory, concurrency, and idle-timeout limits;
- constrain network egress to required provider/API domains where feasible;
- redact logs before exposing them to users or support operators;
- route all agent-visible tool calls through the operator's policy, assignment, and audit layer.

## 17. Reliability, Pagination, And Limits

### 17.1 Pagination

All query tools must:

- follow provider cursors until `has_more = false`, `next_page = null`, or `max_pages` is reached;
- return a warning when `max_pages` truncates results;
- include `pages_fetched`;
- include `provider_request_count`;
- preserve enough cursor metadata to debug incomplete exports without exposing credentials.

### 17.2 Range validation

Defaults:

- dashboard bundles default to the last 7 complete days;
- v1 max range defaults to 90 days unless a provider endpoint has a lower limit;
- minute buckets default to a max 24-hour range;
- hourly buckets default to a max 7-day range;
- daily buckets default to a max 180-day range for OpenAI costs and 31-day chunks for Anthropic cost reports.

The server can chunk larger date ranges across multiple provider calls only when the provider endpoint semantics are clear and the result envelope reports chunking.

### 17.3 Caching

Defaults:

- metadata list tools cache for 5 minutes;
- dashboard bundles cache for 60 seconds;
- direct query tools do not cache unless `cache_ttl_seconds` is supplied.

Cache keys must include:

- provider;
- tool name;
- normalized parameters;
- tenant or workspace id when available;
- credential reference;
- provider credential fingerprint from the envelope/broker, computed outside the MCP server as a non-reversible hash prefix;
- inbound MCP policy identity;
- beta header set for Anthropic.

### 17.4 Error model

Provider errors should map to MCP-safe errors:

| Provider condition | MCP error code | Notes |
| --- | --- | --- |
| Invalid credential | `auth_failed` | Do not echo provider response bodies if they include secrets. |
| Missing admin permission | `permission_denied` | Include missing capability when provider reports it safely. |
| Rate limit | `rate_limited` | Include retry hints when available. |
| Unsupported dimension | `validation_failed` | Return supported dimensions from capabilities. |
| Provider outage | `provider_unavailable` | Include provider status text only if safe. |
| Pagination cap reached | `partial_result` | Return partial data plus warning, not a hard failure. |

## 18. Testing

### 18.1 Unit tests

Required coverage:

- parameter validation;
- timestamp conversion;
- provider query serialization;
- pagination loops;
- max page truncation;
- OpenAI usage normalization;
- OpenAI cost normalization;
- Anthropic messages usage normalization;
- Anthropic cost normalization and minor-unit conversion;
- Google billing export SQL generation and dry-run guardrail behavior once the Google module is implemented;
- cross-provider partial failure behavior;
- raw response redaction;
- error mapping;
- cache key construction.

### 18.2 Contract fixtures

Use fixtures derived from provider documentation examples, with synthetic IDs and no real customer data.

Fixture groups:

- OpenAI completions usage bucket with grouped and ungrouped dimensions;
- OpenAI costs bucket with amount/currency and line item;
- Anthropic messages usage bucket with cache creation/read fields;
- Anthropic cost bucket with workspace and description groupings;
- Google FOCUS billing export rows once the Google module is implemented;
- provider pagination with `has_more` and `next_page`;
- null/default workspace or project attribution.

### 18.3 Live smoke tests

Live tests must be opt-in:

```bash
OPENAI_ADMIN_KEY=... pnpm test:live:openai
ANTHROPIC_ADMIN_KEY=... pnpm test:live:anthropic
GOOGLE_APPLICATION_CREDENTIALS=... pnpm test:live:google-billing
```

Live tests should use:

- a short complete historical window;
- `limit = 1`;
- no mutation endpoints;
- strict redaction checks on captured logs.

### 18.4 MCP interoperability tests

Run the MCP inspector or SDK integration tests for:

- STDIO startup;
- Streamable HTTP startup;
- tool discovery;
- resource discovery;
- prompt discovery if prompts are enabled;
- one mocked tool call per enabled provider;
- one mocked cross-provider dashboard bundle call.

## 19. Release And Open Source Requirements

The server package should include:

- README with credential setup, security warnings, and example MCP client config;
- Dockerfile;
- typed JSON schemas for tool input/output;
- `SECURITY.md`;
- `CONTRIBUTING.md`;
- license file;
- changelog;
- example dashboard prompt and static dashboard sample;
- no product-specific runtime dependency.

Recommended license:

- MIT for broad MCP ecosystem adoption, unless company policy requires Apache-2.0.

Versioning:

- semantic versioning for the server package;
- provider module capability versions;
- shared normalized schema versions independent of package versions, starting at `usage-fact-v1`, `cost-fact-v1`, and `dashboard-bundle-v1`.

## 20. Implementation Plan

### Phase 0: API reconfirmation

- Recheck OpenAI Admin API usage/cost endpoints and group-by fields.
- Recheck Anthropic Usage and Cost API dimensions, cost units, Priority Tier limitations, and polling guidance.
- Recheck Google Cloud Billing export schemas and Gemini billing/usage reporting options.
- Decide final npm package scope and repository name.

### Phase 1: Shared core

- Implement provider-neutral time range validation.
- Implement pagination helpers.
- Implement redaction utilities.
- Implement normalized usage, cost, and dashboard bundle schemas.
- Implement provider module registry and capability resources.
- Implement cross-provider partial result handling.
- Implement `credential_ref` validation, pass-through envelope validation, and broker-token interfaces.
- Add fixture-based tests.

### Phase 2: Server transport and OpenAI provider

- Implement STDIO and Streamable HTTP transports.
- Implement OpenAI Admin API HTTP client.
- Implement project/user/API key metadata list tools.
- Implement usage and cost query tools.
- Implement dashboard bundle aggregation.
- Add Docker image with OpenAI-only configuration.

### Phase 3: Anthropic provider

- Implement Anthropic Admin API HTTP client.
- Implement organization/workspace/API key metadata tools.
- Implement messages usage and cost query tools.
- Implement dashboard bundle aggregation.
- Verify mixed OpenAI + Anthropic operation in one server process.

### Phase 4: Google Cloud Billing provider spike

- Implement BigQuery billing export schema discovery.
- Implement query dry-run and max-bytes-billed guardrails.
- Implement FOCUS export mapping to normalized cost facts.
- Implement Standard/Detailed export mapping if FOCUS is not available.
- Decide whether Google ships in v1.1 or v2 based on attribution quality and query-cost safety.

### Phase 5: OSS hardening

- Add MCP inspector tests.
- Add live smoke test scripts.
- Add docs and examples.
- Add supply chain scanning and release workflow.
- Publish v0.1.0 package and image with OpenAI and Anthropic modules.

### Future phase: Product integration guides

- Document generic Streamable HTTP gateway integration.
- Document pass-through credential envelope and broker-token examples without naming a specific product runtime.
- Document how product dashboards can consume normalized usage, cost, and dashboard bundle schemas.
- Keep product-specific hosting and UI plans outside the OSS server spec.

## 21. Open Questions

1. What open-source organization and npm scope should own the packages?
2. Should provider modules live in the same package or be dynamically loaded plugin packages?
3. Should Anthropic Claude Code Analytics be an optional Anthropic tool or a separate module?
4. Should Google Cloud Billing ship in the first public release or wait for v1.1/v2 after a BigQuery cost-safety review?
5. Should hosted operators use encrypted credential envelopes, broker tokens, or both?
6. Should dashboard bundles include CSV strings, or should CSV export be left to client-side rendering?
7. What metadata enrichment should be included in v1 versus left to provider-specific tools?
8. What minimum gateway/broker contract should the OSS server document without owning a full hosted product?
