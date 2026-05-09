import "server-only";

import { PostHog } from "posthog-node";

import { env } from "src/env";

const globalForPostHog = globalThis as unknown as {
  posthogServer: PostHog | undefined;
};

function getPostHogServer() {
  globalForPostHog.posthogServer ??= new PostHog(
    env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN,
    {
      host: env.NEXT_PUBLIC_POSTHOG_API_HOST,
      flushAt: 1,
      flushInterval: 0,
    },
  );

  return globalForPostHog.posthogServer;
}

export async function captureServerException(
  error: unknown,
  additionalProperties?: Record<string, unknown>,
  distinctId?: string,
) {
  try {
    await getPostHogServer().captureExceptionImmediate(
      error,
      distinctId,
      additionalProperties,
    );
  } catch {
    // Never let telemetry failures replace the handled exception.
  }
}
