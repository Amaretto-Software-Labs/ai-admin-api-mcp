import { describe, expect, it } from "vitest";
import type { CredentialResolver } from "../../core/index.js";
import { OpenAiProvider } from "./provider.js";

describe.skipIf(!process.env.OPENAI_ADMIN_KEY)("OpenAI live smoke", () => {
  it("fetches one recent cost bucket without exposing credentials", async () => {
    const provider = new OpenAiProvider(
      process.env.OPENAI_ADMIN_KEY === undefined ? {} : { adminKey: process.env.OPENAI_ADMIN_KEY },
    );
    const credentialResolver: CredentialResolver = {
      async resolve() {
        return {
          provider: "openai",
          credential_ref: null,
          type: "bearer",
          secret: process.env.OPENAI_ADMIN_KEY ?? "",
        };
      },
    };

    const now = new Date();
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const start = new Date(end.getTime() - 24 * 60 * 60 * 1000);
    const result = await provider.queryCosts(
      {
        start: start.toISOString(),
        end: end.toISOString(),
        limit: 1,
        max_pages: 1,
      },
      { credentialResolver, now: () => now },
    );

    expect(JSON.stringify(result)).not.toContain(process.env.OPENAI_ADMIN_KEY);
  });
});
