import { AiAdminError, type CredentialRequest, type CredentialResolver, type ProviderCredential } from "./core/index.js";
import type { ServerConfig } from "./config.js";
import type { AiAdminProviderPlugin } from "./plugin.js";

export class StaticCredentialResolver implements CredentialResolver {
  constructor(
    private readonly config: ServerConfig,
    private readonly plugins: AiAdminProviderPlugin[],
  ) {}

  async resolve(request: CredentialRequest): Promise<ProviderCredential> {
    const plugin = this.plugins.find((item) => item.id === request.provider);
    if (plugin === undefined) {
      throw new AiAdminError("configuration_error", `No provider plugin is loaded for ${request.provider}`, {
        provider: request.provider,
        tool: request.tool,
      });
    }
    if (plugin.resolveStaticCredential === undefined) {
      throw new AiAdminError("configuration_error", `Provider ${request.provider} does not implement static credential resolution`, {
        provider: request.provider,
        tool: request.tool,
      });
    }

    const credential = await plugin.resolveStaticCredential(request, { config: this.config });
    if (credential === null) {
      throw new AiAdminError("configuration_error", `Provider ${request.provider} did not resolve a static credential`, {
        provider: request.provider,
        tool: request.tool,
      });
    }
    return credential;
  }
}
