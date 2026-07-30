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
  Filter,
  Gauge,
  Globe2,
  Hexagon,
  Layers3,
  MoreHorizontal,
  PanelRightClose,
  Play,
  RefreshCw,
  Search,
  Server,
  Settings2,
  Share2,
  Sparkles,
  TerminalSquare,
  X,
  Zap,
} from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "src/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "src/components/ui/select";
import { cn } from "src/lib/utils";

type Trace = {
  id: string;
  shortId: string;
  route: string;
  method: string;
  status: number;
  service: string;
  duration: string;
  durationMs: number;
  spans: number;
  when: string;
  error: string;
  user: string;
  version: string;
};

const traces: Trace[] = [
  {
    id: "48a7c3b952e9f16a08dc764e4e5806d1",
    shortId: "48a7c3b9",
    route: "/api/generate",
    method: "POST",
    status: 500,
    service: "api",
    duration: "2.84s",
    durationMs: 2840,
    spans: 18,
    when: "12s ago",
    error: "FalClientError: Request timed out after 30s",
    user: "usr_2x7...Ym4",
    version: "web@7f39a2",
  },
  {
    id: "2dc6f58b108fa8dd93aca1245a8f4a77",
    shortId: "2dc6f58b",
    route: "/api/generate",
    method: "POST",
    status: 500,
    service: "api",
    duration: "2.31s",
    durationMs: 2310,
    spans: 16,
    when: "1m ago",
    error: "FalClientError: Request timed out after 30s",
    user: "usr_8p2...Lk9",
    version: "web@7f39a2",
  },
  {
    id: "c90e8c4b780c3a78fae0129021cf1d54",
    shortId: "c90e8c4b",
    route: "/api/uploadthing",
    method: "POST",
    status: 503,
    service: "uploads",
    duration: "1.92s",
    durationMs: 1920,
    spans: 11,
    when: "3m ago",
    error: "StorageUnavailable: Failed to finalize multipart upload",
    user: "usr_4q1...Vt2",
    version: "web@7f39a2",
  },
  {
    id: "ba149b32d0317f2c91a1d83dfdb9cf21",
    shortId: "ba149b32",
    route: "/trpc/media.list",
    method: "GET",
    status: 504,
    service: "web",
    duration: "6.10s",
    durationMs: 6100,
    spans: 23,
    when: "8m ago",
    error: "PostgresError: canceling statement due to statement timeout",
    user: "usr_1n8...Qa7",
    version: "web@d12f48",
  },
  {
    id: "e3cb7783b70c2d97af52aa88f832742b",
    shortId: "e3cb7783",
    route: "/api/generate",
    method: "POST",
    status: 429,
    service: "api",
    duration: "184ms",
    durationMs: 184,
    spans: 9,
    when: "14m ago",
    error: "RateLimitError: Provider quota exceeded",
    user: "usr_9z3...Ap5",
    version: "web@d12f48",
  },
  {
    id: "7b2f199e4d7c9b28b1ec28a86ca8a8dc",
    shortId: "7b2f199e",
    route: "/trpc/media.list",
    method: "GET",
    status: 200,
    service: "web",
    duration: "246ms",
    durationMs: 246,
    spans: 12,
    when: "16m ago",
    error: "",
    user: "usr_6w2...Jf8",
    version: "web@d12f48",
  },
  {
    id: "1a97d2456f01c17a3eacaa58713ad167",
    shortId: "1a97d245",
    route: "/api/uploadthing",
    method: "POST",
    status: 200,
    service: "uploads",
    duration: "1.14s",
    durationMs: 1140,
    spans: 14,
    when: "19m ago",
    error: "",
    user: "usr_3r5...Bc1",
    version: "web@d12f48",
  },
];

const spans = [
  {
    name: "POST /api/generate",
    service: "api",
    start: 0,
    width: 100,
    duration: "2.84s",
    depth: 0,
    error: true,
    icon: Globe2,
  },
  {
    name: "auth.verifySession",
    service: "api",
    start: 2,
    width: 8,
    duration: "219ms",
    depth: 1,
    error: false,
    icon: Hexagon,
  },
  {
    name: "prompt.createWithGenerations",
    service: "api",
    start: 11,
    width: 86,
    duration: "2.44s",
    depth: 1,
    error: true,
    icon: Braces,
  },
  {
    name: "db.insert prompt",
    service: "postgres",
    start: 14,
    width: 5,
    duration: "142ms",
    depth: 2,
    error: false,
    icon: Database,
  },
  {
    name: "generation.create",
    service: "api",
    start: 21,
    width: 73,
    duration: "2.07s",
    depth: 2,
    error: true,
    icon: Sparkles,
  },
  {
    name: "fal.subscribe",
    service: "fal",
    start: 25,
    width: 67,
    duration: "1.91s",
    depth: 3,
    error: true,
    icon: Zap,
  },
  {
    name: "POST queue.fal.run",
    service: "fal",
    start: 28,
    width: 63,
    duration: "1.79s",
    depth: 4,
    error: true,
    icon: Globe2,
  },
  {
    name: "record generation failure",
    service: "postgres",
    start: 93,
    width: 4,
    duration: "97ms",
    depth: 2,
    error: false,
    icon: Database,
  },
];

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
            <button
              key={label}
              type="button"
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
            </button>
          );
        })}
      </div>
      <div className="mt-auto flex flex-col gap-1">
        <button
          type="button"
          className="flex size-10 items-center justify-center rounded-lg text-zinc-500 hover:bg-white/5 hover:text-zinc-200"
        >
          <Settings2 className="size-[18px]" />
        </button>
        <div className="flex size-8 items-center justify-center rounded-full bg-gray-800 text-[11px] font-semibold text-gray-200 ring-1 ring-white/15">
          EG
        </div>
      </div>
    </aside>
  );
}

function MiniHistogram() {
  const values = [
    18, 25, 16, 30, 22, 45, 37, 62, 42, 68, 49, 78, 58, 40, 31, 52, 29, 48, 34,
    22, 27, 18, 13, 21,
  ];
  return (
    <div className="flex h-9 flex-1 items-end gap-[3px]">
      {values.map((value, index) => (
        <div
          key={`${value}-${index}`}
          className={cn(
            "min-w-1 flex-1 rounded-[1px] bg-violet-400/25",
            index > 10 && index < 15 && "bg-rose-400/60",
          )}
          style={{ height: `${value}%` }}
        />
      ))}
    </div>
  );
}

function TraceList({
  selectedTrace,
  setSelectedTrace,
}: {
  selectedTrace: Trace;
  setSelectedTrace: (trace: Trace) => void;
}) {
  const [query, setQuery] = useState("");
  const [preset, setPreset] = useState<"all" | "errors" | "slow">("errors");
  const filtered = useMemo(
    () =>
      traces.filter((trace) => {
        const matchesQuery = `${trace.route} ${trace.error} ${trace.id}`
          .toLowerCase()
          .includes(query.toLowerCase());
        const matchesPreset =
          preset === "all" ||
          (preset === "errors" && trace.status >= 400) ||
          (preset === "slow" && trace.durationMs >= 1000);
        return matchesQuery && matchesPreset;
      }),
    [preset, query],
  );

  return (
    <main className="bg-background flex min-w-[420px] flex-1 flex-col">
      <header className="flex h-14 items-center gap-3 border-b border-white/[0.07] px-4">
        <div className="flex min-w-0 flex-1 items-center gap-2 rounded-md border border-white/[0.09] bg-gray-950 px-3 py-1.5 shadow-inner">
          <Search className="size-3.5 shrink-0 text-zinc-600" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="min-w-0 flex-1 bg-transparent text-xs text-zinc-200 outline-none placeholder:text-zinc-600"
            placeholder="Search traces by route, error, user or trace ID..."
          />
          {query && (
            <button type="button" onClick={() => setQuery("")}>
              <X className="size-3.5 text-zinc-600 hover:text-zinc-300" />
            </button>
          )}
          <kbd className="rounded border border-white/[0.08] bg-white/[0.04] px-1.5 py-0.5 font-sans text-[9px] text-zinc-600">
            ⌘ K
          </kbd>
        </div>
        <Select defaultValue="30m">
          <SelectTrigger className="h-8 border-white/[0.09] bg-white/[0.03] text-xs text-zinc-300">
            <Clock3 className="size-3.5 text-zinc-500" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="15m">Last 15 minutes</SelectItem>
            <SelectItem value="30m">Last 30 minutes</SelectItem>
            <SelectItem value="1h">Last hour</SelectItem>
            <SelectItem value="24h">Last 24 hours</SelectItem>
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          size="icon"
          className="border-white/[0.09] bg-white/[0.03] text-zinc-500"
          title="Refresh mock traces"
        >
          <RefreshCw />
        </Button>
      </header>

      <div className="border-b border-white/[0.07] px-4 pt-3">
        <div className="mb-3 flex items-center gap-1">
          {(["all", "errors", "slow"] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setPreset(value)}
              className={cn(
                "rounded-md px-3 py-1.5 text-[11px] font-medium text-zinc-500 capitalize transition hover:bg-white/[0.04] hover:text-zinc-300",
                preset === value &&
                  "bg-white/[0.07] text-zinc-100 shadow-[inset_0_0_0_1px_rgba(255,255,255,.06)]",
              )}
            >
              {value}
              {value === "errors" && (
                <span className="ml-1.5 font-mono text-[9px] text-rose-400">
                  32
                </span>
              )}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-medium text-zinc-500">FILTERS</span>
          <button
            type="button"
            className="flex items-center gap-1 rounded-md border border-white/[0.08] bg-white/[0.03] px-2 py-1 text-[10px] text-zinc-400"
          >
            environment = production <X className="size-2.5" />
          </button>
          <button
            type="button"
            className="flex items-center gap-1 px-1.5 py-1 text-[10px] text-zinc-500 hover:text-zinc-300"
          >
            <Filter className="size-3" /> Add filter
          </button>
        </div>
        <div className="mt-2 flex items-end gap-4">
          <MiniHistogram />
          <div className="pb-1 text-right">
            <div className="font-mono text-lg font-medium text-zinc-200">
              {preset === "errors" ? 32 : preset === "slow" ? 11 : 84}
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
          <span>30m ago</span>
          <span>20m</span>
          <span>10m</span>
          <span>now</span>
        </div>
      </div>

      <div className="flex items-center border-b border-white/[0.07] px-4 py-2 text-[9px] font-semibold tracking-wider text-zinc-600 uppercase">
        <span className="w-[42%]">Request</span>
        <span className="w-[15%]">Duration</span>
        <span className="w-[14%]">Service</span>
        <span className="w-[12%]">Spans</span>
        <span className="flex-1 text-right">Seen</span>
      </div>

      <div className="flex-1 overflow-y-auto">
        {filtered.map((trace) => (
          <button
            type="button"
            key={trace.id}
            onClick={() => setSelectedTrace(trace)}
            className={cn(
              "group flex w-full items-center border-b border-white/[0.055] px-4 py-3 text-left transition",
              selectedTrace.id === trace.id
                ? "bg-violet-500/[0.08] shadow-[inset_2px_0_0_#8b5cf6]"
                : "hover:bg-white/[0.025]",
            )}
          >
            <div className="flex w-[42%] min-w-0 items-start gap-2.5">
              {trace.status >= 400 ? (
                <AlertCircle className="mt-0.5 size-3.5 shrink-0 text-rose-400" />
              ) : (
                <Check className="mt-0.5 size-3.5 shrink-0 text-emerald-400" />
              )}
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate font-mono text-[11px] font-medium text-zinc-200">
                    {trace.method} {trace.route}
                  </span>
                  <TinyPill tone={trace.status >= 400 ? "error" : "success"}>
                    {trace.status}
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
          </button>
        ))}
        {filtered.length === 0 && (
          <div className="flex h-48 flex-col items-center justify-center text-zinc-600">
            <Search className="mb-2 size-5" />
            <p className="text-xs">No traces match this search</p>
          </div>
        )}
      </div>
      <footer className="flex h-9 items-center justify-between border-t border-white/[0.07] px-4 text-[10px] text-zinc-600">
        <span>Showing {filtered.length} mock traces</span>
        <span className="font-mono">Newest first</span>
      </footer>
    </main>
  );
}

function Waterfall({ hasError }: { hasError: boolean }) {
  const [selectedSpan, setSelectedSpan] = useState(5);
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <div className="bg-background sticky top-0 z-10 grid grid-cols-[225px_1fr] border-b border-white/[0.07]">
        <div className="border-r border-white/[0.06] px-3 py-2 text-[9px] font-semibold tracking-wider text-zinc-600 uppercase">
          Span
        </div>
        <div className="flex justify-between px-3 py-2 font-mono text-[8px] text-zinc-700">
          <span>0ms</span>
          <span>710ms</span>
          <span>1.42s</span>
          <span>2.13s</span>
          <span>2.84s</span>
        </div>
      </div>
      {spans.map((span, index) => {
        const Icon = span.icon;
        const isError = hasError && span.error;
        return (
          <button
            type="button"
            key={span.name}
            onClick={() => setSelectedSpan(index)}
            className={cn(
              "grid w-full grid-cols-[225px_1fr] border-b border-white/[0.045] text-left",
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
          </button>
        );
      })}
      {hasError && (
        <div className="m-3 rounded-lg border border-rose-500/20 bg-rose-500/[0.06] p-3">
          <div className="flex items-center gap-2 text-[11px] font-medium text-rose-300">
            <AlertCircle className="size-3.5" />
            Exception
            <span className="ml-auto font-mono text-[9px] text-rose-400/60">
              fal.subscribe
            </span>
          </div>
          <div className="mt-2 font-mono text-[10px] leading-5 text-zinc-400">
            FalClientError: Request timed out after 30s
            <br />
            <span className="text-zinc-600">
              at FalClient.subscribe (fal-client.ts:142:11)
            </span>
            <br />
            <span className="text-zinc-600">
              at async createGeneration (media.ts:318:22)
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

function Attributes() {
  const attributes = [
    ["http.request.method", "POST"],
    ["http.route", "/api/generate"],
    ["http.response.status_code", "500"],
    ["service.name", "api"],
    ["deployment.environment", "production"],
    ["user.id", "usr_2x7kPf9Ym4"],
    ["app.model", "fal-ai/flux-pro/v1.1"],
    ["app.generation_id", "gen_q9s3Df2k"],
  ];
  return (
    <div className="overflow-auto p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[9px] font-semibold tracking-wider text-zinc-600 uppercase">
          Resource & span attributes
        </span>
        <button className="text-[10px] text-violet-400 hover:text-violet-300">
          Copy as JSON
        </button>
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

function TraceInspector({ trace }: { trace: Trace }) {
  const [tab, setTab] = useState<"waterfall" | "attributes" | "events">(
    "waterfall",
  );
  const [copied, setCopied] = useState(false);
  const hasError = trace.status >= 400;

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
                {trace.method} {trace.route}
              </h2>
              <TinyPill tone={hasError ? "error" : "success"}>
                {trace.status}
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
          >
            <PanelRightClose />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-zinc-600 hover:bg-white/5"
          >
            <MoreHorizontal />
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
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard.writeText(trace.id);
              setCopied(true);
              setTimeout(() => setCopied(false), 1200);
            }}
            className="text-zinc-600 hover:text-zinc-300"
          >
            {copied ? (
              <Check className="size-3 text-emerald-400" />
            ) : (
              <Copy className="size-3" />
            )}
          </button>
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
            <button
              type="button"
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
            </button>
          );
        })}
        <div className="ml-auto flex gap-1">
          <Button
            variant="ghost"
            size="icon-xs"
            className="text-zinc-600 hover:bg-white/5"
            title="Share trace"
          >
            <Share2 />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            className="text-zinc-600 hover:bg-white/5"
            title="Open full page"
          >
            <ExternalLink />
          </Button>
        </div>
      </div>

      {tab === "waterfall" && <Waterfall hasError={hasError} />}
      {tab === "attributes" && <Attributes />}
      {tab === "events" && (
        <div className="overflow-auto p-3">
          <div className="rounded-lg border border-white/[0.07] bg-black/20 p-3 font-mono text-[10px] leading-6 text-zinc-500">
            <span className="text-zinc-700">14:32:08.129</span>{" "}
            <span className="text-cyan-400">generation.queued</span>
            <br />
            <span className="text-zinc-700">14:32:08.421</span>{" "}
            <span className="text-violet-400">provider.request.started</span>
            <br />
            <span className="text-zinc-700">14:32:10.908</span>{" "}
            <span className="text-rose-400">exception</span>{" "}
            <span className="text-zinc-300">FalClientError</span>
            <br />
            <span className="text-zinc-700">14:32:10.969</span>{" "}
            <span className="text-amber-400">generation.failed</span>
          </div>
        </div>
      )}
    </aside>
  );
}

const services = [
  {
    name: "api",
    icon: Braces,
    requests: "18.4k",
    errorRate: "1.8%",
    p95: "842ms",
    health: "degraded",
  },
  {
    name: "web",
    icon: Globe2,
    requests: "42.1k",
    errorRate: "0.3%",
    p95: "294ms",
    health: "healthy",
  },
  {
    name: "postgres",
    icon: Database,
    requests: "31.7k",
    errorRate: "0.1%",
    p95: "91ms",
    health: "healthy",
  },
  {
    name: "uploads",
    icon: Box,
    requests: "8.2k",
    errorRate: "0.9%",
    p95: "1.2s",
    health: "degraded",
  },
  {
    name: "fal",
    icon: Sparkles,
    requests: "3.8k",
    errorRate: "4.7%",
    p95: "8.4s",
    health: "degraded",
  },
  {
    name: "worker",
    icon: Server,
    requests: "12.9k",
    errorRate: "0.2%",
    p95: "436ms",
    health: "healthy",
  },
];

function ViewHeader({
  title,
  description,
}: {
  title: string;
  description: string;
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
        <Select defaultValue="30m">
          <SelectTrigger className="h-8 border-white/[0.09] bg-white/[0.03] text-xs text-zinc-300">
            <Clock3 className="size-3.5 text-zinc-500" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="30m">Last 30 minutes</SelectItem>
            <SelectItem value="1h">Last hour</SelectItem>
            <SelectItem value="24h">Last 24 hours</SelectItem>
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          size="icon"
          className="border-white/[0.09] bg-white/[0.03] text-zinc-500"
        >
          <RefreshCw />
        </Button>
      </div>
    </div>
  );
}

function ServicesView() {
  return (
    <main className="bg-background flex min-w-0 flex-1 flex-col">
      <ViewHeader
        title="Services"
        description="Health and performance across the application"
      />
      <div className="grid grid-cols-3 gap-3 border-b border-white/[0.07] p-5">
        {[
          ["6", "Reporting services", "text-zinc-100"],
          ["2.1%", "Overall error rate", "text-rose-300"],
          ["612ms", "Application p95", "text-orange-300"],
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
          {services.map(
            ({ name, icon: Icon, requests, errorRate, p95, health }) => (
              <button
                key={name}
                type="button"
                className="grid w-full grid-cols-[1.5fr_repeat(4,1fr)] items-center border-t border-white/[0.055] px-4 py-3 text-left hover:bg-white/[0.025]"
              >
                <span className="flex items-center gap-2 text-xs font-medium text-zinc-200">
                  <span className="flex size-7 items-center justify-center rounded-md bg-violet-500/10">
                    <Icon className="size-3.5 text-violet-300" />
                  </span>
                  {name}
                </span>
                <span className="font-mono text-[11px] text-zinc-400">
                  {requests}
                </span>
                <span
                  className={cn(
                    "font-mono text-[11px]",
                    Number.parseFloat(errorRate) > 1
                      ? "text-rose-300"
                      : "text-zinc-400",
                  )}
                >
                  {errorRate}
                </span>
                <span className="font-mono text-[11px] text-zinc-400">
                  {p95}
                </span>
                <span className="flex items-center gap-1.5 text-[10px] text-zinc-400">
                  <span
                    className={cn(
                      "size-1.5 rounded-full",
                      health === "healthy" ? "bg-emerald-400" : "bg-amber-400",
                    )}
                  />
                  {health}
                </span>
              </button>
            ),
          )}
        </div>
      </div>
    </main>
  );
}

function BoardsView() {
  return (
    <main className="bg-background flex min-w-0 flex-1 flex-col">
      <ViewHeader
        title="Boards"
        description="Saved operational views for common investigations"
      />
      <div className="grid min-h-0 flex-1 grid-cols-2 gap-4 overflow-auto p-5">
        {[
          {
            title: "Production pulse",
            description: "Errors, throughput and latency",
            color: "violet",
            bars: [34, 48, 37, 62, 45, 74, 51, 68, 41, 58, 39, 47],
          },
          {
            title: "Generation providers",
            description: "Success rate and duration by model",
            color: "rose",
            bars: [62, 58, 66, 53, 71, 49, 44, 38, 52, 41, 34, 46],
          },
          {
            title: "Database health",
            description: "Query volume, slow queries and locks",
            color: "cyan",
            bars: [21, 26, 24, 31, 28, 35, 27, 33, 25, 29, 23, 26],
          },
          {
            title: "Upload pipeline",
            description: "Storage latency and failed uploads",
            color: "orange",
            bars: [18, 24, 20, 42, 28, 55, 31, 47, 29, 38, 22, 34],
          },
        ].map((board) => (
          <button
            key={board.title}
            type="button"
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
              {board.bars.map((height, index) => (
                <div
                  key={index}
                  className={cn(
                    "flex-1 rounded-t-sm opacity-60",
                    board.color === "violet" && "bg-violet-400",
                    board.color === "rose" && "bg-rose-400",
                    board.color === "cyan" && "bg-cyan-400",
                    board.color === "orange" && "bg-orange-400",
                  )}
                  style={{ height: `${height}%` }}
                />
              ))}
            </div>
            <div className="mt-2 flex w-full justify-between font-mono text-[8px] text-zinc-700">
              <span>30m ago</span>
              <span>now</span>
            </div>
          </button>
        ))}
      </div>
    </main>
  );
}

export default function TelemetryPage() {
  const [activeView, setActiveView] = useState<DashboardView>("traces");
  const [selectedTrace, setSelectedTrace] = useState(traces[0]!);

  return (
    <div className="bg-background flex h-screen min-h-[680px] w-full overflow-hidden text-zinc-200 [&_button:not(:disabled)]:cursor-pointer">
      <NavRail activeView={activeView} onViewChange={setActiveView} />
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="bg-background flex h-10 shrink-0 items-center border-b border-white/[0.07] px-3">
          <button
            type="button"
            className="flex items-center gap-1.5 text-[11px] text-zinc-500 hover:text-zinc-200"
          >
            <ArrowLeft className="size-3.5" />
            AI Thing
          </button>
          <ChevronRight className="mx-2 size-3 text-zinc-700" />
          <button
            type="button"
            className="flex items-center gap-1.5 text-[11px] font-medium text-zinc-300"
          >
            <Box className="size-3 text-violet-400" />
            production
            <ChevronDown className="size-3 text-zinc-600" />
          </button>
          <div className="ml-4 h-4 w-px bg-white/[0.08]" />
          <div className="ml-4 flex items-center gap-1.5 text-[10px] text-zinc-500">
            <span className="size-1.5 rounded-full bg-emerald-400 shadow-[0_0_7px_rgba(52,211,153,.6)]" />
            All systems reporting
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              className="flex items-center gap-1.5 rounded-md border border-white/[0.08] bg-white/[0.025] px-2 py-1 text-[10px] text-zinc-500 hover:text-zinc-300"
            >
              <Play className="size-2.5 fill-current" />
              Live tail
            </button>
            <button
              type="button"
              className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[10px] text-zinc-500 hover:bg-white/[0.04] hover:text-zinc-300"
            >
              <Server className="size-3" /> 6 services
            </button>
          </div>
        </div>
        <div className="flex min-h-0 flex-1">
          {activeView === "traces" && (
            <>
              <TraceList
                selectedTrace={selectedTrace}
                setSelectedTrace={setSelectedTrace}
              />
              <TraceInspector trace={selectedTrace} />
            </>
          )}
          {activeView === "services" && <ServicesView />}
          {activeView === "boards" && <BoardsView />}
        </div>
      </div>
    </div>
  );
}
