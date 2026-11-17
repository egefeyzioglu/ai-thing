"use client";

import Image from "next/image";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { Card } from "src/components/ui/card";
import { Button } from "src/components/ui/button";
import {
  AlertTriangle,
  ChevronDown,
  Copy,
  Download,
  FolderInput,
  ImagePlus,
  Loader2,
  MoreHorizontal,
  Pin,
  PinOff,
  Play,
  RotateCw,
  Trash2,
  Video,
  X,
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
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "src/components/ui/tooltip";
import { cn } from "src/lib/utils";
import { toast } from "sonner";

import { extensionFor } from "src/lib/utils";
import type { LocalStorageSetter, LocalStorageValue } from "src/lib/localStorage";

import type { MEDIA_STATUSES, MEDIA_TYPES } from "src/server/db/schema";

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

// Fan stack padding for n visible cards. Values: pt = (n-1)*4px, pr/pb = (n-1)*14+4px.
const FAN_PADDING = [
  "p-0",
  "p-0",
  "pt-1 pr-[18px] pb-[18px] pl-1",
  "pt-2 pr-8 pb-8 pl-2",
  "pt-3 pr-[46px] pb-[46px] pl-3",
];

// Per-depth Tailwind classes for fanned card items (depth 0 = top).
// sign = depth%2===0 ? +1 : -1. tx=depth*14*sign, ty=depth*7.7, rot=depth*2.2*sign.
const FAN_DEPTH = [
  {
    pos:    "relative",
    xform:  "",
    z:      "z-10",
    shadow: "shadow-[0_6px_20px_oklch(0_0_0/0.5),0_1px_3px_oklch(0_0_0/0.4)]",
  },
  {
    pos:    "absolute inset-0",
    xform:  "-translate-x-[14px] translate-y-[7.7px] -rotate-[2.2deg]",
    z:      "z-[9]",
    shadow: "shadow-[0_3px_10px_oklch(0_0_0/0.4)]",
  },
  {
    pos:    "absolute inset-0",
    xform:  "translate-x-[28px] translate-y-[15.4px] rotate-[4.4deg]",
    z:      "z-[8]",
    shadow: "shadow-[0_3px_10px_oklch(0_0_0/0.4)]",
  },
  {
    pos:    "absolute inset-0",
    xform:  "-translate-x-[42px] translate-y-[23.1px] -rotate-[6.6deg]",
    z:      "z-[7]",
    shadow: "shadow-[0_3px_10px_oklch(0_0_0/0.4)]",
  },
];

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
  const res = await fetch(url, { headers: { Accept: "image/png,*/*;q=0.8" } });
  if(!res.ok) throw new Error(`Download failed: Got ${res.status} from UploadThing`);

  const extension = extensionFor(
    res.headers.get("Content-Type")?.split(';')[0],
    expectedMimeType ?? "dat");

  const blob = await res.blob();
  const blobUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = blobUrl;
  a.download = `generated-${Date.now()}.${extension}`;
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
  }: {
    src: string;
    mediaKey: string;
    ar: string;
  }) {
    const videoRef = useRef<HTMLVideoElement>(null);
    return (
      <div
        className="relative w-full"
        style={{ aspectRatio: parseAspectRatio(ar) }}
        onMouseEnter={() => {
          const el = videoRef.current;
          if (!el) return;
          void el.play().catch((err) => {
            console.debug("video hover-play interrupted:", err);
          });
        }}
        onMouseLeave={() => {
          const el = videoRef.current;
          if (!el) return;
          el.pause();
          el.currentTime = 0;
        }}
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
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/20 transition-opacity group-hover/cell:opacity-0">
          <div className="flex size-12 items-center justify-center rounded-full bg-black/55 backdrop-blur-sm">
            <Play className="ml-0.5 size-5 fill-white text-white" strokeWidth={0} />
          </div>
        </div>
      </div>
    );
  },
  (prev, next) =>
    prev.mediaKey === next.mediaKey && prev.ar === next.ar,
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
}: ImageCellProps) {
  const isVideo = image.mediaType === "video";
  const canOpen = image.status === "succeeded" && Boolean(onOpen);

  const handleRootClick = () => {
    if (canOpen) onOpen?.();
  };

  let body: React.ReactNode;
  if (image.status === "pending" || image.status === "running") {
    body = isVideo ? (
      <VideoRenderingState ar={ar} createdAt={image.createdAt} />
    ) : (
      <div className="relative w-full bg-muted" style={{ aspectRatio: parseAspectRatio(ar) }}>
        <div className="absolute inset-0 animate-pulse bg-linear-to-br from-white/[0.02] via-white/[0.06] to-white/[0.02]" />
        <div className="absolute inset-0 flex items-center justify-center gap-2">
          <Loader2 className="size-4 animate-spin text-primary" />
          <span className="text-xs text-muted-foreground">Generating…</span>
        </div>
      </div>
    );
  } else if (image.status === "failed") {
    body = (
      <div className="relative w-full bg-muted" style={{ aspectRatio: parseAspectRatio(ar) }}>
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-4 py-2">
          <AlertTriangle className="size-4 text-destructive" />
          <p className="text-xs font-medium text-destructive">Generation failed</p>
          {image.error && (
            <p
              className="text-[10px] text-muted-foreground text-center line-clamp-4 break-words max-w-full"
              title={image.error}
            >
              {parseProviderErrorMessage(image.error)}
            </p>
          )}
          {onRetry && (
            <Button
              variant="outline"
              size="xs"
              onClick={(event) => {
                event.stopPropagation();
                onRetry();
              }}
              className="mt-0.5 cursor-pointer"
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
      <VideoPreview src={image.url} mediaKey={image.key} ar={ar} />
    ) : (
      <div className="relative w-full" style={{ aspectRatio: parseAspectRatio(ar) }}>
        <Image
          src={image.url}
          alt="Generated image"
          fill
          loading="lazy"
          className="object-cover"
          sizes="(max-width: 768px) 100vw, 33vw"
        />
      </div>
    );
  }

  return (
    <div
      role={canOpen ? "button" : undefined}
      tabIndex={canOpen ? 0 : undefined}
      onClick={handleRootClick}
      onKeyDown={(event) => {
        if (!canOpen) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen?.();
        }
      }}
      className={cn(
        "group/cell relative w-full rounded-md overflow-hidden bg-muted [animation:promptGroupFadeIn_0.25s_ease_both] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        canOpen && "cursor-pointer",
        isPinned
          ? "outline-2 outline-primary outline"
          : "outline outline-1 outline-white/5",
      )}
    >
      {body}
      {isVideo && image.status === "succeeded" && (
        <div
          className={cn(
            "absolute left-1.5 z-10 flex items-center gap-1 rounded-full bg-black/55 px-1.5 py-0.5 text-[9px] font-semibold tracking-wider text-white backdrop-blur-sm",
            isPinned ? "top-8" : "top-1.5",
          )}
        >
          <Video className="size-2.5" strokeWidth={2.5} />
          VIDEO
        </div>
      )}
      {isVideo &&
        image.status === "succeeded" &&
        image.durationMs != null && (
          <div className="absolute right-1.5 bottom-1.5 z-10 rounded-full bg-black/55 px-1.5 py-0.5 text-[10px] font-medium text-white backdrop-blur-sm">
            {Math.round(image.durationMs / 1000)}s
          </div>
        )}
      {isPinned && totalPinned > 1 && (
        <div className="absolute top-1.5 left-1.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-primary text-primary-foreground flex items-center gap-1 shadow-md">
          <PinIcon size={9} filled />
          {pinIndex + 1}/{totalPinned}
        </div>
      )}
      {isPinned && totalPinned === 1 && (
        <div className="absolute top-1.5 left-1.5 size-5 rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow-md">
          <PinIcon size={10} filled />
        </div>
      )}
      {image.status === "succeeded" && (
        <div className="absolute top-1.5 right-1.5 flex gap-1 items-center opacity-0 transition-opacity group-hover/cell:opacity-100 group-focus-within/cell:opacity-100">
          <GeneratedImageActions
            isPinned={isPinned}
            onTogglePin={onTogglePin}
            onDownload={onDownload}
            onDelete={onDelete}
            onReuseAsReference={isVideo ? undefined : onReuseAsReference}
          />
        </div>
      )}
    </div>
  );
}

function VideoModal({
  src,
  actions,
  onClose,
}: {
  src: string;
  actions?: React.ReactNode;
  onClose: () => void;
}) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label="Expanded video preview"
      onClick={onClose}
    >
      <button
        onClick={(event) => {
          event.stopPropagation();
          onClose();
        }}
        aria-label="Close video preview"
        className="absolute right-4 top-4 z-10 size-9 rounded-full border border-white/20 bg-black/50 text-white backdrop-blur-sm cursor-pointer hover:bg-black/70"
      >
        <X className="mx-auto size-4" />
      </button>
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" />
      <div className="relative z-10 flex h-[90vh] w-full items-center justify-center">
        <div
          className="relative overflow-hidden rounded-lg border border-white/10 bg-black/30 shadow-2xl"
          onClick={(event) => event.stopPropagation()}
        >
          <video
            src={src}
            controls
            autoPlay
            playsInline
            className="block max-h-[90vh] max-w-full"
          />
          {actions && (
            <div className="absolute top-3 right-3 z-10">{actions}</div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function ImageModal({
  src,
  alt,
  actions,
  onClose,
}: {
  src: string;
  alt: string;
  actions?: React.ReactNode;
  onClose: () => void;
}) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label="Expanded image preview"
      onClick={onClose}
    >
      <button
        onClick={(event) => {
          event.stopPropagation();
          onClose();
        }}
        aria-label="Close image preview"
        className="absolute right-4 top-4 z-10 size-9 rounded-full border border-white/20 bg-black/50 text-white backdrop-blur-sm cursor-pointer hover:bg-black/70"
      >
        <X className="mx-auto size-4" />
      </button>
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" />
      <div className="relative z-10 flex h-[90vh] w-full items-center justify-center">
        <div
          className="relative overflow-hidden rounded-lg border border-white/10 bg-black/30 shadow-2xl"
          onClick={(event) => event.stopPropagation()}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src}
            alt={alt}
            className="block max-h-[90vh] max-w-full h-auto w-auto"
          />
          {actions && (
            <div className="absolute top-3 right-3 z-10">
              {actions}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
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
  const unpinned = images.filter((i) => !pinnedMap.has(i.id));
  const allDisplay = [...pinned, ...unpinned];

  const successCount = images.filter((i) => i.status === "succeeded").length;
  const failedCount = images.filter((i) => i.status === "failed").length;

  const coverStack = pinned.length > 0 ? pinned : images;
  const visibleStack = coverStack.slice(0, 4);
  const hiddenStackCount = Math.max(0, coverStack.length - visibleStack.length);
  const canExpand = images.length > 1;

  const handleDownload = (img: MediaShape) => {
    void downloadImage(img.url).catch((err) => {
      console.error("Failed to download image", err);
      toast.error("Image download failed");
    });
  };

  const handleAlbumClick = (event: React.MouseEvent) => {
    if (!canExpand || expanded) return;

    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.closest("button, a, input, textarea, select, [role='button']")) return;

    setExpanded(true);
  };

  return (
    <Card
      className={cn(
        "group/album rounded-xl gap-0 py-0 [animation:promptGroupFadeIn_0.3s_ease_both]",
        canExpand && !expanded && "cursor-pointer",
      )}
      onClick={handleAlbumClick}
    >
      {/* header */}
      <div className="px-3 pt-2.5 pb-2 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-[13px] font-medium">{model?.name ?? modelId}</div>
          <div className="flex items-center gap-1.5 mt-0.5 text-[11px] text-muted-foreground">
            <span>{model?.provider}</span>
            {isVideoAlbum && (
              <>
                <span className="opacity-50">·</span>
                <span className="text-primary">video</span>
              </>
            )}
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
                <span className="text-primary flex items-center gap-0.5">
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
        {images.length > 1 && (
          <Button
            variant="ghost"
            size="xs"
            aria-expanded={expanded}
            onClick={(event) => {
              event.stopPropagation();
              setExpanded((e) => !e);
            }}
            className="text-muted-foreground shrink-0 cursor-pointer gap-1"
          >
            {expanded ? "Stack" : `All ${images.length}`}
            <ChevronDown
              className={cn(
                "transition-transform duration-200",
                expanded && "rotate-180",
              )}
            />
          </Button>
        )}
      </div>

      {/* body */}
      <div className="px-3 pb-3">
        {!expanded ? (
          <div className="relative">
            <div className={cn("relative", FAN_PADDING[visibleStack.length])}>
              {visibleStack.length === 0 ? (
                <div className="rounded-md bg-muted" style={{ aspectRatio: parseAspectRatio(ar) }} />
              ) : (
                [...visibleStack].reverse().map((img, idx) => {
                  const depth = visibleStack.length - 1 - idx; // 0 = top
                  const dc = FAN_DEPTH[depth]!;
                  const isPinned = pinnedMap.has(img.id);
                  const pinIdx = pinned.findIndex((p) => p.id === img.id);
                  return (
                    <div
                      key={img.id}
                      inert={depth !== 0 ? true : undefined}
                      className={cn(
                        "rounded-md transition-transform duration-[250ms]",
                        dc.pos,
                        dc.xform,
                        dc.z,
                        dc.shadow,
                      )}
                    >
                      <ImageCell
                        image={img}
                        ar={ar}
                        isPinned={isPinned}
                        pinIndex={pinIdx}
                        totalPinned={pinned.length}
                        onTogglePin={() => togglePin(img.id)}
                        onDownload={() => handleDownload(img)}
                        onDelete={() => onDeleteMedia?.(img.id)}
                        onRetry={onRetryMedia ? () => onRetryMedia(img.id) : undefined}
                        onReuseAsReference={onReuseAsReference ? () => onReuseAsReference(img.id) : undefined}
                        onOpen={images.length === 1 ? () => setModalImage(img) : undefined}
                      />
                    </div>
                  );
                })
              )}
              {hiddenStackCount > 0 && (
                <div className="absolute bottom-2 right-2 text-[11px] font-semibold px-2 py-1 rounded-full bg-black/65 border border-white/10 text-white z-20 backdrop-blur-sm">
                  +{hiddenStackCount} more{pinned.length > 0 ? " pinned" : ""}
                </div>
              )}
            </div>
            {pinned.length === 0 && images.length > 1 && (
              <div className="absolute bottom-2 left-2 text-[11px] px-2 py-1 rounded-full bg-black/65 border border-white/10 text-white/85 flex items-center gap-1 pointer-events-none z-20 backdrop-blur-sm opacity-0 transition-opacity group-hover/album:opacity-100 group-focus-within/album:opacity-100">
                Click to see all {images.length}
              </div>
            )}
          </div>
        ) : (
          <div className={cn("grid gap-2", images.length === 1 ? "grid-cols-1" : "grid-cols-2")}>
            {allDisplay.map((img) => {
              const isPinned = pinnedMap.has(img.id);
              const pinIdx = pinned.findIndex((p) => p.id === img.id);
              return (
                <ImageCell
                  key={img.id}
                  image={img}
                  ar={ar}
                  isPinned={isPinned}
                  pinIndex={pinIdx}
                  totalPinned={pinned.length}
                  onTogglePin={() => togglePin(img.id)}
                  onDownload={() => handleDownload(img)}
                  onDelete={() => onDeleteMedia?.(img.id)}
                  onRetry={onRetryMedia ? () => onRetryMedia(img.id) : undefined}
                  onReuseAsReference={onReuseAsReference ? () => onReuseAsReference(img.id) : undefined}
                  onOpen={() => setModalImage(img)}
                />
              );
            })}
          </div>
        )}
      </div>
      {modalImage &&
        (modalImage.mediaType === "video" ? (
          <VideoModal
            src={modalImage.url}
            onClose={() => setModalImage(null)}
            actions={
              <GeneratedImageActions
                onDownload={() => handleDownload(modalImage)}
                onDelete={() => {
                  setModalImage(null);
                  onDeleteMedia?.(modalImage.id);
                }}
              />
            }
          />
        ) : (
          <ImageModal
            src={modalImage.url}
            alt="Expanded generated image"
            onClose={() => setModalImage(null)}
            actions={
              <GeneratedImageActions
                onDownload={() => handleDownload(modalImage)}
                onDelete={() => {
                  setModalImage(null);
                  onDeleteMedia?.(modalImage.id);
                }}
                onReuseAsReference={
                  onReuseAsReference
                    ? () => onReuseAsReference(modalImage.id)
                    : undefined
                }
              />
            }
          />
        ))}
    </Card>
  );
}

function CollapsiblePrompt({ text }: { text: string }) {
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
      aria-label="Generation"
      className="group/prompt flex flex-col gap-3 [animation:promptGroupFadeIn_0.4s_ease_both]"
    >
      {/* prompt header */}
      <div className="flex items-start justify-between gap-4">
        <div className="max-w-4xl min-w-0 flex-1">
          <CollapsiblePrompt text={props.prompt} />
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
                <span className="text-primary flex items-center gap-1">
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
                <RotateCw />
                Reuse
              </TooltipTrigger>
              <TooltipContent>Put this prompt back in the editor</TooltipContent>
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
      <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] items-start gap-3">
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
        <ImageModal
          src={referenceModalImage}
          alt="Expanded reference image"
          onClose={() => setReferenceModalImage(null)}
        />
      )}
    </section>
  );
}
