import { getJson, type ProviderCredential } from "../../core/index.js";
import type { OpenAiConfig, OpenAiCostResult, OpenAiPage, OpenAiUsageResult } from "./types.js";

export class OpenAiAdminClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch | undefined;

  constructor(config: OpenAiConfig = {}) {
    this.baseUrl = config.baseUrl ?? "https://api.openai.com/v1";
    this.fetchImpl = config.fetchImpl;
  }

  async getUsagePage(
    path: string,
    query: Record<string, unknown>,
    credential: ProviderCredential,
  ): Promise<OpenAiPage<OpenAiUsageResult>> {
    return getJson<OpenAiPage<OpenAiUsageResult>>({
      baseUrl: this.baseUrl,
      path,
      query,
      headers: this.headers(credential),
      fetchImpl: this.fetchImpl,
    });
  }

  async getCostsPage(query: Record<string, unknown>, credential: ProviderCredential): Promise<OpenAiPage<OpenAiCostResult>> {
    return getJson<OpenAiPage<OpenAiCostResult>>({
      baseUrl: this.baseUrl,
      path: "/organization/costs",
      query,
      headers: this.headers(credential),
      fetchImpl: this.fetchImpl,
    });
  }

  async getMetadata(path: string, query: Record<string, unknown>, credential: ProviderCredential): Promise<unknown> {
    return getJson<unknown>({
      baseUrl: this.baseUrl,
      path,
      query,
      headers: this.headers(credential),
      fetchImpl: this.fetchImpl,
    });
  }

  private headers(credential: ProviderCredential): Record<string, string> {
    return {
      Authorization: `Bearer ${credential.secret}`,
      "Content-Type": "application/json",
    };
  }
}
