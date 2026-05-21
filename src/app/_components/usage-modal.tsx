"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "src/components/ui/dialog";
import type { RouterOutputs } from "src/trpc/react";

type UsageSummary = RouterOutputs["usage"]["getCurrent"];

type UsageModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  usage: UsageSummary | undefined;
  currentRequestCost: number;
  isLoading: boolean;
};

function formatDate(date: Date | string | undefined) {
  if (!date) return "Loading";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(date));
}

function formatDateTime(date: Date | string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(date));
}

export function UsageModal({
  open,
  onOpenChange,
  usage,
  currentRequestCost,
  isLoading,
}: UsageModalProps) {
  const used = usage?.used ?? 0;
  const limit = usage?.limit ?? 0;
  const remaining = usage?.remaining ?? 0;
  const percentUsed = limit > 0 ? Math.min((used / limit) * 100, 100) : 0;
  const usageBarColor =
    percentUsed >= 100
      ? "bg-red-500"
      : percentUsed > 70
        ? "bg-amber-500"
        : "bg-blue-500";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Usage</DialogTitle>
          <DialogDescription>
            Monthly credits reset on {formatDate(usage?.periodEnd)} UTC.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div>
            <div className="mb-2 flex items-baseline justify-between">
              <span className="text-sm text-(--muted-foreground)">
                {isLoading ? "Loading usage" : `${used} of ${limit} credits used`}
              </span>
              <span className="text-sm text-(--muted-foreground)">
                {remaining} remaining
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded bg-(--muted)">
              <div
                className={`h-full ${usageBarColor}`}
                style={{ width: `${percentUsed}%` }}
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-md border border-(--border) p-3">
              <div className="text-xs text-(--muted-foreground) uppercase">
                Used
              </div>
              <div className="mt-1 text-lg font-medium">{used}</div>
            </div>
            <div className="rounded-md border border-(--border) p-3">
              <div className="text-xs text-(--muted-foreground) uppercase">
                Remaining
              </div>
              <div className="mt-1 text-lg font-medium">{remaining}</div>
            </div>
            <div className="rounded-md border border-(--border) p-3">
              <div className="text-xs text-(--muted-foreground) uppercase">
                Request
              </div>
              <div className="mt-1 text-lg font-medium">
                {currentRequestCost}
              </div>
            </div>
          </div>

          <div>
            <h3 className="mb-2 text-sm font-medium">Recent usage</h3>
            <div className="max-h-72 overflow-y-auto rounded-md border border-(--border)">
              {usage?.recent.length ? (
                <div className="divide-y divide-(--border)">
                  {usage.recent.map((row) => (
                    <div
                      key={row.id}
                      className="grid grid-cols-[1fr_auto] gap-3 p-3 text-sm"
                    >
                      <div className="min-w-0">
                        <div className="truncate font-medium">{row.model}</div>
                        <div className="mt-1 text-xs text-(--muted-foreground)">
                          {row.resolution ?? "1K"} / {row.aspectRatio ?? "1:1"} /{" "}
                          {formatDateTime(row.createdAt)}
                        </div>
                      </div>
                      <div className="text-right">
                        <div>{row.credits} credits</div>
                        <div className="mt-1 text-xs capitalize text-(--muted-foreground)">
                          {row.status}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="p-4 text-sm text-(--muted-foreground)">
                  {isLoading ? "Loading usage" : "No usage this month"}
                </div>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
