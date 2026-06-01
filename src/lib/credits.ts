export const MONTHLY_CREDIT_LIMIT = 1000;

export const MODEL_CREDIT_BASE = {
  "gemini-2.5-flash-image": 5,
  "gpt-5.4-mini": 10,
  "gemini-3.1-flash-image-preview": 10,
  "gpt-image-2": 20,
  "gemini-3-pro-image-preview": 25,
} as const;

export const VIDEO_MODEL_CREDIT_PER_SECOND = {
  "dreamina-seedance-2-0": 9,
  "dreamina-seedance-2-0-fast": 5,
} as const;

export const RESOLUTION_CREDIT_MULTIPLIER = {
  "512": 0.5,
  "1K": 1,
  "2K": 2,
  "4K": 4,
} as const;

export const VIDEO_RESOLUTION_CREDIT_MULTIPLIER = {
  "480p": 1,
  "720p": 1.8,
  "1080p": 3,
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
  if (args.model in VIDEO_MODEL_CREDIT_PER_SECOND) {
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
  const perSecond =
    VIDEO_MODEL_CREDIT_PER_SECOND[
      args.model as keyof typeof VIDEO_MODEL_CREDIT_PER_SECOND
    ];
  if (perSecond === undefined) {
    throw new Error(`Unknown video model credit cost: ${args.model}`);
  }

  const duration = args.duration ?? 5;
  const videoResolution = args.videoResolution ?? "720p";
  if (!(videoResolution in VIDEO_RESOLUTION_CREDIT_MULTIPLIER)) {
    throw new Error(
      `Unknown video resolution credit multiplier: ${videoResolution}`,
    );
  }
  const resolutionMultiplier =
    VIDEO_RESOLUTION_CREDIT_MULTIPLIER[
      videoResolution as keyof typeof VIDEO_RESOLUTION_CREDIT_MULTIPLIER
    ];

  return Math.ceil(perSecond * duration * resolutionMultiplier);
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
