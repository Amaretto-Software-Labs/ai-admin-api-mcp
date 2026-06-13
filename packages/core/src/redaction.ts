const SENSITIVE_KEY_PATTERNS = [
  /authorization/i,
  /^x-api-key$/i,
  /^api[_-]?key$/i,
  /api[_-]?key[_-]?(secret|token|value)$/i,
  /secret/i,
  /token/i,
  /credential/i,
  /^auth$/i,
];

const TOKEN_LIKE_PATTERN = /\b(sk-[A-Za-z0-9_-]{12,}|sk-ant-[A-Za-z0-9_-]{12,}|Bearer\s+[A-Za-z0-9._~+/=-]{12,})\b/g;

export function redactString(value: string): string {
  return value.replace(TOKEN_LIKE_PATTERN, "[REDACTED]");
}

export function redactValue(value: unknown): unknown {
  if (typeof value === "string") {
    return redactString(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item));
  }

  if (value !== null && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) {
      output[key] = SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(key))
        ? "[REDACTED]"
        : redactValue(nested);
    }
    return output;
  }

  return value;
}

export function safeErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return redactString(error.message);
  }
  return redactString(String(error));
}
