import "server-only";

import { UTApi, UTFile } from "uploadthing/server";

import { env } from "src/env";

const globalForUt = globalThis as unknown as {
  utapi: UTApi | undefined;
};

export const utapi =
  globalForUt.utapi ?? new UTApi({ token: env.UPLOADTHING_TOKEN });

if (env.NODE_ENV !== "production") globalForUt.utapi = utapi;

export { UTFile };
