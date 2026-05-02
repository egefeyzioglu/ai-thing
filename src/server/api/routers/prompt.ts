import { TRPCError } from "@trpc/server";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { createTRPCRouter, protectedProcedure } from "src/server/api/trpc";
import { db } from "src/server/db";
import { images, prompts, referenceImages } from "src/server/db/schema";
import { utapi } from "src/server/uploadthing";

export const SUPPORTED_MODELS = [
  "gpt-5.4-mini",
  "gemini-2.5-flash-image",
] as const;

export const promptRouter = createTRPCRouter({
  createWithGenerations: protectedProcedure
    .input(
      z.object({
        text: z.string().min(1).max(1000),
        models: z.array(z.enum(SUPPORTED_MODELS)).min(1),
        repeatCount: z.number().int().min(1).max(8),
        referenceImages: z.array(z.string()).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // De-dupe in case the client double-checked a model.
      const models = Array.from(new Set(input.models));
      const referenceImageIds = Array.from(
        new Set(input.referenceImages ?? []),
      );

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

      return db.transaction(async (tx) => {
        const promptId = crypto.randomUUID();
        const [promptRow] = await tx
          .insert(prompts)
          .values({
            id: promptId,
            userId: ctx.user,
            text: input.text,
            referenceImages: referenceImageIds,
          })
          .returning();
        if (!promptRow) throw new Error("Failed to insert prompt");

        const imageRows = await tx
          .insert(images)
          .values(
            Array.from({ length: input.repeatCount }, () =>
              models.map((model) => ({
                id: crypto.randomUUID(),
                userId: ctx.user,
                promptId,
                model,
                status: "pending" as const,
              })),
            ).flat(),
          )
          .returning();

        return { ...promptRow, images: imageRows };
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

      // Collect UploadThing keys for every generated image so we can
      // remove the files before the cascade-delete wipes the rows.
      const imageRows = await db
        .select({ key: images.key })
        .from(images)
        .where(
          and(eq(images.promptId, input.id), eq(images.userId, ctx.user)),
        );

      const keys = imageRows
        .map((r) => r.key)
        .filter((k): k is string => !!k);

      if (keys.length > 0) {
        try {
          await utapi.deleteFiles(keys);
        } catch {
          // Best-effort cleanup — still delete the DB rows.
        }
      }

      // The `onDelete: "cascade"` on images.promptId handles child rows.
      await db
        .delete(prompts)
        .where(and(eq(prompts.id, input.id), eq(prompts.userId, ctx.user)));

      return { success: true };
    }),

  list: protectedProcedure.query(async ({ ctx }) => {
    return db.query.prompts.findMany({
      where: eq(prompts.userId, ctx.user),
      orderBy: [desc(prompts.createdAt)],
      with: {
        images: {
          where: eq(images.userId, ctx.user),
        },
      },
    });
  }),
});
