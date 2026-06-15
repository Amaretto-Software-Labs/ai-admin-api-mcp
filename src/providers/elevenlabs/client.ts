import { getJson, postJson, type ProviderCredential } from "../../core/index.js";
import type { ElevenLabsAnalyticsResponse, ElevenLabsConfig } from "./types.js";

export class ElevenLabsAdminClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch | undefined;

  constructor(config: ElevenLabsConfig = {}) {
    this.baseUrl = config.baseUrl ?? "https://api.elevenlabs.io/v1";
    this.fetchImpl = config.fetchImpl;
  }

  async queryWorkspaceUsage(body: Record<string, unknown>, credential: ProviderCredential): Promise<ElevenLabsAnalyticsResponse> {
    return postJson<ElevenLabsAnalyticsResponse>({
      baseUrl: this.baseUrl,
      path: "/workspace/analytics/query/usage-by-product-over-time",
      body,
      headers: this.headers(credential),
      fetchImpl: this.fetchImpl,
    });
  }

  async listApiRequests(body: Record<string, unknown>, credential: ProviderCredential): Promise<ElevenLabsAnalyticsResponse> {
    return postJson<ElevenLabsAnalyticsResponse>({
      baseUrl: this.baseUrl,
      path: "/workspace/analytics/requests",
      body,
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
      "Content-Type": "application/json",
      "xi-api-key": credential.secret,
    };
  }
}

