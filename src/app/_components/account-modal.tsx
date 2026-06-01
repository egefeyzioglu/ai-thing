"use client";

import { useEffect, useState, type ComponentType, type ReactNode } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  CircleDollarSign,
  ExternalLink,
  Gauge,
  LogOut,
  Shield,
  SlidersHorizontal,
  UserRound,
  X,
} from "lucide-react";

import { Button } from "src/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "src/components/ui/dialog";
import { Input } from "src/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "src/components/ui/select";
import { Switch } from "src/components/ui/switch";
import { Textarea } from "src/components/ui/textarea";
import { cn } from "src/lib/utils";
import type { RouterOutputs } from "src/trpc/react";

type UsageSummary = RouterOutputs["usage"]["getCurrent"];
type UsageRow = UsageSummary["recent"][number];
type Model = RouterOutputs["prompt"]["getModels"][number];
type AccountTab = "account" | "usage" | "defaults" | "spend";

type AccountModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: {
    name?: string | null;
    email?: string | null;
    imageUrl?: string | null;
  };
  usage: UsageSummary | undefined;
  currentRequestCost: number;
  isLoadingUsage: boolean;
  canBypassLimits: boolean;
  bypassMonthlyQuota: boolean;
  onBypassMonthlyQuotaChange: (value: boolean) => void;
  models: Model[];
  onManageAccount: () => void;
  onSignOut: () => void;
};

function useLocalState<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => {
    if (typeof window === "undefined") return initial;
    try {
      const raw = window.localStorage.getItem(key);
      return raw === null ? initial : (JSON.parse(raw) as T);
    } catch {
      return initial;
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* ignore unavailable storage */
    }
  }, [key, value]);

  return [value, setValue] as const;
}

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

function formatRowTitle(row: UsageRow) {
  if (row.kind !== "workshop") return row.model;
  return row.count > 1
    ? `Prompt workshop · ${row.count} messages`
    : "Prompt workshop";
}

function formatRowDetails(row: UsageRow) {
  if (row.kind === "workshop") return row.model;
  return `${row.resolution ?? "1K"} · ${row.aspectRatio ?? "1:1"}`;
}

function getInitials(name?: string | null, email?: string | null) {
  const trimmedName = name?.trim();
  const source =
    trimmedName && trimmedName.length > 0
      ? trimmedName
      : (email?.split("@")[0] ?? "User");
  return source
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
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

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-2 text-[10px] font-semibold tracking-wide text-(--muted-foreground) uppercase">
      <span>{children}</span>
      <span className="h-px min-w-6 flex-1 bg-(--border)" />
    </div>
  );
}

function AccountAvatar({
  imageUrl,
  initials,
  className,
}: {
  imageUrl?: string | null;
  initials: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-blue-500 text-sm font-semibold text-white",
        className,
      )}
    >
      {imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={imageUrl} alt="" className="size-full object-cover" />
      ) : (
        initials
      )}
    </span>
  );
}

function AccountTabPanel({
  user,
  initials,
  onManageAccount,
}: {
  user: AccountModalProps["user"];
  initials: string;
  onManageAccount: () => void;
}) {
  const displayName = user.name ?? "Account";
  const email = user.email ?? "No email available";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-4">
        <AccountAvatar
          imageUrl={user.imageUrl}
          initials={initials}
          className="size-16 text-xl"
        />
        <div className="min-w-0">
          <div className="truncate text-lg font-semibold">{displayName}</div>
          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm text-(--muted-foreground)">
            <span className="truncate">{email}</span>
            <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-400">
              <CheckCircle2 className="size-3" />
              Verified
            </span>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <SectionTitle>Account</SectionTitle>
        <div className="flex items-center gap-4 rounded-md border border-(--border) bg-(--muted)/30 p-4">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-blue-500/15 text-blue-400">
            <UserRound className="size-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium">Manage your account</div>
            <div className="mt-1 max-w-prose text-xs text-(--muted-foreground)">
              Update your profile, email addresses, password, two-step
              verification, and connected accounts in Clerk.
            </div>
          </div>
          <Button
            type="button"
            variant="outline"
            className="shrink-0"
            onClick={onManageAccount}
          >
            Manage
            <ExternalLink className="size-3.5" />
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <SectionTitle>Connected accounts</SectionTitle>
        <div className="flex items-center gap-3 rounded-md border border-(--border) p-3">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-md border border-(--border)">
            <Shield className="size-4 text-(--muted-foreground)" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium">Sign-in methods</div>
            <div className="truncate text-xs text-(--muted-foreground)">
              Managed by Clerk for {email}
            </div>
          </div>
          <span className="rounded-full border border-(--border) px-2 py-0.5 text-[10px] font-semibold text-(--muted-foreground)">
            Connected
          </span>
        </div>
      </div>
    </div>
  );
}

function UsageTabPanel({
  usage,
  currentRequestCost,
  isLoading,
  canBypassLimits,
  bypassMonthlyQuota,
  onBypassMonthlyQuotaChange,
}: Pick<
  AccountModalProps,
  | "usage"
  | "currentRequestCost"
  | "canBypassLimits"
  | "bypassMonthlyQuota"
  | "onBypassMonthlyQuotaChange"
> & { isLoading: boolean }) {
  const used = usage?.used ?? 0;
  const limit = usage?.limit ?? 0;
  const remaining = usage?.remaining ?? 0;
  const percent = getPercent(used, limit);

  return (
    <div className="flex flex-col gap-5">
      {percent >= 100 && !bypassMonthlyQuota && (
        <div className="flex items-start gap-3 rounded-md border border-red-500/40 bg-red-500/10 p-3">
          <AlertTriangle size={16} className="mt-0.5 shrink-0 text-red-400" />
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
        <div className="relative h-2 overflow-visible rounded-full bg-(--muted)">
          <div
            className={cn(
              "h-full rounded-full transition-[width] duration-500",
              bypassMonthlyQuota
                ? "border-r border-black/60"
                : thresholdBg(percent),
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
                "font-medium text-(--foreground)",
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
              <div className="text-sm font-medium">Estimated provider cost</div>
              <div className="text-xs text-(--muted-foreground)">
                {usage?.cost.hasEstimated
                  ? "Includes estimated provider costs."
                  : "Recorded for this monthly usage period."}
              </div>
            </div>
            <div className="shrink-0 text-sm font-medium tabular-nums">
              {usage?.cost.formattedTotal ?? "$0.00"}
            </div>
          </div>
          {canBypassLimits && (
            <div className="flex items-center justify-between gap-4 px-3 py-3">
              <div className="min-w-0">
                <div className="text-sm font-medium">Bypass monthly quota</div>
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
        <p className="mt-2 text-xs text-(--muted-foreground)">
          Monthly credits reset on {formatMediumDate(usage?.periodEnd)} UTC.
        </p>
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
                        {formatRowTitle(row)}
                      </span>
                      <span className="shrink-0 text-xs text-(--muted-foreground)">
                        {formatRowDetails(row)}
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
                        "mt-0.5 text-xs text-(--muted-foreground) tabular-nums",
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
  );
}

function ModelChecklist({
  models,
  storageKey,
}: {
  models: Model[];
  storageKey: string;
}) {
  const defaultSlugs = models.map((model) => model.slug);
  const [selected, setSelected] = useLocalState<string[]>(
    storageKey,
    defaultSlugs,
  );

  return (
    <div className="flex flex-col gap-2">
      {models.map((model) => {
        const checked = selected.includes(model.slug);
        return (
          <button
            key={model.slug}
            type="button"
            role="checkbox"
            aria-checked={checked}
            className={cn(
              "flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2 text-left text-sm",
              checked
                ? "border-blue-500 bg-blue-500/10"
                : "border-(--border) hover:bg-(--muted)/40",
            )}
            onClick={() => {
              setSelected(
                checked
                  ? selected.filter((slug) => slug !== model.slug)
                  : [...selected, model.slug],
              );
            }}
          >
            <span
              className={cn(
                "flex size-4 shrink-0 items-center justify-center rounded border",
                checked
                  ? "border-blue-500 bg-blue-500 text-white"
                  : "border-(--border)",
              )}
            >
              {checked && <CheckCircle2 className="size-3" />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{model.name}</span>
              <span className="block truncate text-xs text-(--muted-foreground)">
                {model.provider}
              </span>
            </span>
            <span
              className={cn(
                "rounded-full border px-1.5 py-0.5 text-[9px] font-semibold tracking-wide uppercase",
                model.kind === "video"
                  ? "border-blue-500/40 bg-blue-500/10 text-blue-400"
                  : "border-(--border) text-(--muted-foreground)",
              )}
            >
              {model.kind}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function DefaultsTabPanel({ models }: { models: Model[] }) {
  const [outputType, setOutputType] = useLocalState(
    "aiThing.defaults.mode",
    "image",
  );
  const [notify, setNotify] = useLocalState("aiThing.defaults.notify", true);
  const [imageResolution, setImageResolution] = useLocalState(
    "aiThing.defaults.imageResolution",
    "1K",
  );
  const [imageAspect, setImageAspect] = useLocalState(
    "aiThing.defaults.imageAspect",
    "1:1",
  );
  const [imageRuns, setImageRuns] = useLocalState(
    "aiThing.defaults.imageRuns",
    1,
  );
  const [quality, setQuality] = useLocalState(
    "aiThing.defaults.quality",
    "auto",
  );
  const [background, setBackground] = useLocalState(
    "aiThing.defaults.background",
    "auto",
  );
  const [negativePrompt, setNegativePrompt] = useLocalState(
    "aiThing.defaults.negativePrompt",
    "",
  );
  const [seed, setSeed] = useLocalState("aiThing.defaults.seed", "");
  const [thinking, setThinking] = useLocalState(
    "aiThing.defaults.thinking",
    "auto",
  );
  const [videoResolution, setVideoResolution] = useLocalState(
    "aiThing.defaults.videoResolution",
    "720p",
  );
  const [duration, setDuration] = useLocalState(
    "aiThing.defaults.duration",
    "5",
  );
  const [videoAspect, setVideoAspect] = useLocalState(
    "aiThing.defaults.videoAspect",
    "16:9",
  );
  const [videoRuns, setVideoRuns] = useLocalState(
    "aiThing.defaults.videoRuns",
    1,
  );
  const [motion, setMotion] = useLocalState("aiThing.defaults.motion", "auto");
  const [cameraFixed, setCameraFixed] = useLocalState(
    "aiThing.defaults.cameraFixed",
    false,
  );

  const imageModels = models.filter((model) => model.kind === "image");
  const videoModels = models.filter((model) => model.kind === "video");

  return (
    <div className="flex flex-col gap-6">
      <p className="text-xs text-(--muted-foreground)">
        These settings are saved locally as your preferred starting point for
        new generations.
      </p>

      <div className="flex flex-col gap-3">
        <SectionTitle>General</SectionTitle>
        <div className="divide-y divide-(--border) rounded-md border border-(--border)">
          <SettingRow
            title="Default output type"
            subtitle="Which mode opens first."
          >
            <Segmented
              value={outputType}
              onChange={setOutputType}
              options={[
                ["image", "Image"],
                ["video", "Video"],
              ]}
            />
          </SettingRow>
          <SettingRow
            title="Notify when generation finishes"
            subtitle="Browser notification if this tab is not focused."
          >
            <Switch checked={notify} onCheckedChange={setNotify} />
          </SettingRow>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <SectionTitle>Image generation</SectionTitle>
        <ModelChecklist
          models={imageModels}
          storageKey="aiThing.defaults.imageModels"
        />
        <div className="grid grid-cols-2 gap-3">
          <LabeledSelect
            label="Resolution"
            value={imageResolution}
            onChange={setImageResolution}
            options={["512", "1K", "2K", "4K"]}
          />
          <NumberStepper value={imageRuns} onChange={setImageRuns} />
        </div>
        <LabeledSegments
          label="Aspect ratio"
          value={imageAspect}
          onChange={setImageAspect}
          options={["1:1", "4:3", "3:4", "16:9", "9:16"]}
        />
        <div className="grid grid-cols-2 gap-3">
          <LabeledSelect
            label="Quality"
            value={quality}
            onChange={setQuality}
            options={["auto", "low", "medium", "high"]}
          />
          <LabeledSelect
            label="Background"
            value={background}
            onChange={setBackground}
            options={["auto", "opaque", "transparent"]}
          />
        </div>
        <label className="flex flex-col gap-1.5">
          <span className="text-[10px] font-medium tracking-wide text-(--muted-foreground) uppercase">
            Negative prompt
          </span>
          <Textarea
            rows={2}
            placeholder="e.g. blurry, low quality, text"
            value={negativePrompt}
            className="cursor-text"
            onChange={(event) => setNegativePrompt(event.target.value)}
          />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-[10px] font-medium tracking-wide text-(--muted-foreground) uppercase">
              Seed
            </span>
            <Input
              inputMode="numeric"
              placeholder="Random"
              value={seed}
              className="cursor-text"
              onChange={(event) =>
                setSeed(event.target.value.replace(/[^0-9]/g, ""))
              }
            />
          </label>
          <LabeledSelect
            label="Thinking"
            value={thinking}
            onChange={setThinking}
            options={["auto", "off", "low", "high"]}
          />
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <SectionTitle>Video generation</SectionTitle>
        <ModelChecklist
          models={videoModels}
          storageKey="aiThing.defaults.videoModels"
        />
        <div className="grid grid-cols-2 gap-3">
          <LabeledSelect
            label="Video resolution"
            value={videoResolution}
            onChange={setVideoResolution}
            options={["480p", "720p", "1080p"]}
          />
          <LabeledSelect
            label="Duration"
            value={duration}
            onChange={setDuration}
            options={["5", "10"]}
            formatLabel={(value) => `${value}s`}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <LabeledSegments
            label="Aspect ratio"
            value={videoAspect}
            onChange={setVideoAspect}
            options={["1:1", "4:3", "16:9", "9:16"]}
          />
          <NumberStepper value={videoRuns} onChange={setVideoRuns} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <LabeledSelect
            label="Motion"
            value={motion}
            onChange={setMotion}
            options={["auto", "low", "high"]}
          />
          <SettingBox label="Camera">
            <Button
              type="button"
              variant={cameraFixed ? "secondary" : "outline"}
              className="w-full"
              onClick={() => setCameraFixed(!cameraFixed)}
            >
              {cameraFixed ? "Fixed" : "Free move"}
            </Button>
          </SettingBox>
        </div>
      </div>
    </div>
  );
}

function SettingRow({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 p-3">
      <div className="min-w-0">
        <div className="text-sm font-medium">{title}</div>
        <div className="mt-1 text-xs text-(--muted-foreground)">{subtitle}</div>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function Segmented({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (value: string) => void;
  options: [string, string][];
}) {
  return (
    <div className="flex rounded-md border border-(--border) p-0.5">
      {options.map(([optionValue, label]) => (
        <button
          key={optionValue}
          type="button"
          className={cn(
            "cursor-pointer rounded-sm px-2 py-1 text-xs font-medium",
            value === optionValue
              ? "bg-blue-500 text-white"
              : "text-(--muted-foreground) hover:bg-(--muted)/60",
          )}
          onClick={() => onChange(optionValue)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function SettingBox({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1.5">
      <span className="text-[10px] font-medium tracking-wide text-(--muted-foreground) uppercase">
        {label}
      </span>
      {children}
    </label>
  );
}

function LabeledSelect({
  label,
  value,
  onChange,
  options,
  formatLabel,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: string[];
  formatLabel?: (value: string) => string;
}) {
  return (
    <SettingBox label={label}>
      <Select value={value} onValueChange={(next) => onChange(next ?? value)}>
        <SelectTrigger className="w-full cursor-pointer">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option} value={option} className="cursor-pointer">
              {formatLabel?.(option) ??
                option[0]!.toUpperCase() + option.slice(1)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </SettingBox>
  );
}

function LabeledSegments({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: string[];
}) {
  return (
    <SettingBox label={label}>
      <div className="flex flex-wrap gap-1.5">
        {options.map((option) => (
          <Button
            key={option}
            type="button"
            size="sm"
            variant={value === option ? "secondary" : "outline"}
            onClick={() => onChange(option)}
          >
            {option}
          </Button>
        ))}
      </div>
    </SettingBox>
  );
}

function NumberStepper({
  value,
  onChange,
}: {
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <SettingBox label="Runs per model">
      <div className="grid grid-cols-[2rem_1fr_2rem] rounded-md border border-(--border)">
        <button
          type="button"
          className="flex cursor-pointer items-center justify-center text-sm hover:bg-(--muted)/60 disabled:cursor-not-allowed disabled:opacity-40"
          disabled={value <= 1}
          onClick={() => onChange(Math.max(1, value - 1))}
        >
          -
        </button>
        <input
          disabled
          value={value}
          className="min-w-0 cursor-default border-x border-(--border) bg-transparent text-center text-sm"
        />
        <button
          type="button"
          className="flex cursor-pointer items-center justify-center text-sm hover:bg-(--muted)/60 disabled:cursor-not-allowed disabled:opacity-40"
          disabled={value >= 8}
          onClick={() => onChange(Math.min(8, value + 1))}
        >
          +
        </button>
      </div>
    </SettingBox>
  );
}

function SpendAlertsTabPanel({ email }: { email?: string | null }) {
  const [enabled, setEnabled] = useLocalState("aiThing.spend.enabled", true);
  const [emailAlerts, setEmailAlerts] = useLocalState(
    "aiThing.spend.email",
    true,
  );
  const [pushAlerts, setPushAlerts] = useLocalState(
    "aiThing.spend.push",
    false,
  );
  const [hardCapEnabled, setHardCapEnabled] = useLocalState(
    "aiThing.spend.capEnabled",
    true,
  );
  const [hardCap, setHardCap] = useLocalState("aiThing.spend.hardCap", "250");
  const [tiers, setTiers] = useLocalState("aiThing.spend.tiers", [
    "25",
    "50",
    "100",
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start gap-3 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-amber-200">
        <AlertTriangle className="mt-0.5 size-4 shrink-0" />
        <div className="text-sm">
          You are bypassing the monthly credit limit. Set alerts before provider
          spend gets away from you.
        </div>
      </div>

      <div className="flex items-center justify-between gap-4 rounded-md border border-(--border) p-3">
        <div>
          <div className="text-sm font-medium">Spend alerts</div>
          <div className="mt-1 text-xs text-(--muted-foreground)">
            Notify me as provider spend crosses each threshold.
          </div>
        </div>
        <Switch checked={enabled} onCheckedChange={setEnabled} />
      </div>

      <div className={cn("flex flex-col gap-6", !enabled && "opacity-50")}>
        <div className="flex flex-col gap-3">
          <SectionTitle>Alert thresholds</SectionTitle>
          <div className="flex flex-col gap-2">
            {tiers.map((tier, index) => (
              <div
                key={index}
                className="grid grid-cols-[auto_1fr_auto] items-center gap-3 rounded-md border border-(--border) bg-(--muted)/20 p-3"
              >
                <span
                  className={cn(
                    "size-2 rounded-full",
                    index === 0
                      ? "bg-emerald-400"
                      : index === tiers.length - 1
                        ? "bg-red-400"
                        : "bg-amber-400",
                  )}
                />
                <div className="text-sm">
                  {index === 0
                    ? "First warning"
                    : index === tiers.length - 1
                      ? "Final warning"
                      : `Warning ${index + 1}`}
                </div>
                <label className="flex w-24 items-center rounded-md border border-(--border) px-2 py-1">
                  <span className="text-xs text-(--muted-foreground)">$</span>
                  <input
                    inputMode="numeric"
                    value={tier}
                    disabled={!enabled}
                    className="min-w-0 flex-1 cursor-text bg-transparent text-right text-sm outline-none disabled:cursor-not-allowed"
                    onChange={(event) => {
                      const next = [...tiers];
                      next[index] = event.target.value.replace(/[^0-9]/g, "");
                      setTiers(next);
                    }}
                  />
                </label>
              </div>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <SectionTitle>Hard cap</SectionTitle>
          <div className="divide-y divide-(--border) rounded-md border border-(--border)">
            <SettingRow
              title="Stop generations at a hard cap"
              subtitle="Block new generations once spend reaches this amount."
            >
              <Switch
                checked={hardCapEnabled}
                disabled={!enabled}
                onCheckedChange={setHardCapEnabled}
              />
            </SettingRow>
            <SettingRow
              title="Cap amount"
              subtitle="Applies to this billing period."
            >
              <label className="flex w-24 items-center rounded-md border border-(--border) px-2 py-1">
                <span className="text-xs text-(--muted-foreground)">$</span>
                <input
                  inputMode="numeric"
                  value={hardCap}
                  disabled={!enabled || !hardCapEnabled}
                  className="min-w-0 flex-1 cursor-text bg-transparent text-right text-sm outline-none disabled:cursor-not-allowed"
                  onChange={(event) =>
                    setHardCap(event.target.value.replace(/[^0-9]/g, ""))
                  }
                />
              </label>
            </SettingRow>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <SectionTitle>Alert channels</SectionTitle>
          <div className="divide-y divide-(--border) rounded-md border border-(--border)">
            <SettingRow
              title="Email"
              subtitle={email ?? "Primary account email"}
            >
              <Switch
                checked={emailAlerts}
                disabled={!enabled}
                onCheckedChange={setEmailAlerts}
              />
            </SettingRow>
            <SettingRow
              title="Browser push"
              subtitle="Notification on this device."
            >
              <Switch
                checked={pushAlerts}
                disabled={!enabled}
                onCheckedChange={setPushAlerts}
              />
            </SettingRow>
          </div>
        </div>
      </div>
    </div>
  );
}

const TAB_META: Record<AccountTab, { label: string; desc: string }> = {
  account: {
    label: "Account",
    desc: "Your profile and sign-in settings.",
  },
  usage: {
    label: "Usage",
    desc: "Monthly credits, costs, and recent activity.",
  },
  defaults: {
    label: "Defaults",
    desc: "Preferred starting settings for new generations.",
  },
  spend: {
    label: "Spend alerts",
    desc: "Stay ahead of provider cost while bypassing limits.",
  },
};

const TAB_ICONS = {
  account: UserRound,
  usage: Gauge,
  defaults: SlidersHorizontal,
  spend: CircleDollarSign,
} satisfies Record<AccountTab, ComponentType<{ className?: string }>>;

export function AccountModal({
  open,
  onOpenChange,
  user,
  usage,
  currentRequestCost,
  isLoadingUsage,
  canBypassLimits,
  bypassMonthlyQuota,
  onBypassMonthlyQuotaChange,
  models,
  onManageAccount,
  onSignOut,
}: AccountModalProps) {
  const [tab, setTab] = useState<AccountTab>("account");
  const initials = getInitials(user.name, user.email);
  const tabs: AccountTab[] = ["account", "usage", "defaults"];
  if (canBypassLimits && bypassMonthlyQuota) tabs.push("spend");

  useEffect(() => {
    if (open) setTab("account");
  }, [open]);

  useEffect(() => {
    if (tab === "spend" && (!canBypassLimits || !bypassMonthlyQuota)) {
      setTab("usage");
    }
  }, [bypassMonthlyQuota, canBypassLimits, tab]);

  const activeMeta = TAB_META[tab];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="grid h-[min(660px,88vh)] min-h-0 w-[min(920px,94vw)] max-w-[min(920px,94vw)] grid-cols-[244px_1fr] gap-0 overflow-hidden p-0 sm:max-w-[min(920px,94vw)]"
      >
        <aside className="flex min-h-0 min-w-0 flex-col border-r border-(--border) bg-(--background)/55">
          <div className="flex items-center gap-3 border-b border-(--border) p-4">
            <AccountAvatar
              imageUrl={user.imageUrl}
              initials={initials}
              className="size-10"
            />
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold">
                {user.name ?? "Account"}
              </div>
              <div className="mt-0.5 truncate text-xs text-(--muted-foreground)">
                {user.email ?? "Signed in"}
              </div>
            </div>
          </div>
          <nav className="min-h-0 flex-1 overflow-y-auto p-3">
            <div className="flex flex-col gap-1">
              {tabs.map((id) => {
                const Icon = TAB_ICONS[id];
                const active = tab === id;
                return (
                  <button
                    key={id}
                    type="button"
                    className={cn(
                      "relative flex w-full cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors",
                      active
                        ? "bg-blue-500/15 text-(--foreground)"
                        : "text-(--muted-foreground) hover:bg-(--muted)/50 hover:text-(--foreground)",
                    )}
                    onClick={() => setTab(id)}
                  >
                    {active && (
                      <span className="absolute top-1/2 -left-3 h-5 w-0.5 -translate-y-1/2 rounded-r bg-blue-500" />
                    )}
                    <Icon
                      className={cn(
                        "size-4 shrink-0",
                        active && "text-blue-400",
                      )}
                    />
                    <span className="min-w-0 flex-1 truncate">
                      {TAB_META[id].label}
                    </span>
                    {id === "spend" && (
                      <span className="rounded-full border border-amber-400/40 bg-amber-400/10 px-1.5 py-0.5 text-[9px] font-semibold text-amber-300 uppercase">
                        Bypass
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </nav>
          <div className="border-t border-(--border) p-3">
            <button
              type="button"
              className="flex w-full cursor-pointer items-center gap-2 rounded-md border border-(--border) px-3 py-2 text-left text-sm text-(--muted-foreground) hover:border-red-400/40 hover:bg-red-500/10 hover:text-red-300"
              onClick={onSignOut}
            >
              <LogOut className="size-4" />
              Sign out
            </button>
          </div>
        </aside>

        <section className="flex min-h-0 min-w-0 flex-col">
          <div className="flex items-start justify-between gap-4 border-b border-(--border) px-5 py-4">
            <div className="min-w-0">
              <DialogTitle>{activeMeta.label}</DialogTitle>
              <DialogDescription className="mt-1">
                {activeMeta.desc}
              </DialogDescription>
            </div>
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              className="shrink-0"
              onClick={() => onOpenChange(false)}
              aria-label="Close account settings"
            >
              <X className="size-4" />
            </Button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-5">
            {tab === "account" && (
              <AccountTabPanel
                user={user}
                initials={initials}
                onManageAccount={onManageAccount}
              />
            )}
            {tab === "usage" && (
              <UsageTabPanel
                usage={usage}
                currentRequestCost={currentRequestCost}
                isLoading={isLoadingUsage}
                canBypassLimits={canBypassLimits}
                bypassMonthlyQuota={bypassMonthlyQuota}
                onBypassMonthlyQuotaChange={onBypassMonthlyQuotaChange}
              />
            )}
            {tab === "defaults" && <DefaultsTabPanel models={models} />}
            {tab === "spend" && <SpendAlertsTabPanel email={user.email} />}
          </div>
        </section>
      </DialogContent>
    </Dialog>
  );
}
