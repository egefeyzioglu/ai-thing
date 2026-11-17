"use client";

import type { ReactNode } from "react";

import { ToggleGroup, ToggleGroupItem } from "src/components/ui/toggle-group";
import { cn } from "src/lib/utils";

export type SegmentedOption<T extends string | number> = {
  value: T;
  label: ReactNode;
  icon?: ReactNode;
  disabled?: boolean;
  /** Shown as a native tooltip, e.g. to explain why an option is disabled. */
  title?: string;
};

type SegmentedControlProps<T extends string | number> = {
  value: T;
  onValueChange: (value: T) => void;
  options: readonly SegmentedOption<T>[];
  "aria-label": string;
  className?: string;
  itemClassName?: string;
};

/**
 * Single-select segmented control. Selecting the active option again keeps it
 * selected, so there is always exactly one value.
 */
export function SegmentedControl<T extends string | number>({
  value,
  onValueChange,
  options,
  "aria-label": ariaLabel,
  className,
  itemClassName,
}: SegmentedControlProps<T>) {
  return (
    <ToggleGroup
      aria-label={ariaLabel}
      value={[String(value)]}
      onValueChange={(next) => {
        const raw: unknown = next[0];
        if (raw === undefined) return;
        const option = options.find((o) => String(o.value) === raw);
        if (option && !option.disabled) onValueChange(option.value);
      }}
      className={cn(
        "bg-muted/40 ring-border grid w-full auto-cols-fr grid-flow-col gap-0.5 rounded-lg p-0.5 ring-1 ring-inset",
        className,
      )}
    >
      {options.map((option) => (
        <ToggleGroupItem
          key={String(option.value)}
          value={String(option.value)}
          disabled={option.disabled}
          title={option.title}
          size="sm"
          className={cn(
            "text-muted-foreground hover:text-foreground h-7 w-full min-w-0 rounded-md px-1.5 text-xs hover:bg-transparent",
            "aria-pressed:bg-accent aria-pressed:text-foreground aria-pressed:shadow-sm aria-pressed:ring-1 aria-pressed:ring-white/10",
            itemClassName,
          )}
        >
          {option.icon}
          <span className="truncate">{option.label}</span>
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
