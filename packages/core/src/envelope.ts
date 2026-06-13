import { nowIso } from "./time.js";
import type { CacheInfo, ProviderId, TimeRange, ToolEnvelope, Warning } from "./types.js";

const DEFAULT_CACHE: CacheInfo = {
  status: "disabled",
  ttl_seconds: null,
};

export function envelope<TData, TRaw = unknown>(params: {
  provider: ProviderId | "multiple";
  tool: string;
  data: TData;
  time_range?: TimeRange | null;
  warnings?: Warning[];
  raw?: TRaw | null;
  cache?: CacheInfo;
  now?: Date;
}): ToolEnvelope<TData, TRaw> {
  return {
    provider: params.provider,
    tool: params.tool,
    queried_at: nowIso(params.now),
    time_range: params.time_range ?? null,
    cache: params.cache ?? DEFAULT_CACHE,
    warnings: params.warnings ?? [],
    data: params.data,
    raw: params.raw ?? null,
  };
}

