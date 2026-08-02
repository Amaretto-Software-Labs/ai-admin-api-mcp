# CobaltCode setup: AI Admin API MCP

## Important: this is not a web application

This repository implements an MCP server. It has no browser UI and no
previewable web application.

- Do **not** call CobaltCode `register_preview`, `refresh_preview`, or other
  preview controls for this repository.
- Do **not** describe port `8787` as a preview port.
- When Streamable HTTP is running, port `8787` is an MCP transport endpoint
  for MCP clients and protocol-level smoke tests only.
- Prefer the STDIO transport unless the task specifically requires HTTP.

## Repository structure

- `src/cli.ts`: CLI and transport selection.
- `src/http.ts`: Streamable HTTP transport implementation.
- `src/server.ts`: MCP server, shared tools, resources, and prompts.
- `src/providers/`: built-in provider integrations and provider tests.
- `src/core/`: shared normalization, validation, errors, and utilities.
- `docs/`: provider and gateway documentation.
- `dist/`: generated TypeScript build output; do not edit it directly.

No database, browser frontend, container, or supporting service is required
for ordinary development and unit tests.

## Prerequisites

- Node.js 22 or newer.
- pnpm 10.29.1, as pinned by `packageManager` in `package.json`.

## Repeatable bootstrap

From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm test
pnpm build
```

Unit tests use mocked provider responses. Live provider tests are separate and
are skipped unless deliberately run with the corresponding credentials.

## Running the MCP server

### STDIO (preferred)

For MCP clients that launch their own server process:

```sh
pnpm start:stdio
```

STDIO mode does not listen on a port and must not be managed as a Cobalt
preview.

### Streamable HTTP (only when required)

The normal authenticated development command is:

```sh
MCP_HTTP_AUTH_TOKEN=<local-token> pnpm start:http
```

This listens at `http://127.0.0.1:8787/mcp`. The value above is a placeholder;
never add an actual token to this file, shell history, logs, or Git.

For a credential-free local protocol smoke test, it is acceptable to run:

```sh
pnpm exec tsx src/cli.ts --http --port 8787 --unsafe-local-http
```

Use unsafe local HTTP only inside the protected development computer. If the
process must survive shell disconnection or computer suspension, manage it as
a background service:

```sh
cobaltcode-service start application 8787 -- pnpm exec tsx src/cli.ts --http --port 8787 --unsafe-local-http
cobaltcode-service status application
cobaltcode-service logs application
```

After a resume, check `cobaltcode-service status application`. If it is
stopped, use the same `cobaltcode-service start` command again. Some runtime
versions do not implement a `restart` subcommand.

Even when HTTP mode is running successfully, **do not register port 8787 as a
Cobalt preview**.

## Verification

Focused HTTP transport tests:

```sh
pnpm exec vitest run src/http.test.ts
```

Confirm a background HTTP service is listening:

```sh
cobaltcode-service status application
ss -ltn '( sport = :8787 )'
```

For unsafe-local mode, perform an MCP initialization handshake rather than a
browser request:

```sh
curl --silent --show-error --fail-with-body \
  --request POST http://127.0.0.1:8787/mcp \
  --header 'Content-Type: application/json' \
  --header 'Accept: application/json, text/event-stream' \
  --data '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"cobalt-smoke","version":"1.0.0"}}}'
```

A successful response contains MCP server information for
`ai-admin-api-mcp`. For authenticated HTTP mode, also pass an Authorization
header without printing or persisting its token.

## Environment variables

Configuration variable names are documented in `.env.example` and `README.md`:

- Provider selection and plugins: `AI_ADMIN_ENABLED_PROVIDERS`,
  `AI_ADMIN_PROVIDER_PLUGINS`, `AI_ADMIN_REQUIRED_PROVIDERS`,
  `AI_ADMIN_CREDENTIAL_MODE`.
- OpenAI: `OPENAI_ADMIN_KEY`, `OPENAI_BASE_URL`.
- Anthropic: `ANTHROPIC_ADMIN_KEY`, `ANTHROPIC_OAUTH_TOKEN`,
  `ANTHROPIC_BASE_URL`, `ANTHROPIC_VERSION`, `ANTHROPIC_BETA`.
- ElevenLabs: `ELEVENLABS_API_KEY`, `ELEVENLABS_BASE_URL`.
- OpenRouter: `OPENROUTER_MANAGEMENT_KEY`, `OPENROUTER_API_KEY`,
  `OPENROUTER_BASE_URL`, `OPENROUTER_HTTP_REFERER`, `OPENROUTER_APP_TITLE`.
- HTTP/TLS: `MCP_HTTP_AUTH_TOKEN`, `MCP_HTTPS_CERT_PATH`,
  `MCP_HTTPS_KEY_PATH`.
- Runtime: `MCP_CACHE_TTL_SECONDS`, `MCP_USER_AGENT`.

Never print, persist, commit, or place real credentials in command examples.
Provider credentials are not required to start the server or run mocked unit
tests, but provider API calls require the relevant credential.

## Persistent state

- `node_modules/` and `dist/` may be reused across turns when their inputs have
  not changed.
- The Cobalt service definition may persist, but its process may be stopped
  after a computer resume; always check status and perform an MCP handshake.
- The application has no database or other durable runtime data.

## Troubleshooting

- `401 missing_or_invalid_bearer_token`: set `MCP_HTTP_AUTH_TOKEN` and send the
  matching bearer token, or use `--unsafe-local-http` for a protected local
  smoke test.
- Port `8787` already in use: inspect the existing listener and
  `cobaltcode-service status application` before starting another process.
- Provider calls report missing credentials: configure only the relevant
  provider environment variable and restart the MCP process.
- Live tests are skipped: this is expected without provider credentials.
- An OpenRouter activity test with a fixed date can eventually fall outside
  the provider's last-30-completed-days validation window; distinguish that
  fixture issue from an HTTP startup failure.
- A browser shows an error or raw protocol response: this is expected because
  `/mcp` is an MCP endpoint, not a web page. Do not solve it by registering a
  preview.
