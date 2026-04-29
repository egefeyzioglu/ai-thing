"use client";

import Image from "next/image";
import { useState } from "react";

import { Button } from "src/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "src/components/ui/card";
import { Skeleton } from "src/components/ui/skeleton";
import { api, type RouterOutputs } from "src/trpc/react";

import { modelLabel } from "src/app/_components/models";

type PromptWithImages = RouterOutputs["prompt"]["list"][number];
type ImageRow = PromptWithImages["images"][number];

/** Pull an extension off a URL path, falling back to "png". */
function extensionFromUrl(url: string): string {
  try {
    const path = new URL(url).pathname;
    const m = /\.([a-z0-9]+)$/i.exec(path);
    if (m?.[1]) return m[1].toLowerCase();
  } catch {
    // fall through
  }
  return "png";
}

/** Make a filesystem-safe filename from a prompt + model. */
function buildDownloadName(promptText: string, model: string, ext: string) {
  const slug = promptText
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  const base = slug.length > 0 ? slug : "image";
  return `${base}-${model}.${ext}`;
}

async function downloadImage(url: string, filename: string) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  const blob = await res.blob();
  const objUrl = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = objUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    // Defer revoke a tick so the click has actually been processed.
    setTimeout(() => URL.revokeObjectURL(objUrl), 0);
  }
}

type PromptGroupProps = {
  prompt: PromptWithImages;
};

export function PromptGroup({ prompt }: PromptGroupProps) {
  return (
    <li className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <p className="text-sm text-neutral-200">{prompt.text}</p>
        <p className="text-[10px] uppercase tracking-wide text-neutral-600">
          {new Date(prompt.createdAt).toLocaleString()}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {prompt.images.map((img) => (
          <ImageCard key={img.id} prompt={prompt} image={img} />
        ))}
      </div>
    </li>
  );
}

function ImageCard({
  prompt,
  image,
}: {
  prompt: PromptWithImages;
  image: ImageRow;
}) {
  const utils = api.useUtils();
  const retry = api.image.runGeneration.useMutation({
    onSettled: () => {
      void utils.prompt.list.invalidate();
    },
  });
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const handleRetry = () => {
    retry.mutate({ imageId: image.id, retry: true });
  };

  const handleDownload = async () => {
    if (!image.url) return;
    setDownloading(true);
    setDownloadError(null);
    try {
      const ext = extensionFromUrl(image.url);
      const filename = buildDownloadName(prompt.text, image.model, ext);
      await downloadImage(image.url, filename);
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : String(err));
    } finally {
      setDownloading(false);
    }
  };

  // While a retry is in flight, the row may still read as `failed` until the
  // server-side update lands and the list query refetches. Treat that window
  // as pending in the UI so the user gets immediate feedback.
  const displayStatus =
    retry.isPending && image.status === "failed" ? "pending" : image.status;

  return (
    <Card className="overflow-hidden border-neutral-800 bg-neutral-900 py-0 text-neutral-100">
      <CardHeader className="px-4 pt-4">
        <CardTitle className="text-sm font-medium text-neutral-200">
          {modelLabel(image.model)}
        </CardTitle>
      </CardHeader>
      <CardContent className="px-0 pb-0">
        {displayStatus === "succeeded" && image.url ? (
          <div className="relative aspect-square w-full">
            <Image
              src={image.url}
              alt={prompt.text}
              fill
              sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
              className="object-cover"
              unoptimized
            />
          </div>
        ) : displayStatus === "failed" ? (
          <div className="flex aspect-square w-full flex-col items-center justify-center gap-3 bg-neutral-950 px-4 text-center">
            <p className="text-xs text-red-400">
              {image.error ?? "Generation failed"}
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={handleRetry}
              disabled={retry.isPending}
            >
              Retry
            </Button>
          </div>
        ) : (
          <Skeleton className="aspect-square w-full rounded-none" />
        )}
      </CardContent>
      <CardFooter className="flex items-center justify-between gap-2 px-4 py-3">
        <p className="text-[10px] uppercase tracking-wide text-neutral-600">
          {displayStatus === "pending"
            ? "Generating…"
            : displayStatus === "failed"
              ? "Failed"
              : new Date(image.createdAt).toLocaleString()}
        </p>
        {displayStatus === "succeeded" && image.url ? (
          <div className="flex flex-col items-end gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void handleDownload()}
              disabled={downloading}
              className="h-7 px-2 text-xs text-neutral-300 hover:text-neutral-100"
            >
              {downloading ? "Downloading…" : "Download"}
            </Button>
            {downloadError ? (
              <p className="text-[10px] text-red-400">{downloadError}</p>
            ) : null}
          </div>
        ) : null}
      </CardFooter>
    </Card>
  );
}
