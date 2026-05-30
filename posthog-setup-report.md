<wizard-report>
# PostHog post-wizard report

The wizard has completed a deep integration of PostHog analytics into AI Thing, an AI image generation app. Here's what was implemented:

- **User identification**: `src/app/providers.tsx` was updated to identify Clerk users with PostHog on sign-in (using `posthog.identify()` with Clerk user ID, email, and name) and reset on sign-out. Error tracking was enabled via `capture_exceptions: true`.
- **Client-side event tracking**: 8 events added across the main generation page and workshop page using `posthog-js`.
- **Server-side event tracking**: 4 events added using `posthog-node` in tRPC router mutations for project management and image generation. A shared `src/lib/posthog-server.ts` client was created.
- **Environment variables**: `.env.local` was updated with `NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN`, `NEXT_PUBLIC_POSTHOG_API_HOST`, and `NEXT_PUBLIC_POSTHOG_UI_HOST`.

> **Important**: Install `posthog-node` before deploying server-side events: `pnpm add posthog-node`

## Events instrumented

| Event | Description | File |
|-------|-------------|------|
| `image_generation_started` | Fired when the user clicks Generate and the API call begins. Tracks model count, resolution, aspect ratio, run count, and whether reference images were used. | `src/app/page.tsx` |
| `image_generation_completed` | Fired after all image generation tasks in a batch resolve. Tracks succeeded/failed counts. | `src/app/page.tsx` |
| `image_retry_started` | Fired when the user requests a retry on a failed image. | `src/app/page.tsx` |
| `reference_image_uploaded` | Fired after one or more reference images are successfully uploaded from disk. | `src/app/page.tsx` |
| `generated_image_reused_as_reference` | Fired when the user reuses a generated image as a reference image. | `src/app/page.tsx` |
| `workshop_message_sent` | Fired when the user submits a message to the prompt workshop. Tracks model and reasoning effort. | `src/app/workshop/page.tsx` |
| `workshop_suggested_prompt_used` | Fired when the user accepts an AI-suggested prompt from the workshop. | `src/app/workshop/page.tsx` |
| `workshop_thread_deleted` | Fired after a workshop thread is successfully deleted. | `src/app/workshop/page.tsx` |
| `project_created` | Server-side event fired when a user creates a new project. | `src/server/api/routers/project.ts` |
| `project_renamed` | Server-side event fired when a user renames a project. | `src/server/api/routers/project.ts` |
| `image_generation_succeeded` | Server-side event fired when an individual image generation succeeds. Tracks model and provider. | `src/server/api/routers/image.ts` |
| `image_generation_failed` | Server-side event fired when an individual image generation fails. Tracks model and error message. | `src/server/api/routers/image.ts` |

## Next steps

We've built some insights and a dashboard for you to keep an eye on user behavior, based on the events we just instrumented:

- [Analytics basics dashboard](/dashboard/1647706)
- [Image generations over time](/insights/DrdOOhrd) — Unique users generating images per day
- [Generation success vs failure rate](/insights/uqTldjRq) — Succeeded vs failed generation counts
- [Workshop to image generation funnel](/insights/vxwiP2yY) — Conversion from workshop prompt refinement to image generation
- [Reference image usage](/insights/6XN9WcwO) — Uploads and reuse of reference images over time
- [Workshop vs direct generation activity](/insights/IwDwBQNK) — DAU comparison between workshop and direct generation

### Agent skill

We've left an agent skill folder in your project at `.claude/skills/integration-nextjs-app-router/`. You can use this context for further agent development when using Claude Code. This will help ensure the model provides the most up-to-date approaches for integrating PostHog.

</wizard-report>
