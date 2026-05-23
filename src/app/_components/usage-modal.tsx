"use client";

import { AlertTriangle } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "src/components/ui/dialog";
import { Switch } from "src/components/ui/switch";
import { cn } from "src/lib/utils";
import type { RouterOutputs } from "src/trpc/react";

type UsageSummary = RouterOutputs["usage"]["getCurrent"];
type UsageRow = UsageSummary["recent"][number];

type UsageModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  usage: UsageSummary | undefined;
  currentRequestCost: number;
  isLoading: boolean;
  canBypassLimits: boolean;
  bypassMonthlyQuota: boolean;
  onBypassMonthlyQuotaChange: (value: boolean) => void;
};

function getPercent(used?: number, limit?: number) {
  if (used === undefined || limit === undefined || limit === 0) return 0;
  return (used / limit) * 100;
}

function thresholdBg(percent: number) {
  if (percent >= 100) return "bg-red-500";
  if (percent > 70) return "bg-amber-500";
  return "bg-blue-500";
}

function thresholdText(percent: number) {
  if (percent >= 100) return "text-red-400";
  if (percent > 70) return "text-amber-400";
  return "text-blue-400";
}

function formatMediumDate(date: Date | string | undefined) {
  if (!date) return "—";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(date));
}

function formatRelative(date: Date | string) {
  const diff = (Date.now() - new Date(date).getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function formatUsdMicros(value: number) {
  if (value > 0 && value < 10_000) return "<$0.01";

  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value / 1_000_000);
}

function formatRowCost(row: UsageRow) {
  if (row.costUsdMicros === null) return "cost pending";
  const prefix = row.costStatus === "estimated" ? "~" : "";
  return `${prefix}${formatUsdMicros(row.costUsdMicros)}`;
}

function StatusDot({ status }: { status: UsageRow["status"] }) {
  const cls =
    status === "consumed"
      ? "bg-blue-500"
      : status === "reserved"
        ? "bg-amber-500"
        : "bg-(--muted-foreground)/40";
  return (
    <span
      className={cn("inline-block size-1.5 shrink-0 rounded-full", cls)}
      aria-hidden
    />
  );
}

export function UsageModal({
  open,
  onOpenChange,
  usage,
  currentRequestCost,
  isLoading,
  canBypassLimits,
  bypassMonthlyQuota,
  onBypassMonthlyQuotaChange,
}: UsageModalProps) {
  const used = usage?.used ?? 0;
  const limit = usage?.limit ?? 0;
  const remaining = usage?.remaining ?? 0;
  const percent = getPercent(used, limit);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Usage</DialogTitle>
          <DialogDescription>
            Monthly credits reset on {formatMediumDate(usage?.periodEnd)} UTC.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-5">
          {percent >= 100 && !bypassMonthlyQuota && (
            <div className="flex items-start gap-3 rounded-md border border-red-500/40 bg-red-500/10 p-3">
              <AlertTriangle
                size={16}
                className="mt-0.5 shrink-0 text-red-400"
              />
              <div className="text-sm text-red-300">
                Out of monthly credits — new generations are paused until{" "}
                {formatMediumDate(usage?.periodEnd)}.
              </div>
            </div>
          )}

          <div>
            <div className="mb-2 flex items-baseline justify-between gap-3">
              <div className="flex items-baseline gap-2">
                <span className="font-heading text-3xl font-semibold tabular-nums">
                  {used}
                </span>
                <span className="text-sm text-(--muted-foreground)">
                  / {limit} credits
                </span>
              </div>
              <span
                className={cn(
                  "text-sm font-medium tabular-nums",
                  thresholdText(percent),
                )}
              >
                {percent.toFixed(0)}%
              </span>
            </div>
            <div
              className={cn(
                "relative h-2 overflow-visible rounded-full bg-(--muted)",
              )}
            >
              <div
                className={cn(
                  "h-full rounded-full transition-[width] duration-500",
                  bypassMonthlyQuota ? "border-r border-black/60" : thresholdBg(percent),
                )}
                style={{
                  width: `${Math.min(percent, 100)}%`,
                  ...(bypassMonthlyQuota
                    ? {
                        backgroundImage:
                          "repeating-linear-gradient(135deg, #facc15 0 10px, #111827 10px 20px)",
                      }
                    : {}),
                }}
              />
              {bypassMonthlyQuota && (
                <div className="pointer-events-none absolute top-1/2 left-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center">
                  <span className="rounded-sm border border-black bg-yellow-400 px-2 py-0.5 text-[10px] font-bold tracking-wide text-black uppercase shadow-sm">
                    Bypassing Limits
                  </span>
                </div>
              )}
            </div>
            <div className="mt-2 flex items-baseline justify-between gap-3 text-xs text-(--muted-foreground)">
              <span className="tabular-nums">{remaining} remaining</span>
              <span className="tabular-nums">
                next request:{" "}
                <span
                  className={cn(
                    "text-(--foreground) font-medium",
                    currentRequestCost > remaining && "text-amber-400",
                  )}
                >
                  {currentRequestCost}
                </span>{" "}
                credits
              </span>
            </div>
            <div className="mt-3 divide-y divide-(--border) rounded-md border border-(--border) bg-(--muted)/30">
              <div className="flex items-center justify-between gap-4 px-3 py-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium">
                    Estimated provider cost
                  </div>
                  <div className="text-xs text-(--muted-foreground)">
                    {usage?.cost.hasEstimated
                      ? "Includes estimated provider costs."
                      : "Recorded for this monthly usage period."}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-sm font-medium tabular-nums">
                    {usage?.cost.formattedTotal ?? "$0.00"}
                  </div>
                </div>
              </div>
              {canBypassLimits && (
                <div className="flex items-center justify-between gap-4 px-3 py-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium">
                      Bypass monthly quota
                    </div>
                    <div className="text-xs text-(--muted-foreground)">
                      Generations can continue after the monthly credit limit.
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Switch
                      checked={bypassMonthlyQuota}
                      onCheckedChange={onBypassMonthlyQuotaChange}
                      aria-label="Bypass monthly quota"
                      className={cn(
                        bypassMonthlyQuota &&
                          "data-checked:bg-blue-500 dark:data-checked:bg-blue-500",
                      )}
                    />
                    <span
                      className={cn(
                        "w-6 text-xs font-medium tabular-nums",
                        bypassMonthlyQuota
                          ? "text-blue-400"
                          : "text-(--muted-foreground)",
                      )}
                    >
                      {bypassMonthlyQuota ? "On" : "Off"}
                    </span>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div>
            <h3 className="mb-2 text-xs font-medium tracking-wide text-(--muted-foreground) uppercase">
              Recent activity
            </h3>
            {usage?.recent.length ? (
              <div className="max-h-72 overflow-y-auto rounded-md border border-(--border)">
                <ul className="divide-y divide-(--border)">
                  {usage.recent.map((row) => (
                    <li
                      key={row.id}
                      className="grid grid-cols-[auto_1fr_auto] items-center gap-3 p-3 text-sm"
                    >
                      <StatusDot status={row.status} />
                      <div className="min-w-0">
                        <div className="flex items-baseline gap-2">
                          <span className="truncate font-medium">
                            {row.model}
                          </span>
                          <span className="shrink-0 text-xs text-(--muted-foreground)">
                            {row.resolution ?? "1K"} ·{" "}
                            {row.aspectRatio ?? "1:1"}
                          </span>
                        </div>
                        <div className="mt-0.5 text-xs text-(--muted-foreground) capitalize">
                          {row.status} · {formatRelative(row.createdAt)}
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <div
                          className={cn(
                            "tabular-nums",
                            row.status === "refunded" &&
                              "text-(--muted-foreground) line-through",
                          )}
                        >
                          {row.credits}
                          <span className="ml-0.5 text-xs text-(--muted-foreground)">
                            cr
                          </span>
                        </div>
                        <div
                          className={cn(
                            "mt-0.5 text-xs tabular-nums text-(--muted-foreground)",
                            row.costStatus === "estimated" && "text-amber-400",
                          )}
                        >
                          {formatRowCost(row)}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <div className="rounded-md border border-(--border) p-4 text-sm text-(--muted-foreground)">
                {isLoading ? "Loading usage…" : "No usage this month."}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
