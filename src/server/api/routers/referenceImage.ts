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
        .onConflictDoNothing({
          target: [referenceImages.userId, referenceImages.url],
        })
        .returning();

      if (referenceImageRow) {
        return referenceImageRow;
      }

      // Conflict: a row with the same (userId, url) already exists.
      const [existing] = await db
        .select()
        .from(referenceImages)
        .where(
          and(
            eq(referenceImages.userId, ctx.user),
            eq(referenceImages.url, input.url),
          ),
        )
        .limit(1);

      return existing;
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

      // 2. Attempt an atomic insert; the unique index on (userId, url)
      //    ensures no duplicate can sneak in between a check and insert.
      const [referenceImageRow] = await db
        .insert(referenceImages)
        .values({
          id: crypto.randomUUID(),
          userId: ctx.user,
          url: generatedImage.url,
          sourceImageId: generatedImage.id,
        })
        .onConflictDoNothing({
          target: [referenceImages.userId, referenceImages.url],
        })
        .returning();

      if (referenceImageRow) {
        return { referenceImage: referenceImageRow, alreadyExisted: false };
      }

      // 3. Conflict – a row with this (userId, url) already exists; fetch it.
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

      return { referenceImage: existing!, alreadyExisted: true };
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
