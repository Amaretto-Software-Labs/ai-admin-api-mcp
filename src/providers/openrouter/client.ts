import { getJson, postJson, type ProviderCredential } from "../../core/index.js";
import type {
  OpenRouterActivityResponse,
  OpenRouterAnalyticsMetaResponse,
  OpenRouterAnalyticsQueryResponse,
  OpenRouterConfig,
  OpenRouterCreditsResponse,
  OpenRouterGenerationResponse,
} from "./types.js";

export class OpenRouterAdminClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch | undefined;
  private readonly httpReferer: string | undefined;
  private readonly appTitle: string | undefined;

  constructor(config: OpenRouterConfig = {}) {
    this.baseUrl = config.baseUrl ?? "https://openrouter.ai/api/v1";
    this.fetchImpl = config.fetchImpl;
    this.httpReferer = config.httpReferer;
    this.appTitle = config.appTitle;
  }

  async getCurrentKey(credential: ProviderCredential): Promise<unknown> {
    return this.getMetadata("/key", {}, credential);
  }

  async listApiKeys(query: Record<string, unknown>, credential: ProviderCredential): Promise<unknown> {
    return this.getMetadata("/keys", query, credential);
  }

  async getApiKey(hash: string, credential: ProviderCredential): Promise<unknown> {
    return this.getMetadata(`/keys/${encodeURIComponent(hash)}`, {}, credential);
  }

  async getCredits(credential: ProviderCredential): Promise<OpenRouterCreditsResponse> {
    return getJson<OpenRouterCreditsResponse>({
      baseUrl: this.baseUrl,
      path: "/credits",
      headers: this.headers(credential),
      fetchImpl: this.fetchImpl,
    });
  }

  async getActivity(query: Record<string, unknown>, credential: ProviderCredential): Promise<OpenRouterActivityResponse> {
    return getJson<OpenRouterActivityResponse>({
      baseUrl: this.baseUrl,
      path: "/activity",
      query,
      headers: this.headers(credential),
      fetchImpl: this.fetchImpl,
    });
  }

  async getAnalyticsMeta(credential: ProviderCredential): Promise<OpenRouterAnalyticsMetaResponse> {
    return getJson<OpenRouterAnalyticsMetaResponse>({
      baseUrl: this.baseUrl,
      path: "/analytics/meta",
      headers: this.headers(credential),
      fetchImpl: this.fetchImpl,
    });
  }

  async queryAnalytics(body: Record<string, unknown>, credential: ProviderCredential): Promise<OpenRouterAnalyticsQueryResponse> {
    return postJson<OpenRouterAnalyticsQueryResponse>({
      baseUrl: this.baseUrl,
      path: "/analytics/query",
      body,
      headers: this.headers(credential),
      fetchImpl: this.fetchImpl,
    });
  }

  async getGeneration(id: string, credential: ProviderCredential): Promise<OpenRouterGenerationResponse> {
    return getJson<OpenRouterGenerationResponse>({
      baseUrl: this.baseUrl,
      path: "/generation",
      query: { id },
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
      ...(this.httpReferer === undefined ? {} : { "HTTP-Referer": this.httpReferer }),
      ...(this.appTitle === undefined ? {} : { "X-Title": this.appTitle }),
    };
  }
}
