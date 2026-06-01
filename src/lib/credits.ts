export const MONTHLY_CREDIT_LIMIT = 1000;

export const MODEL_CREDIT_BASE = {
  "gemini-2.5-flash-image": 5,
  "gpt-5.4-mini": 10,
  "gemini-3.1-flash-image-preview": 10,
  "gpt-image-2": 20,
  "gemini-3-pro-image-preview": 25,
} as const;

// USD per video at 16:9, 5s output, no reference-video input — sourced from
// Modelark's "Price examples" table. We treat 1 credit ≈ 1 USD cent (so
// $0.76 → 76 credits for a 5s 720p Seedance 2.0 video), scale linearly with
// duration, and ignore aspect-ratio variance (the table only gives 16:9
// numbers; using them across aspects gives a conservative upper bound).
const VIDEO_BASE_USD_PER_5S_SEGMENT = {
  "dreamina-seedance-2-0": {
    "480p": 0.35,
    "720p": 0.76,
    "1080p": 1.87,
  },
  "dreamina-seedance-2-0-fast": {
    "480p": 0.28,
    "720p": 0.6,
    // 1080p not supported by 2.0 Fast.
  },
} as const;

const CREDITS_PER_USD = 100;
const BASE_SEGMENT_SECONDS = 5;

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
  videoResolution?: string | null;
  duration?: number | null;
}): number {
  if (args.model in VIDEO_BASE_USD_PER_5S_SEGMENT) {
    return calculateVideoGenerationCredits({
      model: args.model,
      videoResolution: args.videoResolution,
      duration: args.duration,
    });
  }
  if (args.model in MODEL_CREDIT_BASE) {
    return calculateImageGenerationCredits({
      model: args.model,
      resolution: args.resolution,
      aspectRatio: args.aspectRatio,
    });
  }
  throw new Error(`Unknown model credit cost: ${args.model}`);
}

function calculateImageGenerationCredits(args: {
  model: string;
  resolution?: string | null;
  aspectRatio?: string | null;
}): number {
  const base =
    MODEL_CREDIT_BASE[args.model as keyof typeof MODEL_CREDIT_BASE];
  if (base === undefined) {
    throw new Error(`Unknown model credit cost: ${args.model}`);
  }

  const resolution = args.resolution ?? "1K";
  if (!(resolution in RESOLUTION_CREDIT_MULTIPLIER)) {
    throw new Error(`Unknown resolution credit multiplier: ${resolution}`);
  }
  const resolutionMultiplier =
    RESOLUTION_CREDIT_MULTIPLIER[
      resolution as keyof typeof RESOLUTION_CREDIT_MULTIPLIER
    ];

  const aspectRatio = args.aspectRatio ?? "1:1";
  if (!(aspectRatio in ASPECT_RATIO_CREDIT_MULTIPLIER)) {
    throw new Error(`Unknown aspect ratio credit multiplier: ${aspectRatio}`);
  }
  const aspectRatioMultiplier =
    ASPECT_RATIO_CREDIT_MULTIPLIER[
      aspectRatio as keyof typeof ASPECT_RATIO_CREDIT_MULTIPLIER
    ];

  return Math.ceil(base * resolutionMultiplier * aspectRatioMultiplier);
}

function calculateVideoGenerationCredits(args: {
  model: string;
  videoResolution?: string | null;
  duration?: number | null;
}): number {
  const pricing =
    VIDEO_BASE_USD_PER_5S_SEGMENT[
      args.model as keyof typeof VIDEO_BASE_USD_PER_5S_SEGMENT
    ];
  if (!pricing) {
    throw new Error(`Unknown video model credit cost: ${args.model}`);
  }

  const videoResolution = args.videoResolution ?? "720p";
  const baseUsd = pricing[videoResolution as keyof typeof pricing];
  if (baseUsd === undefined) {
    throw new Error(
      `Unsupported video resolution for ${args.model}: ${videoResolution}`,
    );
  }

  const duration = args.duration ?? BASE_SEGMENT_SECONDS;
  return Math.ceil((baseUsd * CREDITS_PER_USD * duration) / BASE_SEGMENT_SECONDS);
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
