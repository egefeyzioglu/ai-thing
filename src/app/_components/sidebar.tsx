"use client";

import { useEffect, useRef, useState, type RefObject } from "react";

import { UserButton } from "@clerk/nextjs";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  Gauge,
  HelpCircle,
  Image as ImageIcon,
  Info,
  Maximize2,
  Minus,
  Plus,
  Sparkles,
  Trash2,
  Upload,
  Video as VideoIcon,
} from "lucide-react";
import Image from "next/image";
import { toast } from "sonner";
import {
  isExtendedImageQuality,
  type ImageQuality,
} from "src/lib/image-quality";
import {
  getEffectiveImageResolution,
  IMAGE_RESOLUTION_OPTIONS,
  type ImageResolution,
} from "src/lib/image-resolution";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "src/components/ui/collapsible";
import { Button } from "src/components/ui/button";
import { Field, FieldLabel } from "src/components/ui/field";
import { Input } from "src/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "src/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "src/components/ui/select";
import { Skeleton } from "src/components/ui/skeleton";
import { Textarea } from "src/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "src/components/ui/tooltip";
import { cn } from "src/lib/utils";
import type { RouterInputs, RouterOutputs } from "src/trpc/react";
import { GenerateButton } from "./generate-button";
import { MediaLightbox } from "./media-lightbox";
import { PromptComposer, type PromptComposerHandle } from "./prompt-composer";
import { SegmentedControl } from "./segmented-control";
import { UsageModal } from "./usage-modal";

export type PromptModelSlug =
  RouterInputs["prompt"]["createWithGenerations"]["models"][number];
export type OutputMode = "image" | "video";
export type ResolutionOption = ImageResolution;
export type VideoResolution = "480p" | "720p" | "1080p";
export type VideoDuration = 5 | 10;
export type VideoMotion = "auto" | "low" | "high";

export const RESOLUTION_OPTIONS: readonly ResolutionOption[] =
  IMAGE_RESOLUTION_OPTIONS;
export const VIDEO_RESOLUTION_OPTIONS: VideoResolution[] = [
  "480p",
  "720p",
  "1080p",
];
export const VIDEO_DURATION_OPTIONS: VideoDuration[] = [5, 10];

export type QualityOption = ImageQuality;
export type BackgroundOption = "auto" | "opaque" | "transparent";
export type ThinkingOption = "auto" | "off" | "low" | "high";

export const VIDEO_MOTION_OPTIONS: { value: VideoMotion; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "low", label: "Subtle" },
  { value: "high", label: "Dynamic" },
];

export type VideoReferenceRole = "first" | "last" | "refimg";
export const MAX_VIDEO_REFERENCE_IMAGES = 9;
export const MAX_RUNS_PER_MODEL = 8;

const IMAGE_ASPECT_OPTIONS = ["1:1", "4:3", "3:4", "16:9", "9:16"] as const;
const VIDEO_ASPECT_OPTIONS = [
  "1:1",
  "4:3",
  "3:4",
  "16:9",
  "9:16",
  "21:9",
  "adaptive",
] as const;

const VIDEO_REFERENCE_ROLE_OPTIONS: {
  value: VideoReferenceRole;
  label: string;
  short: string;
  hint: string;
  accent: boolean;
}[] = [
  {
    value: "first",
    label: "First frame",
    short: "First",
    hint: "Start of the clip",
    accent: true,
  },
  {
    value: "last",
    label: "Last frame",
    short: "Last",
    hint: "End of the clip",
    accent: true,
  },
  {
    value: "refimg",
    label: "Reference image",
    short: "Ref",
    hint: "Guides style & subject",
    accent: false,
  },
];

const VIDEO_REFERENCE_ROLE_BY_VALUE = Object.fromEntries(
  VIDEO_REFERENCE_ROLE_OPTIONS.map((opt) => [opt.value, opt]),
) as Record<VideoReferenceRole, (typeof VIDEO_REFERENCE_ROLE_OPTIONS)[number]>;

export const QUALITY_OPTIONS: { value: QualityOption; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "xhigh", label: "Extra High" },
  { value: "max", label: "Max" },
];

export const BACKGROUND_OPTIONS: { value: BackgroundOption; label: string }[] =
  [
    { value: "auto", label: "Auto" },
    { value: "opaque", label: "Opaque" },
    { value: "transparent", label: "Transparent" },
  ];

export const THINKING_OPTIONS: { value: ThinkingOption; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "off", label: "Off" },
  { value: "low", label: "Low" },
  { value: "high", label: "High" },
];

function formatShortDate(date: Date | string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(date));
}

/** Labelled block in the sidebar with an optional element on the right. */
function Section({
  title,
  aside,
  children,
  className,
}: {
  title: React.ReactNode;
  aside?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("flex flex-col gap-2", className)}>
      <div className="flex min-h-5 items-center justify-between gap-2">
        <h2 className="text-muted-foreground text-xs font-medium">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

/** Header row that toggles a collapsible section. */
function SectionTrigger({
  title,
  badge,
  open,
}: {
  title: string;
  badge?: React.ReactNode;
  open: boolean;
}) {
  return (
    <CollapsibleTrigger className="group/trigger text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 -mx-1.5 flex w-[calc(100%+0.75rem)] cursor-pointer items-center justify-between gap-2 rounded-md px-1.5 py-1 text-xs font-medium outline-none focus-visible:ring-3">
      <span className="flex items-center gap-2">
        {title}
        {badge}
      </span>
      <ChevronDown
        className={cn(
          "size-4 transition-transform duration-200",
          open && "rotate-180",
        )}
      />
    </CollapsibleTrigger>
  );
}

function CountBadge({ children }: { children: React.ReactNode }) {
  return (
    <span className="bg-primary/15 text-primary-text rounded-full px-1.5 py-px text-[10px] leading-4 font-semibold tabular-nums">
      {children}
    </span>
  );
}

function ModelRow({
  slug,
  name,
  provider,
  isSelected,
  onToggle,
}: {
  slug: string;
  name: string;
  provider: string;
  isSelected: boolean;
  onToggle: () => void;
}) {
  return (
    <div
      role="checkbox"
      aria-checked={isSelected}
      aria-labelledby={`model-select-${slug}-label`}
      tabIndex={0}
      title={slug}
      className={cn(
        "focus-visible:ring-ring/50 flex h-9 cursor-pointer items-center gap-2.5 rounded-md px-2.5 text-sm outline-none select-none focus-visible:ring-3",
        "hover:bg-muted/60",
        isSelected ? "text-foreground" : "text-foreground/75",
      )}
      onClick={onToggle}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onToggle();
        }
      }}
    >
      {/* Visual-only box: the row itself is the checkbox. */}
      <span
        aria-hidden
        className={cn(
          "flex size-4 shrink-0 items-center justify-center rounded-[4px] border transition-colors",
          isSelected
            ? "border-primary bg-primary text-primary-foreground"
            : "border-input bg-input/30",
        )}
      >
        {isSelected && <Check className="size-3" strokeWidth={3} />}
      </span>
      <span id={`model-select-${slug}-label`} className="min-w-0 truncate">
        {name}
      </span>
      <span className="text-muted-foreground ml-auto shrink-0 text-xs">
        {provider}
      </span>
    </div>
  );
}

function AspectShape({ ratio }: { ratio: string }) {
  const [w, h] = ratio.split(":").map(Number);
  if (!w || !h) {
    return (
      <span
        aria-hidden
        className="size-3 rounded-[2px] border border-dashed border-current"
      />
    );
  }
  const scale = 12 / Math.max(w, h);
  return (
    <span
      aria-hidden
      className="rounded-[2px] border border-current"
      style={{ width: Math.max(4, w * scale), height: Math.max(4, h * scale) }}
    />
  );
}

function AdvancedControlLabel({
  label,
  help,
  htmlFor,
}: {
  label: string;
  help: string;
  htmlFor?: string;
}) {
  return (
    <div className="flex items-center gap-1">
      <FieldLabel
        htmlFor={htmlFor}
        className="text-muted-foreground text-xs font-normal"
      >
        {label}
      </FieldLabel>
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              aria-label={`What does ${label} do?`}
              className="text-muted-foreground/60 hover:text-muted-foreground focus-visible:outline-ring inline-flex size-4 cursor-help items-center justify-center rounded-sm focus-visible:outline focus-visible:outline-1"
            >
              <HelpCircle size={12} />
            </button>
          }
        />
        <TooltipContent className="max-w-64">{help}</TooltipContent>
      </Tooltip>
    </div>
  );
}

function ProviderGroup({
  name,
  active,
  children,
}: {
  name: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-2.5 rounded-lg border p-3 transition-opacity",
        !active && "opacity-50",
      )}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium">{name}</span>
        {!active && (
          <span className="text-muted-foreground text-[11px]">
            No {name} model selected
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

type ReferenceImageProps = {
  src: string;
  alt: string;
  isSelected: boolean;
  onDelete: () => void;
  setSelected: () => void;
  onPreview: () => void;
  role?: VideoReferenceRole;
  availableRoles?: VideoReferenceRole[];
  onChangeRole?: (role: VideoReferenceRole) => void;
};

function ReferenceImage(props: ReferenceImageProps) {
  const showRolePill = props.isSelected && props.role !== undefined;
  const roleInfo = props.role
    ? VIDEO_REFERENCE_ROLE_BY_VALUE[props.role]
    : undefined;
  return (
    <div
      className={cn(
        "group bg-muted relative aspect-square overflow-hidden rounded-md ring-1 transition-shadow",
        props.isSelected ? "ring-primary ring-2" : "ring-border",
      )}
    >
      {/* Image body: click to select, so the main target is the common action. */}
      <button
        type="button"
        role="checkbox"
        aria-checked={props.isSelected}
        aria-label={
          props.isSelected
            ? "Deselect reference image"
            : "Select reference image"
        }
        onClick={props.setSelected}
        className="focus-visible:ring-ring absolute inset-0 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-inset"
      >
        <Image
          src={props.src}
          alt={props.alt}
          fill
          sizes="96px"
          loading="lazy"
          className="object-cover"
        />
      </button>

      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute top-1 left-1 flex size-4 items-center justify-center rounded-[4px] border transition-opacity",
          props.isSelected
            ? "border-primary bg-primary text-primary-foreground"
            : "border-white/80 bg-black/40 text-transparent opacity-0 group-hover:opacity-100",
        )}
      >
        <Check className="size-3" strokeWidth={3} />
      </span>

      <div className="absolute top-1 right-1 flex gap-1 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
        <button
          type="button"
          aria-label="Preview reference image"
          title="Preview"
          onClick={props.onPreview}
          className="focus-visible:outline-ring flex size-6 cursor-pointer items-center justify-center rounded-[5px] bg-black/60 text-white hover:bg-black/80 focus-visible:outline-2"
        >
          <Maximize2 className="size-3.5" strokeWidth={2} />
        </button>
        <button
          type="button"
          aria-label="Delete reference image"
          title="Delete"
          onClick={props.onDelete}
          className="focus-visible:outline-ring flex size-6 cursor-pointer items-center justify-center rounded-[5px] bg-black/60 text-white hover:bg-red-500/80 focus-visible:outline-2"
        >
          <Trash2 className="size-3.5" strokeWidth={2} />
        </button>
      </div>

      {showRolePill && roleInfo && props.onChangeRole && (
        <Popover>
          <PopoverTrigger
            render={
              <button
                type="button"
                className={cn(
                  "focus-visible:outline-ring absolute right-1 bottom-1 left-1 z-20 flex cursor-pointer items-center justify-center gap-0.5 rounded-full border px-1 py-0.5 text-[10px] leading-none font-medium backdrop-blur-md transition-colors focus-visible:outline focus-visible:outline-2",
                  roleInfo.accent
                    ? "border-primary/50 text-primary-text bg-black/60 hover:bg-black/75"
                    : "border-border text-foreground bg-black/60 hover:bg-black/75",
                )}
                aria-label={`Role: ${roleInfo.label}. Click to change.`}
              >
                <span>{roleInfo.short}</span>
                <ChevronDown
                  className="size-2.5 opacity-70"
                  strokeWidth={2.5}
                />
              </button>
            }
          />
          <PopoverContent
            align="start"
            sideOffset={4}
            className="w-48 gap-0.5 p-1"
          >
            {(
              props.availableRoles ??
              VIDEO_REFERENCE_ROLE_OPTIONS.map((o) => o.value)
            ).map((roleValue) => {
              const opt = VIDEO_REFERENCE_ROLE_BY_VALUE[roleValue];
              const selected = props.role === roleValue;
              return (
                <button
                  key={roleValue}
                  type="button"
                  onClick={() => props.onChangeRole?.(roleValue)}
                  className={cn(
                    "flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs",
                    selected ? "bg-primary/15" : "hover:bg-muted",
                  )}
                >
                  <span
                    className={cn(
                      "size-2 shrink-0 rounded-full",
                      opt.accent ? "bg-primary" : "bg-muted-foreground",
                    )}
                  />
                  <span className="flex min-w-0 flex-col leading-tight">
                    <span className="text-xs">{opt.label}</span>
                    <span className="text-muted-foreground text-[10px]">
                      {opt.hint}
                    </span>
                  </span>
                  {selected && (
                    <Check
                      className="text-primary-text ml-auto size-3 shrink-0"
                      strokeWidth={3}
                    />
                  )}
                </button>
              );
            })}
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}

/**
 * Full-bleed lightbox preview for a reference image, with a "Use as
 * reference" toggle so users can select/deselect without closing it.
 */
function ReferenceImageLightbox({
  src,
  alt,
  isSelected,
  onToggleSelected,
  onClose,
}: {
  src: string;
  alt: string;
  isSelected: boolean;
  onToggleSelected: () => void;
  onClose: () => void;
}) {
  return (
    <MediaLightbox
      label="Reference image"
      onClose={onClose}
      footer={
        <Button
          type="button"
          size="lg"
          variant={isSelected ? "default" : "outline"}
          onClick={onToggleSelected}
          aria-pressed={isSelected}
        >
          <Check className={cn(!isSelected && "opacity-40")} strokeWidth={3} />
          {isSelected ? "Selected as reference" : "Use as reference"}
        </Button>
      }
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        className="block h-auto max-h-[calc(100vh-7.5rem)] w-auto max-w-[calc(100vw-4rem)]"
      />
    </MediaLightbox>
  );
}

function UsageMeter({
  usage,
  isLoading,
  bypassMonthlyQuota,
  onOpen,
}: {
  usage: RouterOutputs["usage"]["getCurrent"] | undefined;
  isLoading: boolean;
  bypassMonthlyQuota: boolean;
  onOpen: () => void;
}) {
  if (isLoading || !usage) {
    return <Skeleton className="h-7 w-24 rounded-md" />;
  }
  const percent =
    usage.limit > 0 ? Math.min(100, (usage.used / usage.limit) * 100) : 0;
  const tone = bypassMonthlyQuota
    ? "bg-yellow-400"
    : percent >= 100
      ? "bg-red-500"
      : percent > 70
        ? "bg-amber-500"
        : "bg-primary";
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            onClick={onOpen}
            aria-label={`Usage: ${usage.remaining} of ${usage.limit} credits left`}
            className="hover:bg-muted focus-visible:ring-ring/50 flex h-7 cursor-pointer flex-col justify-center gap-1 rounded-md px-2 outline-none focus-visible:ring-3"
          >
            <span className="text-muted-foreground flex items-center gap-1 text-[11px] leading-none tabular-nums">
              <Gauge className="size-3" />
              {usage.remaining.toLocaleString()} left
            </span>
            <span className="bg-muted block h-1 w-full overflow-hidden rounded-full">
              <span
                className={cn("block h-full rounded-full", tone)}
                style={{ width: `${Math.max(percent, 2)}%` }}
              />
            </span>
          </button>
        }
      />
      <TooltipContent>
        {usage.used.toLocaleString()} of {usage.limit.toLocaleString()} credits
        used · resets {formatShortDate(usage.periodEnd)}
      </TooltipContent>
    </Tooltip>
  );
}

type SidebarProps = {
  referenceImagesOpen: boolean;
  onReferenceImagesOpenChange: (open: boolean) => void;
  archivedModelsOpen: boolean;
  onArchivedModelsOpenChange: (open: boolean) => void;
  selectedReferenceImages: string[];
  onSelectedReferenceImagesChange: (ids: string[]) => void;
  videoReferenceRoles: Record<string, VideoReferenceRole>;
  onVideoReferenceRolesChange: (
    update:
      | Record<string, VideoReferenceRole>
      | ((
          prev: Record<string, VideoReferenceRole>,
        ) => Record<string, VideoReferenceRole>),
  ) => void;
  selectedModels: PromptModelSlug[];
  onToggleSelectedModel: (slug: PromptModelSlug) => void;
  onSelectedModelsChange: (slugs: PromptModelSlug[]) => void;
  mode: OutputMode;
  onModeChange: (mode: OutputMode) => void;
  resolution: ResolutionOption;
  onResolutionChange: (resolution: ResolutionOption) => void;
  videoResolution: VideoResolution;
  onVideoResolutionChange: (videoResolution: VideoResolution) => void;
  duration: VideoDuration;
  onDurationChange: (duration: VideoDuration) => void;
  motion: VideoMotion;
  onMotionChange: (motion: VideoMotion) => void;
  cameraFixed: boolean;
  onCameraFixedChange: (cameraFixed: boolean) => void;
  aspect: string;
  onAspectChange: (aspect: string) => void;
  advancedOpen: boolean;
  onAdvancedOpenChange: (open: boolean) => void;
  quality: QualityOption;
  onQualityChange: (quality: QualityOption) => void;
  background: BackgroundOption;
  onBackgroundChange: (background: BackgroundOption) => void;
  negativePrompt: string;
  onNegativePromptChange: (value: string) => void;
  seed: string;
  onSeedChange: (value: string) => void;
  thinking: ThinkingOption;
  onThinkingChange: (value: ThinkingOption) => void;
  hasOpenAIModelSelected: boolean;
  extendedQualityAvailable: boolean;
  hasGeminiModelSelected: boolean;
  hasOnlySeedanceFastSelected: boolean;
  maxImageReferenceImages?: number;
  isMacOS: boolean | null;
  promptComposerRef: RefObject<PromptComposerHandle | null>;
  hasSelectedProject: boolean;
  runs: number;
  onRunsChange: (runs: number) => void;
  generateButtonLocked: boolean;
  onGenerate: () => void;
  fileInputRef: RefObject<HTMLInputElement | null>;
  onFileUpload: (event: React.ChangeEvent<HTMLInputElement>) => void;
  pendingRefImageUploads: number;
  onDeleteReferenceImage: (id: string) => void;
  referenceImages:
    | RouterOutputs["referenceImage"]["getReferenceImages"]
    | undefined;
  isLoadingRefImages: boolean;
  isLoadingModels: boolean;
  activeModels: RouterOutputs["prompt"]["getModels"];
  archivedModels: RouterOutputs["prompt"]["getModels"];
  totalGenerations: number;
  usage: RouterOutputs["usage"]["getCurrent"] | undefined;
  isLoadingUsage: boolean;
  currentRequestCost: number;
  canBypassLimits: boolean;
  bypassMonthlyQuota: boolean;
  onBypassMonthlyQuotaChange: (value: boolean) => void;
};

export function Sidebar({
  referenceImagesOpen,
  onReferenceImagesOpenChange,
  archivedModelsOpen,
  onArchivedModelsOpenChange,
  selectedReferenceImages,
  onSelectedReferenceImagesChange,
  videoReferenceRoles,
  onVideoReferenceRolesChange,
  selectedModels,
  onToggleSelectedModel,
  onSelectedModelsChange,
  mode,
  onModeChange,
  resolution,
  onResolutionChange,
  videoResolution,
  onVideoResolutionChange,
  duration,
  onDurationChange,
  motion,
  onMotionChange,
  cameraFixed,
  onCameraFixedChange,
  aspect,
  onAspectChange,
  advancedOpen,
  onAdvancedOpenChange,
  quality,
  onQualityChange,
  background,
  onBackgroundChange,
  negativePrompt,
  onNegativePromptChange,
  seed,
  onSeedChange,
  thinking,
  onThinkingChange,
  hasOpenAIModelSelected,
  extendedQualityAvailable,
  hasGeminiModelSelected,
  hasOnlySeedanceFastSelected,
  maxImageReferenceImages,
  isMacOS,
  promptComposerRef,
  hasSelectedProject,
  runs,
  onRunsChange,
  generateButtonLocked,
  onGenerate,
  fileInputRef,
  onFileUpload,
  pendingRefImageUploads,
  onDeleteReferenceImage,
  referenceImages,
  isLoadingRefImages,
  isLoadingModels,
  activeModels,
  archivedModels,
  totalGenerations,
  usage,
  isLoadingUsage,
  currentRequestCost,
  canBypassLimits,
  bypassMonthlyQuota,
  onBypassMonthlyQuotaChange,
}: SidebarProps) {
  const [usageOpen, setUsageOpen] = useState(false);
  const [previewImage, setPreviewImage] = useState<{
    id: string;
    url: string;
  } | null>(null);

  // Uploads land at the top of the grid (newest first), so bring the top
  // into view when one starts in case the grid was scrolled down.
  const refImagesScrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (pendingRefImageUploads > 0) {
      refImagesScrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
    }
  }, [pendingRefImageUploads]);

  const hasFirst = selectedReferenceImages.some(
    (id) => videoReferenceRoles[id] === "first",
  );
  const hasLast = selectedReferenceImages.some(
    (id) => videoReferenceRoles[id] === "last",
  );
  const hasRefImg = selectedReferenceImages.some(
    (id) => (videoReferenceRoles[id] ?? "refimg") === "refimg",
  );

  const toggleSelected = (id: string) => {
    if (selectedReferenceImages.includes(id)) {
      onSelectedReferenceImagesChange(
        selectedReferenceImages.filter((e) => e !== id),
      );
      return;
    }
    if (mode === "video") {
      if (selectedReferenceImages.length >= MAX_VIDEO_REFERENCE_IMAGES) {
        toast.error(
          `Video generation accepts at most ${MAX_VIDEO_REFERENCE_IMAGES} reference images`,
        );
        return;
      }
      if (hasFirst && hasLast) {
        onVideoReferenceRolesChange((prev) => {
          const next = { ...prev };
          for (const sid of selectedReferenceImages) {
            if (next[sid] === "first" || next[sid] === "last") {
              next[sid] = "refimg";
            }
          }
          return next;
        });
        toast.info(
          "First and last frames are now reference images so you can add more.",
        );
      }
    } else if (
      maxImageReferenceImages !== undefined &&
      selectedReferenceImages.length >= maxImageReferenceImages
    ) {
      toast.error(
        `The selected model accepts at most ${maxImageReferenceImages} reference images`,
      );
      return;
    }
    onSelectedReferenceImagesChange([...selectedReferenceImages, id]);
  };

  // First/last frames can't be mixed with reference images. Rather than hide
  // roles, picking one resolves the rest of the selection into a legal state.
  const handleChangeRole = (id: string, role: VideoReferenceRole) => {
    const next: Record<string, VideoReferenceRole> = { ...videoReferenceRoles };
    if (role === "refimg") {
      for (const sid of selectedReferenceImages) next[sid] = "refimg";
      onVideoReferenceRolesChange(next);
      return;
    }
    const others = selectedReferenceImages.filter((sid) => sid !== id);
    const otherSlot: VideoReferenceRole = role === "first" ? "last" : "first";
    // Keep (or swap into) the other frame slot; a lone second image fills it.
    const partner =
      others.find(
        (sid) =>
          videoReferenceRoles[sid] === otherSlot ||
          videoReferenceRoles[sid] === role,
      ) ?? (others.length === 1 ? others[0] : undefined);
    next[id] = role;
    if (partner) next[partner] = otherSlot;
    const dropped = others.filter((sid) => sid !== partner);
    for (const sid of dropped) delete next[sid];
    onVideoReferenceRolesChange(next);
    if (dropped.length > 0) {
      onSelectedReferenceImagesChange(
        selectedReferenceImages.filter((sid) => !dropped.includes(sid)),
      );
      toast.info(
        `${dropped.length} reference image${dropped.length === 1 ? " was" : "s were"} deselected — first/last frames can't be combined with reference images.`,
      );
    }
  };

  const firstFrameRefImage =
    mode === "video" && hasFirst
      ? referenceImages?.find((img) => videoReferenceRoles[img.id] === "first")
      : undefined;
  const lastFrameRefImage =
    mode === "video" && hasLast
      ? referenceImages?.find((img) => videoReferenceRoles[img.id] === "last")
      : undefined;

  const referenceImageLimit =
    mode === "video" ? MAX_VIDEO_REFERENCE_IMAGES : maxImageReferenceImages;

  const allModels = [...activeModels, ...archivedModels];
  const selectedArchivedCount = archivedModels.filter((m) =>
    selectedModels.includes(m.slug),
  ).length;
  const allActiveSelected =
    activeModels.length > 0 &&
    activeModels.every((m) => selectedModels.includes(m.slug));

  const resolutionAdjustments =
    mode === "image"
      ? selectedModels.flatMap((slug) => {
          const effectiveResolution = getEffectiveImageResolution(
            slug,
            resolution,
          );
          if (!effectiveResolution || effectiveResolution === resolution) {
            return [];
          }
          return [
            `${allModels.find((model) => model.slug === slug)?.name ?? slug} (${effectiveResolution})`,
          ];
        })
      : [];

  const advancedModified =
    mode === "image"
      ? quality !== "auto" ||
        background !== "auto" ||
        negativePrompt.trim().length > 0 ||
        seed.trim().length > 0 ||
        thinking !== "auto"
      : motion !== "auto" || cameraFixed;

  const isOverQuota = Boolean(usage?.isOverQuota) && !bypassMonthlyQuota;
  const outputNoun = mode === "video" ? "video" : "image";

  return (
    <aside className="bg-sidebar flex h-screen w-[360px] shrink-0 flex-col border-r xl:w-[380px]">
      {/* Header: brand, usage, account */}
      <div className="flex h-14 shrink-0 items-center gap-2.5 border-b px-4">
        <div className="bg-primary text-primary-foreground flex size-7 items-center justify-center rounded-lg">
          <Sparkles className="size-4" />
        </div>
        <h1 className="font-heading text-[15px] font-semibold tracking-tight">
          AI Thing
        </h1>
        <div className="ml-auto flex items-center gap-1.5">
          <UsageMeter
            usage={usage}
            isLoading={isLoadingUsage}
            bypassMonthlyQuota={bypassMonthlyQuota}
            onOpen={() => setUsageOpen(true)}
          />
          <UserButton>
            <UserButton.MenuItems>
              <UserButton.Action
                label="Usage"
                labelIcon={<Gauge className="size-4" />}
                onClick={() => setUsageOpen(true)}
              />
            </UserButton.MenuItems>
          </UserButton>
        </div>
      </div>

      {/* Settings */}
      <div className="flex min-h-0 grow flex-col gap-5 overflow-y-auto px-4 py-4 [scrollbar-gutter:stable]">
        <SegmentedControl
          aria-label="Output type"
          value={mode}
          onValueChange={onModeChange}
          className="[&_[data-slot=toggle-group-item]]:h-8 [&_[data-slot=toggle-group-item]]:text-sm"
          options={[
            {
              value: "image",
              label: "Image",
              icon: <ImageIcon className="size-4" />,
            },
            {
              value: "video",
              label: "Video",
              icon: <VideoIcon className="size-4" />,
            },
          ]}
        />

        <PromptComposer
          ref={promptComposerRef}
          isMacOS={isMacOS}
          onSubmit={onGenerate}
        />

        <Collapsible
          open={referenceImagesOpen}
          onOpenChange={onReferenceImagesOpenChange}
          className="flex flex-col gap-2"
        >
          <SectionTrigger
            title="Reference images"
            open={referenceImagesOpen}
            badge={
              selectedReferenceImages.length > 0 ? (
                <CountBadge>
                  {selectedReferenceImages.length}
                  {referenceImageLimit !== undefined
                    ? ` / ${referenceImageLimit}`
                    : ""}
                </CountBadge>
              ) : null
            }
          />
          <CollapsibleContent className="flex flex-col gap-2">
            <div
              ref={refImagesScrollRef}
              className="-m-1 max-h-72 overflow-y-auto p-1"
            >
              <div className="grid grid-cols-4 gap-2">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  aria-label="Add reference images"
                  className="text-muted-foreground hover:text-foreground hover:border-foreground/40 hover:bg-muted/40 focus-visible:ring-ring/50 flex aspect-square cursor-pointer flex-col items-center justify-center gap-1 rounded-md border border-dashed outline-none focus-visible:ring-3"
                >
                  <Upload className="size-4" />
                  <span className="text-[11px]">Upload</span>
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={onFileUpload}
                />
                {Array.from({ length: pendingRefImageUploads }).map((_, i) => (
                  <Skeleton
                    key={`pending-${i}`}
                    aria-label="Uploading reference image"
                    className="aspect-square rounded-md"
                  />
                ))}
                {isLoadingRefImages
                  ? Array.from({ length: 3 }).map((_, i) => (
                      <Skeleton key={i} className="aspect-square rounded-md" />
                    ))
                  : referenceImages?.map((img) => {
                      const isSelected = selectedReferenceImages.includes(
                        img.id,
                      );
                      const role =
                        mode === "video" && isSelected
                          ? (videoReferenceRoles[img.id] ?? "refimg")
                          : undefined;
                      return (
                        <ReferenceImage
                          key={img.id}
                          src={img.url ?? ""}
                          alt="Reference image"
                          isSelected={isSelected}
                          setSelected={() => toggleSelected(img.id)}
                          onDelete={() => onDeleteReferenceImage(img.id)}
                          onPreview={() =>
                            setPreviewImage({ id: img.id, url: img.url ?? "" })
                          }
                          role={role}
                          onChangeRole={
                            mode === "video"
                              ? (newRole) => handleChangeRole(img.id, newRole)
                              : undefined
                          }
                        />
                      );
                    })}
              </div>
            </div>
            {!isLoadingRefImages &&
              (referenceImages?.length ?? 0) === 0 &&
              pendingRefImageUploads === 0 && (
                <p className="text-muted-foreground text-xs">
                  Upload images to guide style, subject or composition. You can
                  also reuse any generated image from the gallery.
                </p>
              )}
            {selectedReferenceImages.length > 0 && (
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground w-fit cursor-pointer text-xs underline-offset-2 hover:underline"
                onClick={() => onSelectedReferenceImagesChange([])}
              >
                Clear selection
              </button>
            )}
          </CollapsibleContent>
        </Collapsible>

        <Section
          title="Models"
          aside={
            activeModels.length > 1 ? (
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground cursor-pointer text-xs"
                onClick={() =>
                  onSelectedModelsChange(
                    allActiveSelected ? [] : activeModels.map((m) => m.slug),
                  )
                }
              >
                {allActiveSelected ? "Clear" : "Select all"}
              </button>
            ) : null
          }
        >
          {isLoadingModels ? (
            <div className="flex flex-col gap-1">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-9 rounded-md" />
              ))}
            </div>
          ) : (
            <div className="-mx-1 flex flex-col gap-0.5">
              {activeModels.map(({ slug, name, provider }) => (
                <ModelRow
                  key={slug}
                  slug={slug}
                  name={name}
                  provider={provider}
                  isSelected={selectedModels.includes(slug)}
                  onToggle={() => onToggleSelectedModel(slug)}
                />
              ))}
              {archivedModels.length > 0 && (
                <Collapsible
                  open={archivedModelsOpen}
                  onOpenChange={onArchivedModelsOpenChange}
                >
                  <CollapsibleTrigger className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 flex h-8 w-full cursor-pointer items-center gap-1.5 rounded-md px-2.5 text-xs outline-none focus-visible:ring-3">
                    <ChevronDown
                      className={cn(
                        "size-3.5 transition-transform",
                        archivedModelsOpen && "rotate-180",
                      )}
                    />
                    {archivedModelsOpen ? "Hide" : "Show"} archived models (
                    {archivedModels.length})
                    {selectedArchivedCount > 0 && !archivedModelsOpen && (
                      <CountBadge>{selectedArchivedCount} selected</CountBadge>
                    )}
                  </CollapsibleTrigger>
                  <CollapsibleContent className="flex flex-col gap-0.5">
                    {archivedModels.map(({ slug, name, provider }) => (
                      <ModelRow
                        key={slug}
                        slug={slug}
                        name={name}
                        provider={provider}
                        isSelected={selectedModels.includes(slug)}
                        onToggle={() => onToggleSelectedModel(slug)}
                      />
                    ))}
                  </CollapsibleContent>
                </Collapsible>
              )}
            </div>
          )}
        </Section>

        {mode === "image" ? (
          <Section title="Resolution">
            <SegmentedControl
              aria-label="Resolution"
              value={resolution}
              onValueChange={onResolutionChange}
              options={RESOLUTION_OPTIONS.map((value) => ({
                value,
                label: value,
              }))}
            />
            {resolutionAdjustments.length > 0 && (
              <p className="text-muted-foreground flex items-start gap-1.5 text-xs">
                <Info className="mt-px size-3.5 shrink-0" />
                <span>
                  Rendered at the closest supported size:{" "}
                  {resolutionAdjustments.join(", ")}.
                </span>
              </p>
            )}
          </Section>
        ) : (
          <div className="grid grid-cols-[2fr_3fr] gap-3">
            <Section title="Duration">
              <SegmentedControl
                aria-label="Duration"
                value={duration}
                onValueChange={onDurationChange}
                options={VIDEO_DURATION_OPTIONS.map((value) => ({
                  value,
                  label: `${value}s`,
                }))}
              />
            </Section>
            <Section title="Resolution">
              <SegmentedControl
                aria-label="Video resolution"
                value={videoResolution}
                onValueChange={onVideoResolutionChange}
                options={VIDEO_RESOLUTION_OPTIONS.map((value) => {
                  const disabled =
                    value === "1080p" && hasOnlySeedanceFastSelected;
                  return {
                    value,
                    label: value,
                    disabled,
                    title: disabled
                      ? "1080p is not supported by Seedance 2.0 Fast"
                      : undefined,
                  };
                })}
              />
            </Section>
          </div>
        )}

        <Section title="Aspect ratio">
          <SegmentedControl
            aria-label="Aspect ratio"
            value={aspect}
            onValueChange={onAspectChange}
            className={cn(
              "grid-flow-row",
              mode === "video" ? "grid-cols-7" : "grid-cols-5",
            )}
            itemClassName="h-12 flex-col gap-1 px-0 text-[11px]"
            options={(mode === "video"
              ? VIDEO_ASPECT_OPTIONS
              : IMAGE_ASPECT_OPTIONS
            ).map((value) => ({
              value,
              label: value === "adaptive" ? "Auto" : value,
              icon: <AspectShape ratio={value} />,
              title:
                value === "adaptive"
                  ? "Adaptive: the model picks the best ratio"
                  : undefined,
            }))}
          />
        </Section>

        {mode === "video" && (
          <div className="bg-muted/40 text-muted-foreground flex items-start gap-2.5 rounded-lg border p-3 text-xs leading-relaxed">
            {firstFrameRefImage?.url || lastFrameRefImage?.url ? (
              <>
                <span className="inline-flex shrink-0 gap-1.5">
                  {[
                    { img: firstFrameRefImage, label: "Start" },
                    { img: lastFrameRefImage, label: "End" },
                  ].map(({ img, label }) =>
                    img?.url ? (
                      <span key={label} className="flex flex-col items-center">
                        <span className="relative size-8 overflow-hidden rounded border">
                          <Image
                            src={img.url}
                            alt={`${label} frame reference`}
                            fill
                            loading="lazy"
                            sizes="32px"
                            className="object-cover"
                          />
                        </span>
                        <span className="text-primary-text mt-0.5 text-[9px] font-medium tracking-wide uppercase">
                          {label}
                        </span>
                      </span>
                    ) : null,
                  )}
                </span>
                <span>
                  <b className="text-foreground font-medium">Image-to-video</b>{" "}
                  {hasFirst && hasLast
                    ? "— morphs from your first frame to your last frame."
                    : hasFirst
                      ? "— begins on your first frame."
                      : "— ends on your last frame."}
                </span>
              </>
            ) : (
              <>
                <Info className="mt-0.5 size-3.5 shrink-0" />
                {hasRefImg ? (
                  <span>
                    Reference images guide style and subject. Set one as{" "}
                    <b className="text-foreground font-medium">First</b> frame
                    instead to animate it (image-to-video).
                  </span>
                ) : (
                  <span>
                    Text-to-video. Select a reference image and set it as the{" "}
                    <b className="text-foreground font-medium">First</b> frame
                    to animate it instead.
                  </span>
                )}
              </>
            )}
          </div>
        )}

        <div className="flex items-center justify-between gap-3">
          <div className="flex flex-col">
            <h2 className="text-muted-foreground text-xs font-medium">
              Runs per model
            </h2>
            <span className="text-muted-foreground/70 text-[11px]">
              Variations of each selected model
            </span>
          </div>
          <div
            role="group"
            aria-label="Runs per model"
            className="flex items-center rounded-lg border"
          >
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Fewer runs"
              disabled={runs <= 1}
              onClick={() => onRunsChange(Math.max(1, runs - 1))}
            >
              <Minus />
            </Button>
            <output
              aria-live="polite"
              className="w-7 text-center text-sm font-medium tabular-nums"
            >
              {runs}
            </output>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="More runs"
              disabled={runs >= MAX_RUNS_PER_MODEL}
              onClick={() =>
                onRunsChange(Math.min(MAX_RUNS_PER_MODEL, runs + 1))
              }
            >
              <Plus />
            </Button>
          </div>
        </div>

        <Collapsible
          open={advancedOpen}
          onOpenChange={onAdvancedOpenChange}
          className="flex flex-col gap-2"
        >
          <SectionTrigger
            title="Advanced"
            open={advancedOpen}
            badge={advancedModified ? <CountBadge>Modified</CountBadge> : null}
          />
          <CollapsibleContent>
            <div className="flex flex-col gap-3 pt-1">
              {mode === "image" && (
                <>
                  <ProviderGroup name="OpenAI" active={hasOpenAIModelSelected}>
                    <div className="grid grid-cols-2 gap-2">
                      <Field className="gap-1.5">
                        <AdvancedControlLabel
                          label="Quality"
                          htmlFor="adv-quality"
                          help="Image quality. Higher uses more credits but produces sharper results. Extra High and Max are only supported by GPT Image 2.5 models."
                        />
                        <Select
                          value={quality}
                          items={QUALITY_OPTIONS}
                          onValueChange={(value) =>
                            onQualityChange(value ?? "auto")
                          }
                          disabled={!hasOpenAIModelSelected}
                        >
                          <SelectTrigger id="adv-quality" className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {QUALITY_OPTIONS.map((option) => (
                              <SelectItem
                                key={option.value}
                                value={option.value}
                                className="cursor-pointer"
                                disabled={
                                  !extendedQualityAvailable &&
                                  isExtendedImageQuality(option.value)
                                }
                              >
                                {option.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </Field>
                      <Field className="gap-1.5">
                        <AdvancedControlLabel
                          label="Background"
                          htmlFor="adv-background"
                          help="Transparent produces a PNG with no background. Auto lets the model decide."
                        />
                        <Select
                          value={background}
                          items={BACKGROUND_OPTIONS}
                          onValueChange={(value) =>
                            onBackgroundChange(value ?? "auto")
                          }
                          disabled={!hasOpenAIModelSelected}
                        >
                          <SelectTrigger id="adv-background" className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {BACKGROUND_OPTIONS.map((option) => (
                              <SelectItem
                                key={option.value}
                                value={option.value}
                                className="cursor-pointer"
                              >
                                {option.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </Field>
                    </div>
                  </ProviderGroup>
                  <ProviderGroup name="Gemini" active={hasGeminiModelSelected}>
                    <Field className="gap-1.5">
                      <AdvancedControlLabel
                        label="Negative prompt"
                        htmlFor="adv-negative-prompt"
                        help="Describe what you don't want in the image (e.g. blurry, text)."
                      />
                      <Textarea
                        id="adv-negative-prompt"
                        rows={2}
                        placeholder="e.g. blurry, low quality, text"
                        value={negativePrompt}
                        onChange={(e) => onNegativePromptChange(e.target.value)}
                        disabled={!hasGeminiModelSelected}
                        className="min-h-14"
                      />
                    </Field>
                    <div className="grid grid-cols-2 gap-2">
                      <Field className="gap-1.5">
                        <AdvancedControlLabel
                          label="Seed"
                          htmlFor="adv-seed"
                          help="Use the same seed to reproduce results. Leave blank for random."
                        />
                        <Input
                          id="adv-seed"
                          inputMode="numeric"
                          placeholder="Random"
                          value={seed}
                          onChange={(e) =>
                            onSeedChange(e.target.value.replace(/[^0-9]/g, ""))
                          }
                          disabled={!hasGeminiModelSelected}
                        />
                      </Field>
                      <Field className="gap-1.5">
                        <AdvancedControlLabel
                          label="Thinking"
                          htmlFor="adv-thinking"
                          help="How much the model reasons before generating. Costs extra tokens. Only Gemini 3 models support thinking."
                        />
                        <Select
                          value={thinking}
                          items={THINKING_OPTIONS}
                          onValueChange={(value) =>
                            onThinkingChange(value ?? "auto")
                          }
                          disabled={!hasGeminiModelSelected}
                        >
                          <SelectTrigger id="adv-thinking" className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {THINKING_OPTIONS.map((option) => (
                              <SelectItem
                                key={option.value}
                                value={option.value}
                                className="cursor-pointer"
                              >
                                {option.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </Field>
                    </div>
                  </ProviderGroup>
                </>
              )}
              {mode === "video" && (
                <ProviderGroup name="Seedance" active>
                  <div className="grid grid-cols-2 gap-2">
                    <Field className="gap-1.5">
                      <AdvancedControlLabel
                        label="Motion"
                        htmlFor="adv-motion"
                        help="How much motion the video should have. Subtle keeps things calm; Dynamic adds more movement."
                      />
                      <Select
                        value={motion}
                        items={VIDEO_MOTION_OPTIONS}
                        onValueChange={(value) =>
                          onMotionChange(value ?? "auto")
                        }
                      >
                        <SelectTrigger id="adv-motion" className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {VIDEO_MOTION_OPTIONS.map((option) => (
                            <SelectItem
                              key={option.value}
                              value={option.value}
                              className="cursor-pointer"
                            >
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field className="gap-1.5">
                      <AdvancedControlLabel
                        label="Camera"
                        help="Fixed locks the camera in place. Free lets the model add camera motion."
                      />
                      <SegmentedControl
                        aria-label="Camera"
                        value={cameraFixed ? "fixed" : "free"}
                        onValueChange={(value) =>
                          onCameraFixedChange(value === "fixed")
                        }
                        options={[
                          { value: "free", label: "Free" },
                          { value: "fixed", label: "Fixed" },
                        ]}
                      />
                    </Field>
                  </div>
                </ProviderGroup>
              )}
            </div>
          </CollapsibleContent>
        </Collapsible>
      </div>

      {/* Footer: summary + primary action */}
      <div className="flex shrink-0 flex-col gap-2.5 border-t px-4 py-3">
        {isOverQuota && usage && (
          <div className="flex items-start gap-2 rounded-md border border-red-500/40 bg-red-500/10 p-2.5 text-xs text-red-300">
            <AlertTriangle className="mt-px size-3.5 shrink-0 text-red-400" />
            <span>
              Out of monthly credits until {formatShortDate(usage.periodEnd)}.{" "}
              <button
                type="button"
                className="cursor-pointer underline underline-offset-2 hover:text-red-200"
                onClick={() => setUsageOpen(true)}
              >
                View usage
              </button>
            </span>
          </div>
        )}
        {!isOverQuota && totalGenerations > 6 && (
          <div className="flex items-start gap-2 text-xs text-amber-300">
            <AlertTriangle className="mt-px size-3.5 shrink-0 text-amber-400" />
            <span>
              {totalGenerations} generations at once can use a lot of credits.{" "}
              {runs > 1 && (
                <button
                  type="button"
                  className="cursor-pointer underline underline-offset-2 hover:text-amber-200"
                  onClick={() => onRunsChange(1)}
                >
                  Use 1 run per model
                </button>
              )}
            </span>
          </div>
        )}
        <GenerateButton
          promptComposerRef={promptComposerRef}
          selectedModelsCount={selectedModels.length}
          hasSelectedProject={hasSelectedProject}
          isOverQuota={Boolean(usage?.isOverQuota)}
          bypassMonthlyQuota={bypassMonthlyQuota}
          generateButtonLocked={generateButtonLocked}
          isMacOS={isMacOS}
          onGenerate={onGenerate}
          summary={
            <>
              <span>
                {`${totalGenerations} ${outputNoun}${totalGenerations === 1 ? "" : "s"} · ${selectedModels.length} model${selectedModels.length === 1 ? "" : "s"}`}
              </span>
              <span>
                <span className="text-foreground font-medium">
                  {currentRequestCost.toLocaleString()}
                </span>{" "}
                credits
              </span>
            </>
          }
        />
      </div>

      {usageOpen && (
        <UsageModal
          open={usageOpen}
          onOpenChange={setUsageOpen}
          usage={usage}
          isLoading={isLoadingUsage}
          currentRequestCost={currentRequestCost}
          canBypassLimits={canBypassLimits}
          bypassMonthlyQuota={bypassMonthlyQuota}
          onBypassMonthlyQuotaChange={onBypassMonthlyQuotaChange}
        />
      )}
      {previewImage && (
        <ReferenceImageLightbox
          src={previewImage.url}
          alt="Reference image preview"
          isSelected={selectedReferenceImages.includes(previewImage.id)}
          onToggleSelected={() => toggleSelected(previewImage.id)}
          onClose={() => setPreviewImage(null)}
        />
      )}
    </aside>
  );
}
