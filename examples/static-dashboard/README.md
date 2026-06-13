# Static Dashboard Example

Run the MCP server locally with static provider credentials:

```sh
OPENAI_ADMIN_KEY=sk-admin-... \
ANTHROPIC_ADMIN_KEY=sk-ant-admin-... \
pnpm --dir ../.. start:stdio
```

Call `ai_admin_query_dashboard_bundle` with a daily range:

```json
{
  "providers": ["openai", "anthropic"],
  "start": "2026-06-01T00:00:00Z",
  "end": "2026-06-08T00:00:00Z",
  "bucket_width": "1d",
  "top_n": 10,
  "include_metadata": false
}
```

The response contains provider-specific envelopes under `data.results` and provider warnings under `data.warnings`.
