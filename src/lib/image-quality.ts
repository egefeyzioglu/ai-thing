export const IMAGE_QUALITY_OPTIONS = [
  "auto",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;

export type ImageQuality = (typeof IMAGE_QUALITY_OPTIONS)[number];

// Quality tiers above "high" were introduced with GPT Image 2.5 and are
// rejected by older OpenAI image models.
export const EXTENDED_IMAGE_QUALITIES: readonly ImageQuality[] = [
  "xhigh",
  "max",
];

const EXTENDED_IMAGE_QUALITY_MODELS: ReadonlySet<string> = new Set([
  "gpt-image-2.5-flare",
  "gpt-image-2.5-sunburst",
]);

export function isExtendedImageQuality(quality: string | null | undefined) {
  return (
    !!quality && (EXTENDED_IMAGE_QUALITIES as readonly string[]).includes(quality)
  );
}

export function modelSupportsImageQuality(
  model: string,
  quality: string | null | undefined,
): boolean {
  if (!isExtendedImageQuality(quality)) return true;
  return EXTENDED_IMAGE_QUALITY_MODELS.has(model);
}
