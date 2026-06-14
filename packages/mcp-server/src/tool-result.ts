import { toAiAdminError } from "@ai-admin-api-mcp/core";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export function jsonToolResult(value: unknown): CallToolResult {
  const structuredContent = toStructuredContent(value);
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(summarizeStructuredContent(structuredContent)),
      },
    ],
    structuredContent,
  };
}

export function errorToolResult(error: unknown): CallToolResult {
  const safe = toAiAdminError(error);
  return {
    isError: true,
    content: [
      {
        type: "text",
        text: JSON.stringify({ error: { code: safe.code, message: safe.message } }),
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

function toStructuredContent(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : { value };
}

function summarizeStructuredContent(value: Record<string, unknown>): Record<string, unknown> {
  const summary: Record<string, unknown> = {
    summary: "Structured payload returned in structuredContent.",
    result_bytes: Buffer.byteLength(JSON.stringify(value), "utf8"),
  };
  if (typeof value.provider === "string") {
    summary.provider = value.provider;
  }
  if (typeof value.tool === "string") {
    summary.tool = value.tool;
  }
  if (isRecord(value.data)) {
    summary.data_keys = Object.keys(value.data);
  }
  if (Array.isArray(value.warnings)) {
    summary.warning_count = value.warnings.length;
  }
  return summary;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
