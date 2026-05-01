import { createTRPCRouter, protectedProcedure } from "src/server/api/trpc"
import { z } from "zod"
import { db } from "src/server/db"
import { referenceImages } from "src/server/db/schema";

export const referenceImageRouter = createTRPCRouter({
    createReferenceImage: protectedProcedure.input(z.object({
        url: z.string().min(1),
    })).mutation(async ({input}) => {
        const referenceImageRow = await db.insert(referenceImages).values({
            id: crypto.randomUUID(),
            url: input.url
        });
        return referenceImageRow;
    }),
    getReferenceImages: protectedProcedure.query(async () => {
        return await db.select().from(referenceImages).orderBy(referenceImages.uploadedAt);
    })
});