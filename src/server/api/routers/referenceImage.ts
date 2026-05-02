import { TRPCError } from "@trpc/server";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { createTRPCRouter, protectedProcedure } from "src/server/api/trpc";
import { db } from "src/server/db";
import { referenceImages } from "src/server/db/schema";
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
        .returning();

      return referenceImageRow;
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

      // Clean up the file from UploadThing before removing the DB row.
      if (row.url) {
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
