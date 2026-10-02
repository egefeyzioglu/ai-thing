import { ThreadId, type EnvironmentId } from "@t3tools/contracts";
import {
  Check,
  ChevronLeftIcon,
  ChevronRightIcon,
  Columns2,
  CornerDownLeft,
  ImageOff,
  X,
  XIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type KeyboardEvent } from "react";

import { isContextMenuOpen } from "~/contextMenuFallback";
import { cn } from "~/lib/utils";
import { imagesEnvironment } from "~/state/images";
import { useAtomCommand } from "~/state/use-atom-command";
import { Button } from "~/components/ui/button";
import { Dialog, DialogPopup, DialogTitle } from "~/components/ui/dialog";
import { Kbd } from "~/components/ui/kbd";
import { Spinner } from "~/components/ui/spinner";

import { ComparePane } from "./ImageCompare";
import { imageBasename, useImageAssetUrl, type ImageVersionItem } from "./useImageAssetUrl";

export interface ImageLightboxProps {
  environmentId: EnvironmentId;
  cwd: string;
  threadId: string | null;
  /** The alternatives under review, in filmstrip order. */
  items: ReadonlyArray<ImageVersionItem>;
  /** What they derive from; shown first, never culled. */
  source?: ImageVersionItem;
  initialIndex: number;
  onClose: () => void;
}

function FilmstripThumb({
  environmentId,
  cwd,
  item,
  active,
  kept,
  dropped,
  label,
  onSelect,
}: {
  environmentId: EnvironmentId;
  cwd: string;
  item: ImageVersionItem;
  active: boolean;
  kept: boolean;
  dropped: boolean;
  label?: string;
  onSelect: () => void;
}) {
  const asset = useImageAssetUrl(environmentId, cwd, item.path, item.version);
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-label={`${label ? `${label}: ` : ""}${item.ref}`}
      aria-current={active}
      className={cn(
        "relative size-16 shrink-0 cursor-pointer overflow-hidden rounded-md bg-black/50 outline-none ring-2 transition-[box-shadow,opacity]",
        active ? "ring-white" : kept ? "ring-success" : "ring-transparent hover:ring-white/40",
        dropped && "opacity-40",
      )}
    >
      {asset._tag === "Success" ? (
        <img src={asset.url} alt="" draggable={false} className="size-full object-cover" />
      ) : asset._tag === "Failure" ? (
        <ImageOff className="m-auto size-4 text-white/50" aria-hidden />
      ) : null}
      {label ? (
        <span className="absolute inset-x-0 bottom-0 bg-black/70 text-center text-3xs uppercase tracking-wide text-white/85">
          {label}
        </span>
      ) : null}
      {kept ? (
        <span className="absolute right-0.5 top-0.5 rounded-full bg-success p-0.5 text-white">
          <Check className="size-2.5" aria-hidden />
        </span>
      ) : dropped ? (
        <span className="absolute right-0.5 top-0.5 rounded-full bg-destructive p-0.5 text-white">
          <X className="size-2.5" aria-hidden />
        </span>
      ) : null}
    </button>
  );
}

function MainImage({
  environmentId,
  cwd,
  item,
}: {
  environmentId: EnvironmentId;
  cwd: string;
  item: ImageVersionItem;
}) {
  const asset = useImageAssetUrl(environmentId, cwd, item.path, item.version);
  if (asset._tag === "Failure") {
    return (
      <div className="flex flex-col items-center gap-2 text-sm text-white/70">
        <ImageOff className="size-6" aria-hidden />
        This version could not be loaded.
      </div>
    );
  }
  if (asset._tag !== "Success") return <Spinner size="lg" />;
  return (
    <img
      src={asset.url}
      alt={item.ref}
      draggable={false}
      className="max-h-full max-w-full object-contain"
    />
  );
}

/**
 * Full-screen cull: Space keeps, Backspace drops, Enter promotes, C compares
 * with the source. Decisions apply locally first and then fire the commands.
 */
export function ImageLightbox({
  environmentId,
  cwd,
  threadId,
  items,
  source,
  initialIndex,
  onClose,
}: ImageLightboxProps) {
  const strip = useMemo<ReadonlyArray<ImageVersionItem>>(
    () => (source ? [source, ...items] : items),
    [items, source],
  );
  const offset = source ? 1 : 0;
  const [index, setIndex] = useState(() =>
    Math.min(Math.max(initialIndex + offset, 0), Math.max(strip.length - 1, 0)),
  );
  const [kept, setKept] = useState(
    () => new Set(items.filter((item) => item.starred).map((item) => item.path)),
  );
  const [dropped, setDropped] = useState(
    () => new Set(items.filter((item) => item.rejected).map((item) => item.ref)),
  );
  const [compare, setCompare] = useState(false);

  const star = useAtomCommand(imagesEnvironment.star);
  const reject = useAtomCommand(imagesEnvironment.reject);
  const pick = useAtomCommand(imagesEnvironment.pick);
  const restore = useAtomCommand(imagesEnvironment.restore);

  const item = strip[index];
  const isSource = source !== undefined && index === 0;

  const move = useCallback(
    (direction: -1 | 1) => {
      setIndex((current) => {
        const count = strip.length;
        return count === 0 ? 0 : (((current + direction) % count) + count) % count;
      });
    },
    [strip.length],
  );

  const keep = useCallback(() => {
    if (!item || isSource) return;
    const wasKept = kept.has(item.path);
    setKept((current) => {
      const next = new Set(current);
      if (wasKept) next.delete(item.path);
      else next.add(item.path);
      return next;
    });
    void star({
      environmentId,
      input: { cwd, path: item.path, starred: !wasKept },
    });
    if (!wasKept && dropped.has(item.ref)) {
      setDropped((current) => {
        const next = new Set(current);
        next.delete(item.ref);
        return next;
      });
      void reject({
        environmentId,
        input: { cwd, path: item.path, version: item.version, rejected: false },
      });
    }
  }, [cwd, dropped, environmentId, isSource, item, kept, reject, star]);

  const drop = useCallback(() => {
    if (!item || isSource) return;
    const wasDropped = dropped.has(item.ref);
    setDropped((current) => {
      const next = new Set(current);
      if (wasDropped) next.delete(item.ref);
      else next.add(item.ref);
      return next;
    });
    void reject({
      environmentId,
      input: {
        cwd,
        path: item.path,
        version: item.version,
        rejected: !wasDropped,
      },
    });
    if (!wasDropped && kept.has(item.path)) {
      setKept((current) => {
        const next = new Set(current);
        next.delete(item.path);
        return next;
      });
      void star({
        environmentId,
        input: { cwd, path: item.path, starred: false },
      });
    }
    if (!wasDropped && index < strip.length - 1) move(1);
  }, [cwd, dropped, environmentId, index, isSource, item, kept, move, reject, star, strip.length]);

  const useAsCurrent = useCallback(() => {
    if (!item || isSource) return;
    const threadInput = threadId ? { threadId: ThreadId.make(threadId) } : {};
    if (source) {
      void pick({
        environmentId,
        input: { cwd, from: item.ref, to: source.path, ...threadInput },
      });
    } else {
      void restore({
        environmentId,
        input: { cwd, path: item.path, version: item.version, ...threadInput },
      });
    }
  }, [cwd, environmentId, isSource, item, pick, restore, source, threadId]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.defaultPrevented || isContextMenuOpen()) return;
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement)
      return;
    const handled = (() => {
      switch (event.key) {
        case "ArrowLeft":
          move(-1);
          return true;
        case "ArrowRight":
          move(1);
          return true;
        case " ":
          keep();
          return true;
        case "Backspace":
        case "Delete":
          drop();
          return true;
        case "Enter":
          useAsCurrent();
          return true;
        case "c":
        case "C":
          if (source) setCompare((value) => !value);
          return true;
        default:
          return false;
      }
    })();
    if (handled) {
      event.preventDefault();
      event.stopPropagation();
    }
  };

  useEffect(() => {
    const onEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape" || isContextMenuOpen()) return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onEscape, { capture: true });
    return () => window.removeEventListener("keydown", onEscape, { capture: true });
  }, [onClose]);

  if (!item) return null;
  const keptCount = kept.size;
  const droppedCount = dropped.size;
  const position = isSource ? null : index - offset + 1;
  const itemKept = kept.has(item.path);
  const itemDropped = dropped.has(item.ref);

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogPopup
        variant="media"
        showCloseButton={false}
        bottomStickOnMobile={false}
        className="row-start-1 h-[96vh] w-[98vw] max-w-[98vw]"
        onKeyDown={onKeyDown}
      >
        <DialogTitle className="sr-only">Review images</DialogTitle>
        <div className="flex h-full min-h-0 flex-col gap-2 p-2 text-white">
          <header className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 px-1 text-xs text-white/80">
            <span className="truncate font-medium text-white">{imageBasename(item.path)}</span>
            <span className="font-mono text-white/60">v{item.version}</span>
            {item.width && item.height ? (
              <span>
                {item.width}×{item.height}
              </span>
            ) : null}
            {item.model ? <span className="text-white/60">{item.model}</span> : null}
            {item.costUsd !== undefined ? (
              <span className="text-white/60">${item.costUsd.toFixed(2)}</span>
            ) : null}
            {isSource ? (
              <span className="rounded-sm bg-white/15 px-1 uppercase tracking-wide">source</span>
            ) : position !== null ? (
              <span>
                {position} / {items.length}
              </span>
            ) : null}
            <span className="ml-auto text-white/60">
              {keptCount} kept · {droppedCount} dropped
            </span>
            <Button
              size="icon-xs"
              variant="media-close"
              onClick={onClose}
              aria-label="Close review"
            >
              <XIcon />
            </Button>
          </header>

          <div className="relative flex min-h-0 flex-1 items-stretch justify-center gap-3">
            {compare && source && !isSource ? (
              <>
                <ComparePane environmentId={environmentId} cwd={cwd} item={source} label="source" />
                <ComparePane
                  environmentId={environmentId}
                  cwd={cwd}
                  item={item}
                  label="candidate"
                />
              </>
            ) : (
              <div
                className={cn(
                  "flex min-h-0 flex-1 items-center justify-center",
                  itemDropped && "opacity-50",
                )}
              >
                <MainImage key={item.ref} environmentId={environmentId} cwd={cwd} item={item} />
              </div>
            )}
            {strip.length > 1 ? (
              <>
                <Button
                  size="icon"
                  variant="media-navigation"
                  className="left-0"
                  aria-label="Previous"
                  onClick={() => move(-1)}
                >
                  <ChevronLeftIcon className="size-5" />
                </Button>
                <Button
                  size="icon"
                  variant="media-navigation"
                  className="right-0"
                  aria-label="Next"
                  onClick={() => move(1)}
                >
                  <ChevronRightIcon className="size-5" />
                </Button>
              </>
            ) : null}
          </div>

          <div className="flex shrink-0 flex-wrap items-center justify-center gap-2">
            <Button
              size="sm"
              variant={itemKept ? "default" : "media-close"}
              disabled={isSource}
              aria-pressed={itemKept}
              onClick={keep}
            >
              <Check aria-hidden />
              {itemKept ? "Kept" : "Keep"}
            </Button>
            <Button
              size="sm"
              variant={itemDropped ? "destructive" : "media-close"}
              disabled={isSource}
              aria-pressed={itemDropped}
              onClick={drop}
            >
              <X aria-hidden />
              {itemDropped ? "Dropped" : "Drop"}
            </Button>
            <Button
              size="sm"
              variant="media-close"
              disabled={!source || isSource}
              aria-pressed={compare}
              onClick={() => setCompare((value) => !value)}
            >
              <Columns2 aria-hidden />
              Compare with source
            </Button>
            <Button size="sm" variant="media-close" disabled={isSource} onClick={useAsCurrent}>
              <CornerDownLeft aria-hidden />
              {source ? "Use as current" : "Restore as current"}
            </Button>
          </div>

          <div className="flex shrink-0 justify-center">
            <div className="flex max-w-full gap-1.5 overflow-x-auto px-1 py-1">
              {strip.map((entry, entryIndex) => (
                <FilmstripThumb
                  key={entry.ref}
                  environmentId={environmentId}
                  cwd={cwd}
                  item={entry}
                  active={entryIndex === index}
                  kept={kept.has(entry.path) && !(source && entryIndex === 0)}
                  dropped={dropped.has(entry.ref)}
                  {...(source && entryIndex === 0 ? { label: "source" } : {})}
                  onSelect={() => setIndex(entryIndex)}
                />
              ))}
            </div>
          </div>

          <footer className="flex shrink-0 flex-wrap items-center justify-center gap-x-3 gap-y-1 text-2xs text-white/55">
            <span>
              <Kbd>Space</Kbd> keep
            </span>
            <span>
              <Kbd>⌫</Kbd> drop
            </span>
            <span>
              <Kbd>C</Kbd> compare
            </span>
            <span>
              <Kbd>↵</Kbd> {source ? "use as current" : "restore"}
            </span>
            <span>
              <Kbd>←</Kbd>
              <Kbd>→</Kbd> move
            </span>
            <span>
              <Kbd>Esc</Kbd> close
            </span>
          </footer>
        </div>
      </DialogPopup>
    </Dialog>
  );
}
