import { and, eq, inArray, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { createTRPCRouter, protectedProcedure } from "src/server/api/trpc";
import { db } from "src/server/db";
import { images, referenceImages } from "src/server/db/schema";
import { extractFileKey, utapi } from "src/server/uploadthing";

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

      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Reference image was deleted during conflict resolution",
        });
      }

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
        .onConflictDoUpdate({
          target: [referenceImages.userId, referenceImages.url],
          set: {
            sourceImageId: sql`COALESCE(${referenceImages.sourceImageId}, ${generatedImage.id})`,
          },
        })
        .returning();

      if (referenceImageRow) {
        return { referenceImage: referenceImageRow, alreadyExisted: false };
      }

      // 3. Conflict – a row with this (userId, url) already exists; fetch it.
      //    (Normally unreachable because onConflictDoUpdate + returning()
      //    always produces a row, but kept as a safety net.)
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

      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Reference image was deleted during conflict resolution",
        });
      }

      return { referenceImage: existing, alreadyExisted: true };
    }),

  deleteReferenceImage: protectedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const [row] = await db
        .select()
        .from(referenceImages)
        .where(
          and(
            eq(referenceImages.id, input.id),
            eq(referenceImages.userId, ctx.user),
          ),
        )
        .limit(1);

      if (!row) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Reference image not found",
        });
      }

      // Clean up the file from UploadThing before removing the DB row —
      // but only when this reference owns the file. References created via
      // "use as reference" share the UploadThing file with the source
      // generated image (sourceImageId is set), so we must not delete it
      // here; the file will be cleaned up when the generated image is
      // deleted (or, if the generated image is deleted first, the FK
      // cascade sets sourceImageId to null and we become the owner).
      if (row.url && !row.sourceImageId) {
        const key = extractFileKey(row.url);
        if (key) {
          try {
            await utapi.deleteFiles(key);
          } catch {
            // If the file is already gone we still want to remove the row.
          }
        }
      }

      await db
        .delete(referenceImages)
        .where(
          and(
            eq(referenceImages.id, input.id),
            eq(referenceImages.userId, ctx.user),
          ),
        );

      return { success: true };
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
