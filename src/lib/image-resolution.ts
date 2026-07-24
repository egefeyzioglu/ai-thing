export const IMAGE_RESOLUTION_OPTIONS = ["512", "1K", "2K", "4K"] as const;

export type ImageResolution = (typeof IMAGE_RESOLUTION_OPTIONS)[number];

export const MODEL_IMAGE_RESOLUTIONS: Readonly<
  Partial<Record<string, readonly ImageResolution[]>>
> = {
  "gpt-image-2": ["1K", "2K", "4K"],
  "gpt-5.4-mini": ["1K", "2K", "4K"],
  "dola-seedream-5-0-lite": ["2K", "4K"],
  "dola-seedream-5-0-pro": ["1K", "2K"],
};

const RESOLUTION_PIXELS: Record<ImageResolution, number> = {
  "512": 512,
  "1K": 1024,
  "2K": 2048,
  "4K": 4096,
};

export function getEffectiveImageResolution(
  model: string,
  requestedResolution: string | null | undefined,
): string | undefined {
  if (!requestedResolution) return undefined;

  const supportedResolutions = MODEL_IMAGE_RESOLUTIONS[model];
  if (!supportedResolutions?.length) return requestedResolution;
  if (
    supportedResolutions.includes(requestedResolution as ImageResolution)
  ) {
    return requestedResolution;
  }

  const requestedPixels =
    RESOLUTION_PIXELS[requestedResolution as ImageResolution];
  if (!requestedPixels) return requestedResolution;

  return supportedResolutions.reduce((closest, candidate) => {
    const closestDistance = Math.abs(
      RESOLUTION_PIXELS[closest] - requestedPixels,
    );
    const candidateDistance = Math.abs(
      RESOLUTION_PIXELS[candidate] - requestedPixels,
    );
    return candidateDistance < closestDistance ||
      (candidateDistance === closestDistance &&
        RESOLUTION_PIXELS[candidate] > RESOLUTION_PIXELS[closest])
      ? candidate
      : closest;
  });
}
