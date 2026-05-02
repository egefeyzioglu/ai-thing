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

/**
 * Extract the UploadThing file key from a `ufsUrl`.
 *
 * Typical URL shapes:
 *   https://utfs.io/f/<key>
 *   https://<appId>.ufs.sh/f/<key>
 */
export function extractFileKey(url: string): string | null {
  try {
    const match = /\/f\/(.+)/.exec(new URL(url).pathname);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}
