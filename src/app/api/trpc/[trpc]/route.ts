import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { type NextRequest } from "next/server";

import { env } from "src/env";
import { captureServerException } from "src/lib/server-utils";
import { appRouter } from "src/server/api/root";
import { createTRPCContext } from "src/server/api/trpc";

const handler = (req: NextRequest) =>
  fetchRequestHandler({
    endpoint: "/api/trpc",
    req,
    router: appRouter,
    createContext: createTRPCContext,
    onError:
      ({ path, error }) => {
        void captureServerException(error, {
          source: "trpc.onError",
          path: path ?? "<no-path>",
          code: error.code,
        });

        if (env.NODE_ENV === "development") {
          console.error(
            `❌ tRPC failed on ${path ?? "<no-path>"}: ${error.message}`,
          );
        }
      },
  });

export { handler as GET, handler as POST };
