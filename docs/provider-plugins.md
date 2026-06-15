# Provider Plugins

The server supports native provider plugins loaded at startup. Plugins are trusted JavaScript modules; do not load modules from untrusted sources.

Built-in providers use the same plugin contract as external providers:

- `openai`
- `anthropic`
- `elevenlabs`

## Configure

Use `AI_ADMIN_PROVIDER_PLUGINS` for external ESM modules:

```sh
AI_ADMIN_PROVIDER_PLUGINS=@acme/ai-admin-provider-example,/absolute/path/to/provider.js
```

The value is a comma-separated list of package specifiers, absolute paths, relative paths, or `file:` URLs. Relative paths resolve from the current working directory.

Use `AI_ADMIN_ENABLED_PROVIDERS` to select providers explicitly:

```sh
AI_ADMIN_ENABLED_PROVIDERS=openai,my-provider
```

If `AI_ADMIN_ENABLED_PROVIDERS` is omitted, every loaded plugin may opt into inference through its `inferEnabled` hook.

## Contract

External modules must export a provider plugin as `default`, `providerPlugin`, or `plugin`.
Plugin ids must match `^[a-z0-9][a-z0-9._-]*$`.

```ts
import type { AiAdminProviderPlugin } from "@amaretto-software-labs/ai-admin-api-mcp";

const plugin: AiAdminProviderPlugin = {
  apiVersion: "1",
  id: "my-provider",
  displayName: "My Provider",
  inferEnabled({ config }) {
    return config.pluginEnv.MY_PROVIDER_API_KEY !== undefined;
  },
  createProvider({ config }) {
    return {
      id: "my-provider",
      displayName: "My Provider",
      version: "0.1.0",
      configured: config.pluginEnv.MY_PROVIDER_API_KEY !== undefined,
      required: config.requiredProviders.includes("my-provider"),
      capabilities() {
        return {
          provider: "my-provider",
          display_name: "My Provider",
          version: "0.1.0",
          status: "enabled",
          tools: [],
          resources: ["my-provider://capabilities"],
          supports_usage: true,
          supports_costs: false,
          direct_queries_can_incur_cost: false,
          freshness_notes: [],
          cost_coverage_gaps: [],
          dimensions: {},
          limits: {},
          warnings: [],
        };
      },
      async queryUsage(input, context) {
        // Return a ToolEnvelope-compatible object.
      },
    };
  },
};

export default plugin;
```

## Common Tools

Common tools route provider-specific arguments through `provider_options`:

```json
{
  "providers": ["my-provider"],
  "provider_options": {
    "my-provider": {
      "group_by": ["model"]
    }
  },
  "start": "2026-06-01T00:00:00Z",
  "end": "2026-06-02T00:00:00Z",
  "bucket_width": "1d"
}
```

Provider-specific tools are registered by each plugin through `registerTools`.
