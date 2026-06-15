# Changelog

## Unreleased

- Added ElevenLabs Admin provider support for workspace credit usage analytics, API request analytics, audit logs, user/subscription metadata, and service-account API key inventory.
- Added normalized `credit_count` usage metrics and dashboard summaries.
- Documented that the ElevenLabs provider reports credit usage, not provider-reported monetary cost.

## 0.1.0

- Added a Node.js/TypeScript MCP server with STDIO and Streamable HTTP transports.
- Added normalized OpenAI Admin API usage, cost, metadata, and dashboard tools.
- Added normalized Anthropic Admin API usage, cost, metadata, and dashboard tools.
- Added common cross-provider usage, cost, and dashboard bundle tools.
- Added provider capability resources, normalized fact schemas, and dashboard prompts.
- Added static credential mode with opaque `credential_ref` validation.
- Added local unit tests, MCP in-memory interop tests, and skipped live test entrypoints.
- Documented Google Cloud Billing as a planned provider. When the Google provider ships, its release notes must clearly state that direct BigQuery billing export queries can incur Google Cloud query costs.
