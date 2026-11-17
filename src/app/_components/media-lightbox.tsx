"use client";

import type { ReactNode } from "react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { X } from "lucide-react";

import { cn } from "src/lib/utils";

type MediaLightboxProps = {
  /** Accessible name for the dialog, e.g. "Generated image". */
  label: string;
  onClose: () => void;
  /** The image or video. */
  children: ReactNode;
  /** Buttons overlaid on the media's top-right corner. */
  actions?: ReactNode;
  /** Content below the media, e.g. a primary action. */
  footer?: ReactNode;
};

/**
 * Full-screen media preview. Built on the Base UI dialog so focus moves in,
 * stays trapped while open, and returns to the trigger on close.
 */
export function MediaLightbox({
  label,
  onClose,
  children,
  actions,
  footer,
}: MediaLightboxProps) {
  return (
    <DialogPrimitive.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className="data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0 fixed inset-0 z-50 bg-black/85 backdrop-blur-sm duration-150" />
        <DialogPrimitive.Popup
          aria-label={label}
          className="data-open:animate-in data-open:fade-in-0 data-open:zoom-in-[0.98] fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 p-4 outline-none sm:p-8"
          onClick={(event) => {
            // Clicking the empty area around the media closes the preview.
            if (event.target === event.currentTarget) onClose();
          }}
        >
          <DialogPrimitive.Title className="sr-only">
            {label}
          </DialogPrimitive.Title>
          <DialogPrimitive.Close
            aria-label="Close preview"
            className="focus-visible:ring-ring absolute top-4 right-4 z-10 flex size-9 cursor-pointer items-center justify-center rounded-full border border-white/20 bg-black/50 text-white backdrop-blur-sm outline-none hover:bg-black/70 focus-visible:ring-2"
          >
            <X className="size-4" />
          </DialogPrimitive.Close>
          <div
            className={cn(
              "relative flex min-h-0 max-w-full items-center justify-center overflow-hidden rounded-lg border border-white/10 bg-black/30 shadow-2xl",
              footer ? "max-h-[calc(100%-3.5rem)]" : "max-h-full",
            )}
          >
            {children}
            {actions && (
              <div className="absolute top-3 right-3 z-10">{actions}</div>
            )}
          </div>
          {footer}
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
