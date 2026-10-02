import type { EnvironmentId } from "@t3tools/contracts";
import { ArrowLeftRight, ImageOff, XIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "~/components/ui/button";
import { Dialog, DialogPopup, DialogTitle } from "~/components/ui/dialog";
import { Spinner } from "~/components/ui/spinner";

import { imageBasename, useImageAssetUrl, type ImageVersionItem } from "./useImageAssetUrl";

export function ComparePane({
  environmentId,
  cwd,
  item,
  label,
}: {
  environmentId: EnvironmentId;
  cwd: string;
  item: ImageVersionItem;
  label?: string;
}) {
  const asset = useImageAssetUrl(environmentId, cwd, item.path, item.version);
  return (
    <figure className="flex min-h-0 min-w-0 flex-1 flex-col gap-1.5">
      <figcaption className="flex items-baseline gap-1.5 truncate text-xs text-white/85">
        {label ? <span className="text-white/55">{label}</span> : null}
        <span className="truncate font-medium">{imageBasename(item.path)}</span>
        <span className="font-mono text-white/55">v{item.version}</span>
        {item.width && item.height ? (
          <span className="text-white/55">
            {item.width}×{item.height}
          </span>
        ) : null}
      </figcaption>
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-lg bg-black/40 ring-1 ring-white/10">
        {asset._tag === "Success" ? (
          <img
            src={asset.url}
            alt={item.ref}
            draggable={false}
            className="max-h-full max-w-full object-contain"
          />
        ) : asset._tag === "Failure" ? (
          <ImageOff className="size-6 text-white/50" aria-hidden />
        ) : (
          <Spinner size="md" />
        )}
      </div>
    </figure>
  );
}

export interface ImageCompareProps {
  environmentId: EnvironmentId;
  cwd: string;
  left: ImageVersionItem;
  right: ImageVersionItem;
  leftLabel?: string;
  rightLabel?: string;
  onClose: () => void;
}

/** Two versions side by side; swap flips them. */
export function ImageCompare({
  environmentId,
  cwd,
  left,
  right,
  leftLabel,
  rightLabel,
  onClose,
}: ImageCompareProps) {
  const [swapped, setSwapped] = useState(false);
  const first = swapped ? right : left;
  const second = swapped ? left : right;
  const firstLabel = swapped ? rightLabel : leftLabel;
  const secondLabel = swapped ? leftLabel : rightLabel;
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
        className="row-start-1 h-[92vh] w-[94vw] max-w-[94vw]"
      >
        <DialogTitle className="sr-only">Compare images</DialogTitle>
        <div className="flex h-full min-h-0 flex-col gap-3 p-3 text-white">
          <div className="flex shrink-0 items-center gap-2 text-xs text-white/80">
            <span className="font-medium">Compare</span>
            <Button
              size="xs"
              variant="media-close"
              onClick={() => setSwapped((value) => !value)}
              aria-label="Swap sides"
            >
              <ArrowLeftRight aria-hidden />
              Swap
            </Button>
            <Button
              size="icon-xs"
              variant="media-close"
              className="ml-auto"
              onClick={onClose}
              aria-label="Close compare"
            >
              <XIcon />
            </Button>
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-3 sm:flex-row">
            <ComparePane
              environmentId={environmentId}
              cwd={cwd}
              item={first}
              {...(firstLabel ? { label: firstLabel } : {})}
            />
            <ComparePane
              environmentId={environmentId}
              cwd={cwd}
              item={second}
              {...(secondLabel ? { label: secondLabel } : {})}
            />
          </div>
        </div>
      </DialogPopup>
    </Dialog>
  );
}
