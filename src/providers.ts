import type { ProviderCapability, Warning } from "./core/index.js";
import { AnthropicProvider } from "./providers/anthropic/index.js";
import { OpenAiProvider } from "./providers/openai/index.js";
import type { ServerConfig } from "./config.js";

export interface ProviderRegistry {
  openai?: OpenAiProvider;
  anthropic?: AnthropicProvider;
  capabilities: ProviderCapability[];
}

export function createProviderRegistry(config: ServerConfig): ProviderRegistry {
  const openai = config.enabledProviders.includes("openai")
    ? new OpenAiProvider({
      ...(config.openai.adminKey === undefined ? {} : { adminKey: config.openai.adminKey }),
      ...(config.openai.baseUrl === undefined ? {} : { baseUrl: config.openai.baseUrl }),
      required: config.requiredProviders.includes("openai"),
      cacheTtlSeconds: config.cacheTtlSeconds,
    })
    : undefined;

  const anthropic = config.enabledProviders.includes("anthropic")
    ? new AnthropicProvider({
      ...(config.anthropic.adminKey === undefined ? {} : { adminKey: config.anthropic.adminKey }),
      ...(config.anthropic.oauthToken === undefined ? {} : { oauthToken: config.anthropic.oauthToken }),
      ...(config.anthropic.baseUrl === undefined ? {} : { baseUrl: config.anthropic.baseUrl }),
      ...(config.anthropic.version === undefined ? {} : { anthropicVersion: config.anthropic.version }),
      betaHeaders: config.anthropic.betaHeaders,
      required: config.requiredProviders.includes("anthropic"),
      cacheTtlSeconds: config.cacheTtlSeconds,
    })
    : undefined;

  return {
    ...(openai === undefined ? {} : { openai }),
    ...(anthropic === undefined ? {} : { anthropic }),
    capabilities: [
      ...(openai === undefined ? [] : [openai.capabilities()]),
      ...(anthropic === undefined ? [] : [anthropic.capabilities()]),
      googlePlannedCapability(),
    ],
  };
}

function googlePlannedCapability(): ProviderCapability {
  const warnings: Warning[] = [
    {
      code: "planned_provider",
      message: "Google Cloud Billing support is planned. BigQuery billing export queries can incur Google Cloud query costs; release notes must call this out when the provider ships.",
    },
  ];
  return {
    provider: "google-cloud-billing",
    display_name: "Google Cloud Billing",
    version: "planned",
    status: "planned",
    tools: [],
    resources: ["google-billing://capabilities"],
    supports_usage: false,
    supports_costs: false,
    direct_queries_can_incur_cost: true,
    freshness_notes: ["Cloud Billing export freshness depends on Google Cloud export timing."],
    cost_coverage_gaps: ["Model-level and API-key-level attribution may be unavailable in billing export rows."],
    dimensions: {},
    limits: {},
    warnings,
  };
}
