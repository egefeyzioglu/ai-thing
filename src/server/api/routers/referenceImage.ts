import { TRPCError } from "@trpc/server";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";

import { createTRPCRouter, protectedProcedure } from "src/server/api/trpc";
import { db } from "src/server/db";
import { extractFileKey, utapi } from "src/server/uploadthing";
import { images, referenceImages } from "src/server/db/schema";

export const referenceImageRouter = createTRPCRouter({
  createReferenceImage: protectedProcedure
    .input(
      z.object({
        url: z.string().min(1),
        // Optional because it's easier to validate and delete from UT on the
        // server than on the client
        mimeType: z.unknown().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (
        typeof input.mimeType !== "string" ||
        !input.mimeType.startsWith("image/")
      ) {
        const key = extractFileKey(input.url);
        if (key) {
          try {
            await utapi.deleteFiles(key);
          } catch (reason) {
            console.error(
              `Deleting image with key ${key} failed. Was deleting because no MIME type was provided/the provided MIME type is invalid`,
              reason,
            );
          }
        }

        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Reference image MIME type must start with image/",
        });
      }

      const [referenceImageRow] = await db
        .insert(referenceImages)
        .values({
          id: crypto.randomUUID(),
          userId: ctx.user,
          url: input.url,
          mimeType: input.mimeType,
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
      if (row.url && !row.reusedFrom) {
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
  createReferenceImageFromGenerated: protectedProcedure
    .input(
      z.object({
        imageId: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [generatedImageRow] = await db
        .select()
        .from(images)
        .where(eq(images.id, input.imageId));
      if (generatedImageRow?.userId !== ctx.user) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `No image with id ${input.imageId} exists, or you do not have access`,
        });
      }
      if (!generatedImageRow.url) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Image ${input.imageId} does not have a URL (is it in progress/has it failed?)`,
        });
      }
      const newId = crypto.randomUUID();
      const [referenceImageRow] = await db
        .insert(referenceImages)
        .values({
          id: newId,
          reusedFrom: input.imageId,
          url: generatedImageRow.url,
          mimeType: generatedImageRow.mimeType,
          userId: ctx.user,
        })
        .onConflictDoUpdate({
          target: referenceImages.reusedFrom,
          set: { id: sql`${referenceImages.id}` }, // NO-OP update to get the conflicting row
        })
        .returning();
      if (!referenceImageRow) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Unknown error when inserting new reference image",
        });
      }
      return {
        referenceImageRow: referenceImageRow,
        existing: referenceImageRow.id !== newId,
      };
    }),
});
