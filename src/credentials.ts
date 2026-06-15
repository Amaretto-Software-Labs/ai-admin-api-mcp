import { AiAdminError, type CredentialRequest, type CredentialResolver, type ProviderCredential } from "./core/index.js";
import type { ServerConfig } from "./config.js";

const STATIC_REFS = {
  openai: "credential:openai:static",
  anthropic: "credential:anthropic:static",
  elevenlabs: "credential:elevenlabs:static",
} as const;

export class StaticCredentialResolver implements CredentialResolver {
  constructor(private readonly config: ServerConfig) {}

  async resolve(request: CredentialRequest): Promise<ProviderCredential> {
    const expectedRef = STATIC_REFS[request.provider];
    if (request.credential_ref !== null && request.credential_ref !== undefined && request.credential_ref !== expectedRef) {
      throw new AiAdminError("permission_denied", `Unknown credential_ref for static ${request.provider} configuration`, {
        credential_ref: request.credential_ref,
        expected_credential_ref: expectedRef,
        tool: request.tool,
      });
    }

    if (request.provider === "openai") {
      if (!this.config.openai.adminKey) {
        throw new AiAdminError("configuration_error", "OPENAI_ADMIN_KEY is required for OpenAI static credential mode");
      }
      return {
        provider: "openai",
        credential_ref: request.credential_ref ?? expectedRef,
        type: "bearer",
        secret: this.config.openai.adminKey,
      };
    }

    if (request.provider === "elevenlabs") {
      if (!this.config.elevenlabs.apiKey) {
        throw new AiAdminError("configuration_error", "ELEVENLABS_API_KEY is required for ElevenLabs static credential mode");
      }
      return {
        provider: "elevenlabs",
        credential_ref: request.credential_ref ?? expectedRef,
        type: "api_key",
        secret: this.config.elevenlabs.apiKey,
      };
    }

    if (this.config.anthropic.oauthToken) {
      return {
        provider: "anthropic",
        credential_ref: request.credential_ref ?? expectedRef,
        type: "bearer",
        secret: this.config.anthropic.oauthToken,
      };
    }

    if (!this.config.anthropic.adminKey) {
      throw new AiAdminError("configuration_error", "ANTHROPIC_ADMIN_KEY or ANTHROPIC_OAUTH_TOKEN is required for Anthropic static credential mode");
    }

    return {
      provider: "anthropic",
      credential_ref: request.credential_ref ?? expectedRef,
      type: "api_key",
      secret: this.config.anthropic.adminKey,
    };
  }
}
