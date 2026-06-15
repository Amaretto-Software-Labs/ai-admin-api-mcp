import { AiAdminError } from "./errors.js";
import { redactValue, safeErrorMessage } from "./redaction.js";

export interface HttpRequestOptions {
  baseUrl: string;
  path: string;
  headers: Record<string, string>;
  query?: Record<string, unknown>;
  fetchImpl?: typeof fetch | undefined;
}

export interface JsonRequestOptions extends HttpRequestOptions {
  body?: unknown;
}

export function buildUrl(baseUrl: string, path: string, query: Record<string, unknown> = {}): URL {
  const url = new URL(path.replace(/^\//, ""), baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);

  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") {
      continue;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        if (item !== undefined && item !== null && item !== "") {
          url.searchParams.append(key, String(item));
        }
      }
      continue;
    }

    url.searchParams.set(key, String(value));
  }

  return url;
}

export async function getJson<T>(options: HttpRequestOptions): Promise<T> {
  return requestJson<T>("GET", options);
}

export async function postJson<T>(options: JsonRequestOptions): Promise<T> {
  return requestJson<T>("POST", options);
}

async function requestJson<T>(method: "GET" | "POST", options: JsonRequestOptions): Promise<T> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const url = buildUrl(options.baseUrl, options.path, options.query);
  let response: Response;

  try {
    response = await fetchImpl(url, {
      method,
      headers: options.headers,
      ...(method === "POST" ? { body: JSON.stringify(options.body ?? {}) } : {}),
    });
  } catch (error) {
    throw new AiAdminError("provider_unavailable", safeErrorMessage(error), {
      url: `${url.origin}${url.pathname}`,
    });
  }

  if (!response.ok) {
    const body = await readSafeBody(response);
    throw mapHttpError(response.status, body);
  }

  return (await response.json()) as T;
}

async function readSafeBody(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") ?? "";
  try {
    if (contentType.includes("application/json")) {
      return redactValue(await response.json());
    }
    return redactValue(await response.text());
  } catch {
    return null;
  }
}

function mapHttpError(status: number, body: unknown): AiAdminError {
  const details = { status, body };
  if (status === 401 || status === 403) {
    return new AiAdminError(status === 401 ? "auth_failed" : "permission_denied", `Provider returned HTTP ${status}`, details);
  }
  if (status === 429) {
    return new AiAdminError("rate_limited", "Provider rate limit exceeded", details);
  }
  if (status >= 500) {
    return new AiAdminError("provider_unavailable", `Provider returned HTTP ${status}`, details);
  }
  return new AiAdminError("validation_failed", `Provider rejected request with HTTP ${status}`, details);
}
