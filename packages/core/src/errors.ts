import { redactValue, safeErrorMessage } from "./redaction.js";

export type AiAdminErrorCode =
  | "auth_failed"
  | "permission_denied"
  | "rate_limited"
  | "validation_failed"
  | "provider_unavailable"
  | "partial_result"
  | "configuration_error"
  | "internal_error";

export class AiAdminError extends Error {
  readonly code: AiAdminErrorCode;
  readonly details: Record<string, unknown>;

  constructor(code: AiAdminErrorCode, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "AiAdminError";
    this.code = code;
    this.details = details;
  }
}

export function toAiAdminError(error: unknown): AiAdminError {
  if (error instanceof AiAdminError) {
    return new AiAdminError(error.code, safeErrorMessage(error), redactValue(error.details) as Record<string, unknown>);
  }

  if (error instanceof Error) {
    return new AiAdminError("internal_error", safeErrorMessage(error));
  }

  return new AiAdminError("internal_error", "Unknown error");
}

export function assertNever(value: never): never {
  throw new AiAdminError("internal_error", `Unhandled value: ${String(value)}`);
}
