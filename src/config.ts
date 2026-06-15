import { AiAdminError, type ImplementedProviderId } from "./core/index.js";

export type CredentialMode = "static" | "pass_through" | "hybrid";

export interface ServerConfig {
  enabledProviders: ImplementedProviderId[];
  requiredProviders: ImplementedProviderId[];
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
  httpAuthToken?: string;
  cacheTtlSeconds: number;
  userAgent?: string;
}

const IMPLEMENTED_PROVIDERS: ImplementedProviderId[] = ["openai", "anthropic", "elevenlabs"];

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const enabledFromEnv = parseProviderList(env.AI_ADMIN_ENABLED_PROVIDERS);
  const inferredEnabled = IMPLEMENTED_PROVIDERS.filter((provider) => hasProviderConfig(provider, env));
  const enabledProviders = enabledFromEnv ?? inferredEnabled;
  const openAiAdminKey = optionalString(env.OPENAI_ADMIN_KEY);
  const openAiBaseUrl = optionalString(env.OPENAI_BASE_URL);
  const anthropicAdminKey = optionalString(env.ANTHROPIC_ADMIN_KEY);
  const anthropicOAuthToken = optionalString(env.ANTHROPIC_OAUTH_TOKEN);
  const anthropicBaseUrl = optionalString(env.ANTHROPIC_BASE_URL);
  const anthropicVersion = optionalString(env.ANTHROPIC_VERSION);
  const elevenLabsApiKey = optionalString(env.ELEVENLABS_API_KEY);
  const elevenLabsBaseUrl = optionalString(env.ELEVENLABS_BASE_URL);
  const httpAuthToken = optionalString(env.MCP_HTTP_AUTH_TOKEN);
  const userAgent = optionalString(env.MCP_USER_AGENT);

  return {
    enabledProviders,
    requiredProviders: parseProviderList(env.AI_ADMIN_REQUIRED_PROVIDERS) ?? [],
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
    ...(httpAuthToken === undefined ? {} : { httpAuthToken }),
    cacheTtlSeconds: parsePositiveInt(env.MCP_CACHE_TTL_SECONDS, 60),
    ...(userAgent === undefined ? {} : { userAgent }),
  };
}

export function ensureRequiredProviders(config: ServerConfig): void {
  for (const provider of config.requiredProviders) {
    if (!config.enabledProviders.includes(provider)) {
      throw new AiAdminError("configuration_error", `Required provider ${provider} is not enabled`);
    }
    if (!hasStaticCredential(provider, config)) {
      throw new AiAdminError("configuration_error", `Required provider ${provider} is missing static credentials`);
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

function parseProviderList(value: string | undefined): ImplementedProviderId[] | undefined {
  if (value === undefined || value.trim() === "") {
    return undefined;
  }

  const providers = splitCsv(value);
  for (const provider of providers) {
    if (!IMPLEMENTED_PROVIDERS.includes(provider as ImplementedProviderId)) {
      throw new AiAdminError("configuration_error", `Unsupported provider ${provider}`, {
        supported_providers: IMPLEMENTED_PROVIDERS,
      });
    }
  }
  return providers as ImplementedProviderId[];
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

function hasProviderConfig(provider: ImplementedProviderId, env: NodeJS.ProcessEnv): boolean {
  if (provider === "openai") {
    return optionalString(env.OPENAI_ADMIN_KEY) !== undefined;
  }
  if (provider === "anthropic") {
    return optionalString(env.ANTHROPIC_ADMIN_KEY) !== undefined || optionalString(env.ANTHROPIC_OAUTH_TOKEN) !== undefined;
  }
  return optionalString(env.ELEVENLABS_API_KEY) !== undefined;
}

function hasStaticCredential(provider: ImplementedProviderId, config: ServerConfig): boolean {
  if (provider === "openai") {
    return Boolean(config.openai.adminKey);
  }
  if (provider === "anthropic") {
    return Boolean(config.anthropic.adminKey || config.anthropic.oauthToken);
  }
  return Boolean(config.elevenlabs.apiKey);
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
