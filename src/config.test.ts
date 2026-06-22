import { describe, expect, it } from "vitest";
import { StaticCredentialResolver } from "./credentials.js";
import { ensureSupportedCredentialMode, loadConfig } from "./config.js";
import { BUILTIN_PROVIDER_PLUGINS, createProviderRegistry } from "./providers.js";

describe("loadConfig", () => {
  it("leaves provider inference to the plugin registry", () => {
    const config = loadConfig({
      OPENAI_ADMIN_KEY: "sk-test",
      ANTHROPIC_ADMIN_KEY: "sk-ant-admin-test",
      ELEVENLABS_API_KEY: "xi-test",
    });
    const registry = createProviderRegistry(config);

    expect(config.enabledProviders).toEqual([]);
    expect(Array.from(registry.providers.keys())).toEqual(["openai", "anthropic", "elevenlabs"]);
  });

  it("ignores empty optional environment values", () => {
    const config = loadConfig({
      OPENAI_ADMIN_KEY: " ",
      MCP_HTTP_AUTH_TOKEN: "",
      MCP_USER_AGENT: " ",
    });

    expect(config.enabledProviders).toEqual([]);
    expect(config.httpAuthToken).toBeUndefined();
    expect(config.userAgent).toBeUndefined();
  });

  it("infers OpenRouter when either OpenRouter credential is configured", () => {
    const managementConfig = loadConfig({ OPENROUTER_MANAGEMENT_KEY: "or-mgmt-test" });
    const apiConfig = loadConfig({ OPENROUTER_API_KEY: "or-api-test" });

    expect(Array.from(createProviderRegistry(managementConfig).providers.keys())).toEqual(["openrouter"]);
    expect(Array.from(createProviderRegistry(apiConfig).providers.keys())).toEqual(["openrouter"]);
  });

  it("fails fast for documented but unsupported gateway credential modes", () => {
    const config = loadConfig({
      AI_ADMIN_CREDENTIAL_MODE: "pass_through",
      AI_ADMIN_ENABLED_PROVIDERS: "openai",
    });

    expect(() => ensureSupportedCredentialMode(config)).toThrow(/external gateway adapter/);
  });
});

describe("StaticCredentialResolver", () => {
  it("rejects unknown credential refs in static mode", async () => {
    const config = loadConfig({ OPENAI_ADMIN_KEY: "sk-test" });
    const resolver = new StaticCredentialResolver(config, BUILTIN_PROVIDER_PLUGINS);

    await expect(
      resolver.resolve({
        provider: "openai",
        credential_ref: "credential:openai:other",
        tool: "openai_admin_query_usage",
      }),
    ).rejects.toMatchObject({ code: "permission_denied" });
  });

  it("resolves ElevenLabs static credentials", async () => {
    const config = loadConfig({ ELEVENLABS_API_KEY: "xi-test" });
    const resolver = new StaticCredentialResolver(config, BUILTIN_PROVIDER_PLUGINS);

    await expect(
      resolver.resolve({
        provider: "elevenlabs",
        credential_ref: "credential:elevenlabs:static",
        tool: "elevenlabs_admin_query_usage",
      }),
    ).resolves.toMatchObject({
      provider: "elevenlabs",
      type: "api_key",
      secret: "xi-test",
    });
  });

  it("resolves OpenRouter static credential refs", async () => {
    const config = loadConfig({
      OPENROUTER_MANAGEMENT_KEY: "or-mgmt-test",
      OPENROUTER_API_KEY: "or-api-test",
    });
    const resolver = new StaticCredentialResolver(config, BUILTIN_PROVIDER_PLUGINS);

    await expect(
      resolver.resolve({
        provider: "openrouter",
        credential_ref: "credential:openrouter:management",
        tool: "openrouter_admin_get_credits",
      }),
    ).resolves.toMatchObject({
      provider: "openrouter",
      type: "bearer",
      secret: "or-mgmt-test",
    });
    await expect(
      resolver.resolve({
        provider: "openrouter",
        credential_ref: "credential:openrouter:api",
        tool: "openrouter_admin_get_generation",
      }),
    ).resolves.toMatchObject({
      provider: "openrouter",
      type: "bearer",
      secret: "or-api-test",
    });
    await expect(
      resolver.resolve({
        provider: "openrouter",
        credential_ref: "credential:openrouter:static",
        tool: "openrouter_admin_get_current_key",
      }),
    ).resolves.toMatchObject({
      provider: "openrouter",
      type: "bearer",
      secret: "or-mgmt-test",
    });
  });
});
