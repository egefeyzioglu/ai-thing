import { TRPCError } from "@trpc/server";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";

import { MONTHLY_CREDIT_LIMIT } from "src/lib/credits";
import { createTRPCRouter, protectedProcedure } from "src/server/api/trpc";
import { db } from "src/server/db";
import {
  media,
  generationUsage,
  projects,
  prompts,
  referenceImages,
  type MediaType,
} from "src/server/db/schema";
import { signUploadThingUrl, utapi } from "src/server/uploadthing";
import {
  calculateUsageRowCredits,
  getUsedCredits,
  lockUserUsage,
} from "src/server/usage";
import { currentUserCanBypassLimits } from "src/server/limits";
import { cancelSeedanceTask } from "src/server/media/seedance";

export type SupportedModel = {
  slug: string;
  humanName: string;
  provider: string;
  kind: MediaType;
  isArchived: boolean;
};

export const SUPPORTED_MODELS = [
  {
    slug: "gpt-image-2",
    humanName: "GPT Image 2",
    provider: "Open AI",
    kind: "image",
    isArchived: false,
  },
  {
    slug: "gpt-5.4-mini",
    humanName: "GPT 5.4 Mini",
    provider: "Open AI",
    kind: "image",
    isArchived: true,
  },
  {
    slug: "gemini-2.5-flash-image",
    humanName: "Nano Banana",
    provider: "Google",
    kind: "image",
    isArchived: true,
  },
  {
    slug: "gemini-3.1-flash-image-preview",
    humanName: "Nano Banana 2",
    provider: "Google",
    kind: "image",
    isArchived: false,
  },
  {
    slug: "gemini-3-pro-image-preview",
    humanName: "Nano Banana Pro",
    provider: "Google",
    kind: "image",
    isArchived: false,
  },
  {
    slug: "dreamina-seedance-2-0",
    humanName: "Seedance 2.0",
    provider: "Dreamina",
    kind: "video",
    isArchived: false,
  },
  {
    slug: "dreamina-seedance-2-0-fast",
    humanName: "Seedance 2.0 Fast",
    provider: "Dreamina",
    kind: "video",
    isArchived: false,
  },
] as const satisfies SupportedModel[];

type ModelSlug = (typeof SUPPORTED_MODELS)[number]["slug"];

const SUPPORTED_MODEL_BY_SLUG = Object.fromEntries(
  SUPPORTED_MODELS.map((model) => [model.slug, model]),
) as Record<ModelSlug, (typeof SUPPORTED_MODELS)[number]>;

const supportedModelSlugs = SUPPORTED_MODELS.map((m) => m.slug) as unknown as [
  ModelSlug,
  ...ModelSlug[],
];

export const VIDEO_DURATION_OPTIONS = [5, 10] as const;
export type VideoDuration = (typeof VIDEO_DURATION_OPTIONS)[number];

export const VIDEO_RESOLUTION_OPTIONS = ["480p", "720p", "1080p"] as const;
export type VideoResolution = (typeof VIDEO_RESOLUTION_OPTIONS)[number];

export const VIDEO_MOTION_OPTIONS = ["auto", "low", "high"] as const;
export type VideoMotion = (typeof VIDEO_MOTION_OPTIONS)[number];

export const VIDEO_REFERENCE_ROLES = ["first", "last", "refimg"] as const;
export type VideoReferenceRole = (typeof VIDEO_REFERENCE_ROLES)[number];

export const MAX_VIDEO_REFERENCE_IMAGES = 9;

export const promptRouter = createTRPCRouter({
  getModels: protectedProcedure.query(() => {
    return SUPPORTED_MODELS.map((model) => ({
      slug: model.slug,
      name: model.humanName,
      provider: model.provider,
      kind: model.kind,
      isArchived: model.isArchived,
    }));
  }),

  createWithGenerations: protectedProcedure
    .input(
      z.object({
        projectId: z.string().min(1),
        text: z.string().min(1).max(10_1000),
        mode: z.enum(["image", "video"]),
        models: z.array(z.enum(supportedModelSlugs)).min(1),
        repeatCount: z.number().int().min(1).max(8),
        referenceImages: z
          .array(
            z.union([
              z.string(),
              z.object({
                id: z.string().min(1),
                role: z.enum(VIDEO_REFERENCE_ROLES).optional(),
              }),
            ]),
          )
          .optional(),
        resolution: z.string().optional(),
        aspectRatio: z.string().optional(),
        // image-only
        quality: z.enum(["auto", "low", "medium", "high"]).optional(),
        background: z.enum(["auto", "opaque", "transparent"]).optional(),
        negativePrompt: z.string().max(2000).optional(),
        seed: z
          .string()
          .regex(/^\d*$/, "Seed must contain digits only")
          .max(20)
          .optional(),
        thinking: z.enum(["auto", "off", "low", "high"]).optional(),
        // video-only
        duration: z
          .number()
          .int()
          .refine(
            (v): v is VideoDuration =>
              (VIDEO_DURATION_OPTIONS as readonly number[]).includes(v),
          )
          .optional(),
        videoResolution: z.enum(VIDEO_RESOLUTION_OPTIONS).optional(),
        motion: z.enum(VIDEO_MOTION_OPTIONS).optional(),
        cameraFixed: z.boolean().optional(),
        requestQuotaBypass: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // De-dupe in case the client double-checked a model.
      const models = Array.from(new Set(input.models));

      // Normalize referenceImages input to {id, role?} and de-dupe by id
      // (last entry wins so a later role assignment overrides an earlier one).
      const normalizedRefs = (input.referenceImages ?? []).map((raw) =>
        typeof raw === "string" ? { id: raw } : { id: raw.id, role: raw.role },
      );
      const refsById = new Map<
        string,
        { id: string; role?: VideoReferenceRole }
      >();
      for (const r of normalizedRefs) refsById.set(r.id, r);
      const referenceImagesNormalized = Array.from(refsById.values());
      const referenceImageIds = referenceImagesNormalized.map((r) => r.id);

      const inconsistentModels = models.filter(
        (slug) => SUPPORTED_MODEL_BY_SLUG[slug]?.kind !== input.mode,
      );
      if (inconsistentModels.length > 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Selected models do not match output type "${input.mode}": ${inconsistentModels.join(", ")}`,
        });
      }

      if (input.mode === "video") {
        if (input.duration === undefined || input.videoResolution === undefined) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "Video generation requires both duration and videoResolution",
          });
        }
        if (referenceImagesNormalized.length > MAX_VIDEO_REFERENCE_IMAGES) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Video generation accepts at most ${MAX_VIDEO_REFERENCE_IMAGES} reference images`,
          });
        }
        const firstCount = referenceImagesNormalized.filter(
          (r) => r.role === "first",
        ).length;
        const lastCount = referenceImagesNormalized.filter(
          (r) => r.role === "last",
        ).length;
        const refImgCount = referenceImagesNormalized.filter(
          (r) => r.role === "refimg" || r.role === undefined,
        ).length;
        if (firstCount > 1 || lastCount > 1) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "Video generation accepts at most one first frame and one last frame",
          });
        }
        if ((firstCount > 0 || lastCount > 0) && refImgCount > 0) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "First/last frames can't be combined with reference images",
          });
        }
      }

      const [project] = await db
        .select({ id: projects.id })
        .from(projects)
        .where(
          and(eq(projects.id, input.projectId), eq(projects.userId, ctx.user)),
        )
        .limit(1);

      if (!project) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Project not found",
        });
      }

      if (referenceImageIds.length > 0) {
        const ownedReferenceImages = await db
          .select({ id: referenceImages.id })
          .from(referenceImages)
          .where(
            and(
              eq(referenceImages.userId, ctx.user),
              inArray(referenceImages.id, referenceImageIds),
            ),
          );

        if (ownedReferenceImages.length !== referenceImageIds.length) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message:
              "One or more reference images do not belong to the current user",
          });
        }
      }

      const shouldBypassMonthlyQuota = input.requestQuotaBypass
        ? await currentUserCanBypassLimits()
        : false;

      return db.transaction(async (tx) => {
        await lockUserUsage(tx, ctx.user);
        const usedCredits = await getUsedCredits(tx, ctx.user);
        if (!shouldBypassMonthlyQuota && usedCredits >= MONTHLY_CREDIT_LIMIT) {
          throw new TRPCError({
            code: "TOO_MANY_REQUESTS",
            message: "Monthly credit limit reached",
          });
        }

        const isVideo = input.mode === "video";
        const persistedResolution = isVideo
          ? input.videoResolution
          : input.resolution;

        const promptId = crypto.randomUUID();
        const persistedReferenceImages =
          input.mode === "video"
            ? referenceImagesNormalized
            : referenceImageIds;
        const [promptRow] = await tx
          .insert(prompts)
          .values({
            id: promptId,
            userId: ctx.user,
            projectId: input.projectId,
            text: input.text,
            referenceImages: persistedReferenceImages,
            resolution: persistedResolution,
            aspectRatio: input.aspectRatio,
            quality:
              input.quality && input.quality !== "auto" ? input.quality : null,
            background:
              input.background && input.background !== "auto"
                ? input.background
                : null,
            negativePrompt:
              input.negativePrompt?.trim() ? input.negativePrompt.trim() : null,
            seed: input.seed?.trim() ? input.seed.trim() : null,
            thinking:
              input.thinking && input.thinking !== "auto"
                ? input.thinking
                : null,
          })
          .returning();
        if (!promptRow) throw new Error("Failed to insert prompt");

        const mediaValues = Array.from({ length: input.repeatCount }, () =>
          models.map((model) => ({
            id: crypto.randomUUID(),
            userId: ctx.user,
            promptId,
            type: input.mode,
            model,
            mimeType: isVideo ? "video/mp4" : "image/png",
            status: "pending" as const,
            durationMs: isVideo ? input.duration! * 1000 : null,
          })),
        ).flat();
        const mediaRows = await tx
          .insert(media)
          .values(mediaValues)
          .returning();

        await tx.insert(generationUsage).values(
          mediaRows.map((mediaRow) => ({
            id: crypto.randomUUID(),
            userId: ctx.user,
            mediaId: mediaRow.id,
            model: mediaRow.model,
            resolution: persistedResolution,
            aspectRatio: input.aspectRatio,
            credits: calculateUsageRowCredits({
              model: mediaRow.model,
              resolution: input.resolution,
              aspectRatio: input.aspectRatio,
              videoResolution: input.videoResolution,
              duration: input.duration,
            }),
            usageType: isVideo
              ? ("video_generation" as const)
              : ("image_generation" as const),
            status: "reserved" as const,
          })),
        );

        return { ...promptRow, media: mediaRows };
      });
    }),

  deletePrompt: protectedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const [row] = await db
        .select()
        .from(prompts)
        .where(and(eq(prompts.id, input.id), eq(prompts.userId, ctx.user)))
        .limit(1);

      if (!row) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Prompt not found",
        });
      }

      const { keys, runningVideoTaskIds } = await db.transaction(async (tx) => {
        await tx.execute(sql`
          select ${media.id}
          from ${media}
          where ${media.promptId} = ${input.id}
            and ${media.userId} = ${ctx.user}
          for update
        `);

        // Collect UploadThing keys for every generated media item that isn't
        // reused before the cascade-delete wipes the rows.
        const mediaRows = await tx
          .select({
            id: media.id,
            key: media.key,
            providerStatus: media.providerStatus,
            status: media.status,
            type: media.type,
            reusedBy: referenceImages.reusedFromMediaId,
          })
          .from(media)
          .leftJoin(
            referenceImages,
            eq(media.id, referenceImages.reusedFromMediaId),
          )
          .where(and(eq(media.promptId, input.id), eq(media.userId, ctx.user)));

        const mediaIds = mediaRows.map((r) => r.id);
        const runningVideoTaskIds = mediaRows
          .filter(
            (r) =>
              r.type === "video" && r.status === "running" && r.providerStatus,
          )
          .map((r) => r.providerStatus)
          .filter((taskId): taskId is string => !!taskId);

        if (mediaIds.length > 0) {
          await tx
            .update(generationUsage)
            .set({ status: "refunded", updatedAt: new Date() })
            .where(
              and(
                eq(generationUsage.userId, ctx.user),
                eq(generationUsage.status, "reserved"),
                inArray(generationUsage.mediaId, mediaIds),
              ),
            );
        }

        const keys = mediaRows
          .filter((r) => !r.reusedBy)
          .map((r) => r.key)
          .filter((k): k is string => !!k);

        // The `onDelete: "cascade"` on images.promptId handles child rows.
        // The `onDelete: "set null" on referenceImages.reused_from handles
        // dangling references.
        await tx
          .delete(prompts)
          .where(and(eq(prompts.id, input.id), eq(prompts.userId, ctx.user)));

        return { keys, runningVideoTaskIds };
      });

      await Promise.all(
        runningVideoTaskIds.map((taskId) =>
          cancelSeedanceTask(taskId).catch((error) => {
            console.error(
              `Failed to cancel video task ${taskId} for prompt ${input.id}`,
              error,
            );
          }),
        ),
      );

      if (keys.length > 0) {
        await utapi.deleteFiles(keys).catch((r) => {
          console.error(
            `Failed to delete some files from UploadThing for image ${input.id}`,
            r,
          );
        });
      }

      return { success: true };
    }),

  movePrompt: protectedProcedure
    .input(z.object({ id: z.string().min(1), projectId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const [prompt] = await db
        .select()
        .from(prompts)
        .where(and(eq(prompts.id, input.id), eq(prompts.userId, ctx.user)))
        .limit(1);

      if (!prompt) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Prompt not found",
        });
      }

      const [project] = await db
        .select({ id: projects.id })
        .from(projects)
        .where(
          and(eq(projects.id, input.projectId), eq(projects.userId, ctx.user)),
        )
        .limit(1);

      if (!project) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Project not found",
        });
      }

      if (prompt.projectId === input.projectId) return prompt;

      const [updatedPrompt] = await db
        .update(prompts)
        .set({ projectId: input.projectId })
        .where(and(eq(prompts.id, input.id), eq(prompts.userId, ctx.user)))
        .returning();

      if (!updatedPrompt) throw new Error("Failed to move prompt");
      return updatedPrompt;
    }),

  list: protectedProcedure
    .input(z.object({ projectId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const [project] = await db
        .select({ id: projects.id })
        .from(projects)
        .where(
          and(eq(projects.id, input.projectId), eq(projects.userId, ctx.user)),
        )
        .limit(1);

      if (!project) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Project not found",
        });
      }

      const results = await db.query.prompts.findMany({
        where: and(
          eq(prompts.userId, ctx.user),
          eq(prompts.projectId, input.projectId),
        ),
        orderBy: [desc(prompts.createdAt)],
        with: {
          media: {
            where: eq(media.userId, ctx.user),
          },
        },
      });

      return Promise.all(
        results.map(async (prompt) => ({
          ...prompt,
          media: await Promise.all(
            prompt.media.map(async (mediaItem) => {
              if (mediaItem.url !== null) {
                try {
                  mediaItem.url = await signUploadThingUrl(mediaItem.url);
                } catch {
                  console.log(
                    `[prompts.list] could not sign upload URL for media ${mediaItem.id}`,
                  );
                  throw new TRPCError({
                    code: "INTERNAL_SERVER_ERROR",
                    message: "Could not sign upload URL",
                  });
                }
              }
              return mediaItem;
            }),
          ),
        })),
      );
    }),
});
