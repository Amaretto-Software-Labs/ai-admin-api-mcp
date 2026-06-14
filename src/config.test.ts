import { describe, expect, it } from "vitest";
import { StaticCredentialResolver } from "./credentials.js";
import { ensureSupportedCredentialMode, loadConfig } from "./config.js";

describe("loadConfig", () => {
  it("infers enabled providers from static credentials", () => {
    const config = loadConfig({
      OPENAI_ADMIN_KEY: "sk-test",
      ANTHROPIC_ADMIN_KEY: "sk-ant-admin-test",
    });

    expect(config.enabledProviders).toEqual(["openai", "anthropic"]);
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
    const resolver = new StaticCredentialResolver(config);

    await expect(
      resolver.resolve({
        provider: "openai",
        credential_ref: "credential:openai:other",
        tool: "openai_admin_query_usage",
      }),
    ).rejects.toMatchObject({ code: "permission_denied" });
  });
});
