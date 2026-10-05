"use client";

import {
  AlertCircle,
  ArrowLeft,
  Box,
  Braces,
  Check,
  ChevronDown,
  ChevronRight,
  Clock3,
  Columns3,
  Copy,
  Database,
  ExternalLink,
  Gauge,
  Globe2,
  Layers3,
  PanelRightClose,
  RefreshCw,
  Search,
  Server,
  Share2,
  TerminalSquare,
  X,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { Button } from "src/components/ui/button";
import { Input } from "src/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "src/components/ui/select";
import { cn } from "src/lib/utils";
import {
  TELEMETRY_BOARD_TERMS,
  type TelemetryBoardId,
} from "src/lib/telemetry-boards";

type Trace = {
  id: string;
  shortId: string;
  route: string;
  outcome: string;
  source: string;
  service: string;
  duration: string;
  durationMs: number;
  spans: number;
  when: string;
  error: string;
  user: string;
  version: string;
};

type TracePreset = "all" | "errors" | "slow";

type TraceListResponse = {
  error?: string;
  truncated?: boolean;
  traces?: Array<{
    durationMs: number;
    errorMessage: string | null;
    errorName: string | null;
    id: string;
    operation: string;
    outcome: string;
    release: string | null;
    service: string;
    shortId: string;
    source: string;
    spanCount: number;
    startedAt: string | null;
    userId: string | null;
  }>;
};

type LiveSpan = {
  durationMs: number;
  errorMessage: string | null;
  errorName: string | null;
  errorStack: string | null;
  id: string;
  name: string;
  operation: string | null;
  outcome: string;
  parentId: string | null;
  service: string;
  source: string;
  startedAt: string | null;
};

type TraceDetailResponse = {
  error?: string;
  spans?: LiveSpan[];
  truncated?: boolean;
};

type SummaryMetric = {
  errorCount: number;
  p95Ms: number;
  requestCount: number;
};

type TelemetrySummary = {
  bucketCount: number;
  buckets: Array<
    SummaryMetric & { bucket: number; operation: string; root: boolean }
  >;
  boards: Record<BoardId, SummaryMetric>;
  operations: Array<SummaryMetric & { operation: string; root: boolean }>;
  overall: SummaryMetric & { errorRate: number; serviceCount: number };
  services: Array<SummaryMetric & { errorRate: number; service: string }>;
};

type BoardId = TelemetryBoardId;

function formatDuration(durationMs: number): string {
  if (durationMs >= 1_000) return `${(durationMs / 1_000).toFixed(2)}s`;
  return `${Math.round(durationMs)}ms`;
}

function formatRelativeTime(timestamp: string | null): string {
  if (!timestamp) return "unknown";
  const elapsedMs = Date.now() - new Date(timestamp).getTime();
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return "just now";
  if (elapsedMs < 60_000)
    return `${Math.max(1, Math.floor(elapsedMs / 1_000))}s ago`;
  if (elapsedMs < 3_600_000) return `${Math.floor(elapsedMs / 60_000)}m ago`;
  if (elapsedMs < 86_400_000)
    return `${Math.floor(elapsedMs / 3_600_000)}h ago`;
  return `${Math.floor(elapsedMs / 86_400_000)}d ago`;
}

function formatEventTime(timestamp: string): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZone: "UTC",
  }).format(new Date(timestamp));
}

async function parseApiResponse<T extends { error?: string }>(
  response: Response,
  fallbackMessage: string,
): Promise<T> {
  const body = (await response.json().catch(() => null)) as T | null;
  if (!response.ok) {
    throw new Error(body?.error ?? `${fallbackMessage} (${response.status})`);
  }
  if (!body) throw new Error(`${fallbackMessage}: malformed response`);
  return body;
}

function formatRangeLabel(range: number, ratio: number): string {
  if (ratio === 0) return "now";
  const seconds = Math.round(range * ratio);
  if (seconds < 3_600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.round(seconds / 3_600)}h ago`;
  return `${Math.round(seconds / 86_400)}d ago`;
}

function traceMatchesQuery(trace: Trace, query: string): boolean {
  return `${trace.route} ${trace.error} ${trace.user} ${trace.id}`
    .toLowerCase()
    .includes(query.toLowerCase());
}

function traceHasError(trace: Trace): boolean {
  return trace.outcome === "unexpected_error";
}

function Logo() {
  return (
    <div className="size-8 rounded-md bg-blue-400" aria-label="AI Thing" />
  );
}

function TinyPill({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "error" | "success" | "violet";
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-1.5 py-0.5 font-mono text-[10px] leading-4",
        tone === "error" && "border-rose-500/25 bg-rose-500/10 text-rose-300",
        tone === "success" &&
          "border-emerald-500/25 bg-emerald-500/10 text-emerald-300",
        tone === "violet" &&
          "border-violet-500/25 bg-violet-500/10 text-violet-300",
        tone === "neutral" && "border-white/8 bg-white/4 text-zinc-400",
      )}
    >
      {children}
    </span>
  );
}

type DashboardView = "traces" | "services" | "boards";

function NavRail({
  activeView,
  onViewChange,
}: {
  activeView: DashboardView;
  onViewChange: (view: DashboardView) => void;
}) {
  const items = [
    { icon: Layers3, label: "Traces", value: "traces" },
    { icon: Gauge, label: "Services", value: "services" },
    { icon: Columns3, label: "Boards", value: "boards" },
  ];

  return (
    <aside className="bg-background flex w-[68px] shrink-0 flex-col items-center border-r border-white/[0.07] py-3">
      <Logo />
      <div className="mt-7 flex w-full flex-col items-center gap-1">
        {items.map(({ icon: Icon, label, value }) => {
          const active = activeView === value;
          return (
            <Button
              key={label}
              type="button"
              variant="ghost"
              size={null}
              title={label}
              aria-label={label}
              aria-current={active ? "page" : undefined}
              onClick={() => onViewChange(value as DashboardView)}
              className={cn(
                "group relative flex h-11 w-12 items-center justify-center rounded-lg text-zinc-500 transition hover:bg-white/5 hover:text-zinc-200",
                active && "bg-violet-500/10 text-violet-300",
              )}
            >
              {active && (
                <span className="absolute -left-[10px] h-5 w-0.5 rounded-r bg-violet-400" />
              )}
              <Icon className="size-[18px]" />
            </Button>
          );
        })}
      </div>
    </aside>
  );
}

function TraceList({
  error,
  isLoading,
  onClearService,
  onPresetChange,
  onRangeChange,
  onRefresh,
  preset,
  range,
  serviceFilter,
  selectedTrace,
  setSelectedTrace,
  traces,
  truncated,
}: {
  error: string | null;
  isLoading: boolean;
  onClearService: () => void;
  onPresetChange: (preset: TracePreset) => void;
  onRangeChange: (range: number) => void;
  onRefresh: () => void;
  preset: TracePreset;
  range: number;
  serviceFilter: string | null;
  selectedTrace: Trace | null;
  setSelectedTrace: (trace: Trace) => void;
  traces: Trace[];
  truncated: boolean;
}) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(
    () =>
      traces.filter((trace) => {
        const matchesPreset =
          preset === "all" ||
          selectedTrace?.id === trace.id ||
          (preset === "errors" && traceHasError(trace)) ||
          (preset === "slow" && trace.durationMs >= 1000);
        return traceMatchesQuery(trace, query) && matchesPreset;
      }),
    [preset, query, selectedTrace?.id, traces],
  );
  const errorCount = traces.filter(
    (trace) => traceHasError(trace) && traceMatchesQuery(trace, query),
  ).length;

  return (
    <main className="bg-background flex min-w-[420px] flex-1 flex-col">
      <header className="flex h-14 items-center gap-3 border-b border-white/[0.07] px-4">
        <div className="flex min-w-0 flex-1 items-center gap-2 rounded-md border border-white/[0.09] bg-gray-950 px-3 py-1.5 shadow-inner">
          <Search className="size-3.5 shrink-0 text-zinc-600" />
          <Input
            aria-label="Search traces"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="h-auto min-w-0 flex-1 border-0 bg-transparent p-0 text-xs text-zinc-200 shadow-none outline-none placeholder:text-zinc-600 focus-visible:ring-0 dark:bg-transparent"
            placeholder="Search traces by route, error, user or trace ID..."
          />
          {query && (
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label="Clear trace search"
              title="Clear trace search"
              onClick={() => setQuery("")}
            >
              <X className="size-3.5 text-zinc-600 hover:text-zinc-300" />
            </Button>
          )}
        </div>
        <Select
          value={String(range)}
          onValueChange={(value) => value && onRangeChange(Number(value))}
        >
          <SelectTrigger className="h-8 border-white/[0.09] bg-white/[0.03] text-xs text-zinc-300">
            <Clock3 className="size-3.5 text-zinc-500" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="900">Last 15 minutes</SelectItem>
            <SelectItem value="1800">Last 30 minutes</SelectItem>
            <SelectItem value="3600">Last hour</SelectItem>
            <SelectItem value="86400">Last 24 hours</SelectItem>
            <SelectItem value="604800">Last 7 days</SelectItem>
            <SelectItem value="2592000">Last 30 days</SelectItem>
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          size="icon"
          className="border-white/[0.09] bg-white/[0.03] text-zinc-500"
          aria-label="Refresh traces"
          disabled={isLoading}
          onClick={onRefresh}
          title="Refresh traces"
        >
          <RefreshCw />
        </Button>
      </header>

      <div className="border-b border-white/[0.07] px-4 pt-3">
        <div className="mb-3 flex items-center gap-1">
          {(["all", "errors", "slow"] as const).map((value) => (
            <Button
              key={value}
              type="button"
              variant="ghost"
              size={null}
              onClick={() => onPresetChange(value)}
              className={cn(
                "rounded-md px-3 py-1.5 text-[11px] font-medium text-zinc-500 capitalize transition hover:bg-white/[0.04] hover:text-zinc-300",
                preset === value &&
                  "bg-white/[0.07] text-zinc-100 shadow-[inset_0_0_0_1px_rgba(255,255,255,.06)]",
              )}
            >
              {value}
              {value === "errors" && (
                <span className="ml-1.5 font-mono text-[9px] text-rose-400">
                  {errorCount}
                </span>
              )}
            </Button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-medium text-zinc-500">FILTERS</span>
          {serviceFilter ? (
            <Button
              type="button"
              variant="ghost"
              size={null}
              onClick={onClearService}
              className="flex items-center gap-1 rounded-md border border-violet-500/20 bg-violet-500/10 px-2 py-1 text-[10px] text-violet-300"
            >
              service = {serviceFilter} <X className="size-2.5" />
            </Button>
          ) : (
            <span className="text-[10px] text-zinc-700">No service filter</span>
          )}
        </div>
        <div className="mt-2 flex justify-end">
          <div className="text-right">
            <div className="font-mono text-lg font-medium text-zinc-200">
              {filtered.length}
            </div>
            <div className="text-[9px] text-zinc-600">
              {preset === "errors"
                ? "ERROR TRACES"
                : preset === "slow"
                  ? "SLOW TRACES"
                  : "TOTAL TRACES"}
            </div>
          </div>
        </div>
        <div className="mt-1 flex justify-between pb-2 font-mono text-[8px] text-zinc-700">
          {[1, 2 / 3, 1 / 3, 0].map((ratio) => (
            <span key={ratio}>{formatRangeLabel(range, ratio)}</span>
          ))}
        </div>
      </div>

      <div className="flex items-center border-b border-white/[0.07] px-4 py-2 text-[9px] font-semibold tracking-wider text-zinc-600 uppercase">
        <span className="w-[42%]">Request</span>
        <span className="w-[15%]">Duration</span>
        <span className="w-[14%]">Service</span>
        <span className="w-[12%]">Spans</span>
        <span className="flex-1 text-right">Seen</span>
      </div>

      <div className="relative flex-1 overflow-y-auto">
        {error && (
          <div className="m-4 rounded-md border border-amber-500/30 bg-amber-500/10 p-4">
            <div className="flex items-start gap-2.5">
              <AlertCircle className="mt-0.5 size-4 shrink-0 text-amber-400" />
              <div>
                <p className="text-xs font-medium text-amber-200">
                  Live telemetry is unavailable
                </p>
                <p className="mt-1 text-[11px] leading-5 text-amber-100/60">
                  {error}
                </p>
              </div>
            </div>
          </div>
        )}
        {isLoading && (
          <div className="absolute inset-x-0 top-0 h-0.5 overflow-hidden bg-white/5">
            <div className="h-full w-1/3 animate-pulse bg-violet-400" />
          </div>
        )}
        {filtered.map((trace) => (
          <Button
            type="button"
            variant="ghost"
            size={null}
            key={trace.id}
            onClick={() => setSelectedTrace(trace)}
            className={cn(
              "group flex h-auto w-full items-center rounded-none border-b border-white/[0.055] px-4 py-3 text-left transition",
              selectedTrace?.id === trace.id
                ? "bg-violet-500/[0.08] shadow-[inset_2px_0_0_#8b5cf6]"
                : "hover:bg-white/[0.025]",
            )}
          >
            <div className="flex w-[42%] min-w-0 items-start gap-2.5">
              {traceHasError(trace) ? (
                <AlertCircle className="mt-0.5 size-3.5 shrink-0 text-rose-400" />
              ) : (
                <Check className="mt-0.5 size-3.5 shrink-0 text-emerald-400" />
              )}
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate font-mono text-[11px] font-medium text-zinc-200">
                    {trace.source} · {trace.route}
                  </span>
                  <TinyPill tone={traceHasError(trace) ? "error" : "success"}>
                    {trace.outcome}
                  </TinyPill>
                </div>
                {trace.error && (
                  <div className="mt-1 truncate text-[10px] text-zinc-600">
                    {trace.error}
                  </div>
                )}
                <div className="mt-1.5 font-mono text-[9px] text-zinc-700">
                  {trace.shortId}…
                </div>
              </div>
            </div>
            <div className="w-[15%]">
              <span
                className={cn(
                  "font-mono text-[11px]",
                  trace.durationMs > 2000 ? "text-orange-300" : "text-zinc-400",
                )}
              >
                {trace.duration}
              </span>
            </div>
            <div className="w-[14%]">
              <TinyPill tone={trace.service === "api" ? "violet" : "neutral"}>
                {trace.service}
              </TinyPill>
            </div>
            <div className="w-[12%] font-mono text-[10px] text-zinc-500">
              {trace.spans}
            </div>
            <div className="flex-1 text-right text-[10px] text-zinc-600">
              {trace.when}
            </div>
            <ChevronRight className="ml-2 size-3.5 text-zinc-700 opacity-0 transition group-hover:opacity-100" />
          </Button>
        ))}
        {filtered.length === 0 && (
          <div className="flex h-48 flex-col items-center justify-center text-zinc-600">
            <Search className="mb-2 size-5" />
            <p className="text-xs">No traces match this search</p>
          </div>
        )}
      </div>
      <footer className="flex h-9 items-center justify-between border-t border-white/[0.07] px-4 text-[10px] text-zinc-600">
        <span>
          {isLoading
            ? "Loading traces…"
            : truncated
              ? `Showing newest ${filtered.length} traces (more available)`
              : `Showing ${filtered.length} traces`}
        </span>
        <span className="font-mono">Newest first</span>
      </footer>
    </main>
  );
}

function Waterfall({
  error,
  isLoading,
  spans,
}: {
  error: string | null;
  isLoading: boolean;
  spans: LiveSpan[];
}) {
  const [selectedSpan, setSelectedSpan] = useState(0);
  const displaySpans = useMemo(() => {
    const source = spans.map((span) => {
      const startedAt = span.startedAt ? new Date(span.startedAt).getTime() : 0;
      return {
        ...span,
        depth: 0,
        duration: formatDuration(span.durationMs),
        error: span.outcome === "unexpected_error",
        icon:
          span.service === "postgres"
            ? Database
            : span.source === "browser"
              ? Globe2
              : Braces,
        startMs: Number.isFinite(startedAt) ? startedAt : 0,
      };
    });
    if (source.length === 0) return [];

    const byId = new Map(source.map((span) => [span.id, span]));
    const depthFor = (span: (typeof source)[number]): number => {
      let depth = 0;
      let parentId = span.parentId;
      const visited = new Set<string>();
      while (parentId && !visited.has(parentId)) {
        visited.add(parentId);
        const parent = byId.get(parentId);
        if (!parent) break;
        depth += 1;
        parentId = parent.parentId;
      }
      return depth;
    };
    const validStarts = source
      .map((span) => span.startMs)
      .filter((value) => value > 0);
    const traceStart = validStarts.length > 0 ? Math.min(...validStarts) : 0;
    const traceEnd = Math.max(
      ...source.map((span) => {
        return span.startMs + span.durationMs;
      }),
    );
    const traceDuration = Math.max(traceEnd - traceStart, 1);

    return source.map((span) => {
      return {
        ...span,
        depth: depthFor(span),
        start: Math.max(0, ((span.startMs - traceStart) / traceDuration) * 100),
        width: Math.min(100, (span.durationMs / traceDuration) * 100),
      };
    });
  }, [spans]);
  const validSpanStarts = spans
    .map((span) => (span.startedAt ? new Date(span.startedAt).getTime() : 0))
    .filter((value) => Number.isFinite(value) && value > 0);
  const traceStart =
    validSpanStarts.length > 0 ? Math.min(...validSpanStarts) : 0;
  const traceEnd = Math.max(
    ...spans.map((span) => {
      const start = span.startedAt
        ? new Date(span.startedAt).getTime()
        : traceStart;
      return (Number.isFinite(start) ? start : traceStart) + span.durationMs;
    }),
    traceStart,
  );
  const traceDurationMs = Math.max(traceEnd - traceStart, 0);
  const exception = spans.find((span) => span.outcome === "unexpected_error");

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <div className="bg-background sticky top-0 z-10 grid grid-cols-[225px_1fr] border-b border-white/[0.07]">
        <div className="border-r border-white/[0.06] px-3 py-2 text-[9px] font-semibold tracking-wider text-zinc-600 uppercase">
          Span
        </div>
        <div className="flex justify-between px-3 py-2 font-mono text-[8px] text-zinc-700">
          {[0, 0.25, 0.5, 0.75, 1].map((ratio) => (
            <span key={ratio}>{formatDuration(traceDurationMs * ratio)}</span>
          ))}
        </div>
      </div>
      {isLoading && (
        <div className="p-4 text-[11px] text-zinc-600">Loading spans…</div>
      )}
      {error && (
        <div className="m-3 rounded-md border border-amber-500/25 bg-amber-500/10 p-3 text-[11px] text-amber-200">
          {error}
        </div>
      )}
      {!isLoading && !error && displaySpans.length === 0 && (
        <div className="p-4 text-[11px] text-zinc-600">
          No spans were found for this trace.
        </div>
      )}
      {displaySpans.map((span, index) => {
        const Icon = span.icon;
        const isError = span.error;
        return (
          <Button
            type="button"
            variant="ghost"
            size={null}
            key={span.id}
            onClick={() => setSelectedSpan(index)}
            className={cn(
              "grid h-auto w-full grid-cols-[225px_1fr] rounded-none border-b border-white/[0.045] p-0 text-left",
              selectedSpan === index
                ? "bg-violet-500/[0.08]"
                : "hover:bg-white/[0.025]",
            )}
          >
            <div
              className="flex min-w-0 items-center border-r border-white/[0.06] py-2 pr-2"
              style={{ paddingLeft: `${12 + span.depth * 13}px` }}
            >
              {span.depth < 3 && (
                <ChevronDown className="mr-1 size-3 shrink-0 text-zinc-700" />
              )}
              <Icon
                className={cn(
                  "mr-1.5 size-3 shrink-0",
                  isError ? "text-rose-400" : "text-zinc-500",
                )}
              />
              <span className="truncate font-mono text-[10px] text-zinc-300">
                {span.name}
              </span>
            </div>
            <div className="relative flex items-center overflow-hidden px-2">
              <div className="pointer-events-none absolute inset-0 grid grid-cols-4">
                {[0, 1, 2, 3].map((item) => (
                  <div
                    key={item}
                    className="border-r border-dashed border-white/[0.045]"
                  />
                ))}
              </div>
              <div
                className={cn(
                  "relative h-3 rounded-[3px] border",
                  isError
                    ? "border-rose-400/40 bg-rose-400/25"
                    : span.service === "postgres"
                      ? "border-cyan-400/30 bg-cyan-400/20"
                      : "border-violet-400/30 bg-violet-400/20",
                )}
                style={{
                  marginLeft: `${span.start}%`,
                  width: `${Math.max(span.width, 2)}%`,
                }}
              />
              <span className="absolute right-2 font-mono text-[8px] text-zinc-600">
                {span.duration}
              </span>
            </div>
          </Button>
        );
      })}
      {exception && (
        <div className="m-3 rounded-lg border border-rose-500/20 bg-rose-500/[0.06] p-3">
          <div className="flex items-center gap-2 text-[11px] font-medium text-rose-300">
            <AlertCircle className="size-3.5" />
            Exception
            <span className="ml-auto font-mono text-[9px] text-rose-400/60">
              {exception.name}
            </span>
          </div>
          <div className="mt-2 font-mono text-[10px] leading-5 text-zinc-400">
            {exception.errorName ?? "Error"}:{" "}
            {exception.errorMessage ?? "No error message recorded"}
            {exception.errorStack && (
              <pre className="mt-2 whitespace-pre-wrap text-zinc-600">
                {exception.errorStack}
              </pre>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Attributes({ spans, trace }: { spans: LiveSpan[]; trace: Trace }) {
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">(
    "idle",
  );
  const attributes = [
    ["trace.trace_id", trace.id],
    ["operation", trace.route],
    ["outcome", trace.outcome],
    ["service", trace.service],
    ["duration_ms", String(trace.durationMs)],
    ["span_count", String(spans.length)],
    ["userId", trace.user],
    ["release", trace.version],
  ];
  return (
    <div className="overflow-auto p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[9px] font-semibold tracking-wider text-zinc-600 uppercase">
          Resource & span attributes
        </span>
        <Button
          type="button"
          variant="ghost"
          size={null}
          onClick={() => {
            void navigator.clipboard
              .writeText(
                JSON.stringify(Object.fromEntries(attributes), null, 2),
              )
              .then(
                () => setCopyStatus("copied"),
                () => setCopyStatus("failed"),
              );
          }}
          className="text-[10px] text-violet-400 hover:text-violet-300"
        >
          {copyStatus === "copied"
            ? "Copied"
            : copyStatus === "failed"
              ? "Copy failed"
              : "Copy as JSON"}
        </Button>
      </div>
      <div className="overflow-hidden rounded-lg border border-white/[0.07]">
        {attributes.map(([key, value]) => (
          <div
            key={key}
            className="grid grid-cols-[45%_1fr] border-b border-white/[0.055] last:border-0"
          >
            <div className="border-r border-white/[0.055] bg-white/[0.018] px-3 py-2 font-mono text-[9px] text-zinc-500">
              {key}
            </div>
            <div className="px-3 py-2 font-mono text-[9px] text-zinc-300">
              {value}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TraceInspector({
  onClose,
  trace,
}: {
  onClose: () => void;
  trace: Trace;
}) {
  const [tab, setTab] = useState<"waterfall" | "attributes" | "events">(
    "waterfall",
  );
  const [copied, setCopied] = useState(false);
  const [shareStatus, setShareStatus] = useState<"idle" | "copied" | "failed">(
    "idle",
  );
  const [liveSpans, setLiveSpans] = useState<LiveSpan[]>([]);
  const [spansError, setSpansError] = useState<string | null>(null);
  const [spansLoading, setSpansLoading] = useState(true);
  const [spansTruncated, setSpansTruncated] = useState(false);
  const hasError = traceHasError(trace);

  useEffect(() => {
    const controller = new AbortController();
    setSpansLoading(true);
    setSpansError(null);
    setLiveSpans([]);
    setSpansTruncated(false);

    void fetch(`/api/telemetry/traces/${encodeURIComponent(trace.id)}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then((response) =>
        parseApiResponse<TraceDetailResponse>(
          response,
          "Unable to load trace spans",
        ),
      )
      .then((body) => {
        setLiveSpans(body.spans ?? []);
        setSpansTruncated(body.truncated === true);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setSpansError(
          error instanceof Error ? error.message : "Unable to load trace spans",
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setSpansLoading(false);
      });

    return () => controller.abort();
  }, [trace.id]);

  return (
    <aside className="bg-background flex w-[clamp(420px,35vw,520px)] shrink-0 flex-col border-l border-white/[0.08] shadow-[-16px_0_40px_rgba(0,0,0,.22)]">
      <div className="border-b border-white/[0.07] px-4 pt-3 pb-3">
        <div className="flex items-start gap-3">
          <div
            className={cn(
              "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md border",
              hasError
                ? "border-rose-500/20 bg-rose-500/10"
                : "border-emerald-500/20 bg-emerald-500/10",
            )}
          >
            {hasError ? (
              <AlertCircle className="size-3.5 text-rose-400" />
            ) : (
              <Check className="size-3.5 text-emerald-400" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="truncate font-mono text-xs font-semibold text-zinc-100">
                {trace.source} · {trace.route}
              </h2>
              <TinyPill tone={hasError ? "error" : "success"}>
                {trace.outcome}
              </TinyPill>
            </div>
            <p
              className={cn(
                "mt-1 truncate text-[10px]",
                hasError ? "text-rose-300/80" : "text-emerald-300/70",
              )}
            >
              {trace.error || "Completed successfully"}
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-zinc-600 hover:bg-white/5"
            aria-label="Close trace inspector"
            onClick={onClose}
            title="Close trace inspector"
          >
            <PanelRightClose />
          </Button>
        </div>

        <div className="mt-3 flex items-center gap-4 text-[10px]">
          <div>
            <span className="text-zinc-600">Duration </span>
            <span className="font-mono text-orange-300">{trace.duration}</span>
          </div>
          <div>
            <span className="text-zinc-600">Spans </span>
            <span className="font-mono text-zinc-300">{trace.spans}</span>
          </div>
          <div>
            <span className="text-zinc-600">Started </span>
            <span className="font-mono text-zinc-300">{trace.when}</span>
          </div>
        </div>

        <div className="mt-3 flex items-center gap-2 rounded-md border border-white/[0.065] bg-black/20 px-2 py-1.5">
          <span className="text-[9px] text-zinc-600">TRACE ID</span>
          <code className="min-w-0 flex-1 truncate text-[9px] text-zinc-400">
            {trace.id}
          </code>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            onClick={() => {
              void navigator.clipboard.writeText(trace.id).then(
                () => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1200);
                },
                () => undefined,
              );
            }}
            aria-label="Copy trace ID"
            title="Copy trace ID"
            className="text-zinc-600 hover:text-zinc-300"
          >
            {copied ? (
              <Check className="size-3 text-emerald-400" />
            ) : (
              <Copy className="size-3" />
            )}
          </Button>
        </div>
      </div>

      <div className="flex items-center border-b border-white/[0.07] px-3">
        {[
          ["waterfall", "Waterfall", Layers3],
          ["attributes", "Attributes", Braces],
          ["events", "Events", TerminalSquare],
        ].map(([value, label, icon]) => {
          const Icon = icon as typeof Layers3;
          return (
            <Button
              type="button"
              variant="ghost"
              size={null}
              key={value as string}
              onClick={() =>
                setTab(value as "waterfall" | "attributes" | "events")
              }
              className={cn(
                "relative flex items-center gap-1.5 px-3 py-2.5 text-[10px] text-zinc-500 hover:text-zinc-300",
                tab === value && "text-zinc-100",
              )}
            >
              <Icon className="size-3" />
              {label as string}
              {tab === value && (
                <span className="absolute inset-x-2 bottom-0 h-px bg-violet-400" />
              )}
            </Button>
          );
        })}
        <div className="ml-auto flex gap-1">
          <Button
            variant="ghost"
            size="icon-xs"
            className="text-zinc-600 hover:bg-white/5"
            title="Share trace"
            aria-label="Copy a link to this trace"
            onClick={() => {
              const url = new URL(window.location.href);
              url.searchParams.set("trace", trace.id);
              void navigator.clipboard.writeText(url.toString()).then(
                () => {
                  setShareStatus("copied");
                  setTimeout(() => setShareStatus("idle"), 1200);
                },
                () => {
                  setShareStatus("failed");
                  setTimeout(() => setShareStatus("idle"), 1800);
                },
              );
            }}
          >
            {shareStatus === "copied" ? (
              <Check className="text-emerald-400" />
            ) : shareStatus === "failed" ? (
              <X className="text-rose-400" />
            ) : (
              <Share2 />
            )}
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            className="text-zinc-600 hover:bg-white/5"
            title="Open full page"
            aria-label="Open this trace in a new tab"
            onClick={() => {
              const url = new URL(window.location.href);
              url.searchParams.set("trace", trace.id);
              window.open(url, "_blank", "noopener,noreferrer");
            }}
          >
            <ExternalLink />
          </Button>
        </div>
      </div>

      {tab === "waterfall" && (
        <Waterfall
          error={
            spansError ??
            (spansTruncated
              ? "This trace has more than 500 spans; showing the first 500."
              : null)
          }
          isLoading={spansLoading}
          spans={liveSpans}
        />
      )}
      {tab === "attributes" && (
        <Attributes key={trace.id} spans={liveSpans} trace={trace} />
      )}
      {tab === "events" && (
        <div className="overflow-auto p-3">
          <div className="rounded-lg border border-white/[0.07] bg-black/20 p-3 font-mono text-[10px] leading-6 text-zinc-500">
            {spansLoading && (
              <div className="text-zinc-600">Loading span events…</div>
            )}
            {spansError && <div className="text-amber-300">{spansError}</div>}
            {spansTruncated && (
              <div className="text-amber-300">
                Showing the first 500 span events.
              </div>
            )}
            {!spansError &&
              liveSpans.map((span) => (
                <div key={span.id}>
                  <span className="text-zinc-700">
                    {span.startedAt
                      ? formatEventTime(span.startedAt)
                      : "--:--:--"}
                  </span>{" "}
                  <span
                    className={
                      span.outcome === "unexpected_error"
                        ? "text-rose-400"
                        : "text-cyan-400"
                    }
                  >
                    {span.name}
                  </span>
                  {span.errorName && (
                    <span className="text-zinc-300"> · {span.errorName}</span>
                  )}
                </div>
              ))}
            {!spansLoading && !spansError && liveSpans.length === 0 && (
              <span className="text-zinc-600">No span events found.</span>
            )}
          </div>
        </div>
      )}
    </aside>
  );
}

const boardDefinitions: Array<{
  color: string;
  description: string;
  id: BoardId;
  title: string;
}> = [
  {
    id: "production",
    title: "Production pulse",
    description: "Errors, throughput and latency",
    color: "bg-violet-400",
  },
  {
    id: "generation",
    title: "Generation providers",
    description: "Success rate and duration for generation operations",
    color: "bg-rose-400",
  },
  {
    id: "database",
    title: "Database health",
    description: "Database request volume, errors and latency",
    color: "bg-cyan-400",
  },
  {
    id: "uploads",
    title: "Upload pipeline",
    description: "Storage latency and failed upload operations",
    color: "bg-orange-400",
  },
];

function formatCount(value: number) {
  return new Intl.NumberFormat(undefined, { notation: "compact" }).format(
    value,
  );
}

function aggregateMetrics(items: SummaryMetric[]): SummaryMetric {
  const requestCount = items.reduce((sum, item) => sum + item.requestCount, 0);
  return {
    errorCount: items.reduce((sum, item) => sum + item.errorCount, 0),
    p95Ms:
      requestCount === 0
        ? 0
        : items.reduce((sum, item) => sum + item.p95Ms * item.requestCount, 0) /
          requestCount,
    requestCount,
  };
}

function metricsForBoard(summary: TelemetrySummary, boardId: BoardId) {
  const terms = TELEMETRY_BOARD_TERMS[boardId];
  const matches = (operation: string, root: boolean) =>
    terms.length === 0
      ? root
      : terms.some((term) => operation.toLowerCase().includes(term));
  const operations = summary.operations.filter(({ operation, root }) =>
    matches(operation, root),
  );
  const buckets = Array.from({ length: summary.bucketCount }, (_, index) =>
    aggregateMetrics(
      summary.buckets.filter(
        (bucket) =>
          bucket.bucket === index && matches(bucket.operation, bucket.root),
      ),
    ),
  );
  return { buckets, metrics: summary.boards[boardId], operations };
}

function ViewHeader({
  title,
  description,
  isLoading,
  onRangeChange,
  onRefresh,
  range,
}: {
  title: string;
  description: string;
  isLoading: boolean;
  onRangeChange: (range: number) => void;
  onRefresh: () => void;
  range: number;
}) {
  return (
    <div className="flex h-16 shrink-0 items-center border-b border-white/[0.07] px-5">
      <div>
        <h1 className="text-sm font-semibold tracking-tight text-zinc-100">
          {title}
        </h1>
        <p className="mt-0.5 text-[11px] text-zinc-500">{description}</p>
      </div>
      <div className="ml-auto flex items-center gap-2">
        <Select
          value={String(range)}
          onValueChange={(value) => value && onRangeChange(Number(value))}
        >
          <SelectTrigger className="h-8 border-white/[0.09] bg-white/[0.03] text-xs text-zinc-300">
            <Clock3 className="size-3.5 text-zinc-500" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="900">Last 15 minutes</SelectItem>
            <SelectItem value="1800">Last 30 minutes</SelectItem>
            <SelectItem value="3600">Last hour</SelectItem>
            <SelectItem value="86400">Last 24 hours</SelectItem>
            <SelectItem value="604800">Last 7 days</SelectItem>
            <SelectItem value="2592000">Last 30 days</SelectItem>
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          size="icon"
          className="border-white/[0.09] bg-white/[0.03] text-zinc-500"
          aria-label="Refresh view"
          disabled={isLoading}
          onClick={onRefresh}
          title="Refresh view"
        >
          <RefreshCw />
        </Button>
      </div>
    </div>
  );
}

function SummaryState({
  error,
  isLoading,
}: {
  error: string | null;
  isLoading: boolean;
}) {
  if (isLoading)
    return <p className="p-5 text-xs text-zinc-500">Loading telemetry…</p>;
  if (error) return <p className="p-5 text-xs text-amber-300">{error}</p>;
  return null;
}

function ServicesView({
  error,
  isLoading,
  onRangeChange,
  onRefresh,
  onSelectService,
  range,
  summary,
}: {
  error: string | null;
  isLoading: boolean;
  onRangeChange: (range: number) => void;
  onRefresh: () => void;
  onSelectService: (service: string) => void;
  range: number;
  summary: TelemetrySummary | null;
}) {
  return (
    <main className="bg-background flex min-w-0 flex-1 flex-col">
      <ViewHeader
        title="Services"
        description="Health and performance across the application"
        isLoading={isLoading}
        onRangeChange={onRangeChange}
        onRefresh={onRefresh}
        range={range}
      />
      <SummaryState error={error} isLoading={isLoading} />
      {summary && (
        <>
          <div className="grid grid-cols-3 gap-3 border-b border-white/[0.07] p-5">
            {[
              [
                String(summary.overall.serviceCount),
                "Reporting services",
                "text-zinc-100",
              ],
              [
                `${(summary.overall.errorRate * 100).toFixed(1)}%`,
                "Overall error rate",
                "text-rose-300",
              ],
              [
                formatDuration(summary.overall.p95Ms),
                "Application p95",
                "text-orange-300",
              ],
            ].map(([value, label, tone]) => (
              <div
                key={label}
                className="rounded-md border border-white/[0.07] bg-white/[0.025] p-4"
              >
                <div className={cn("font-mono text-xl font-medium", tone)}>
                  {value}
                </div>
                <div className="mt-1 text-[10px] text-zinc-600">{label}</div>
              </div>
            ))}
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-5">
            <div className="overflow-hidden rounded-md border border-white/[0.07]">
              <div className="grid grid-cols-[1.5fr_repeat(4,1fr)] bg-white/[0.025] px-4 py-2.5 text-[9px] font-semibold tracking-wider text-zinc-600 uppercase">
                <span>Service</span>
                <span>Requests</span>
                <span>Error rate</span>
                <span>P95</span>
                <span>Status</span>
              </div>
              {summary.services.map((service) => {
                const health =
                  service.errorRate > 0.01 ? "degraded" : "healthy";
                return (
                  <Button
                    key={service.service}
                    type="button"
                    variant="ghost"
                    size={null}
                    onClick={() => onSelectService(service.service)}
                    className="grid h-auto w-full grid-cols-[1.5fr_repeat(4,1fr)] items-center rounded-none border-t border-white/[0.055] px-4 py-3 text-left hover:bg-white/[0.025]"
                  >
                    <span className="flex items-center gap-2 text-xs font-medium text-zinc-200">
                      <span className="flex size-7 items-center justify-center rounded-md bg-violet-500/10">
                        <Server className="size-3.5 text-violet-300" />
                      </span>
                      {service.service}
                    </span>
                    <span className="font-mono text-[11px] text-zinc-400">
                      {formatCount(service.requestCount)}
                    </span>
                    <span
                      className={cn(
                        "font-mono text-[11px]",
                        service.errorRate > 0.01
                          ? "text-rose-300"
                          : "text-zinc-400",
                      )}
                    >
                      {(service.errorRate * 100).toFixed(1)}%
                    </span>
                    <span className="font-mono text-[11px] text-zinc-400">
                      {formatDuration(service.p95Ms)}
                    </span>
                    <span className="flex items-center gap-1.5 text-[10px] text-zinc-400">
                      <span
                        className={cn(
                          "size-1.5 rounded-full",
                          health === "healthy"
                            ? "bg-emerald-400"
                            : "bg-amber-400",
                        )}
                      />
                      {health}
                    </span>
                  </Button>
                );
              })}
              {summary.services.length === 0 && (
                <p className="p-4 text-xs text-zinc-500">
                  No services reported in this time range.
                </p>
              )}
            </div>
          </div>
        </>
      )}
    </main>
  );
}

function BoardsView({
  boardId,
  error,
  isLoading,
  onBoardChange,
  onRangeChange,
  onRefresh,
  range,
  summary,
}: {
  boardId: BoardId | null;
  error: string | null;
  isLoading: boolean;
  onBoardChange: (board: BoardId | null) => void;
  onRangeChange: (range: number) => void;
  onRefresh: () => void;
  range: number;
  summary: TelemetrySummary | null;
}) {
  const selectedBoard = boardDefinitions.find(({ id }) => id === boardId);
  const selectedData =
    summary && boardId ? metricsForBoard(summary, boardId) : null;
  return (
    <main className="bg-background flex min-w-0 flex-1 flex-col">
      <ViewHeader
        title={selectedBoard?.title ?? "Boards"}
        description={
          selectedBoard?.description ??
          "Operational views for common investigations"
        }
        isLoading={isLoading}
        onRangeChange={onRangeChange}
        onRefresh={onRefresh}
        range={range}
      />
      <SummaryState error={error} isLoading={isLoading} />
      {summary && !selectedBoard && (
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-auto p-5 md:grid-cols-2">
          {boardDefinitions.map((board) => {
            const data = metricsForBoard(summary, board.id);
            const maximum = Math.max(
              1,
              ...data.buckets.map(({ requestCount }) => requestCount),
            );
            return (
              <Button
                key={board.id}
                type="button"
                variant="ghost"
                size={null}
                onClick={() => onBoardChange(board.id)}
                aria-label={`${board.title}: ${formatCount(data.metrics.requestCount)} ${board.id === "production" ? "requests" : "spans"}, ${data.metrics.errorCount} errors`}
                className="group flex min-h-52 flex-col rounded-md border border-white/[0.07] bg-white/[0.02] p-4 text-left transition hover:border-violet-500/25 hover:bg-gray-900"
              >
                <div className="flex w-full items-start">
                  <div>
                    <h2 className="text-xs font-medium text-zinc-200">
                      {board.title}
                    </h2>
                    <p className="mt-1 text-[10px] text-zinc-600">
                      {board.description}
                    </p>
                  </div>
                  <ExternalLink className="ml-auto size-3.5 text-zinc-700 transition group-hover:text-zinc-400" />
                </div>
                <div className="mt-auto flex h-24 w-full items-end gap-2 border-b border-white/[0.06]">
                  {data.buckets.map(({ requestCount }, index) => (
                    <div
                      key={index}
                      className={cn(
                        "flex-1 rounded-t-sm opacity-60",
                        board.color,
                      )}
                      style={{ height: `${(requestCount / maximum) * 100}%` }}
                    />
                  ))}
                </div>
                <div className="mt-2 flex w-full justify-between font-mono text-[8px] text-zinc-700">
                  <span>{formatRangeLabel(range, 1)}</span>
                  <span>now</span>
                </div>
                <div className="mt-3 flex gap-4 font-mono text-[9px] text-zinc-500">
                  <span>
                    {formatCount(data.metrics.requestCount)}{" "}
                    {board.id === "production" ? "requests" : "spans"}
                  </span>
                  <span>{data.metrics.errorCount} errors</span>
                  <span>p95 {formatDuration(data.metrics.p95Ms)}</span>
                </div>
              </Button>
            );
          })}
        </div>
      )}
      {summary && selectedBoard && selectedData && (
        <div className="min-h-0 flex-1 overflow-auto p-5">
          <Button
            variant="ghost"
            size={null}
            onClick={() => onBoardChange(null)}
            className="mb-4 text-xs text-zinc-400"
          >
            <ArrowLeft className="size-3.5" /> All boards
          </Button>
          <div className="grid grid-cols-3 gap-3">
            {[
              [
                formatCount(selectedData.metrics.requestCount),
                boardId === "production" ? "Requests" : "Spans",
              ],
              [
                `${selectedData.metrics.requestCount ? ((selectedData.metrics.errorCount / selectedData.metrics.requestCount) * 100).toFixed(1) : "0.0"}%`,
                "Error rate",
              ],
              [formatDuration(selectedData.metrics.p95Ms), "P95 latency"],
            ].map(([value, label]) => (
              <div
                key={label}
                className="rounded-md border border-white/[0.07] bg-white/[0.025] p-4"
              >
                <div className="font-mono text-xl text-zinc-100">{value}</div>
                <div className="mt-1 text-[10px] text-zinc-600">{label}</div>
              </div>
            ))}
          </div>
          <div className="mt-4 overflow-hidden rounded-md border border-white/[0.07]">
            {selectedData.operations.map((operation) => (
              <div
                key={operation.operation}
                className="grid grid-cols-[2fr_repeat(3,1fr)] border-b border-white/[0.055] px-4 py-3 text-[11px] last:border-0"
              >
                <span className="truncate font-mono text-zinc-300">
                  {operation.operation}
                </span>
                <span className="text-zinc-500">
                  {formatCount(operation.requestCount)} requests
                </span>
                <span className="text-zinc-500">
                  {operation.errorCount} errors
                </span>
                <span className="text-zinc-500">
                  p95 {formatDuration(operation.p95Ms)}
                </span>
              </div>
            ))}
            {selectedData.operations.length === 0 && (
              <p className="p-4 text-xs text-zinc-500">
                No matching operations reported in this time range.
              </p>
            )}
          </div>
        </div>
      )}
    </main>
  );
}

export default function TelemetryPage() {
  const [activeView, setActiveView] = useState<DashboardView>("traces");
  const [preset, setPreset] = useState<TracePreset>("errors");
  const [range, setRange] = useState(1_800);
  const [boardId, setBoardId] = useState<BoardId | null>(null);
  const [serviceFilter, setServiceFilter] = useState<string | null>(null);
  const [requestedTraceId, setRequestedTraceId] = useState<string | null>(null);
  const [urlReady, setUrlReady] = useState(false);
  const [liveTraces, setLiveTraces] = useState<Trace[]>([]);
  const [selectedTrace, setSelectedTrace] = useState<Trace | null>(null);
  const [tracesError, setTracesError] = useState<string | null>(null);
  const [tracesLoading, setTracesLoading] = useState(true);
  const [tracesTruncated, setTracesTruncated] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [summary, setSummary] = useState<TelemetrySummary | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);

  useEffect(() => {
    const applyUrl = () => {
      const params = new URLSearchParams(window.location.search);
      const view = params.get("view");
      const nextPreset = params.get("preset");
      const nextRange = Number(params.get("range"));
      const board = params.get("board");
      setActiveView(view === "services" || view === "boards" ? view : "traces");
      setPreset(
        nextPreset === "all" || nextPreset === "slow" ? nextPreset : "errors",
      );
      setRange(
        [900, 1800, 3600, 86400, 604800, 2592000].includes(nextRange)
          ? nextRange
          : 1_800,
      );
      setBoardId(
        boardDefinitions.some(({ id }) => id === board)
          ? (board as BoardId)
          : null,
      );
      setServiceFilter(params.get("service"));
      setRequestedTraceId(params.get("trace"));
      setSelectedTrace(null);
      setUrlReady(true);
    };
    applyUrl();
    window.addEventListener("popstate", applyUrl);
    return () => window.removeEventListener("popstate", applyUrl);
  }, []);

  useEffect(() => {
    if (!urlReady) return;
    const params = new URLSearchParams();
    params.set("view", activeView);
    params.set("range", String(range));
    params.set("preset", preset);
    if (serviceFilter) params.set("service", serviceFilter);
    if (activeView === "boards" && boardId) params.set("board", boardId);
    const traceId = selectedTrace?.id ?? requestedTraceId;
    if (activeView === "traces" && traceId) params.set("trace", traceId);
    window.history.replaceState(null, "", `?${params.toString()}`);
  }, [
    activeView,
    boardId,
    preset,
    range,
    requestedTraceId,
    selectedTrace,
    serviceFilter,
    urlReady,
  ]);

  useEffect(() => {
    if (!urlReady) return;
    const controller = new AbortController();
    setSummaryLoading(true);
    setSummaryError(null);
    void fetch(`/api/telemetry/summary?range=${range}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then((response) =>
        parseApiResponse<TelemetrySummary & { error?: string }>(
          response,
          "Unable to load telemetry summary",
        ),
      )
      .then(setSummary)
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setSummary(null);
        setSummaryError(
          error instanceof Error
            ? error.message
            : "Unable to load telemetry summary",
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setSummaryLoading(false);
      });
    return () => controller.abort();
  }, [range, refreshKey, urlReady]);

  useEffect(() => {
    if (!urlReady) return;
    const controller = new AbortController();
    setTracesLoading(true);
    setTracesError(null);

    const serviceQuery = serviceFilter
      ? `&service=${encodeURIComponent(serviceFilter)}`
      : "";
    const traceQuery = requestedTraceId
      ? `&trace=${encodeURIComponent(requestedTraceId)}`
      : "";
    void fetch(
      `/api/telemetry/traces?preset=${preset}&range=${range}${serviceQuery}${traceQuery}`,
      {
        cache: "no-store",
        signal: controller.signal,
      },
    )
      .then((response) =>
        parseApiResponse<TraceListResponse>(
          response,
          "Unable to load telemetry",
        ),
      )
      .then((body) => {
        const nextTraces = (body.traces ?? []).map<Trace>((trace) => ({
          id: trace.id,
          shortId: trace.shortId,
          route: trace.operation,
          outcome: trace.outcome,
          source: trace.source,
          service: trace.service,
          duration: formatDuration(trace.durationMs),
          durationMs: trace.durationMs,
          spans: trace.spanCount,
          when: formatRelativeTime(trace.startedAt),
          error: [trace.errorName, trace.errorMessage]
            .filter(Boolean)
            .join(": "),
          user: trace.userId ?? "—",
          version: trace.release ?? "—",
        }));
        setLiveTraces(nextTraces);
        setTracesTruncated(body.truncated === true);
        setSelectedTrace((current) => {
          if (current) {
            const refreshed = nextTraces.find(
              (trace) => trace.id === current.id,
            );
            if (refreshed) return refreshed;
          }
          return (
            nextTraces.find((trace) => trace.id === requestedTraceId) ??
            nextTraces[0] ??
            null
          );
        });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setLiveTraces([]);
        setTracesTruncated(false);
        setSelectedTrace(null);
        setTracesError(
          error instanceof Error ? error.message : "Unable to load telemetry",
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setTracesLoading(false);
      });

    return () => controller.abort();
  }, [preset, range, refreshKey, requestedTraceId, serviceFilter, urlReady]);

  return (
    <div className="bg-background flex h-screen min-h-[680px] w-full overflow-auto text-zinc-200 [&_button:not(:disabled)]:cursor-pointer">
      <NavRail activeView={activeView} onViewChange={setActiveView} />
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="bg-background flex h-10 shrink-0 items-center border-b border-white/[0.07] px-3">
          <Link
            href="/"
            className="flex h-auto items-center gap-1.5 text-[11px] text-zinc-500 hover:text-zinc-200"
          >
            <ArrowLeft className="size-3.5" />
            AI Thing
          </Link>
          <ChevronRight className="mx-2 size-3 text-zinc-700" />
          <div className="flex h-auto items-center gap-1.5 text-[11px] font-medium text-zinc-300">
            <Box className="size-3 text-violet-400" />
            production
          </div>
          <div className="ml-4 h-4 w-px bg-white/[0.08]" />
          <div className="ml-4 flex items-center gap-1.5 text-[10px] text-zinc-500">
            <span
              className={cn(
                "size-1.5 rounded-full",
                summaryError
                  ? "bg-rose-400 shadow-[0_0_7px_rgba(251,113,133,.6)]"
                  : summaryLoading
                    ? "bg-amber-400"
                    : "bg-emerald-400 shadow-[0_0_7px_rgba(52,211,153,.6)]",
              )}
            />
            {summaryError
              ? "Telemetry unavailable"
              : summaryLoading
                ? "Loading telemetry"
                : "Telemetry connected"}
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size={null}
              onClick={() => setActiveView("services")}
              className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[10px] text-zinc-500 hover:bg-white/[0.04] hover:text-zinc-300"
            >
              <Server className="size-3" /> {summary?.overall.serviceCount ?? 0}{" "}
              services
            </Button>
          </div>
        </div>
        <div className="flex min-h-0 min-w-[720px] flex-1 lg:min-w-0">
          {activeView === "traces" && (
            <>
              <TraceList
                error={tracesError}
                isLoading={tracesLoading}
                onClearService={() => setServiceFilter(null)}
                onPresetChange={setPreset}
                onRangeChange={setRange}
                onRefresh={() => setRefreshKey((value) => value + 1)}
                preset={preset}
                range={range}
                serviceFilter={serviceFilter}
                selectedTrace={selectedTrace}
                setSelectedTrace={(trace) => {
                  setRequestedTraceId(null);
                  setSelectedTrace(trace);
                }}
                traces={liveTraces}
                truncated={tracesTruncated}
              />
              {selectedTrace ? (
                <TraceInspector
                  key={selectedTrace.id}
                  onClose={() => {
                    setRequestedTraceId(null);
                    setSelectedTrace(null);
                  }}
                  trace={selectedTrace}
                />
              ) : (
                <aside className="bg-background flex w-[clamp(420px,35vw,520px)] shrink-0 items-center justify-center border-l border-white/[0.08] p-8 text-center">
                  <div>
                    <Layers3 className="mx-auto size-5 text-zinc-700" />
                    <p className="mt-3 text-xs text-zinc-500">
                      Select a trace to inspect its spans
                    </p>
                  </div>
                </aside>
              )}
            </>
          )}
          {activeView === "services" && (
            <ServicesView
              error={summaryError}
              isLoading={summaryLoading}
              onRangeChange={setRange}
              onRefresh={() => setRefreshKey((value) => value + 1)}
              onSelectService={(service) => {
                setServiceFilter(service);
                setPreset("all");
                setActiveView("traces");
              }}
              range={range}
              summary={summary}
            />
          )}
          {activeView === "boards" && (
            <BoardsView
              boardId={boardId}
              error={summaryError}
              isLoading={summaryLoading}
              onBoardChange={setBoardId}
              onRangeChange={setRange}
              onRefresh={() => setRefreshKey((value) => value + 1)}
              range={range}
              summary={summary}
            />
          )}
        </div>
      </div>
    </div>
  );
}
