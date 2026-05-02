import { and, eq, inArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { createTRPCRouter, protectedProcedure } from "src/server/api/trpc";
import { db } from "src/server/db";
import { images, referenceImages } from "src/server/db/schema";

export const referenceImageRouter = createTRPCRouter({
  createReferenceImage: protectedProcedure
    .input(
      z.object({
        url: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [referenceImageRow] = await db
        .insert(referenceImages)
        .values({
          id: crypto.randomUUID(),
          userId: ctx.user,
          url: input.url,
        })
        .returning();

      return referenceImageRow;
    }),

  /**
   * Create a reference image from an already-generated image, reusing its
   * UploadThing URL instead of re-uploading.  If a reference with the same
   * URL already exists for this user, the existing row is returned together
   * with `alreadyExisted: true` so the client can just select it.
   */
  createFromGeneratedImage: protectedProcedure
    .input(
      z.object({
        generatedImageId: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // 1. Look up the generated image and verify ownership + success.
      const [generatedImage] = await db
        .select()
        .from(images)
        .where(
          and(
            eq(images.id, input.generatedImageId),
            eq(images.userId, ctx.user),
          ),
        )
        .limit(1);

      if (!generatedImage) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Generated image not found",
        });
      }
      if (generatedImage.status !== "succeeded" || !generatedImage.url) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Only succeeded images can be used as references",
        });
      }

      // 2. Check for an existing reference with the same URL (dedup).
      const [existing] = await db
        .select()
        .from(referenceImages)
        .where(
          and(
            eq(referenceImages.userId, ctx.user),
            eq(referenceImages.url, generatedImage.url),
          ),
        )
        .limit(1);

      if (existing) {
        return { referenceImage: existing, alreadyExisted: true };
      }

      // 3. Create a new reference image row pointing to the same URL.
      const [referenceImageRow] = await db
        .insert(referenceImages)
        .values({
          id: crypto.randomUUID(),
          userId: ctx.user,
          url: generatedImage.url,
          sourceImageId: generatedImage.id,
        })
        .returning();

      return { referenceImage: referenceImageRow!, alreadyExisted: false };
    }),

  getReferenceImages: protectedProcedure
    .input(
      z
        .object({
          ids: z.array(z.string()).min(1).optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      return await db
        .select()
        .from(referenceImages)
        .where(
          input?.ids?.length
            ? and(
                eq(referenceImages.userId, ctx.user),
                inArray(referenceImages.id, input.ids),
              )
            : eq(referenceImages.userId, ctx.user),
        )
        .orderBy(referenceImages.uploadedAt);
    }),
});
