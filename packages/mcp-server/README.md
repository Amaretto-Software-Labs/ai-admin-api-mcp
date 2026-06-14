# ai-admin-api-mcp

Read-only MCP server for AI provider administration APIs.

Implemented providers:

- OpenAI Admin API
- Anthropic Admin API

Run over STDIO:

```sh
OPENAI_ADMIN_KEY=sk-admin-... ai-admin-api-mcp --stdio
```

Run over Streamable HTTP:

```sh
MCP_HTTP_AUTH_TOKEN=local-token \
OPENAI_ADMIN_KEY=sk-admin-... \
ai-admin-api-mcp --http --port 8787
```

Run over local HTTPS:

```sh
MCP_HTTP_AUTH_TOKEN=local-token \
OPENAI_ADMIN_KEY=sk-admin-... \
ai-admin-api-mcp --https --port 8787 \
  --tls-cert /path/to/localhost.pem \
  --tls-key /path/to/localhost.key
```

See the repository README for full configuration, provider caveats, and gateway deployment notes.
