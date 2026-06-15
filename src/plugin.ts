import type { ServerConfig } from "./config.js";
import type { CredentialRequest, DashboardBundle, ProviderCapability, ProviderCredential, ProviderId, QueryContext, ToolEnvelope } from "./core/index.js";

export interface ProviderPluginContext {
  config: ServerConfig;
}

export interface ProviderToolRegistrar {
  registerTool(
    name: string,
    config: ProviderToolConfig,
    callback: ProviderToolCallback,
  ): void;
}

export interface ProviderToolConfig {
  title?: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  annotations?: Record<string, unknown>;
  _meta?: Record<string, unknown>;
}

export type ProviderToolCallback = (args: unknown, extra: unknown) => unknown | Promise<unknown>;

export interface ProviderResourceRegistrar {
  registerJsonResource(name: string, uri: string, value: unknown | (() => unknown)): void;
}

export interface ProviderRuntime {
  id: ProviderId;
  displayName: string;
  version: string;
  configured: boolean;
  required: boolean;
  capabilities(): ProviderCapability;
  registerTools?(registrar: ProviderToolRegistrar, context: () => QueryContext): void;
  registerResources?(registrar: ProviderResourceRegistrar): void;
  queryUsage?(input: Record<string, unknown>, context: QueryContext): Promise<ToolEnvelope<unknown>>;
  queryCosts?(input: Record<string, unknown>, context: QueryContext): Promise<ToolEnvelope<unknown>>;
  queryDashboardBundle?(input: Record<string, unknown>, context: QueryContext): Promise<ToolEnvelope<DashboardBundle>>;
}

export interface AiAdminProviderPlugin {
  apiVersion: "1";
  id: ProviderId;
  displayName: string;
  inferEnabled?(context: ProviderPluginContext): boolean;
  createProvider(context: ProviderPluginContext): ProviderRuntime;
  resolveStaticCredential?(
    request: CredentialRequest,
    context: ProviderPluginContext,
  ): ProviderCredential | null | Promise<ProviderCredential | null>;
}

export function isAiAdminProviderPlugin(value: unknown): value is AiAdminProviderPlugin {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<AiAdminProviderPlugin>;
  return candidate.apiVersion === "1"
    && typeof candidate.id === "string"
    && candidate.id.length > 0
    && typeof candidate.displayName === "string"
    && candidate.displayName.length > 0
    && typeof candidate.createProvider === "function";
}
