import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function captureHandledException(
  error: unknown,
  additionalProperties?: Record<string, unknown>,
) {
  if (typeof window === "undefined") return;

  void import("posthog-js")
    .then(({ default: posthog }) => {
      posthog.captureException(error, additionalProperties);
    })
    .catch(() => {
      // Never let telemetry failures change the handled-error path.
    });
}

export function extensionFor(mimeType?: string | null, defaultValue?: string): string {
  switch (mimeType?.toLowerCase()) {
    case "image/jpg":
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    default:
      if(defaultValue !== null && defaultValue !== undefined) return defaultValue;
      throw new Error(`Unknown MIME type ${mimeType}`);
  }
}
