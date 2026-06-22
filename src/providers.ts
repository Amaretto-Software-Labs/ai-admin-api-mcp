import { pathToFileURL } from "node:url";
import { isAbsolute, resolve } from "node:path";
import { AiAdminError, type ProviderCapability, type ProviderId, type Warning } from "./core/index.js";
import type { ServerConfig } from "./config.js";
import { anthropicProviderPlugin } from "./providers/anthropic/plugin.js";
import { elevenLabsProviderPlugin } from "./providers/elevenlabs/plugin.js";
import { openAiProviderPlugin } from "./providers/openai/plugin.js";
import { openRouterProviderPlugin } from "./providers/openrouter/plugin.js";
import { isAiAdminProviderPlugin, type AiAdminProviderPlugin, type ProviderRuntime } from "./plugin.js";

export interface ProviderRegistry {
  providers: Map<ProviderId, ProviderRuntime>;
  plugins: AiAdminProviderPlugin[];
  capabilities: ProviderCapability[];
}

export interface ProviderRegistryOptions {
  plugins?: AiAdminProviderPlugin[];
}

export const BUILTIN_PROVIDER_PLUGINS: AiAdminProviderPlugin[] = [
  openAiProviderPlugin,
  anthropicProviderPlugin,
  elevenLabsProviderPlugin,
  openRouterProviderPlugin,
];

export function createProviderRegistry(config: ServerConfig, options: ProviderRegistryOptions = {}): ProviderRegistry {
  if (config.providerPluginModules.length > 0 && options.plugins === undefined) {
    throw new AiAdminError(
      "configuration_error",
      "External provider plugins require createProviderRegistryWithPlugins or createAiAdminServerWithPlugins",
      { configured_plugins: config.providerPluginModules },
    );
  }

  const plugins = options.plugins ?? BUILTIN_PROVIDER_PLUGINS;
  return createRegistryFromPlugins(config, plugins);
}

export async function createProviderRegistryWithPlugins(config: ServerConfig, options: ProviderRegistryOptions = {}): Promise<ProviderRegistry> {
  const externalPlugins = await loadConfiguredProviderPlugins(config);
  return createRegistryFromPlugins(config, [...(options.plugins ?? BUILTIN_PROVIDER_PLUGINS), ...externalPlugins]);
}

export async function loadConfiguredProviderPlugins(config: ServerConfig): Promise<AiAdminProviderPlugin[]> {
  const plugins: AiAdminProviderPlugin[] = [];
  for (const specifier of config.providerPluginModules) {
    plugins.push(await importProviderPlugin(specifier));
  }
  return plugins;
}

async function importProviderPlugin(specifier: string): Promise<AiAdminProviderPlugin> {
  const module = await import(resolvePluginSpecifier(specifier));
  const plugin = (module.default ?? module.providerPlugin ?? module.plugin) as unknown;
  if (!isAiAdminProviderPlugin(plugin)) {
    throw new AiAdminError("configuration_error", `Provider plugin ${specifier} does not export a valid ai-admin provider plugin`, {
      expected_api_version: "1",
    });
  }
  return plugin;
}

function resolvePluginSpecifier(specifier: string): string {
  if (specifier.startsWith("file:")) {
    return specifier;
  }
  if (specifier.startsWith(".") || specifier.startsWith("/") || specifier.includes("\\")) {
    const path = isAbsolute(specifier) ? specifier : resolve(process.cwd(), specifier);
    return pathToFileURL(path).href;
  }
  return specifier;
}

function createRegistryFromPlugins(config: ServerConfig, plugins: AiAdminProviderPlugin[]): ProviderRegistry {
  validatePluginIds(plugins);
  const enabledProviderIds = enabledProviderIdsFromConfig(config, plugins);
  const providers = new Map<ProviderId, ProviderRuntime>();

  for (const providerId of enabledProviderIds) {
    const plugin = plugins.find((item) => item.id === providerId);
    if (plugin === undefined) {
      throw new AiAdminError("configuration_error", `Provider ${providerId} is enabled but no provider plugin is loaded for it`, {
        enabled_provider: providerId,
        loaded_providers: plugins.map((item) => item.id),
        configured_plugin_modules: config.providerPluginModules,
      });
    }
    providers.set(providerId, plugin.createProvider({ config }));
  }

  validateRequiredProviders(config, providers);

  return {
    providers,
    plugins,
    capabilities: [
      ...Array.from(providers.values()).map((provider) => provider.capabilities()),
      googlePlannedCapability(),
    ],
  };
}

function validatePluginIds(plugins: AiAdminProviderPlugin[]): void {
  const seen = new Set<string>();
  for (const plugin of plugins) {
    if (!/^[a-z0-9][a-z0-9._-]*$/i.test(plugin.id)) {
      throw new AiAdminError("configuration_error", `Invalid provider plugin id ${plugin.id}`, {
        provider_id: plugin.id,
        expected_pattern: "^[a-z0-9][a-z0-9._-]*$",
      });
    }
    if (seen.has(plugin.id)) {
      throw new AiAdminError("configuration_error", `Duplicate provider plugin id ${plugin.id}`);
    }
    seen.add(plugin.id);
  }
}

function enabledProviderIdsFromConfig(config: ServerConfig, plugins: AiAdminProviderPlugin[]): ProviderId[] {
  if (config.enabledProviders.length > 0) {
    return config.enabledProviders;
  }
  return plugins
    .filter((plugin) => plugin.inferEnabled?.({ config }) ?? false)
    .map((plugin) => plugin.id);
}

function validateRequiredProviders(config: ServerConfig, providers: Map<ProviderId, ProviderRuntime>): void {
  for (const providerId of config.requiredProviders) {
    const provider = providers.get(providerId);
    if (provider === undefined) {
      throw new AiAdminError("configuration_error", `Required provider ${providerId} is not enabled`);
    }
    if (!provider.configured) {
      throw new AiAdminError("configuration_error", `Required provider ${providerId} is not configured`);
    }
  }
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
