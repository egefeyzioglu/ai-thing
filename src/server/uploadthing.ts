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

export const UPLOADTHING_SIGNED_URL_EXPIRES_IN = "7 days";

/**
 * Extract the UploadThing file key from a `ufsUrl`.
 *
 * Typical URL shapes:
 *   https://utfs.io/f/<key>
 *   https://<appId>.ufs.sh/f/<key>
 *   https://ufs.sh/a/<appId>/<key>
 */
export function extractFileKey(url: string): string | null {
  try {
    const pathname = new URL(url).pathname;
    const fPathMatch = /\/f\/(.+)/.exec(pathname);
    if (fPathMatch?.[1]) return fPathMatch[1];

    const appPathMatch = /\/a\/[^/]+\/(.+)/.exec(pathname);
    return appPathMatch?.[1] ?? null;
  } catch {
    return null;
  }
}

export async function signUploadThingUrl(url: string): Promise<string> {
  const key = extractFileKey(url);
  if (!key) {
    throw new Error(`Could not extract UploadThing file key from URL: ${url}`);
  }

  return (
    await utapi.generateSignedURL(key, {
      expiresIn: UPLOADTHING_SIGNED_URL_EXPIRES_IN,
    })
  ).ufsUrl;
}
