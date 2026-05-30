import { PostHog } from "posthog-node";

import { env } from "src/env";

let posthogClient: PostHog | null = null;

export function getPostHogClient(): PostHog {
  posthogClient ??= new PostHog(env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN, {
    host: env.NEXT_PUBLIC_POSTHOG_API_HOST,
  });
  return posthogClient;
}
