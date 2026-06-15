const fixtureProviderPlugin = {
  apiVersion: "1",
  id: "fixture-provider",
  displayName: "Fixture Provider",
  inferEnabled({ config }) {
    return config.pluginEnv.FIXTURE_PROVIDER_ENABLED === "true";
  },
  createProvider({ config }) {
    const configured = config.pluginEnv.FIXTURE_PROVIDER_CONFIGURED !== "false";
    return {
      id: "fixture-provider",
      displayName: "Fixture Provider",
      version: "0.0.0-test",
      configured,
      required: config.requiredProviders.includes("fixture-provider"),
      capabilities() {
        return {
          provider: "fixture-provider",
          display_name: "Fixture Provider",
          version: "0.0.0-test",
          status: configured ? "enabled" : "disabled",
          tools: ["fixture_provider_ping"],
          resources: ["fixture-provider://capabilities"],
          supports_usage: true,
          supports_costs: false,
          direct_queries_can_incur_cost: false,
          freshness_notes: ["Fixture plugin data is synthetic."],
          cost_coverage_gaps: [],
          dimensions: {},
          limits: {},
          warnings: [],
        };
      },
      registerTools(registrar) {
        registrar.registerTool(
          "fixture_provider_ping",
          {
            description: "Return a fixture plugin response.",
            inputSchema: {},
            annotations: { readOnlyHint: true },
          },
          async () => ({
            content: [{ type: "text", text: "pong" }],
            structuredContent: { ok: true },
          }),
        );
      },
      async queryUsage(input, context) {
        return {
          provider: "fixture-provider",
          tool: "fixture_provider_query_usage",
          queried_at: context.now().toISOString(),
          time_range: {
            start: input.start,
            end: input.end,
            bucket_width: input.bucket_width,
          },
          cache: { status: "disabled", ttl_seconds: null },
          warnings: [],
          data: {
            marker: input.marker ?? null,
            credential_ref: input.credential_ref ?? null,
          },
          raw: null,
        };
      },
    };
  },
};

export default fixtureProviderPlugin;
