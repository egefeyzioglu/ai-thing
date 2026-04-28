import { desc } from "drizzle-orm";
import { z } from "zod";

import { createTRPCRouter, publicProcedure } from "src/server/api/trpc";
import { db } from "src/server/db";
import { prompts } from "src/server/db/schema";

export const promptRouter = createTRPCRouter({
  create: publicProcedure
    .input(z.object({ text: z.string().min(1).max(1000) }))
    .mutation(async ({ input }) => {
      const id = crypto.randomUUID();
      const [row] = await db
        .insert(prompts)
        .values({ id, text: input.text })
        .returning();
      if (!row) throw new Error("Failed to insert prompt");
      return row;
    }),

  list: publicProcedure.query(async () => {
    return db.query.prompts.findMany({
      orderBy: [desc(prompts.createdAt)],
      with: {
        images: true,
      },
    });
  }),
});
