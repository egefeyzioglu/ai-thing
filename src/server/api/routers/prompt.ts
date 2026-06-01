import { TRPCError } from "@trpc/server";
import { and, desc, eq, inArray } from "drizzle-orm";
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
} from "src/server/db/schema";
import { signUploadThingUrl, utapi } from "src/server/uploadthing";
import {
  calculateUsageRowCredits,
  getUsedCredits,
  lockUserUsage,
} from "src/server/usage";
import { currentUserCanBypassLimits } from "src/server/limits";

export type SupportedModel = {
  slug: string;
  humanName: string;
  provider: string;
  isArchived: boolean;
};

export const SUPPORTED_MODELS = [
  {
    slug: "gpt-image-2",
    humanName: "GPT Image 2",
    provider: "Open AI",
    isArchived: false,
  },
  {
    slug: "gpt-5.4-mini",
    humanName: "GPT 5.4 Mini",
    provider: "Open AI",
    isArchived: true,
  },
  {
    slug: "gemini-2.5-flash-image",
    humanName: "Nano Banana",
    provider: "Google",
    isArchived: true,
  },
  {
    slug: "gemini-3.1-flash-image-preview",
    humanName: "Nano Banana 2",
    provider: "Google",
    isArchived: false,
  },
  {
    slug: "gemini-3-pro-image-preview",
    humanName: "Nano Banana Pro",
    provider: "Google",
    isArchived: false,
  },
] as const satisfies SupportedModel[];

type ModelSlug = (typeof SUPPORTED_MODELS)[number]["slug"];

const supportedModelSlugs = SUPPORTED_MODELS.map((m) => m.slug) as unknown as [
  ModelSlug,
  ...ModelSlug[],
];

export const promptRouter = createTRPCRouter({
  getModels: protectedProcedure.query(() => {
    return SUPPORTED_MODELS.map((model) => ({
      slug: model.slug,
      name: model.humanName,
      provider: model.provider,
      isArchived: model.isArchived,
    }));
  }),

  createWithGenerations: protectedProcedure
    .input(
      z.object({
        projectId: z.string().min(1),
        text: z.string().min(1).max(10_1000),
        models: z.array(z.enum(supportedModelSlugs)).min(1),
        repeatCount: z.number().int().min(1).max(8),
        referenceImages: z.array(z.string()).optional(),
        resolution: z.string().optional(),
        aspectRatio: z.string().optional(),
        quality: z.enum(["auto", "low", "medium", "high"]).optional(),
        background: z.enum(["auto", "opaque", "transparent"]).optional(),
        negativePrompt: z.string().max(2000).optional(),
        seed: z
          .string()
          .regex(/^\d*$/, "Seed must contain digits only")
          .max(20)
          .optional(),
        thinking: z.enum(["auto", "off", "low", "high"]).optional(),
        requestQuotaBypass: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // De-dupe in case the client double-checked a model.
      const models = Array.from(new Set(input.models));
      const referenceImageIds = Array.from(
        new Set(input.referenceImages ?? []),
      );

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

        const promptId = crypto.randomUUID();
        const [promptRow] = await tx
          .insert(prompts)
          .values({
            id: promptId,
            userId: ctx.user,
            projectId: input.projectId,
            text: input.text,
            referenceImages: referenceImageIds,
            resolution: input.resolution,
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
            type: "image" as const,
            model,
            mimeType: "image/png",
            status: "pending" as const,
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
            resolution: input.resolution,
            aspectRatio: input.aspectRatio,
            credits: calculateUsageRowCredits({
              model: mediaRow.model,
              resolution: input.resolution,
              aspectRatio: input.aspectRatio,
            }),
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

      // Collect UploadThing keys for every generated media item that isn't reused
      // so we can remove the files before the cascade-delete wipes the rows.
      const mediaRows = await db
        .select({ key: media.key, reusedBy: referenceImages.reusedFromMediaId })
        .from(media)
        .leftJoin(referenceImages, eq(media.id, referenceImages.reusedFromMediaId))
        .where(and(eq(media.promptId, input.id), eq(media.userId, ctx.user)));

      const keys = mediaRows
        .filter((r) => !r.reusedBy)
        .map((r) => r.key)
        .filter((k): k is string => !!k);

      if (keys.length > 0) {
        await utapi.deleteFiles(keys).catch((r) => {
          console.error(
            `Failed to delete some files from UploadThing for image ${input.id}`,
            r,
          );
        });
      }

      // The `onDelete: "cascade"` on images.promptId handles child rows.
      // The `onDelete: "set null" on referenceImages.reused_from handles
      // dangling references
      await db
        .delete(prompts)
        .where(and(eq(prompts.id, input.id), eq(prompts.userId, ctx.user)));

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
