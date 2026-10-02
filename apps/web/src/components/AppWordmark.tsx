import type { HTMLAttributes } from "react";
import { cn } from "~/lib/utils";

/**
 * AppWordmark — the "AI Thing" product mark: a small rounded "AI" tile
 * followed by the product name. Tailwind only; sized by the parent's font
 * size so it fits both the sidebar chrome and the welcome wizard header.
 */
export function AppWordmark({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      role="img"
      aria-label="AI Thing"
      className={cn("inline-flex items-center gap-1.5 font-medium tracking-tight", className)}
      {...props}
    >
      <span
        aria-hidden
        className="inline-flex size-5 shrink-0 items-center justify-center rounded-sm bg-primary text-2xs font-semibold leading-none text-primary-foreground"
      >
        AI
      </span>
      <span className="truncate">AI Thing</span>
    </span>
  );
}
