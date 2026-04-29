import { desc } from "drizzle-orm";
import { z } from "zod";

import { createTRPCRouter, protectedProcedure } from "src/server/api/trpc";
import { db } from "src/server/db";
import { images, prompts } from "src/server/db/schema";

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
      }),
    )
    .mutation(async ({ input }) => {
      // De-dupe in case the client double-checked a model.
      const models = Array.from(new Set(input.models));

      return db.transaction(async (tx) => {
        const promptId = crypto.randomUUID();
        const [promptRow] = await tx
          .insert(prompts)
          .values({ id: promptId, text: ("Generate an image for the following user input: " + input.text) })
          .returning();
        if (!promptRow) throw new Error("Failed to insert prompt");

        const imageRows = await tx
          .insert(images)
          .values(
            models.map((model) => ({
              id: crypto.randomUUID(),
              promptId,
              model,
              status: "pending" as const,
            })),
          )
          .returning();

        return { ...promptRow, images: imageRows };
      });
    }),

  list: protectedProcedure.query(async () => {
    return db.query.prompts.findMany({
      orderBy: [desc(prompts.createdAt)],
      with: {
        images: true,
      },
    });
  }),
});
