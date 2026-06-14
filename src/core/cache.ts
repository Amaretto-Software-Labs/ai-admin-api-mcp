import type { CacheInfo, CacheStatus } from "./types.js";

export interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export class TtlCache<T> {
  private readonly entries = new Map<string, CacheEntry<T>>();

  get(key: string, now: Date = new Date()): T | null {
    const entry = this.entries.get(key);
    if (entry === undefined) {
      return null;
    }

    if (entry.expiresAt <= now.getTime()) {
      this.entries.delete(key);
      return null;
    }

    return entry.value;
  }

  set(key: string, value: T, ttlSeconds: number, now: Date = new Date()): void {
    if (ttlSeconds <= 0) {
      return;
    }

    this.entries.set(key, {
      value,
      expiresAt: now.getTime() + ttlSeconds * 1000,
    });
  }

  clear(): void {
    this.entries.clear();
  }
}

export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${stableStringify(nested)}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
}

export function makeCacheKey(parts: Record<string, unknown>): string {
  return stableStringify(parts);
}

export function withCacheStatus<T extends { cache: CacheInfo }>(value: T, status: CacheStatus, ttlSeconds: number): T {
  return {
    ...value,
    cache: {
      status,
      ttl_seconds: ttlSeconds,
    },
  };
}
