"use client";

import Image from "next/image";
import { memo, useEffect, useMemo, useRef, useState } from "react";

import { Card } from "src/components/ui/card";
import { Button } from "src/components/ui/button";
import {
  AlertTriangle,
  ChevronDown,
  Copy,
  CornerUpLeft,
  Download,
  FolderInput,
  ImageOff,
  ImagePlus,
  Loader2,
  MoreHorizontal,
  Pin,
  PinOff,
  Play,
  RotateCw,
  Trash2,
  Video,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "src/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "src/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "src/components/ui/tooltip";
import { cn } from "src/lib/utils";
import { toast } from "sonner";

import { extensionFor } from "src/lib/utils";
import type { LocalStorageSetter, LocalStorageValue } from "src/lib/localStorage";

import type { MEDIA_STATUSES, MEDIA_TYPES } from "src/server/db/schema";

import { MediaLightbox } from "./media-lightbox";

export type ModelInfo = {
  slug: string;
  name: string;
  provider: string;
  kind: "image" | "video";
};

type ProjectInfo = {
  id: string;
  name: string;
};

type MediaShape = {
  id: string;
  url: string;
  modelSlug: string;
  status: (typeof MEDIA_STATUSES)[number];
  mediaType: (typeof MEDIA_TYPES)[number];
  mimeType: string;
  durationMs: number | null;
  key: string;
  error?: string;
  createdAt: Date;
  updatedAt: Date;
};

type PinnedImages = LocalStorageValue<"pinnedImages">;
type SetPinnedImages = LocalStorageSetter<"pinnedImages">;

export type PromptGroupProps = {
  id: string;
  prompt: string;
  aspectRatio?: string;
  createdAt: Date;
  images: MediaShape[];
  referenceImages: { url?: string; id: string }[];
  models: ModelInfo[];
  projects?: ProjectInfo[];
  currentProjectId?: string | null;
  onDeletePrompt?: () => void;
  onMovePrompt?: (projectId: string) => void;
  onDeleteMedia?: (mediaId: string) => void;
  onRetryMedia?: (mediaId: string) => void;
  onReuseAsReference?: (mediaId: string) => Promise<void>;
  onReusePrompt?: () => void;
  pinnedImages: PinnedImages;
  onPinnedImagesChange: SetPinnedImages;
};

function parseAspectRatio(ar: string): string {
  const parts = ar.split(":");
  const w = Number(parts[0]);
  const h = Number(parts[1]);
  if (w > 0 && h > 0) return `${w} / ${h}`;
  return "1 / 1";
}

function parseProviderErrorMessage(rawError: string): string {
  const jsonStart = rawError.indexOf("{");
  if (jsonStart === -1) return rawError;

  try {
    const parsed = JSON.parse(rawError.slice(jsonStart)) as {
      error?: { message?: unknown };
      message?: unknown;
    };
    if (typeof parsed?.error?.message === "string" && parsed.error.message) {
      return parsed.error.message;
    }
    if (typeof parsed?.message === "string" && parsed.message) {
      return parsed.message;
    }
  } catch {
    // Not JSON; fall through and show the raw string
  }
  return rawError;
}

const fmtDate = (d: Date) =>
  d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

function PinIcon({
  size = 12,
  filled = false,
}: {
  size?: number;
  filled?: boolean;
}) {
  return (
    <Pin
      width={size}
      height={size}
      strokeWidth={2}
      className={cn(filled && "fill-current")}
    />
  );
}

async function downloadImage(url: string, expectedMimeType?: string) {
  const res = await fetch(url);
  if(!res.ok) throw new Error(`Download failed: Got ${res.status} from UploadThing`);

  // Prefer the response type, then the stored type, then a generic fallback.
  const extension = extensionFor(
    res.headers.get("Content-Type")?.split(";")[0],
    extensionFor(expectedMimeType, "dat"),
  );

  const blob = await res.blob();
  const blobUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = blobUrl;
  const prefix = expectedMimeType?.startsWith("video/") ? "video" : "image";
  a.download = `${prefix}-${Date.now()}.${extension}`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(blobUrl);
}

// The signed UploadThing URL is regenerated on every prompt.list response, so
// naive rendering would swap the <video> src each refetch and the browser
// would reload + reset playback. The underlying file `mediaKey` is stable, so
// we memoize on mediaKey + ar — once a stable URL has been handed to the
// browser, re-signs of the same file are ignored at the React layer and the
// <video> element keeps its state.
const VideoPreview = memo(
  function VideoPreview({
    src,
    ar,
    playing,
  }: {
    src: string;
    mediaKey: string;
    ar: string;
    playing: boolean;
  }) {
    const videoRef = useRef<HTMLVideoElement>(null);
    useEffect(() => {
      const el = videoRef.current;
      if (!el) return;
      if (playing) {
        void el.play().catch((err) => {
          console.debug("video hover-play interrupted:", err);
        });
      } else {
        el.pause();
        el.currentTime = 0;
      }
    }, [playing]);
    return (
      <div
        className="relative w-full"
        style={{ aspectRatio: parseAspectRatio(ar) }}
      >
        <video
          ref={videoRef}
          src={src}
          className="absolute inset-0 size-full object-cover"
          muted
          playsInline
          loop
          preload="metadata"
        />
        <div
          className={cn(
            "pointer-events-none absolute inset-0 flex items-center justify-center bg-black/20 transition-opacity",
            playing && "opacity-0",
          )}
        >
          <div className="flex size-12 items-center justify-center rounded-full bg-black/55 backdrop-blur-sm">
            <Play className="ml-0.5 size-5 fill-white text-white" strokeWidth={0} />
          </div>
        </div>
      </div>
    );
  },
  (prev, next) =>
    prev.mediaKey === next.mediaKey &&
    prev.ar === next.ar &&
    prev.playing === next.playing,
);

function VideoRenderingState({
  ar,
  createdAt,
}: {
  ar: string;
  createdAt: Date;
}) {
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    const estimatedMs = 45_000;
    const tick = () => {
      const elapsed = Date.now() - createdAt.getTime();
      setProgress(Math.min(95, (elapsed / estimatedMs) * 95));
    };
    tick();
    const interval = setInterval(tick, 500);
    return () => clearInterval(interval);
  }, [createdAt]);
  return (
    <div
      className="relative w-full bg-muted"
      style={{ aspectRatio: parseAspectRatio(ar) }}
    >
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6">
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-(--border)">
          <div
            className="h-full bg-primary transition-all duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="flex w-full justify-between text-xs text-muted-foreground">
          <span className="animate-pulse">Rendering video…</span>
          <span>{Math.round(progress)}%</span>
        </div>
      </div>
    </div>
  );
}

type ImageCellProps = {
  image: MediaShape;
  ar: string;
  isPinned: boolean;
  pinIndex: number;
  totalPinned: number;
  onTogglePin: () => void;
  onDownload: () => void;
  onDelete: () => void;
  onRetry?: () => void;
  onReuseAsReference?: () => Promise<void>;
  onOpen?: () => void;
  /** Accessible label for the open action, e.g. "Show all 4 images". */
  openLabel?: string;
};

type GeneratedImageActionsProps = {
  isPinned?: boolean;
  onTogglePin?: () => void;
  onDownload: () => void;
  onDelete: () => void;
  onReuseAsReference?: () => Promise<void>;
};

const overlayButtonClass =
  "flex size-7 cursor-pointer items-center justify-center rounded-md border border-white/10 bg-black/60 text-white backdrop-blur-sm transition-colors hover:bg-black/80 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:cursor-default disabled:opacity-50";

function OverlayButton({
  label,
  onClick,
  disabled,
  className,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={label}
            disabled={disabled}
            onClick={(event) => {
              event.stopPropagation();
              onClick();
            }}
            className={cn(overlayButtonClass, className)}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function GeneratedImageActions({
  isPinned = false,
  onTogglePin,
  onDownload,
  onDelete,
  onReuseAsReference,
}: GeneratedImageActionsProps) {
  const [reusing, setReusing] = useState(false);

  return (
    <div className="flex items-center gap-1">
      {onTogglePin && (
        <OverlayButton
          label={isPinned ? "Unpin cover" : "Pin as album cover"}
          onClick={onTogglePin}
          className={cn(
            isPinned && "bg-primary border-primary hover:bg-primary/85",
          )}
        >
          {isPinned ? (
            <PinOff className="size-3.5" />
          ) : (
            <Pin className="size-3.5" />
          )}
        </OverlayButton>
      )}
      {onReuseAsReference && (
        <OverlayButton
          label={reusing ? "Saving as reference…" : "Use as reference image"}
          disabled={reusing}
          onClick={() => {
            if (reusing) return;
            setReusing(true);
            void onReuseAsReference().finally(() => setReusing(false));
          }}
        >
          {reusing ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <ImagePlus className="size-3.5" />
          )}
        </OverlayButton>
      )}
      <OverlayButton label="Download" onClick={onDownload}>
        <Download className="size-3.5" />
      </OverlayButton>
      <OverlayButton
        label="Delete"
        onClick={onDelete}
        className="hover:bg-red-500/80"
      >
        <Trash2 className="size-3.5" />
      </OverlayButton>
    </div>
  );
}

function FailureDetails({ error }: { error: string }) {
  const message = parseProviderErrorMessage(error);
  return (
    <>
      <p className="text-muted-foreground line-clamp-3 max-w-full text-center text-xs break-words">
        {message}
      </p>
      {error.trim() !== "" && (
        <Popover>
          <PopoverTrigger
            render={
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground focus-visible:ring-ring pointer-events-auto cursor-pointer rounded text-[11px] underline underline-offset-2 outline-none focus-visible:ring-2"
              />
            }
          >
            Details
          </PopoverTrigger>
          <PopoverContent className="w-80">
            <pre className="max-h-60 overflow-auto font-mono text-[11px] leading-relaxed break-words whitespace-pre-wrap select-text">
              {error}
            </pre>
          </PopoverContent>
        </Popover>
      )}
    </>
  );
}

function ImageCell({
  image,
  ar,
  isPinned,
  pinIndex,
  totalPinned,
  onTogglePin,
  onDownload,
  onDelete,
  onRetry,
  onReuseAsReference,
  onOpen,
  openLabel,
}: ImageCellProps) {
  const isVideo = image.mediaType === "video";
  // A stack cover always opens (it expands the album), even if that run
  // failed; a single result opens only once it has media to show.
  const canOpen =
    Boolean(onOpen) && (image.status === "succeeded" || Boolean(openLabel));
  const [hovered, setHovered] = useState(false);
  // Storage can be slow or briefly unavailable; offer a retry instead of the
  // browser's broken-image icon.
  const [loadFailed, setLoadFailed] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);

  let body: React.ReactNode;
  if (image.status === "pending" || image.status === "running") {
    body = isVideo ? (
      <VideoRenderingState ar={ar} createdAt={image.createdAt} />
    ) : (
      <div
        className="bg-muted relative min-h-32 w-full"
        style={{ aspectRatio: parseAspectRatio(ar) }}
      >
        <div className="absolute inset-0 animate-pulse bg-linear-to-br from-white/[0.02] via-white/[0.06] to-white/[0.02]" />
        <div className="absolute inset-0 flex items-center justify-center gap-2">
          <Loader2 className="text-primary-text size-4 animate-spin" />
          <span className="text-muted-foreground text-xs">Generating…</span>
        </div>
      </div>
    );
  } else if (image.status === "failed") {
    body = (
      <div
        className="bg-muted relative min-h-40 w-full"
        style={{ aspectRatio: parseAspectRatio(ar) }}
      >
        <div className="pointer-events-none absolute inset-0 z-[2] flex flex-col items-center justify-center gap-1.5 px-4 py-3">
          <AlertTriangle className="text-destructive size-4 shrink-0" />
          <p className="text-foreground text-xs font-medium">
            Generation failed
          </p>
          {image.error && <FailureDetails error={image.error} />}
          {onRetry && (
            <Button
              variant="outline"
              size="xs"
              onClick={onRetry}
              className="pointer-events-auto mt-1 cursor-pointer"
            >
              <RotateCw />
              Retry
            </Button>
          )}
        </div>
      </div>
    );
  } else {
    body = isVideo ? (
      <VideoPreview
        src={image.url}
        mediaKey={image.key}
        ar={ar}
        playing={hovered}
      />
    ) : (
      <div
        className="relative w-full"
        style={{ aspectRatio: parseAspectRatio(ar) }}
      >
        {loadFailed ? (
          <div className="bg-muted pointer-events-none absolute inset-0 z-[2] flex flex-col items-center justify-center gap-1.5 px-4">
            <ImageOff className="text-muted-foreground size-4" />
            <p className="text-muted-foreground text-xs">
              Couldn&apos;t load this image
            </p>
            <Button
              variant="outline"
              size="xs"
              className="pointer-events-auto cursor-pointer"
              onClick={() => {
                setLoadFailed(false);
                setLoadAttempt((n) => n + 1);
              }}
            >
              <RotateCw />
              Try again
            </Button>
          </div>
        ) : (
          <Image
            key={loadAttempt}
            src={image.url}
            alt="Generated image"
            fill
            loading="lazy"
            className="object-cover"
            sizes="(max-width: 1280px) 50vw, 33vw"
            onError={() => setLoadFailed(true)}
          />
        )}
      </div>
    );
  }

  return (
    <div
      onMouseEnter={isVideo ? () => setHovered(true) : undefined}
      onMouseLeave={isVideo ? () => setHovered(false) : undefined}
      className={cn(
        "group/cell bg-muted relative w-full overflow-hidden rounded-md [animation:promptGroupFadeIn_0.25s_ease_both]",
        isPinned
          ? "outline-primary outline outline-2"
          : "outline outline-1 outline-white/5",
      )}
    >
      {body}
      {canOpen && (
        // Sibling of the action buttons (not their parent) so each control
        // gets its own keyboard activation.
        <button
          type="button"
          aria-label={openLabel ?? (isVideo ? "Play video" : "Open image")}
          onClick={onOpen}
          onFocus={isVideo ? () => setHovered(true) : undefined}
          onBlur={isVideo ? () => setHovered(false) : undefined}
          className="focus-visible:ring-ring absolute inset-0 z-[1] cursor-pointer rounded-md outline-none focus-visible:ring-2 focus-visible:ring-inset"
        />
      )}
      {isVideo && image.status === "succeeded" && (
        <div
          className={cn(
            "pointer-events-none absolute left-1.5 z-10 flex items-center gap-1 rounded-full bg-black/55 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-white backdrop-blur-sm",
            isPinned ? "top-8" : "top-1.5",
          )}
        >
          <Video className="size-2.5" strokeWidth={2.5} />
          Video
        </div>
      )}
      {isVideo && image.status === "succeeded" && image.durationMs != null && (
        <div className="pointer-events-none absolute right-1.5 bottom-1.5 z-10 rounded-full bg-black/55 px-1.5 py-0.5 text-[10px] font-medium text-white backdrop-blur-sm">
          {Math.round(image.durationMs / 1000)}s
        </div>
      )}
      {isPinned && (
        <div className="bg-primary text-primary-foreground pointer-events-none absolute top-1.5 left-1.5 z-10 flex h-5 items-center gap-1 rounded-full px-1.5 text-[10px] font-semibold shadow-md">
          <PinIcon size={10} filled />
          {totalPinned > 1 && `${pinIndex + 1}/${totalPinned}`}
          <span className="sr-only">Pinned cover</span>
        </div>
      )}
      {image.status === "succeeded" && (
        <div className="absolute top-1.5 right-1.5 z-20 flex items-center gap-1 opacity-0 transition-opacity group-focus-within/cell:opacity-100 group-hover/cell:opacity-100">
          <GeneratedImageActions
            isPinned={isPinned}
            onTogglePin={onTogglePin}
            onDownload={onDownload}
            onDelete={onDelete}
            onReuseAsReference={isVideo ? undefined : onReuseAsReference}
          />
        </div>
      )}
      {image.status === "failed" && (
        <div className="absolute top-1.5 right-1.5 z-20 opacity-0 transition-opacity group-focus-within/cell:opacity-100 group-hover/cell:opacity-100">
          <OverlayButton
            label="Delete"
            onClick={onDelete}
            className="hover:bg-red-500/80"
          >
            <Trash2 className="size-3.5" />
          </OverlayButton>
        </div>
      )}
    </div>
  );
}

type ModelAlbumProps = {
  modelId: string;
  images: MediaShape[];
  ar: string;
  models: ModelInfo[];
  onDeleteMedia?: (mediaId: string) => void;
  onRetryMedia?: (mediaId: string) => void;
  onReuseAsReference?: (mediaId: string) => Promise<void>;
  pinnedImages: PinnedImages;
  onPinnedImagesChange: SetPinnedImages;
};

function ModelAlbum({ modelId, images, ar, models, onDeleteMedia, onRetryMedia, onReuseAsReference, pinnedImages, onPinnedImagesChange }: ModelAlbumProps) {
  const model = models.find((m) => m.slug === modelId);
  const isVideoAlbum = model?.kind === "video";
  const itemNoun = isVideoAlbum ? "clip" : "image";
  const [expanded, setExpanded] = useState(false);
  const [modalImage, setModalImage] = useState<MediaShape | null>(null);
  const imageIds = useMemo(() => new Set(images.map((image) => image.id)), [images]);
  // map of imageId to timestamp when pinned (higher = more recently pinned = on top)
  const pinnedMap = useMemo(
    () =>
      new Map(
        pinnedImages
          .filter(({ imageId }) => imageIds.has(imageId))
          .map(({ imageId, pinnedAt }) => [imageId, pinnedAt]),
      ),
    [imageIds, pinnedImages],
  );

  const togglePin = (id: string) => {
    onPinnedImagesChange((prev) => {
      if (prev.some(({ imageId }) => imageId === id)) {
        return prev.filter(({ imageId }) => imageId !== id);
      }

      return [...prev, { imageId: id, pinnedAt: Date.now() }];
    });
  };

  const pinned = images
    .filter((i) => pinnedMap.has(i.id))
    .sort((a, b) => (pinnedMap.get(b.id) ?? 0) - (pinnedMap.get(a.id) ?? 0));
  // Same priority as the cover: results first, then work in progress, then failures.
  const statusRank = (i: MediaShape) =>
    i.status === "succeeded" ? 0 : i.status === "failed" ? 2 : 1;
  const unpinned = images
    .filter((i) => !pinnedMap.has(i.id))
    .sort((a, b) => statusRank(a) - statusRank(b));
  const allDisplay = [...pinned, ...unpinned];

  const successCount = images.filter((i) => i.status === "succeeded").length;
  const failedCount = images.filter((i) => i.status === "failed").length;

  // Prefer something worth looking at as the cover: a pin, then a success,
  // then work in progress, and only then a failure.
  const cover =
    pinned[0] ??
    images.find((i) => i.status === "succeeded") ??
    images.find((i) => i.status === "pending" || i.status === "running") ??
    images[0];
  const stackDepth = Math.min(2, images.length - 1);
  const canExpand = images.length > 1;
  // Deleting down to one result leaves nothing to expand.
  const isExpanded = expanded && canExpand;

  const handleDownload = (img: MediaShape) => {
    void downloadImage(img.url, img.mimeType).catch((err) => {
      console.error("Failed to download media", err);
      toast.error("Download failed");
    });
  };

  const renderCell = (img: MediaShape, onOpen: () => void, openLabel?: string) => (
    <ImageCell
      key={img.id}
      image={img}
      ar={ar}
      isPinned={pinnedMap.has(img.id)}
      pinIndex={pinned.findIndex((p) => p.id === img.id)}
      totalPinned={pinned.length}
      onTogglePin={() => togglePin(img.id)}
      onDownload={() => handleDownload(img)}
      onDelete={() => onDeleteMedia?.(img.id)}
      onRetry={onRetryMedia ? () => onRetryMedia(img.id) : undefined}
      onReuseAsReference={
        onReuseAsReference ? () => onReuseAsReference(img.id) : undefined
      }
      onOpen={onOpen}
      openLabel={openLabel}
    />
  );

  return (
    <Card
      className={cn(
        "group/album gap-0 rounded-xl py-0 [animation:promptGroupFadeIn_0.3s_ease_both]",
        isExpanded && "col-span-full",
      )}
    >
      {/* header */}
      <div className="flex items-center justify-between gap-2 px-3 pt-2.5 pb-2">
        <div className="min-w-0">
          <div className="truncate text-[13px] font-medium">
            {model?.name ?? modelId}
          </div>
          <div className="text-muted-foreground mt-0.5 flex items-center gap-1.5 text-[11px]">
            <span>{model?.provider}</span>
            {successCount > 0 && (
              <>
                <span className="opacity-50">·</span>
                <span>
                  {successCount} {itemNoun}
                  {successCount !== 1 ? "s" : ""}
                </span>
              </>
            )}
            {pinned.length > 0 && (
              <>
                <span className="opacity-50">·</span>
                <span className="text-primary-text flex items-center gap-0.5">
                  <PinIcon size={9} filled />
                  {pinned.length} pinned
                </span>
              </>
            )}
            {failedCount > 0 && (
              <>
                <span className="opacity-50">·</span>
                <span className="text-destructive">{failedCount} failed</span>
              </>
            )}
          </div>
        </div>
        {canExpand && (
          <Button
            variant="ghost"
            size="xs"
            aria-expanded={isExpanded}
            onClick={() => setExpanded((e) => !e)}
            className="text-muted-foreground shrink-0 cursor-pointer gap-1"
          >
            {isExpanded ? "Collapse" : `Show all ${images.length}`}
            <ChevronDown
              className={cn(
                "transition-transform duration-200",
                isExpanded && "rotate-180",
              )}
            />
          </Button>
        )}
      </div>

      {/* body */}
      <div className="px-3 pb-3">
        {!isExpanded ? (
          <div className={cn("relative", stackDepth > 0 && "pb-2")}>
            {/* Page edges peeking out below the cover signal more results. */}
            {stackDepth >= 2 && (
              <div
                aria-hidden
                className="bg-muted/50 absolute inset-x-4 bottom-0 h-8 rounded-b-md border border-t-0"
              />
            )}
            {stackDepth >= 1 && (
              <div
                aria-hidden
                className="bg-muted absolute inset-x-2 bottom-1 h-8 rounded-b-md border border-t-0"
              />
            )}
            <div className="relative z-[1]">
              {cover
                ? renderCell(
                    cover,
                    canExpand
                      ? () => setExpanded(true)
                      : () => setModalImage(cover),
                    canExpand ? `Show all ${images.length} ${itemNoun}s` : undefined,
                  )
                : null}
              {canExpand && (
                <div className="pointer-events-none absolute bottom-2 left-2 z-10 rounded-full border border-white/10 bg-black/65 px-2 py-0.5 text-[11px] font-medium text-white backdrop-blur-sm">
                  +{images.length - 1}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-2">
            {allDisplay.map((img) => renderCell(img, () => setModalImage(img)))}
          </div>
        )}
      </div>
      {modalImage && (
        <MediaLightbox
          label={
            modalImage.mediaType === "video" ? "Generated video" : "Generated image"
          }
          onClose={() => setModalImage(null)}
          actions={
            <GeneratedImageActions
              onDownload={() => handleDownload(modalImage)}
              onDelete={() => {
                setModalImage(null);
                onDeleteMedia?.(modalImage.id);
              }}
              onReuseAsReference={
                modalImage.mediaType !== "video" && onReuseAsReference
                  ? () => onReuseAsReference(modalImage.id)
                  : undefined
              }
            />
          }
        >
          {modalImage.mediaType === "video" ? (
            <video
              src={modalImage.url}
              controls
              autoPlay
              playsInline
              className="block max-h-[calc(100vh-4rem)] max-w-[calc(100vw-4rem)]"
            />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={modalImage.url}
              alt="Generated image"
              className="block h-auto max-h-[calc(100vh-4rem)] w-auto max-w-[calc(100vw-4rem)]"
            />
          )}
        </MediaLightbox>
      )}
    </Card>
  );
}

function CollapsiblePrompt({ text, id }: { text: string; id?: string }) {
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const ref = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const measure = () => {
      const lh = parseFloat(getComputedStyle(el).lineHeight);
      if (isNaN(lh)) return;
      setOverflows(el.scrollHeight > lh * 3 + 1);
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [text]);

  return (
    <div>
      <p
        ref={ref}
        id={id}
        className={cn(
          "text-[15px] text-foreground leading-relaxed",
          !expanded && "line-clamp-3",
        )}
      >
        {text}
      </p>
      {overflows && (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((e) => !e)}
          className="mt-0.5 text-xs text-muted-foreground hover:text-foreground cursor-pointer"
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
}

export default function PromptGroup(props: PromptGroupProps) {
  const [referenceModalImage, setReferenceModalImage] = useState<string | null>(
    null,
  );
  const modelOrder: string[] = [];
  const byModel: Record<string, MediaShape[]> = {};
  for (const img of props.images) {
    if (!byModel[img.modelSlug]) {
      byModel[img.modelSlug] = [];
      modelOrder.push(img.modelSlug);
    }
    byModel[img.modelSlug]!.push(img);
  }

  const refImages = props.referenceImages.filter((r) => r.url);
  const destinationProjects =
    props.projects?.filter((project) => project.id !== props.currentProjectId) ??
    [];
  const promptId = `prompt-${props.id}`;
  const inProgressCount = props.images.filter(
    (i) => i.status === "pending" || i.status === "running",
  ).length;

  const handleCopyPrompt = () => {
    navigator.clipboard.writeText(props.prompt).then(
      () => toast.success("Prompt copied"),
      () => toast.error("Couldn't copy the prompt"),
    );
  };

  return (
    <section
      aria-labelledby={promptId}
      className="group/prompt flex flex-col gap-3 [animation:promptGroupFadeIn_0.4s_ease_both]"
    >
      {/* prompt header */}
      <div className="flex items-start justify-between gap-4">
        <div className="max-w-4xl min-w-0 flex-1">
          <CollapsiblePrompt text={props.prompt} id={promptId} />
          <div className="text-muted-foreground mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
            <time dateTime={props.createdAt.toISOString()}>
              {fmtDate(props.createdAt)}
            </time>
            {props.aspectRatio && (
              <>
                <span aria-hidden className="opacity-40">
                  ·
                </span>
                <span>
                  {props.aspectRatio === "adaptive"
                    ? "Auto ratio"
                    : props.aspectRatio}
                </span>
              </>
            )}
            {inProgressCount > 0 && (
              <>
                <span aria-hidden className="opacity-40">
                  ·
                </span>
                <span className="text-primary-text flex items-center gap-1">
                  <Loader2 className="size-3 animate-spin" />
                  {inProgressCount} in progress
                </span>
              </>
            )}
            {refImages.length > 0 && (
              <>
                <span aria-hidden className="opacity-40">
                  ·
                </span>
                <div className="flex items-center gap-1">
                  {refImages.map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      aria-label="View reference image"
                      onClick={() => setReferenceModalImage(r.url!)}
                      className="focus-visible:ring-ring relative size-5 shrink-0 cursor-pointer overflow-hidden rounded border outline-none hover:ring-1 hover:ring-white/40 focus-visible:ring-2"
                    >
                      <Image
                        src={r.url!}
                        alt=""
                        fill
                        loading="lazy"
                        className="object-cover"
                        sizes="20px"
                      />
                    </button>
                  ))}
                  <span className="ml-0.5">
                    {refImages.length} reference
                    {refImages.length > 1 ? "s" : ""}
                  </span>
                </div>
              </>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {props.onReusePrompt && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground"
                    onClick={props.onReusePrompt}
                  />
                }
              >
                <CornerUpLeft />
                Reuse prompt
              </TooltipTrigger>
              <TooltipContent>
                Load this prompt and its output type and aspect ratio into the
                editor
              </TooltipContent>
            </Tooltip>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="text-muted-foreground"
                  aria-label="More actions"
                />
              }
            >
              <MoreHorizontal />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuGroup>
                <DropdownMenuItem onClick={handleCopyPrompt}>
                  <Copy />
                  Copy prompt
                </DropdownMenuItem>
                {props.onMovePrompt && (
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger>
                      <FolderInput />
                      Move to project
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent className="w-52">
                      {destinationProjects.length > 0 ? (
                        destinationProjects.map((project) => (
                          <DropdownMenuItem
                            key={project.id}
                            onClick={() => props.onMovePrompt?.(project.id)}
                          >
                            <span className="truncate">{project.name}</span>
                          </DropdownMenuItem>
                        ))
                      ) : (
                        <DropdownMenuItem disabled>
                          No other projects
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                )}
              </DropdownMenuGroup>
              {props.onDeletePrompt && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    variant="destructive"
                    onClick={props.onDeletePrompt}
                  >
                    <Trash2 />
                    Delete generation
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* one album per model */}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] items-start gap-3">
        {modelOrder.map((modelId) => (
          <ModelAlbum
            key={modelId}
            modelId={modelId}
            images={byModel[modelId]!}
            ar={props.aspectRatio ?? "1:1"}
            models={props.models}
            onDeleteMedia={props.onDeleteMedia}
            onRetryMedia={props.onRetryMedia}
            onReuseAsReference={props.onReuseAsReference}
            pinnedImages={props.pinnedImages}
            onPinnedImagesChange={props.onPinnedImagesChange}
          />
        ))}
      </div>
      {referenceModalImage && (
        <MediaLightbox
          label="Reference image"
          onClose={() => setReferenceModalImage(null)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={referenceModalImage}
            alt="Reference image"
            className="block h-auto max-h-[calc(100vh-4rem)] w-auto max-w-[calc(100vw-4rem)]"
          />
        </MediaLightbox>
      )}
    </section>
  );
}
