import type { EnvironmentId, ImageIndexEntry } from "@t3tools/contracts";
import { Check, GitBranch, ImageOff, Star, X } from "lucide-react";
import { memo } from "react";

import { cn } from "~/lib/utils";
import { Button } from "~/components/ui/button";
import { Spinner } from "~/components/ui/spinner";

import { imageBasename, imageDirname, useImageAssetUrl } from "./useImageAssetUrl";

export interface ImageTileProps {
  environmentId: EnvironmentId;
  cwd: string;
  entry: ImageIndexEntry;
  selected: boolean;
  /** Alternatives waiting for a decision around this file. */
  reviewCount: number;
  onOpen: () => void;
  onReview: () => void;
  onStar: (starred: boolean) => void;
  onDrop: (rejected: boolean) => void;
}

export const ImageTile = memo(function ImageTile({
  environmentId,
  cwd,
  entry,
  selected,
  reviewCount,
  onOpen,
  onReview,
  onStar,
  onDrop,
}: ImageTileProps) {
  const asset = useImageAssetUrl(environmentId, cwd, entry.exists ? entry.path : null);
  const name = imageBasename(entry.path);
  const folder = imageDirname(entry.path);
  const dimmed = entry.rejected || !entry.exists;
  const isAlternative = entry.parents.length > 0 && !entry.starred;

  return (
    <div
      className={cn(
        "group relative aspect-square overflow-hidden rounded-lg border bg-muted/40",
        selected ? "ring-2 ring-ring ring-offset-1 ring-offset-background" : "border-border/70",
      )}
      data-path={entry.path}
    >
      <button
        type="button"
        className="absolute inset-0 flex cursor-pointer items-center justify-center outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={`Inspect ${entry.path}`}
        onClick={onOpen}
      >
        {!entry.exists ? (
          <ImageOff className="size-5 text-muted-foreground" aria-hidden />
        ) : asset._tag === "Success" ? (
          <img
            src={asset.url}
            alt={name}
            loading="lazy"
            draggable={false}
            className={cn(
              "size-full object-cover transition-opacity",
              dimmed && "opacity-40 grayscale",
            )}
          />
        ) : asset._tag === "Failure" ? (
          <ImageOff className="size-5 text-muted-foreground" aria-hidden />
        ) : (
          <Spinner size="sm" tone="muted" />
        )}
      </button>

      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-1 p-1.5">
        <div className="flex flex-wrap gap-1">
          {entry.versions > 1 ? (
            <span className="rounded-sm bg-black/65 px-1 font-mono text-3xs leading-4 text-white">
              v{entry.current}
            </span>
          ) : null}
          {entry.familySize > 1 ? (
            <span className="inline-flex items-center gap-0.5 rounded-sm bg-black/65 px-1 text-3xs leading-4 text-white">
              <GitBranch className="size-2.5" aria-hidden />
              {entry.familySize}
            </span>
          ) : null}
        </div>
        <button
          type="button"
          className={cn(
            "pointer-events-auto inline-flex size-5 cursor-pointer items-center justify-center rounded-sm bg-black/70 outline-none transition-opacity hover:bg-black/90 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-white",
            entry.starred
              ? "text-warning-foreground"
              : "text-white/80 opacity-0 group-hover:opacity-100",
          )}
          aria-label={entry.starred ? "Unstar" : "Star"}
          aria-pressed={entry.starred}
          onClick={() => onStar(!entry.starred)}
        >
          <Star className={cn("size-3", entry.starred && "fill-current")} aria-hidden />
        </button>
      </div>

      {dimmed ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="rounded-sm bg-black/70 px-1.5 py-0.5 text-3xs font-medium uppercase tracking-wide text-white/90">
            {entry.exists ? "dropped" : "missing"}
          </span>
        </div>
      ) : null}

      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-1 bg-gradient-to-t from-black/75 via-black/40 to-transparent p-1.5 pt-5">
        <div className="min-w-0 text-white">
          <div className="truncate text-xs font-medium leading-4">{name}</div>
          {folder ? (
            <div className="truncate font-mono text-3xs leading-3 text-white/65">{folder}</div>
          ) : null}
        </div>
        {reviewCount > 0 ? (
          <Button
            size="micro"
            variant="overlay"
            className="pointer-events-auto shrink-0"
            onClick={onReview}
          >
            Review {reviewCount}
          </Button>
        ) : null}
      </div>

      {isAlternative && !dimmed ? (
        <div className="pointer-events-none absolute inset-x-0 top-1/2 flex -translate-y-1/2 items-center justify-center gap-1.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
          <Button
            size="xs"
            variant="overlay"
            className="pointer-events-auto"
            aria-label={`Keep ${name}`}
            onClick={() => onStar(true)}
          >
            <Check className="text-success" aria-hidden />
            Keep
          </Button>
          <Button
            size="xs"
            variant="overlay"
            className="pointer-events-auto"
            aria-label={`Drop ${name}`}
            onClick={() => onDrop(true)}
          >
            <X className="text-destructive" aria-hidden />
            Drop
          </Button>
        </div>
      ) : null}
    </div>
  );
});
