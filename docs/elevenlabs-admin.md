# ElevenLabs Admin Provider

The ElevenLabs provider queries workspace analytics and read-only administration surfaces and returns normalized usage facts where possible.

## Credentials

Set `ELEVENLABS_API_KEY` in static mode. The outbound request uses `xi-api-key: <key>`.

Optional:

- `ELEVENLABS_BASE_URL` for tests or compatible gateways. Defaults to `https://api.elevenlabs.io/v1`.

Accepted static credential ref:

- `credential:elevenlabs:static`

## Usage

Tool: `elevenlabs_admin_query_usage`

Endpoint: `POST /workspace/analytics/query/usage-by-product-over-time`

The provider sends `start_time` and `end_time` as Unix timestamps in milliseconds, maps bucket widths to `interval_seconds`, and returns normalized usage facts with `credit_count`.

Supported `group_by` values:

- `product_type`
- `model`
- `voice_id`
- `user_id`
- `fiat_currency`
- `fiat_charge_type`
- `region`
- `reporting_workspace_id`
- `request_source`
- `resource_id`
- `subresource_id`
- `request_queue_type`
- `voice_multiplier`
- `hashed_xi_api_key`
- `billing_group_id`

Supported filter operations:

- `in`
- `not_in`
- `le`
- `ge`
- `lt`
- `gt`
- `eq`
- `neq`

## Request Analytics

Tool: `elevenlabs_admin_list_api_requests`

Endpoint: `POST /workspace/analytics/requests`

This returns ElevenLabs' tabular request analytics response. At least one of `start` or `end` is required.

## Metadata

Read-only metadata tools:

- `elevenlabs_admin_get_user`
- `elevenlabs_admin_get_subscription`
- `elevenlabs_admin_list_service_accounts`
- `elevenlabs_admin_list_service_account_api_keys`
- `elevenlabs_admin_list_audit_logs`

Audit logs require the ElevenLabs workspace tier and permission that the provider enforces.

## Costs

The implemented ElevenLabs analytics endpoint reports credits, not provider-reported monetary cost. Common cost queries return a `costs_not_supported` warning for ElevenLabs, and dashboard bundles set `provider_reported_cost` to `null` unless ElevenLabs returns monetary columns in analytics output.
