import { getJson, type ProviderCredential } from "@ai-admin-api-mcp/core";
import type { AnthropicConfig, AnthropicCostResult, AnthropicPage, AnthropicUsageResult } from "./types.js";

export class AnthropicAdminClient {
  private readonly baseUrl: string;
  private readonly anthropicVersion: string;
  private readonly betaHeaders: string[];
  private readonly fetchImpl: typeof fetch | undefined;

  constructor(config: AnthropicConfig = {}) {
    this.baseUrl = config.baseUrl ?? "https://api.anthropic.com/v1";
    this.anthropicVersion = config.anthropicVersion ?? "2023-06-01";
    this.betaHeaders = config.betaHeaders ?? [];
    this.fetchImpl = config.fetchImpl;
  }

  async getMessagesUsagePage(query: Record<string, unknown>, credential: ProviderCredential): Promise<AnthropicPage<AnthropicUsageResult>> {
    return getJson<AnthropicPage<AnthropicUsageResult>>({
      baseUrl: this.baseUrl,
      path: "/organizations/usage_report/messages",
      query,
      headers: this.headers(credential),
      fetchImpl: this.fetchImpl,
    });
  }

  async getCostPage(query: Record<string, unknown>, credential: ProviderCredential): Promise<AnthropicPage<AnthropicCostResult>> {
    return getJson<AnthropicPage<AnthropicCostResult>>({
      baseUrl: this.baseUrl,
      path: "/organizations/cost_report",
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
    const headers: Record<string, string> = {
      "anthropic-version": this.anthropicVersion,
      "Content-Type": "application/json",
    };
    if (this.betaHeaders.length > 0) {
      headers["anthropic-beta"] = this.betaHeaders.join(",");
    }
    if (credential.type === "bearer") {
      headers.Authorization = `Bearer ${credential.secret}`;
    } else {
      headers["x-api-key"] = credential.secret;
    }
    return headers;
  }
}
