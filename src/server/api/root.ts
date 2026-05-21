import { imageRouter } from "src/server/api/routers/image";
import { promptRouter } from "src/server/api/routers/prompt";
import { projectRouter } from "src/server/api/routers/project";
import { usageRouter } from "src/server/api/routers/usage";
import { createCallerFactory, createTRPCRouter } from "src/server/api/trpc";
import { referenceImageRouter } from "./routers/referenceImage";

/**
 * This is the primary router for your server.
 *
 * All routers added in /api/routers should be manually added here.
 */
export const appRouter = createTRPCRouter({
  image: imageRouter,
  prompt: promptRouter,
  project: projectRouter,
  referenceImage: referenceImageRouter,
  usage: usageRouter,
});

// export type definition of API
export type AppRouter = typeof appRouter;

/**
 * Create a server-side caller for the tRPC API.
 * @example
 * const trpc = createCaller(createContext);
 * const res = await trpc.post.all();
 *       ^? Post[]
 */
export const createCaller = createCallerFactory(appRouter);
