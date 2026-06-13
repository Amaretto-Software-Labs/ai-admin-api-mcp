import * as z from "zod/v4";

export const bucketWidthSchema = z.enum(["1m", "1h", "1d"]);

export const timeRangeInputSchema = {
  start: z.string().datetime({ offset: true }).describe("Inclusive UTC ISO start timestamp."),
  end: z.string().datetime({ offset: true }).describe("Exclusive UTC ISO end timestamp."),
  bucket_width: bucketWidthSchema.default("1d"),
};

export const commonQueryInputSchema = {
  credential_ref: z.string().optional().nullable(),
  ...timeRangeInputSchema,
  limit: z.number().int().positive().optional().nullable(),
  max_pages: z.number().int().positive().max(100).default(20),
  include_raw: z.boolean().default(false),
};

export const warningSchema = z.object({
  code: z.string(),
  message: z.string(),
  details: z.record(z.string(), z.unknown()).optional(),
});

export const moneyAmountSchema = z.object({
  value: z.number(),
  currency: z.string(),
  source_unit: z.enum(["major", "minor", "unknown"]),
  raw_value: z.union([z.string(), z.number()]).nullable(),
});

