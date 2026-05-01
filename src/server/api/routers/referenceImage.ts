import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { createTRPCRouter, protectedProcedure } from "src/server/api/trpc";
import { db } from "src/server/db";
import { referenceImages } from "src/server/db/schema";

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
