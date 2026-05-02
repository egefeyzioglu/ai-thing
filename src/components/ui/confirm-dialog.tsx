"use client";

import { useCallback, useEffect } from "react";
import { createPortal } from "react-dom";

import { Button } from "src/components/ui/button";

type ConfirmDialogProps = {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  isPending?: boolean;
};

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Delete",
  onConfirm,
  onCancel,
  isPending = false,
}: ConfirmDialogProps) {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isPending) onCancel();
    },
    [onCancel, isPending],
  );

  useEffect(() => {
    if (!open) return;
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, handleKeyDown]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
      aria-describedby="confirm-dialog-desc"
    >
      {/* backdrop */}
      <div
        className="absolute inset-0 bg-black/60"
        onClick={isPending ? undefined : onCancel}
      />

      {/* panel */}
      <div className="relative z-10 mx-4 w-full max-w-sm rounded-lg border border-neutral-800 bg-neutral-900 p-6 shadow-xl">
        <h3
          id="confirm-dialog-title"
          className="text-sm font-medium text-neutral-100"
        >
          {title}
        </h3>
        <p id="confirm-dialog-desc" className="mt-2 text-sm text-neutral-400">
          {description}
        </p>
        <div className="mt-6 flex justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={onCancel}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={onConfirm}
            disabled={isPending}
          >
            {isPending ? "Deleting…" : confirmLabel}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
