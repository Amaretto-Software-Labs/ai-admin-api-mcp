import { toAiAdminError } from "@ai-admin-api-mcp/core";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export function jsonToolResult(value: unknown): CallToolResult {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(value, null, 2),
      },
    ],
    structuredContent: value as Record<string, unknown>,
  };
}

export function errorToolResult(error: unknown): CallToolResult {
  const safe = toAiAdminError(error);
  return {
    isError: true,
    content: [
      {
        type: "text",
        text: JSON.stringify({ error: { code: safe.code, message: safe.message, details: safe.details } }, null, 2),
      },
    ],
    structuredContent: {
      error: {
        code: safe.code,
        message: safe.message,
        details: safe.details,
      },
    },
  };
}

export async function asToolResult(run: () => Promise<unknown>): Promise<CallToolResult> {
  try {
    return jsonToolResult(await run());
  } catch (error) {
    return errorToolResult(error);
  }
}

