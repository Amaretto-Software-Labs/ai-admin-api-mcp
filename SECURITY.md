# Security

This MCP server exposes read-only access to high-impact provider admin data. Treat every deployment as sensitive.

## Supported Credential Mode

Version 0.1 implements static credential mode only. Provider credentials are read from process environment variables or host secret injection.

`pass_through` and `hybrid` are documented gateway contracts for future or downstream adapters. This runtime build fails fast if those modes are selected.

## Deployment Guidance

- Run STDIO only for trusted local clients.
- Require `MCP_HTTP_AUTH_TOKEN` for HTTP mode unless using explicit unsafe local development mode.
- Place HTTP deployments behind a trusted gateway or reverse proxy.
- Use least-privileged provider admin credentials that can read usage, costs, and metadata.
- Do not share one statically credentialed server across tenants.
- Do not log MCP request bodies, provider response headers, or provider credentials.

## Reporting Issues

Do not open public issues with provider credentials, tokens, tenant identifiers, billing exports, or raw admin API responses. Share a minimal reproduction with secrets redacted.
