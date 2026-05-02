"use client";

import Image from "next/image";
import { type ReactElement, useEffect, useState } from "react";

import {
  ChevronDown,
  ChevronUp,
  Download,
  ImageOff,
  Layers3,
  Pin,
  Trash2,
} from "lucide-react";

/**
 * How long a `pending` row can sit before we treat it as stuck. Real
 * generations resolve in well under this; anything older is almost
 * certainly an orphan from a server restart or crash mid-flight.
 */
const STALE_PENDING_MS = 90_000;

import { modelLabel } from "src/app/_components/models";
import { Button } from "src/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "src/components/ui/card";
import { ConfirmDialog } from "src/components/ui/confirm-dialog";
import { Skeleton } from "src/components/ui/skeleton";
import { cn } from "src/lib/utils";
import { api, type RouterOutputs } from "src/trpc/react";

type PromptWithImages = RouterOutputs["prompt"]["list"][number];
type ImageRow = PromptWithImages["images"][number];

type PromptGroupProps = {
  prompt: PromptWithImages;
  pinnedImageIds: Set<string>;
  onTogglePin: (imageId: string) => void;
};

type ModelImageGroup = {
  model: string;
  images: ImageRow[];
};

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

function compareImages(a: ImageRow, b: ImageRow) {
  const createdAtDiff =
    new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  if (createdAtDiff !== 0) return createdAtDiff;
  return a.id.localeCompare(b.id);
}

function representativeImage(images: ImageRow[]) {
  return (
    images.find((image) => image.status === "succeeded" && image.url) ??
    images[0]!
  );
}

function groupImagesByModel(images: ImageRow[]): ModelImageGroup[] {
  const groups = new Map<string, ImageRow[]>();

  for (const image of [...images].sort(compareImages)) {
    const existing = groups.get(image.model);
    if (existing) existing.push(image);
    else groups.set(image.model, [image]);
  }

  return [...groups.entries()]
    .sort(([a], [b]) => modelLabel(a).localeCompare(modelLabel(b)))
    .map(([model, groupedImages]) => ({ model, images: groupedImages }));
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

export function PromptGroup({
  prompt,
  pinnedImageIds,
  onTogglePin,
}: PromptGroupProps) {
  const utils = api.useUtils();
  const [expandedModels, setExpandedModels] = useState<Set<string>>(new Set());
  const [confirmDeletePrompt, setConfirmDeletePrompt] = useState(false);

  const deletePrompt = api.prompt.deletePrompt.useMutation({
    onSuccess: () => {
      void utils.prompt.list.invalidate();
    },
  });

  // Reference image IDs are stored as JSON on the prompt row. Look up the
  // actual URLs from the cached reference-image query so we can render
  // thumbnails alongside the prompt text.
  const referenceImageIds = Array.isArray(prompt.referenceImages)
    ? (prompt.referenceImages as unknown[]).filter(
        (v): v is string => typeof v === "string",
      )
    : [];
  const referenceImagesQuery = api.referenceImage.getReferenceImages.useQuery(
    { ids: referenceImageIds },
    { enabled: referenceImageIds.length > 0 },
  );
  const modelGroups = groupImagesByModel(prompt.images);

  const toggleExpandedModel = (model: string) => {
    setExpandedModels((prev) => {
      const next = new Set(prev);
      if (next.has(model)) next.delete(model);
      else next.add(model);
      return next;
    });
  };

  const pinnedGalleryItems: ReactElement[] = [];
  const albumGalleryItems: ReactElement[] = [];
  for (const group of modelGroups) {
    const isExpanded = expandedModels.has(group.model);
    const pinnedInGroup = group.images.filter((image) =>
      pinnedImageIds.has(image.id),
    );

    if (isExpanded) {
      albumGalleryItems.push(
        <ModelGroupCard
          key={`${prompt.id}-${group.model}`}
          prompt={prompt}
          model={group.model}
          images={group.images}
          visibleImages={group.images}
          hasHiddenImages={false}
          isExpanded={true}
          pinnedImageIds={pinnedImageIds}
          onToggleExpanded={() => toggleExpandedModel(group.model)}
          onTogglePin={onTogglePin}
        />,
      );
      continue;
    }

    if (pinnedInGroup.length === 0) {
      albumGalleryItems.push(
        <ModelGroupCard
          key={`${prompt.id}-${group.model}`}
          prompt={prompt}
          model={group.model}
          images={group.images}
          visibleImages={[representativeImage(group.images)]}
          hasHiddenImages={group.images.length > 1}
          isExpanded={false}
          pinnedImageIds={pinnedImageIds}
          onToggleExpanded={() => toggleExpandedModel(group.model)}
          onTogglePin={onTogglePin}
        />,
      );
      continue;
    }

    const unpinnedImages = group.images.filter(
      (image) => !pinnedImageIds.has(image.id),
    );

    if (unpinnedImages.length > 0) {
      albumGalleryItems.push(
        <ModelGroupCard
          key={`${prompt.id}-${group.model}`}
          prompt={prompt}
          model={group.model}
          images={group.images}
          visibleImages={[representativeImage(unpinnedImages)]}
          hasHiddenImages={unpinnedImages.length > 1}
          isExpanded={false}
          pinnedImageIds={pinnedImageIds}
          onToggleExpanded={() => toggleExpandedModel(group.model)}
          onTogglePin={onTogglePin}
        />,
      );
    }

    pinnedGalleryItems.push(
      ...pinnedInGroup.map((image) => (
        <PinnedImageCard
          key={`${prompt.id}-${group.model}-${image.id}`}
          prompt={prompt}
          model={group.model}
          image={image}
          isPinned={true}
          onTogglePin={onTogglePin}
        />
      )),
    );
  }
  const galleryItems = [...pinnedGalleryItems, ...albumGalleryItems];

  return (
    <li className="flex flex-col gap-3">
      <div className="group/prompt flex items-start gap-2">
        <button
          type="button"
          onClick={() => setConfirmDeletePrompt(true)}
          className="mt-0.5 inline-flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded text-red-400/50 opacity-0 transition-opacity hover:text-red-400 group-hover/prompt:opacity-100"
          aria-label="Delete prompt"
        >
          <Trash2 className="size-3.5" />
        </button>
        <div className="flex flex-col gap-1">
          <p className="text-sm text-neutral-200">{prompt.text}</p>
          <p className="text-[10px] tracking-wide text-neutral-600 uppercase">
            {new Date(prompt.createdAt).toLocaleString()}
          </p>
        </div>
      </div>

      {referenceImageIds.length > 0 ? (
        <div className="flex flex-col gap-1">
          <p className="text-[10px] tracking-wide text-neutral-600 uppercase">
            References
          </p>
          <div className="flex flex-wrap gap-2">
            {referenceImageIds.map((id) => {
              const url =
                referenceImagesQuery.data?.find((r) => r.id === id)?.url;

              if (url) {
                return (
                  <div
                    key={id}
                    className="relative h-12 w-12 overflow-hidden rounded border border-neutral-800 bg-neutral-900"
                  >
                    <Image
                      src={url}
                      alt="Reference image"
                      fill
                      sizes="48px"
                      className="object-cover"
                      unoptimized
                    />
                  </div>
                );
              }

              if (referenceImagesQuery.isLoading) {
                return (
                  <Skeleton key={id} className="h-12 w-12 rounded" />
                );
              }

              {/* Query finished but image wasn't found — it was deleted. */}
              return (
                <div
                  key={id}
                  className="flex h-12 w-12 items-center justify-center rounded border border-neutral-800 bg-neutral-900"
                  title="Reference image deleted"
                >
                  <ImageOff className="size-4 text-neutral-600" />
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {galleryItems}
      </div>

      <ConfirmDialog
        open={confirmDeletePrompt}
        title="Delete prompt?"
        description="This will permanently delete the prompt and all of its generated images."
        onConfirm={() => {
          deletePrompt.mutate(
            { id: prompt.id },
            { onSettled: () => setConfirmDeletePrompt(false) },
          );
        }}
        onCancel={() => setConfirmDeletePrompt(false)}
        isPending={deletePrompt.isPending}
      />
    </li>
  );
}

function ModelGroupCard({
  prompt,
  model,
  images,
  visibleImages,
  hasHiddenImages,
  isExpanded,
  pinnedImageIds,
  onToggleExpanded,
  onTogglePin,
}: {
  prompt: PromptWithImages;
  model: string;
  images: ImageRow[];
  visibleImages: ImageRow[];
  hasHiddenImages: boolean;
  isExpanded: boolean;
  pinnedImageIds: Set<string>;
  onToggleExpanded: () => void;
  onTogglePin: (imageId: string) => void;
}) {
  const collapsedInteractive = hasHiddenImages && !isExpanded;
  const showToggleButton = isExpanded ? images.length > 1 : hasHiddenImages;
  const pinnedCount = images.filter((image) =>
    pinnedImageIds.has(image.id),
  ).length;

  return (
    <Card
      className={cn(
        "overflow-hidden border-neutral-800 bg-neutral-900 py-0 text-neutral-100",
        isExpanded && "md:col-span-2 xl:col-span-3 2xl:col-span-4",
        collapsedInteractive &&
          "cursor-pointer transition hover:border-neutral-700 hover:bg-neutral-900/90",
      )}
      onClick={collapsedInteractive ? onToggleExpanded : undefined}
      onKeyDown={
        collapsedInteractive
          ? (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onToggleExpanded();
              }
            }
          : undefined
      }
      role={collapsedInteractive ? "button" : undefined}
      tabIndex={collapsedInteractive ? 0 : undefined}
    >
      <CardHeader className="px-4 pt-4 pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <CardTitle className="text-sm leading-tight font-medium text-neutral-200">
              {modelLabel(model)}
            </CardTitle>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="inline-flex min-w-6 items-center justify-center rounded-full border border-neutral-700 bg-neutral-950 px-2 text-[10px] tracking-wide text-neutral-400 uppercase">
                {images.length} total
              </span>
              {pinnedCount > 0 ? (
                <span className="inline-flex min-w-6 items-center justify-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 text-[10px] tracking-wide text-amber-300 uppercase">
                  <Pin className="size-3 fill-current" />
                  {pinnedCount} pinned
                </span>
              ) : null}
              {hasHiddenImages && !isExpanded ? (
                <span className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-neutral-700 bg-neutral-950 text-neutral-400">
                  <Layers3 className="size-3.5" />
                </span>
              ) : null}
            </div>
          </div>
          {showToggleButton ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0 text-neutral-400 hover:text-neutral-100"
              onClick={(event) => {
                event.stopPropagation();
                onToggleExpanded();
              }}
              aria-label={
                isExpanded ? "Collapse image group" : "Expand image group"
              }
            >
              {isExpanded ? (
                <ChevronUp className="size-4" />
              ) : (
                <ChevronDown className="size-4" />
              )}
            </Button>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        <div
          className={cn(
            "grid gap-3",
            isExpanded
              ? "grid-cols-1 sm:grid-cols-2 xl:grid-cols-3"
              : visibleImages.length > 1
                ? "grid-cols-1 sm:grid-cols-2"
                : "grid-cols-1",
          )}
        >
          {visibleImages.map((image) => (
            <ImageTile
              key={image.id}
              prompt={prompt}
              image={image}
              isPinned={pinnedImageIds.has(image.id)}
              onTogglePin={onTogglePin}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function PinnedImageCard({
  prompt,
  model,
  image,
  isPinned,
  onTogglePin,
}: {
  prompt: PromptWithImages;
  model: string;
  image: ImageRow;
  isPinned: boolean;
  onTogglePin: (imageId: string) => void;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <p className="text-[10px] tracking-wide text-neutral-600 uppercase">
        {modelLabel(model)}
      </p>
      <ImageTile
        prompt={prompt}
        image={image}
        isPinned={isPinned}
        onTogglePin={onTogglePin}
      />
    </div>
  );
}

function ImageTile({
  prompt,
  image,
  isPinned,
  onTogglePin,
}: {
  prompt: PromptWithImages;
  image: ImageRow;
  isPinned: boolean;
  onTogglePin: (imageId: string) => void;
}) {
  const utils = api.useUtils();
  const retry = api.image.runGeneration.useMutation({
    onSettled: () => {
      void utils.prompt.list.invalidate();
    },
  });
  const deleteImage = api.image.deleteImage.useMutation({
    onSuccess: () => {
      void utils.prompt.list.invalidate();
    },
  });
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Flip `isStale` once a pending row has been pending too long. We rely on
  // the row's `updatedAt` (server bumps it on retry) so a fresh retry resets
  // the staleness clock.
  const [isStale, setIsStale] = useState(false);
  useEffect(() => {
    if (image.status !== "pending") {
      setIsStale(false);
      return;
    }
    const elapsed = Date.now() - new Date(image.updatedAt).getTime();
    if (elapsed >= STALE_PENDING_MS) {
      setIsStale(true);
      return;
    }
    setIsStale(false);
    const t = setTimeout(() => setIsStale(true), STALE_PENDING_MS - elapsed);
    return () => clearTimeout(t);
  }, [image.status, image.updatedAt]);

  const handleRetry = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    retry.mutate({ imageId: image.id, retry: true });
  };

  const handleDownload = async (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
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

  const handleTogglePin = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    onTogglePin(image.id);
  };

  const handleDeleteClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    setConfirmDelete(true);
  };

  // While a retry is in flight, the row may still read as `failed` until the
  // server-side update lands and the list query refetches. Treat that window
  // as pending in the UI so the user gets immediate feedback. Conversely,
  // a row that has been pending too long is almost certainly orphaned, so
  // surface it as "failed" to expose the Retry button.
  const displayStatus: ImageRow["status"] =
    retry.isPending && image.status !== "succeeded"
      ? "pending"
      : image.status === "pending" && isStale
        ? "failed"
        : image.status;
  const stuckMessage =
    image.status === "pending" && isStale && !retry.isPending
      ? "Generation appears stuck — the server may have restarted."
      : null;

  return (
    <div className="group/tile overflow-hidden rounded-xl border border-neutral-800 bg-neutral-950">
      {displayStatus === "succeeded" && image.url ? (
        <div className="relative aspect-square w-full bg-neutral-950">
          <Image
            src={image.url}
            alt={prompt.text}
            fill
            sizes="(min-width: 1280px) 28vw, (min-width: 640px) 40vw, 100vw"
            className="object-contain p-2"
            unoptimized
          />
          <button
            type="button"
            onClick={handleTogglePin}
            className={cn(
              "absolute top-2 right-2 inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-full border border-neutral-700 bg-neutral-950/85 text-neutral-300 backdrop-blur transition hover:text-neutral-100",
              isPinned && "border-amber-500/60 text-amber-300",
            )}
            aria-label={isPinned ? "Unpin image" : "Pin image"}
          >
            <Pin className={cn("size-4", isPinned && "fill-current")} />
          </button>
        </div>
      ) : displayStatus === "failed" ? (
        <div className="flex aspect-square w-full flex-col items-center justify-center gap-3 bg-neutral-950 px-4 text-center">
          <p className="text-xs text-red-400">
            {stuckMessage ?? image.error ?? "Generation failed"}
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
      <CardFooter className="justify-between gap-2 border-t border-neutral-800 bg-neutral-950/80 px-3 py-2">
        <p className="text-[10px] tracking-wide text-neutral-600 uppercase">
          {displayStatus === "pending"
            ? "Generating…"
            : displayStatus === "failed"
              ? "Failed"
              : new Date(image.createdAt).toLocaleString()}
        </p>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleDeleteClick}
            className="h-7 w-7 cursor-pointer p-0 text-red-400/50 opacity-0 transition-opacity hover:text-red-400 group-hover/tile:opacity-100"
            aria-label="Delete image"
          >
            <Trash2 className="size-3.5" />
          </Button>
          {displayStatus === "succeeded" && image.url ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleDownload}
              disabled={downloading}
              className="h-7 w-7 cursor-pointer p-0 text-neutral-300 hover:text-neutral-100"
              aria-label={downloading ? "Downloading image" : "Download image"}
            >
              <Download className="size-3.5" />
            </Button>
          ) : null}
        </div>
      </CardFooter>
      {downloadError ? (
        <div className="border-t border-neutral-800 px-3 py-2">
          <p className="text-[10px] text-red-400">{downloadError}</p>
        </div>
      ) : null}

      <ConfirmDialog
        open={confirmDelete}
        title="Delete image?"
        description="This generated image will be permanently deleted."
        onConfirm={() => {
          deleteImage.mutate(
            { id: image.id },
            { onSettled: () => setConfirmDelete(false) },
          );
        }}
        onCancel={() => setConfirmDelete(false)}
        isPending={deleteImage.isPending}
      />
    </div>
  );
}
