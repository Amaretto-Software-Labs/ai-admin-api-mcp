# Contributing

## Development

Use pnpm workspaces:

```sh
pnpm install
pnpm check
pnpm test
```

Provider packages should stay independent of MCP transport details. The MCP server package owns tool registration, credential resolution, and transport setup. The core package owns shared normalization types, redaction, pagination, errors, and HTTP helpers.

## Provider Changes

For any provider surface change:

- Add endpoint capability metadata.
- Reject unsupported filters and groupings before making a provider call.
- Normalize into shared `UsageFact` or `CostFact` shapes.
- Preserve provider-specific details under `provider_details`.
- Add unit tests with mocked provider responses.
- Add or update a live test entrypoint if the provider can be exercised safely with environment credentials.

## Security Expectations

- Do not add write or mutation tools.
- Do not accept provider credentials as normal MCP tool arguments.
- Redact credentials from errors, raw responses, logs, and tests.
- Keep pass-through credential material out of cache keys and tool results.
- Document cost-bearing provider calls in release notes.
