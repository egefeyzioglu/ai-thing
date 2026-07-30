import "server-only";

import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import sharp, { type Metadata } from "sharp";

import { db } from "src/server/db";
import {
  referenceImages,
  type ReferenceImage,
  type SeedreamResizePolicy,
} from "src/server/db/schema";
import { createWideEvent } from "src/server/observability/event";
import { signUploadThingUrl, utapi, UTFile } from "src/server/uploadthing";

const SEEDREAM_MAX_INPUT_PIXELS = 36_000_000;
const SEEDREAM_TARGET_INPUT_PIXELS = 35_000_000;
const SHARP_MAX_INPUT_PIXELS = 100_000_000;
const SEEDREAM_RESIZE_POLICY = "35mp-v1" satisfies SeedreamResizePolicy;
const REFERENCE_IMAGE_DOWNLOAD_LIMIT_BYTES = 20 * 1024 * 1024;
const REFERENCE_IMAGE_DOWNLOAD_TIMEOUT_MS = 30_000;

export type ReferenceImageDimensions = {
  width: number;
  height: number;
};

export type PreparedSeedreamReference = {
  url: string;
  originalWidth: number;
  originalHeight: number;
  width: number;
  height: number;
  resized: boolean;
};

function orientedDimensions(metadata: Metadata): ReferenceImageDimensions {
  const { width, height } = metadata.autoOrient;
  if (!width || !height) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Reference image dimensions could not be determined",
    });
  }

  return { width, height };
}

async function downloadReferenceImage(
  url: string,
  signal?: AbortSignal,
): Promise<Buffer> {
  const response = await fetch(url, {
    signal: signal
      ? AbortSignal.any([
          signal,
          AbortSignal.timeout(REFERENCE_IMAGE_DOWNLOAD_TIMEOUT_MS),
        ])
      : AbortSignal.timeout(REFERENCE_IMAGE_DOWNLOAD_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(
      `Reference image download failed with status ${response.status}`,
    );
  }

  const contentLength = Number(response.headers.get("content-length"));
  if (
    Number.isFinite(contentLength) &&
    contentLength > REFERENCE_IMAGE_DOWNLOAD_LIMIT_BYTES
  ) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Reference image is too large to process",
    });
  }

  if (!response.body) {
    throw new Error("Reference image download returned an empty body");
  }

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > REFERENCE_IMAGE_DOWNLOAD_LIMIT_BYTES) {
        await reader.cancel();
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Reference image is too large to process",
        });
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, totalBytes);
}

export async function inspectReferenceImage(
  url: string,
  signal?: AbortSignal,
): Promise<ReferenceImageDimensions> {
  const input = await downloadReferenceImage(url, signal);
  try {
    return orientedDimensions(
      await sharp(input, {
        limitInputPixels: SHARP_MAX_INPUT_PIXELS,
      }).metadata(),
    );
  } catch (error) {
    if (error instanceof TRPCError) throw error;
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Reference image could not be decoded",
      cause: error,
    });
  }
}

function targetDimensions(
  width: number,
  height: number,
): ReferenceImageDimensions {
  const scale = Math.sqrt(SEEDREAM_TARGET_INPUT_PIXELS / (width * height));
  return {
    width: Math.max(1, Math.floor(width * scale)),
    height: Math.max(1, Math.floor(height * scale)),
  };
}

function bufferToBytes(buffer: Buffer): Uint8Array<ArrayBuffer> {
  const output = new Uint8Array(new ArrayBuffer(buffer.byteLength));
  output.set(buffer);
  return output;
}

type CachedDerivativeImage = ReferenceImage & {
  height: number;
  seedreamHeight: number;
  seedreamUrl: string;
  seedreamWidth: number;
  width: number;
};

function hasCachedDerivative(
  image: ReferenceImage,
): image is CachedDerivativeImage {
  return (
    image.seedreamResizePolicy === SEEDREAM_RESIZE_POLICY &&
    Boolean(
      image.seedreamUrl &&
      image.seedreamWidth &&
      image.seedreamHeight &&
      image.width &&
      image.height,
    )
  );
}

async function cachedDerivative(
  image: ReferenceImage,
): Promise<PreparedSeedreamReference | null> {
  if (!hasCachedDerivative(image)) return null;

  return {
    url: await signUploadThingUrl(image.seedreamUrl),
    originalWidth: image.width,
    originalHeight: image.height,
    width: image.seedreamWidth,
    height: image.seedreamHeight,
    resized: true,
  };
}

export async function prepareSeedreamReferenceImage(args: {
  image: ReferenceImage;
  userId: string;
  signal?: AbortSignal;
}): Promise<PreparedSeedreamReference> {
  const event = createWideEvent("seedream.reference_image.prepare", {
    userId: args.userId,
  }).set({ referenceImageId: args.image.id });

  try {
    const cached = await cachedDerivative(args.image);
    if (cached) {
      event.set({
        cacheHit: true,
        originalWidth: cached.originalWidth,
        originalHeight: cached.originalHeight,
        width: cached.width,
        height: cached.height,
        resized: true,
      });
      return cached;
    }

    if (!args.image.url) {
      throw new Error("Reference image does not have a URL");
    }

    if (
      args.image.width &&
      args.image.height &&
      args.image.width * args.image.height <= SEEDREAM_MAX_INPUT_PIXELS
    ) {
      event.set({
        cacheHit: true,
        dimensionsCached: true,
        originalWidth: args.image.width,
        originalHeight: args.image.height,
        width: args.image.width,
        height: args.image.height,
        resized: false,
      });
      return {
        url: await signUploadThingUrl(args.image.url),
        originalWidth: args.image.width,
        originalHeight: args.image.height,
        width: args.image.width,
        height: args.image.height,
        resized: false,
      };
    }

    const input = await downloadReferenceImage(args.image.url, args.signal);
    let metadata: Metadata;
    try {
      metadata = await sharp(input, {
        limitInputPixels: SHARP_MAX_INPUT_PIXELS,
      }).metadata();
    } catch (error) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Reference image could not be decoded",
        cause: error,
      });
    }
    const original = orientedDimensions(metadata);
    const originalPixels = original.width * original.height;
    event.set({
      cacheHit: false,
      originalWidth: original.width,
      originalHeight: original.height,
      originalPixels,
    });

    await db
      .update(referenceImages)
      .set({ width: original.width, height: original.height })
      .where(eq(referenceImages.id, args.image.id));

    if (originalPixels <= SEEDREAM_MAX_INPUT_PIXELS) {
      event.set({
        width: original.width,
        height: original.height,
        resized: false,
      });
      return {
        url: await signUploadThingUrl(args.image.url),
        originalWidth: original.width,
        originalHeight: original.height,
        width: original.width,
        height: original.height,
        resized: false,
      };
    }

    const target = targetDimensions(original.width, original.height);
    let pipeline = sharp(input, {
      limitInputPixels: SHARP_MAX_INPUT_PIXELS,
    })
      .autoOrient()
      .resize({
        width: target.width,
        height: target.height,
        fit: "inside",
        withoutEnlargement: true,
        kernel: sharp.kernel.lanczos3,
      });
    const outputMimeType = metadata.hasAlpha ? "image/png" : "image/jpeg";
    pipeline = metadata.hasAlpha
      ? pipeline.png({ compressionLevel: 9 })
      : pipeline.jpeg({ quality: 92, mozjpeg: true });
    const { data: output, info: outputInfo } = await pipeline.toBuffer({
      resolveWithObject: true,
    });
    const extension = metadata.hasAlpha ? "png" : "jpg";
    const file = new UTFile(
      [bufferToBytes(output)],
      `${args.image.id}-seedream-${SEEDREAM_RESIZE_POLICY}.${extension}`,
      { type: outputMimeType },
    );
    const uploaded = await utapi.uploadFiles(file, { acl: "private" });
    if (uploaded.error || !uploaded.data) {
      throw new Error(
        `Seedream reference image upload failed: ${uploaded.error?.message ?? "unknown error"}`,
      );
    }

    const claim = await db
      .transaction(async (tx) => {
        const [current] = await tx
          .select()
          .from(referenceImages)
          .where(eq(referenceImages.id, args.image.id))
          .for("update")
          .limit(1);
        if (!current) return { status: "missing" } as const;

        if (hasCachedDerivative(current)) {
          return { status: "contended", image: current } as const;
        }

        await tx
          .update(referenceImages)
          .set({
            width: original.width,
            height: original.height,
            seedreamUrl: uploaded.data.ufsUrl,
            seedreamKey: uploaded.data.key,
            seedreamWidth: outputInfo.width,
            seedreamHeight: outputInfo.height,
            seedreamResizePolicy: SEEDREAM_RESIZE_POLICY,
          })
          .where(eq(referenceImages.id, args.image.id));
        return {
          status: "claimed",
          previousKey: current.seedreamKey,
        } as const;
      })
      .catch(async (error) => {
        await utapi.deleteFiles(uploaded.data.key).catch((cleanupError) => {
          console.error(
            "[seedream] failed to delete unclaimed reference derivative",
            cleanupError,
          );
        });
        throw error;
      });

    if (claim.status !== "claimed") {
      await utapi.deleteFiles(uploaded.data.key);
      const winnerDerivative =
        claim.status === "contended"
          ? await cachedDerivative(claim.image)
          : null;
      if (!winnerDerivative) {
        throw new Error("Failed to cache resized Seedream reference image");
      }
      event.set({
        cacheHit: true,
        cacheContended: true,
        width: winnerDerivative.width,
        height: winnerDerivative.height,
        resized: true,
      });
      return winnerDerivative;
    }

    if (claim.previousKey && claim.previousKey !== uploaded.data.key) {
      await utapi.deleteFiles(claim.previousKey).catch((error) => {
        console.error(
          "[seedream] failed to delete superseded reference derivative",
          error,
        );
      });
    }

    event.set({
      width: outputInfo.width,
      height: outputInfo.height,
      outputBytes: output.byteLength,
      resized: true,
    });
    return {
      url: await signUploadThingUrl(uploaded.data.ufsUrl),
      originalWidth: original.width,
      originalHeight: original.height,
      width: outputInfo.width,
      height: outputInfo.height,
      resized: true,
    };
  } catch (error) {
    event.fail(error, "reference_image_preparation");
    throw error;
  } finally {
    await event.emit().catch((error) => {
      console.error("[seedream] failed to emit preparation event", error);
    });
  }
}
