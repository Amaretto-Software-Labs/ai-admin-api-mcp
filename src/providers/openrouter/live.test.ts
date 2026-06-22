import { describe, expect, it } from "vitest";
import type { CredentialResolver } from "../../core/index.js";
import { OpenRouterProvider } from "./provider.js";

describe.skipIf(!process.env.OPENROUTER_MANAGEMENT_KEY)("OpenRouter live smoke", () => {
  it("fetches credits and analytics metadata without exposing credentials", async () => {
    const managementKey = process.env.OPENROUTER_MANAGEMENT_KEY ?? "";
    const provider = new OpenRouterProvider({
      managementKey,
      ...(process.env.OPENROUTER_BASE_URL === undefined ? {} : { baseUrl: process.env.OPENROUTER_BASE_URL }),
    });
    const credentialResolver: CredentialResolver = {
      async resolve() {
        return {
          provider: "openrouter",
          credential_ref: "credential:openrouter:management",
          type: "bearer",
          secret: managementKey,
        };
      },
    };

    const key = await provider.getCurrentKey({}, { credentialResolver, now: () => new Date() });
    const credits = await provider.getCredits({}, { credentialResolver, now: () => new Date() });
    const meta = await provider.getAnalyticsMeta({}, { credentialResolver, now: () => new Date() });

    const serialized = JSON.stringify({ key, credits, meta });
    expect(serialized).not.toContain(managementKey);
  });
});
