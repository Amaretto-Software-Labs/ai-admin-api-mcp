import { AiAdminError } from "./errors.js";
import type { BucketWidth, TimeRange } from "./types.js";

export interface RangeLimits {
  maxRangeDays?: number;
  minuteMaxHours?: number;
  hourlyMaxDays?: number;
  dailyMaxDays?: number;
}

const ISO_UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

export function nowIso(now: Date = new Date()): string {
  return now.toISOString();
}

export function parseIsoUtc(value: string, fieldName: string): Date {
  if (!ISO_UTC_PATTERN.test(value)) {
    throw new AiAdminError("validation_failed", `${fieldName} must be an ISO-8601 UTC timestamp`, {
      field: fieldName,
      value,
      expected: "YYYY-MM-DDTHH:mm:ssZ",
    });
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new AiAdminError("validation_failed", `${fieldName} is not a valid timestamp`, {
      field: fieldName,
      value,
    });
  }

  return date;
}

export function toUnixSeconds(value: string): number {
  return Math.floor(parseIsoUtc(value, "timestamp").getTime() / 1000);
}

export function fromUnixSeconds(value: number): string {
  return new Date(value * 1000).toISOString();
}

export function validateTimeRange(range: TimeRange, limits: RangeLimits = {}): TimeRange {
  const start = parseIsoUtc(range.start, "start");
  const end = parseIsoUtc(range.end, "end");

  if (end.getTime() <= start.getTime()) {
    throw new AiAdminError("validation_failed", "end must be after start", {
      start: range.start,
      end: range.end,
    });
  }

  const hours = (end.getTime() - start.getTime()) / 3_600_000;
  const days = hours / 24;

  if (limits.maxRangeDays !== undefined && days > limits.maxRangeDays) {
    throw new AiAdminError("validation_failed", `time range cannot exceed ${limits.maxRangeDays} days`, {
      max_range_days: limits.maxRangeDays,
      actual_days: days,
    });
  }

  if (range.bucket_width === "1m" && limits.minuteMaxHours !== undefined && hours > limits.minuteMaxHours) {
    throw new AiAdminError("validation_failed", `1m bucket range cannot exceed ${limits.minuteMaxHours} hours`, {
      max_hours: limits.minuteMaxHours,
      actual_hours: hours,
    });
  }

  if (range.bucket_width === "1h" && limits.hourlyMaxDays !== undefined && days > limits.hourlyMaxDays) {
    throw new AiAdminError("validation_failed", `1h bucket range cannot exceed ${limits.hourlyMaxDays} days`, {
      max_days: limits.hourlyMaxDays,
      actual_days: days,
    });
  }

  if (range.bucket_width === "1d" && limits.dailyMaxDays !== undefined && days > limits.dailyMaxDays) {
    throw new AiAdminError("validation_failed", `1d bucket range cannot exceed ${limits.dailyMaxDays} days`, {
      max_days: limits.dailyMaxDays,
      actual_days: days,
    });
  }

  return range;
}

export function lastCompleteDaysRange(now: Date, days: number, bucket_width: BucketWidth = "1d"): TimeRange {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const start = new Date(end.getTime() - days * 24 * 3_600_000);
  return {
    start: start.toISOString(),
    end: end.toISOString(),
    bucket_width,
  };
}

