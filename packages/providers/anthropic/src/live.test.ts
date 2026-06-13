import { describe, expect, it } from "vitest";
import type { CredentialResolver } from "@ai-admin-api-mcp/core";
import { AnthropicProvider } from "./provider.js";

describe.skipIf(!process.env.ANTHROPIC_ADMIN_KEY && !process.env.ANTHROPIC_OAUTH_TOKEN)("Anthropic live smoke", () => {
  it("fetches organization metadata without exposing credentials", async () => {
    const provider = new AnthropicProvider({
      ...(process.env.ANTHROPIC_ADMIN_KEY === undefined ? {} : { adminKey: process.env.ANTHROPIC_ADMIN_KEY }),
      ...(process.env.ANTHROPIC_OAUTH_TOKEN === undefined ? {} : { oauthToken: process.env.ANTHROPIC_OAUTH_TOKEN }),
    });
    const credentialResolver: CredentialResolver = {
      async resolve() {
        return {
          provider: "anthropic",
          credential_ref: null,
          type: process.env.ANTHROPIC_OAUTH_TOKEN ? "bearer" : "api_key",
          secret: process.env.ANTHROPIC_OAUTH_TOKEN ?? process.env.ANTHROPIC_ADMIN_KEY ?? "",
        };
      },
    };

    const result = await provider.getOrganization({}, { credentialResolver, now: () => new Date() });
    expect(JSON.stringify(result)).not.toContain(process.env.ANTHROPIC_ADMIN_KEY ?? process.env.ANTHROPIC_OAUTH_TOKEN);
  });
});
