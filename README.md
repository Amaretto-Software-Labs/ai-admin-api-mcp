# AI Admin API MCP Server

Read-only MCP server for querying AI provider administration APIs and returning normalized usage, cost, and dashboard data.

## Status

Built-in providers:

- OpenAI Admin API usage, costs, projects, users, and project API keys.
- Anthropic Admin API organization metadata, workspaces, API keys, messages usage, and costs.
- ElevenLabs workspace credit usage analytics, API request analytics, audit logs, user/subscription metadata, service accounts, and service-account API keys.

Planned providers:

- Google Cloud Billing export through BigQuery. This provider is not implemented yet. When it ships, release notes must state that direct BigQuery billing export queries can incur Google Cloud query costs.

All MCP tools are read-only. The server does not expose provider mutation tools.

External provider plugins can be loaded at startup with `AI_ADMIN_PROVIDER_PLUGINS`. See [Provider Plugins](docs/provider-plugins.md).

## Tech Stack

- Node.js 22+
- TypeScript
- pnpm
- `@modelcontextprotocol/sdk`
- Zod input schemas
- Vitest

## Quick Start

Run the published package with `npx`:

```sh
OPENAI_ADMIN_KEY=sk-admin-... \
ANTHROPIC_ADMIN_KEY=sk-ant-admin-... \
ELEVENLABS_API_KEY=xi-... \
npx @amaretto-software-labs/ai-admin-api-mcp --stdio
```

Pin a specific published version:

```sh
npx @amaretto-software-labs/ai-admin-api-mcp@0.0.1 --stdio
```

For local repo development:

```sh
pnpm install
pnpm check
pnpm test
```

Run over STDIO:

```sh
OPENAI_ADMIN_KEY=sk-admin-... \
ANTHROPIC_ADMIN_KEY=sk-ant-admin-... \
ELEVENLABS_API_KEY=xi-... \
pnpm start:stdio
```

Run over Streamable HTTP:

```sh
OPENAI_ADMIN_KEY=sk-admin-... \
ANTHROPIC_ADMIN_KEY=sk-ant-admin-... \
ELEVENLABS_API_KEY=xi-... \
MCP_HTTP_AUTH_TOKEN=local-proxy-token \
pnpm start:http
```

HTTP listens on `http://127.0.0.1:8787/mcp`. Pass `--unsafe-local-http` only for local development where another process already protects the endpoint.

Run the gateway-compatible local HTTPS endpoint with a local development certificate:

```sh
OPENAI_ADMIN_KEY=sk-admin-... \
ANTHROPIC_ADMIN_KEY=sk-ant-admin-... \
ELEVENLABS_API_KEY=xi-... \
MCP_HTTP_AUTH_TOKEN=local-proxy-token \
MCP_HTTPS_CERT_PATH=/path/to/localhost.pem \
MCP_HTTPS_KEY_PATH=/path/to/localhost.key \
pnpm start:https
```

HTTPS listens on `https://127.0.0.1:8787/mcp`.

Use the published package for Streamable HTTP or HTTPS by passing the same flags to `npx`:

```sh
MCP_HTTP_AUTH_TOKEN=local-proxy-token \
OPENAI_ADMIN_KEY=sk-admin-... \
ANTHROPIC_ADMIN_KEY=sk-ant-admin-... \
ELEVENLABS_API_KEY=xi-... \
npx @amaretto-software-labs/ai-admin-api-mcp --http --port 8787
```

```sh
MCP_HTTP_AUTH_TOKEN=local-proxy-token \
OPENAI_ADMIN_KEY=sk-admin-... \
ANTHROPIC_ADMIN_KEY=sk-ant-admin-... \
ELEVENLABS_API_KEY=xi-... \
MCP_HTTPS_CERT_PATH=/path/to/localhost.pem \
MCP_HTTPS_KEY_PATH=/path/to/localhost.key \
npx @amaretto-software-labs/ai-admin-api-mcp --https --port 8787
```

## Configuration

| Variable | Required | Description |
| --- | --- | --- |
| `AI_ADMIN_ENABLED_PROVIDERS` | No | Comma-separated provider ids. If omitted, loaded provider plugins may infer enablement from config/credentials. |
| `AI_ADMIN_PROVIDER_PLUGINS` | No | Comma-separated trusted ESM module specifiers, paths, or `file:` URLs for external provider plugins. |
| `AI_ADMIN_REQUIRED_PROVIDERS` | No | Comma-separated providers that must be enabled and report configured status at startup. |
| `AI_ADMIN_CREDENTIAL_MODE` | No | Only `static` is implemented in this runtime build. `pass_through` and `hybrid` are documented gateway contracts and fail fast. |
| `OPENAI_ADMIN_KEY` | OpenAI static mode | OpenAI Admin API key. |
| `OPENAI_BASE_URL` | No | Override for tests or compatible OpenAI Admin API gateways. Defaults to `https://api.openai.com/v1`. |
| `ANTHROPIC_ADMIN_KEY` | Anthropic static mode | Anthropic Admin API key, sent as `x-api-key`. |
| `ANTHROPIC_OAUTH_TOKEN` | Anthropic static mode | Optional Anthropic OAuth bearer token with admin scope. |
| `ANTHROPIC_BASE_URL` | No | Override for tests or compatible Anthropic Admin API gateways. Defaults to `https://api.anthropic.com/v1`. |
| `ANTHROPIC_VERSION` | No | Anthropic API version. Defaults to `2023-06-01`. |
| `ANTHROPIC_BETA` | No | Comma-separated Anthropic beta headers, for example `fast-mode-2026-02-01`. |
| `ELEVENLABS_API_KEY` | ElevenLabs static mode | ElevenLabs API key, sent as `xi-api-key`. |
| `ELEVENLABS_BASE_URL` | No | Override for tests or compatible ElevenLabs API gateways. Defaults to `https://api.elevenlabs.io/v1`. |
| `MCP_HTTP_AUTH_TOKEN` | HTTP mode | Bearer token required by the MCP HTTP endpoint unless unsafe local mode is used. |
| `MCP_HTTPS_CERT_PATH` | HTTPS mode | PEM certificate path for local HTTPS. |
| `MCP_HTTPS_KEY_PATH` | HTTPS mode | PEM private-key path for local HTTPS. |
| `MCP_CACHE_TTL_SECONDS` | No | Dashboard bundle cache TTL in seconds. Metadata list tools cache for 300 seconds. Defaults to `60`. |
| `MCP_USER_AGENT` | No | Optional user agent context for future outbound request metadata. |

## Credentials

Provider credentials must come from environment variables or an external host secret integration. They must never be sent as normal MCP tool arguments.

In v0.1 static mode, these credential refs are accepted:

- `credential:openai:static`
- `credential:anthropic:static`
- `credential:elevenlabs:static`

Omit `credential_ref` to use the static provider credential. Unknown refs are rejected.

Pass-through and broker modes are deployment contracts for an operator-supplied gateway. The gateway, credential store, tenant policy, audit layer, and envelope signing are outside this runtime build. See [pass-through gateway docs](docs/pass-through-gateway.md).

## Tools

Common tools:

- `ai_admin_list_providers`
- `ai_admin_query_usage`
- `ai_admin_query_costs`
- `ai_admin_query_dashboard_bundle`

Common query tools accept provider-specific arguments under `provider_options[provider_id]`:

```json
{
  "providers": ["openai"],
  "provider_options": {
    "openai": {
      "usage_endpoint": "images",
      "group_by": ["project_id", "model"]
    }
  },
  "start": "2026-06-01T00:00:00Z",
  "end": "2026-06-02T00:00:00Z",
  "bucket_width": "1d"
}
```

OpenAI tools:

- `openai_admin_query_usage`
- `openai_admin_query_costs`
- `openai_admin_list_projects`
- `openai_admin_list_users`
- `openai_admin_list_project_api_keys`
- `openai_admin_query_dashboard_bundle`

Anthropic tools:

- `anthropic_admin_get_organization`
- `anthropic_admin_list_workspaces`
- `anthropic_admin_list_api_keys`
- `anthropic_admin_query_messages_usage`
- `anthropic_admin_query_costs`
- `anthropic_admin_query_dashboard_bundle`

ElevenLabs tools:

- `elevenlabs_admin_get_user`
- `elevenlabs_admin_get_subscription`
- `elevenlabs_admin_list_service_accounts`
- `elevenlabs_admin_list_service_account_api_keys`
- `elevenlabs_admin_list_audit_logs`
- `elevenlabs_admin_list_api_requests`
- `elevenlabs_admin_query_usage`
- `elevenlabs_admin_query_dashboard_bundle`

## Resources and Prompts

Resources:

- `ai-admin://providers`
- `ai-admin://providers/{provider}/capabilities`
- `ai-admin://schema/provider-capability-v1`
- `ai-admin://schema/usage-fact-v1`
- `ai-admin://schema/cost-fact-v1`
- `ai-admin://schema/dashboard-bundle-v1`
- `openai-admin://capabilities`
- `anthropic-admin://capabilities`
- `elevenlabs-admin://capabilities`

External provider plugins can register their own tools and resources.

Prompts:

- `build_usage_dashboard`
- `investigate_cost_spike`
- `export_finance_report`

## Provider Notes

- OpenAI usage endpoints have endpoint-specific filters, groupings, and metrics. Unsupported parameters are rejected before any provider call.
- Anthropic costs are reported in minor units and normalized to USD major units. Priority Tier costs are not included in the Anthropic cost endpoint.
- Anthropic `speed` usage filters/groupings require `ANTHROPIC_BETA=fast-mode-2026-02-01`.
- ElevenLabs workspace analytics reports credit usage. The provider exposes `credit_count`; provider-reported monetary cost is not available from the implemented endpoint.
- Google Cloud Billing support is planned only. BigQuery queries against billing export tables can be cost-bearing.

## MCP Client Example

```json
{
  "mcpServers": {
    "ai-admin-api": {
      "command": "pnpm",
      "args": ["--dir", "/absolute/path/to/ai-admin-api-mcp", "start:stdio"],
      "env": {
        "OPENAI_ADMIN_KEY": "sk-admin-...",
        "ANTHROPIC_ADMIN_KEY": "sk-ant-admin-...",
        "ELEVENLABS_API_KEY": "xi-..."
      }
    }
  }
}
```

## Docker

```sh
docker build -t ai-admin-api-mcp .
docker run --rm -p 8787:8787 \
  -e OPENAI_ADMIN_KEY \
  -e ANTHROPIC_ADMIN_KEY \
  -e ELEVENLABS_API_KEY \
  -e MCP_HTTP_AUTH_TOKEN \
  ai-admin-api-mcp
```

The Docker image starts Streamable HTTP mode by default.

## Development

```sh
pnpm check
pnpm test
pnpm test:live:openai
pnpm test:live:anthropic
```

Live tests are skipped unless provider credentials are present.

## Release

The **Build and Publish** GitHub Actions workflow runs `pnpm check` and `pnpm test` on pushes and pull requests targeting `main`.

Releases are manual through **Actions -> Build and Publish -> Run workflow** on `main`.

Inputs:

- `package-version`: optional SemVer override. If omitted, the workflow uses the committed package version.
- `npm-tag`: npm dist-tag to use when publishing. Defaults to `latest`.
- `publish-to-npm`: set to `true` to publish `@amaretto-software-labs/ai-admin-api-mcp` to npm after the release is created.

The release job aligns the `@amaretto-software-labs/ai-admin-api-mcp` package version in the runner, rebuilds and tests the package, packs one npm tarball, pushes a `v<package-version>` git tag, creates a GitHub Release with the packed artifact, and optionally publishes `@amaretto-software-labs/ai-admin-api-mcp` to npm using trusted publishing. Configure npm trusted publishing for this repository and package before enabling `publish-to-npm`.
