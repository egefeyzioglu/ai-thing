"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

import { Card } from "src/components/ui/card";
import { Button } from "src/components/ui/button";
import { Trash2 } from "lucide-react";
import { cn } from "src/lib/utils";
import { toast } from "sonner";

import { extensionFor } from "src/lib/utils";
import type { LocalStorageSetter, LocalStorageValue } from "src/lib/localStorage";

import type { IMAGE_STATUSES } from "src/server/db/schema";

export type ModelInfo = { slug: string; name: string; provider: string };

type ImageShape = {
  id: string;
  url: string;
  modelSlug: string;
  status: (typeof IMAGE_STATUSES)[number];
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
  images: ImageShape[];
  referenceImages: { url?: string; id: string }[];
  models: ModelInfo[];
  onDeletePrompt?: () => void;
  onDeleteImage?: (imageId: string) => void;
  onRetryImage?: (imageId: string) => void;
  onReuseAsReference?: (imageId: string) => Promise<void>;
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

function Spinner() {
  return (
    <div className="size-[18px] rounded-full border-2 border-border border-t-blue-500 animate-spin" />
  );
}

function PinIcon({ size = 12, filled = false }: { size?: number; filled?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <path
        d="M10.5 1.5L14.5 5.5M9 3L13 7M9.5 6.5L4 12M5.5 8L2 11.5L4.5 14L8 10.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill={filled ? "currentColor" : "none"}
      />
      <path
        d="M10 2L14 6L11 9L7 5L10 2Z"
        fill={filled ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
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

type ImageCellProps = {
  image: ImageShape;
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

function GeneratedImageActions({
  isPinned = false,
  onTogglePin,
  onDownload,
  onDelete,
  onReuseAsReference,
}: GeneratedImageActionsProps) {
  const [reusing, setReusing] = useState(false);

  return (
    <div className="flex gap-1 items-center">
      {onTogglePin && (
        <button
          onClick={(event) => {
            event.stopPropagation();
            onTogglePin();
          }}
          title={isPinned ? "Unpin" : "Pin as cover"}
          className={cn(
            "h-6 px-2 rounded-full text-[11px] font-medium flex items-center gap-1 cursor-pointer border transition-colors",
            isPinned
              ? "bg-blue-500 border-blue-500 text-white"
              : "bg-[oklch(0.09_0.012_258/0.82)] border-border text-foreground backdrop-blur-sm",
          )}
        >
          <PinIcon size={11} filled={isPinned} />
          {isPinned ? "Pinned" : "Pin"}
        </button>
      )}
      {onReuseAsReference && (
        <button
          onClick={(event) => {
            event.stopPropagation();
            if (reusing) return;
            setReusing(true);
            void onReuseAsReference().finally(() => setReusing(false));
          }}
          disabled={reusing}
          aria-label="Reuse as reference"
          title={reusing ? "Saving as reference…" : "Reuse as reference image"}
          className="size-6 rounded-full bg-[oklch(0.09_0.012_258/0.82)] border border-border text-foreground cursor-pointer flex items-center justify-center backdrop-blur-sm disabled:opacity-50"
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
            <rect x="2" y="3" width="12" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
            <circle cx="5.5" cy="6.5" r="1.2" stroke="currentColor" strokeWidth="1" />
            <path d="M2 11L5.5 8L8 10L11 7L14 10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      )}
      <button
        onClick={(event) => {
          event.stopPropagation();
          onDownload();
        }}
        aria-label="Download"
        title="Download"
        className="size-6 rounded-full bg-[oklch(0.09_0.012_258/0.82)] border border-border text-foreground cursor-pointer flex items-center justify-center backdrop-blur-sm"
      >
        <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
          <path
            d="M6 1V8M6 8L3 5.5M6 8L9 5.5M2 10.5H10"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      <button
        onClick={(event) => {
          event.stopPropagation();
          onDelete();
        }}
        aria-label="Delete image"
        title="Delete image"
        className="size-6 rounded-full bg-[oklch(0.09_0.012_258/0.82)] border border-border text-muted-foreground cursor-pointer flex items-center justify-center backdrop-blur-sm"
      >
        <Trash2 className="size-3.5" strokeWidth={2} />
      </button>
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
  const canOpen = image.status === "succeeded" && Boolean(onOpen);

  const handleRootClick = () => {
    if (canOpen) onOpen?.();
  };

  let body: React.ReactNode;
  if (image.status === "pending" || image.status === "running") {
    body = (
      <div className="relative w-full bg-muted" style={{ aspectRatio: parseAspectRatio(ar) }}>
        <div className="absolute inset-0 flex items-center justify-center gap-2">
          <Spinner />
          <span className="text-xs text-muted-foreground animate-pulse">Generating…</span>
        </div>
      </div>
    );
  } else if (image.status === "failed") {
    body = (
      <div className="relative w-full bg-muted" style={{ aspectRatio: parseAspectRatio(ar) }}>
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2.5">
          <p className="text-xs text-destructive">Generation failed</p>
          {onRetry && (
            <Button variant="outline" size="xs" onClick={onRetry} className="cursor-pointer">
              Retry
            </Button>
          )}
        </div>
      </div>
    );
  } else {
    body = (
      <div className="relative w-full" style={{ aspectRatio: parseAspectRatio(ar) }}>
        <Image
          src={image.url}
          alt="Generated image"
          fill
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
        "group/cell relative w-full rounded-md overflow-hidden [animation:promptGroupFadeIn_0.25s_ease_both]",
        canOpen && "cursor-pointer",
        isPinned
          ? "outline-2 outline-[oklch(0.63_0.18_258)] outline"
          : "outline outline-1 outline-border",
      )}
    >
      {body}
      {isPinned && totalPinned > 1 && (
        <div className="absolute top-1.5 left-1.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-blue-500 text-white flex items-center gap-1 shadow-md">
          <PinIcon size={9} filled />
          {pinIndex + 1}/{totalPinned}
        </div>
      )}
      {isPinned && totalPinned === 1 && (
        <div className="absolute top-1.5 left-1.5 size-5 rounded-full bg-blue-500 text-white flex items-center justify-center shadow-md">
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
            onReuseAsReference={onReuseAsReference}
          />
        </div>
      )}
    </div>
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
        className="absolute right-4 top-4 z-10 size-9 rounded-full border border-white/20 bg-black/50 text-white backdrop-blur-sm cursor-pointer"
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="mx-auto">
          <path d="M2 2L10 10M10 2L2 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
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
  images: ImageShape[];
  ar: string;
  models: ModelInfo[];
  onDeleteImage?: (imageId: string) => void;
  onRetryImage?: (imageId: string) => void;
  onReuseAsReference?: (imageId: string) => Promise<void>;
  pinnedImages: PinnedImages;
  onPinnedImagesChange: SetPinnedImages;
};

function ModelAlbum({ modelId, images, ar, models, onDeleteImage, onRetryImage, onReuseAsReference, pinnedImages, onPinnedImagesChange }: ModelAlbumProps) {
  const model = models.find((m) => m.slug === modelId);
  const [expanded, setExpanded] = useState(false);
  const [modalImage, setModalImage] = useState<ImageShape | null>(null);
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

  const handleDownload = (img: ImageShape) => {
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
        "group/album rounded-lg gap-0 py-0 [animation:promptGroupFadeIn_0.3s_ease_both]",
        canExpand && !expanded && "cursor-pointer",
      )}
      onClick={handleAlbumClick}
    >
      {/* header */}
      <div className="px-3 py-2.5 flex items-center justify-between gap-2 border-b border-border">
        <div className="min-w-0">
          <div className="text-xs font-semibold">{model?.name ?? modelId}</div>
          <div className="flex items-center gap-1.5 mt-px text-[10px] text-muted-foreground">
            <span>{model?.provider}</span>
            {successCount > 0 && (
              <>
                <span className="opacity-50">·</span>
                <span>{successCount} image{successCount !== 1 ? "s" : ""}</span>
              </>
            )}
            {pinned.length > 0 && (
              <>
                <span className="opacity-50">·</span>
                <span className="text-blue-500 flex items-center gap-0.5">
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
            variant="outline"
            size="xs"
            onClick={(event) => {
              event.stopPropagation();
              setExpanded((e) => !e);
            }}
            className="shrink-0 gap-1 cursor-pointer"
          >
            {expanded ? "Collapse" : `View all ${images.length}`}
            <svg
              width="9"
              height="9"
              viewBox="0 0 10 10"
              fill="none"
              className={cn("transition-transform duration-200", expanded && "rotate-180")}
            >
              <path
                d="M2 4L5 7L8 4"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </Button>
        )}
      </div>

      {/* body */}
      <div className="p-3.5">
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
                        onDelete={() => onDeleteImage?.(img.id)}
                        onRetry={onRetryImage ? () => onRetryImage(img.id) : undefined}
                        onReuseAsReference={onReuseAsReference ? () => onReuseAsReference(img.id) : undefined}
                        onOpen={expanded ? () => setModalImage(img) : undefined}
                      />
                    </div>
                  );
                })
              )}
              {hiddenStackCount > 0 && (
                <div className="absolute bottom-2 right-2 text-[11px] font-semibold px-2 py-1 rounded-full bg-[oklch(0.09_0.012_258/0.85)] border border-border text-foreground z-20 backdrop-blur-sm">
                  +{hiddenStackCount} more{pinned.length > 0 ? " pinned" : ""}
                </div>
              )}
            </div>
            {pinned.length === 0 && images.length > 1 && (
              <div className="absolute bottom-2 left-2 text-[11px] px-2 py-1 rounded-full bg-[oklch(0.09_0.012_258/0.82)] border border-border text-muted-foreground flex items-center gap-1 pointer-events-none z-20 backdrop-blur-sm opacity-0 transition-opacity group-hover/album:opacity-100 group-focus-within/album:opacity-100">
                <PinIcon size={10} />
                Pin to set cover · expand to see all
              </div>
            )}
          </div>
        ) : (
          <div className={cn("grid gap-2.5", images.length === 1 ? "grid-cols-1" : "grid-cols-2")}>
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
                  onDelete={() => onDeleteImage?.(img.id)}
                  onRetry={onRetryImage ? () => onRetryImage(img.id) : undefined}
                  onReuseAsReference={onReuseAsReference ? () => onReuseAsReference(img.id) : undefined}
                  onOpen={() => setModalImage(img)}
                />
              );
            })}
          </div>
        )}
      </div>
      {modalImage && (
        <ImageModal
          src={modalImage.url}
          alt="Expanded generated image"
          onClose={() => setModalImage(null)}
          actions={
            <GeneratedImageActions
              onDownload={() => handleDownload(modalImage)}
              onDelete={() => {
                setModalImage(null);
                onDeleteImage?.(modalImage.id);
              }}
              onReuseAsReference={onReuseAsReference ? () => onReuseAsReference(modalImage.id) : undefined}
            />
          }
        />
      )}
    </Card>
  );
}

export default function PromptGroup(props: PromptGroupProps) {
  const [referenceModalImage, setReferenceModalImage] = useState<string | null>(null);
  const modelOrder: string[] = [];
  const byModel: Record<string, ImageShape[]> = {};
  for (const img of props.images) {
    if (!byModel[img.modelSlug]) {
      byModel[img.modelSlug] = [];
      modelOrder.push(img.modelSlug);
    }
    byModel[img.modelSlug]!.push(img);
  }

  const refImages = props.referenceImages.filter((r) => r.url);

  return (
    <div
      className="group/prompt flex flex-col gap-3 [animation:promptGroupFadeIn_0.4s_ease_both]"
    >
      {/* prompt header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm text-foreground leading-relaxed">{props.prompt}</p>
          <div className="flex items-center gap-2.5 mt-1.5 flex-wrap">
            <p className="text-[11px] text-muted-foreground/60">{fmtDate(props.createdAt)}</p>
            {refImages.length > 0 && (
              <div className="flex items-center gap-1">
                {refImages.map((r) => (
                  <div
                    key={r.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => setReferenceModalImage(r.url!)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setReferenceModalImage(r.url!);
                      }
                    }}
                    className="relative size-[18px] rounded border border-border overflow-hidden shrink-0 cursor-pointer"
                  >
                    <Image src={r.url!} alt="Reference" fill className="object-cover" sizes="18px" />
                  </div>
                ))}
                <span className="text-[10px] text-muted-foreground/60 ml-0.5">
                  {refImages.length} ref{refImages.length > 1 ? "s" : ""}
                </span>
              </div>
            )}
          </div>
        </div>
        {props.onDeletePrompt && (
          <button
            onClick={props.onDeletePrompt}
            className="px-2.5 py-1 text-[11px] bg-transparent border border-border rounded-md text-muted-foreground cursor-pointer hover:border-destructive hover:text-destructive transition-colors shrink-0 opacity-0 group-hover/prompt:opacity-100 group-focus-within/prompt:opacity-100"
          >
            Delete
          </button>
        )}
      </div>

      {/* model albums — 3-column grid */}
      <div className="grid grid-cols-3 gap-3.5 items-start">
        {modelOrder.map((modelId) => (
          <ModelAlbum
            key={modelId}
            modelId={modelId}
            images={byModel[modelId]!}
            ar={props.aspectRatio ?? "1:1"}
            models={props.models}
            onDeleteImage={props.onDeleteImage}
            onRetryImage={props.onRetryImage}
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
    </div>
  );
}
