import { AiAdminError, type ProviderId } from "./core/index.js";

export type CredentialMode = "static" | "pass_through" | "hybrid";

export interface ServerConfig {
  enabledProviders: ProviderId[];
  requiredProviders: ProviderId[];
  providerPluginModules: string[];
  pluginEnv: Record<string, string | undefined>;
  credentialMode: CredentialMode;
  openai: {
    adminKey?: string;
    baseUrl?: string;
  };
  anthropic: {
    adminKey?: string;
    oauthToken?: string;
    baseUrl?: string;
    version?: string;
    betaHeaders: string[];
  };
  elevenlabs: {
    apiKey?: string;
    baseUrl?: string;
  };
  openrouter: {
    managementKey?: string;
    apiKey?: string;
    baseUrl?: string;
    httpReferer?: string;
    appTitle?: string;
  };
  httpAuthToken?: string;
  cacheTtlSeconds: number;
  userAgent?: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const enabledFromEnv = parseProviderList(env.AI_ADMIN_ENABLED_PROVIDERS);
  const providerPluginModules = splitCsv(env.AI_ADMIN_PROVIDER_PLUGINS);
  const openAiAdminKey = optionalString(env.OPENAI_ADMIN_KEY);
  const openAiBaseUrl = optionalString(env.OPENAI_BASE_URL);
  const anthropicAdminKey = optionalString(env.ANTHROPIC_ADMIN_KEY);
  const anthropicOAuthToken = optionalString(env.ANTHROPIC_OAUTH_TOKEN);
  const anthropicBaseUrl = optionalString(env.ANTHROPIC_BASE_URL);
  const anthropicVersion = optionalString(env.ANTHROPIC_VERSION);
  const elevenLabsApiKey = optionalString(env.ELEVENLABS_API_KEY);
  const elevenLabsBaseUrl = optionalString(env.ELEVENLABS_BASE_URL);
  const openRouterManagementKey = optionalString(env.OPENROUTER_MANAGEMENT_KEY);
  const openRouterApiKey = optionalString(env.OPENROUTER_API_KEY);
  const openRouterBaseUrl = optionalString(env.OPENROUTER_BASE_URL);
  const openRouterHttpReferer = optionalString(env.OPENROUTER_HTTP_REFERER);
  const openRouterAppTitle = optionalString(env.OPENROUTER_APP_TITLE);
  const httpAuthToken = optionalString(env.MCP_HTTP_AUTH_TOKEN);
  const userAgent = optionalString(env.MCP_USER_AGENT);

  return {
    enabledProviders: enabledFromEnv ?? [],
    requiredProviders: parseProviderList(env.AI_ADMIN_REQUIRED_PROVIDERS) ?? [],
    providerPluginModules,
    pluginEnv: { ...env },
    credentialMode: parseCredentialMode(env.AI_ADMIN_CREDENTIAL_MODE),
    openai: {
      ...(openAiAdminKey === undefined ? {} : { adminKey: openAiAdminKey }),
      ...(openAiBaseUrl === undefined ? {} : { baseUrl: openAiBaseUrl }),
    },
    anthropic: {
      ...(anthropicAdminKey === undefined ? {} : { adminKey: anthropicAdminKey }),
      ...(anthropicOAuthToken === undefined ? {} : { oauthToken: anthropicOAuthToken }),
      ...(anthropicBaseUrl === undefined ? {} : { baseUrl: anthropicBaseUrl }),
      ...(anthropicVersion === undefined ? {} : { version: anthropicVersion }),
      betaHeaders: splitCsv(env.ANTHROPIC_BETA),
    },
    elevenlabs: {
      ...(elevenLabsApiKey === undefined ? {} : { apiKey: elevenLabsApiKey }),
      ...(elevenLabsBaseUrl === undefined ? {} : { baseUrl: elevenLabsBaseUrl }),
    },
    openrouter: {
      ...(openRouterManagementKey === undefined ? {} : { managementKey: openRouterManagementKey }),
      ...(openRouterApiKey === undefined ? {} : { apiKey: openRouterApiKey }),
      ...(openRouterBaseUrl === undefined ? {} : { baseUrl: openRouterBaseUrl }),
      ...(openRouterHttpReferer === undefined ? {} : { httpReferer: openRouterHttpReferer }),
      ...(openRouterAppTitle === undefined ? {} : { appTitle: openRouterAppTitle }),
    },
    ...(httpAuthToken === undefined ? {} : { httpAuthToken }),
    cacheTtlSeconds: parsePositiveInt(env.MCP_CACHE_TTL_SECONDS, 60),
    ...(userAgent === undefined ? {} : { userAgent }),
  };
}

export function ensureRequiredProviders(config: ServerConfig): void {
  for (const provider of config.requiredProviders) {
    if (config.enabledProviders.length > 0 && !config.enabledProviders.includes(provider)) {
      throw new AiAdminError("configuration_error", `Required provider ${provider} is not enabled`);
    }
  }
}

export function ensureSupportedCredentialMode(config: ServerConfig): void {
  if (config.credentialMode === "static") {
    return;
  }
  throw new AiAdminError(
    "configuration_error",
    `Credential mode ${config.credentialMode} requires an external gateway adapter and is not implemented in this runtime build`,
    {
      supported_credential_modes: ["static"],
      documented_gateway_modes: ["pass_through", "hybrid"],
    },
  );
}

function parseProviderList(value: string | undefined): ProviderId[] | undefined {
  if (value === undefined || value.trim() === "") {
    return undefined;
  }

  return splitCsv(value);
}

function parseCredentialMode(value: string | undefined): CredentialMode {
  if (value === undefined || value.trim() === "") {
    return "static";
  }
  if (value === "static" || value === "pass_through" || value === "hybrid") {
    return value;
  }
  throw new AiAdminError("configuration_error", `Unsupported credential mode ${value}`);
}

function splitCsv(value: string | undefined): string[] {
  return value === undefined
    ? []
    : value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function optionalString(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}
