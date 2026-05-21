export const MONTHLY_CREDIT_LIMIT = 1000;

export const MODEL_CREDIT_BASE = {
  "gemini-2.5-flash-image": 5,
  "gpt-5.4-mini": 10,
  "gemini-3.1-flash-image-preview": 10,
  "gpt-image-2": 20,
  "gemini-3-pro-image-preview": 25,
} as const;

export const RESOLUTION_CREDIT_MULTIPLIER = {
  "512": 0.5,
  "1K": 1,
  "2K": 2,
  "4K": 4,
} as const;

export const ASPECT_RATIO_CREDIT_MULTIPLIER = {
  "1:1": 1,
  "4:3": 1,
  "3:4": 1,
  "16:9": 1.25,
  "9:16": 1.25,
} as const;

export function calculateGenerationCredits(args: {
  model: string;
  resolution?: string | null;
  aspectRatio?: string | null;
}): number {
  const base =
    MODEL_CREDIT_BASE[args.model as keyof typeof MODEL_CREDIT_BASE];
  if (base === undefined) {
    throw new Error(`Unknown model credit cost: ${args.model}`);
  }

  const resolutionMultiplier =
    RESOLUTION_CREDIT_MULTIPLIER[
      (args.resolution ?? "1K") as keyof typeof RESOLUTION_CREDIT_MULTIPLIER
    ] ?? RESOLUTION_CREDIT_MULTIPLIER["1K"];
  const aspectRatioMultiplier =
    ASPECT_RATIO_CREDIT_MULTIPLIER[
      (args.aspectRatio ?? "1:1") as keyof typeof ASPECT_RATIO_CREDIT_MULTIPLIER
    ] ?? ASPECT_RATIO_CREDIT_MULTIPLIER["1:1"];

  return Math.ceil(base * resolutionMultiplier * aspectRatioMultiplier);
}

export function getMonthlyUsageWindow(now = new Date()): {
  periodStart: Date;
  periodEnd: Date;
} {
  const periodStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
  );
  const periodEnd = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1),
  );

  return { periodStart, periodEnd };
}
