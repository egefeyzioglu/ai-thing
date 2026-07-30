import "server-only";

import { TRPCError } from "@trpc/server";
import { and, eq, isNull, ne, or } from "drizzle-orm";
import sharp from "sharp";

import { db } from "src/server/db";
import { referenceImages, type ReferenceImage } from "src/server/db/schema";
import { createWideEvent } from "src/server/observability/event";
import { signUploadThingUrl, utapi, UTFile } from "src/server/uploadthing";

const SEEDREAM_MAX_INPUT_PIXELS = 36_000_000;
const SEEDREAM_TARGET_INPUT_PIXELS = 35_000_000;
const SEEDREAM_RESIZE_POLICY = "35mp-v1";
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

function orientedDimensions(
  metadata: sharp.Metadata,
): ReferenceImageDimensions {
  if (!metadata.width || !metadata.height) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Reference image dimensions could not be determined",
    });
  }

  const swapsAxes =
    metadata.orientation !== undefined && metadata.orientation >= 5;
  return swapsAxes
    ? { width: metadata.height, height: metadata.width }
    : { width: metadata.width, height: metadata.height };
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

  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.byteLength > REFERENCE_IMAGE_DOWNLOAD_LIMIT_BYTES) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Reference image is too large to process",
    });
  }
  return bytes;
}

export async function inspectReferenceImage(
  url: string,
  signal?: AbortSignal,
): Promise<ReferenceImageDimensions> {
  const input = await downloadReferenceImage(url, signal);
  try {
    return orientedDimensions(await sharp(input).metadata());
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

async function cachedDerivative(
  image: ReferenceImage,
): Promise<PreparedSeedreamReference | null> {
  if (
    image.seedreamResizePolicy !== SEEDREAM_RESIZE_POLICY ||
    !image.seedreamUrl ||
    !image.seedreamWidth ||
    !image.seedreamHeight ||
    !image.width ||
    !image.height
  ) {
    return null;
  }

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

    const input = await downloadReferenceImage(args.image.url, args.signal);
    let metadata: sharp.Metadata;
    try {
      metadata = await sharp(input).metadata();
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
        url: args.image.url,
        originalWidth: original.width,
        originalHeight: original.height,
        width: original.width,
        height: original.height,
        resized: false,
      };
    }

    const target = targetDimensions(original.width, original.height);
    let pipeline = sharp(input).autoOrient().resize({
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

    const [claimed] = await db
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
      .where(
        and(
          eq(referenceImages.id, args.image.id),
          or(
            isNull(referenceImages.seedreamKey),
            ne(referenceImages.seedreamResizePolicy, SEEDREAM_RESIZE_POLICY),
          ),
        ),
      )
      .returning();

    if (!claimed) {
      await utapi.deleteFiles(uploaded.data.key);
      const [winner] = await db
        .select()
        .from(referenceImages)
        .where(eq(referenceImages.id, args.image.id))
        .limit(1);
      const winnerDerivative = winner ? await cachedDerivative(winner) : null;
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

    if (
      args.image.seedreamKey &&
      args.image.seedreamKey !== uploaded.data.key
    ) {
      await utapi.deleteFiles(args.image.seedreamKey).catch((error) => {
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
    await event.emit();
  }
}
