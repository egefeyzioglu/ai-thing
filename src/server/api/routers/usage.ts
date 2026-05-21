import { createTRPCRouter, protectedProcedure } from "src/server/api/trpc";
import { getCurrentUsage } from "src/server/usage";

export const usageRouter = createTRPCRouter({
  getCurrent: protectedProcedure.query(async ({ ctx }) => {
    return getCurrentUsage(ctx.user);
  }),
});
