"use client";

import { useEffect, useState, type RefObject } from "react";
import { createPortal } from "react-dom";

import { UserButton } from "@clerk/nextjs";
import {
  Check,
  ChevronDown,
  ChevronUp,
  Gauge,
  HelpCircle,
  Image as ImageIcon,
  Maximize2,
  Trash2,
  Upload,
  Video as VideoIcon,
  AlertTriangle,
  X,
} from "lucide-react";
import Image from "next/image";
import clsx from "clsx";
import { toast } from "sonner";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "src/components/ui/collapsible";
import { Button } from "src/components/ui/button";
import { ButtonGroup } from "src/components/ui/button-group";
import { Checkbox } from "src/components/ui/checkbox";
import { Field, FieldLabel } from "src/components/ui/field";
import { Input } from "src/components/ui/input";
import { Label } from "src/components/ui/label";
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
import type { RouterInputs, RouterOutputs } from "src/trpc/react";
import { GenerateButton } from "./generate-button";
import {
  PromptComposer,
  type PromptComposerHandle,
} from "./prompt-composer";
import { UsageModal } from "./usage-modal";

export type PromptModelSlug =
  RouterInputs["prompt"]["createWithGenerations"]["models"][number];
export type OutputMode = "image" | "video";
export type ResolutionOption = "512" | "1K" | "2K" | "4K";
export type VideoResolution = "480p" | "720p" | "1080p";
export type VideoDuration = 5 | 10;
export type VideoMotion = "auto" | "low" | "high";

export const RESOLUTION_OPTIONS: ResolutionOption[] = ["512", "1K", "2K", "4K"];
export const VIDEO_RESOLUTION_OPTIONS: VideoResolution[] = [
  "480p",
  "720p",
  "1080p",
];
export const VIDEO_DURATION_OPTIONS: VideoDuration[] = [5, 10];

export type QualityOption = "auto" | "low" | "medium" | "high";
export type BackgroundOption = "auto" | "opaque" | "transparent";
export type ThinkingOption = "auto" | "off" | "low" | "high";

export const VIDEO_MOTION_OPTIONS: { value: VideoMotion; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "low", label: "Subtle" },
  { value: "high", label: "Dynamic" },
];

export type VideoReferenceRole = "first" | "last" | "refimg";
export const MAX_VIDEO_REFERENCE_IMAGES = 9;

const VIDEO_REFERENCE_ROLE_OPTIONS: {
  value: VideoReferenceRole;
  label: string;
  short: string;
  hint: string;
  accent: boolean;
}[] = [
  { value: "first", label: "First frame", short: "First", hint: "Start of the clip", accent: true },
  { value: "last", label: "Last frame", short: "Last", hint: "End of the clip", accent: true },
  { value: "refimg", label: "Reference image", short: "Ref", hint: "Guides style & subject", accent: false },
];

const VIDEO_REFERENCE_ROLE_BY_VALUE = Object.fromEntries(
  VIDEO_REFERENCE_ROLE_OPTIONS.map((opt) => [opt.value, opt]),
) as Record<VideoReferenceRole, (typeof VIDEO_REFERENCE_ROLE_OPTIONS)[number]>;

export const QUALITY_OPTIONS: { value: QualityOption; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
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

function ModelCard({
  slug,
  name,
  kind,
  isSelected,
  onToggle,
}: {
  slug: string;
  name: string;
  kind: OutputMode;
  isSelected: boolean;
  onToggle: () => void;
}) {
  return (
    <div
      role="checkbox"
      aria-checked={isSelected}
      aria-labelledby={`model-select-${slug}-label`}
      tabIndex={0}
      className={clsx(
        "flex cursor-pointer flex-row items-center gap-4 rounded-md border border-1 px-4 py-2 text-(--foreground)",
        isSelected ? "border-blue-500 bg-gray-800" : "hover:bg-gray-900",
      )}
      onClick={onToggle}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onToggle();
        }
      }}
    >
      <Checkbox
        id={`model-select-${slug}`}
        accentColor="blue-500"
        checked={isSelected}
        tabIndex={-1}
        className="pointer-events-none"
      />
      <Label
        id={`model-select-${slug}-label`}
        className="pointer-events-none min-w-0 grow cursor-pointer flex-col items-start"
      >
        <span className="truncate">{name}</span>
        <span className="truncate text-xs text-(--muted-foreground)">
          {slug}
        </span>
      </Label>
      <span
        className={clsx(
          "shrink-0 rounded-full border px-1.5 py-0.5 text-[9px] font-semibold tracking-wider uppercase",
          kind === "video"
            ? "border-blue-500/40 bg-blue-500/10 text-blue-400"
            : "border-(--border) text-(--muted-foreground)",
        )}
      >
        {kind}
      </span>
    </div>
  );
}

function AdvancedControlLabel({
  label,
  help,
}: {
  label: string;
  help: string;
}) {
  return (
    <FieldLabel className="text-xxs flex items-center gap-1 text-(--muted-foreground) uppercase">
      <span>{label}</span>
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              aria-label={`What does ${label} do?`}
              className="focus-visible:outline-ring inline-flex cursor-help items-center justify-center text-(--muted-foreground)/60 hover:text-(--muted-foreground) focus-visible:outline focus-visible:outline-1"
            >
              <HelpCircle size={12} />
            </button>
          }
        />
        <TooltipContent>{help}</TooltipContent>
      </Tooltip>
    </FieldLabel>
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
      className={clsx(
        "group relative flex aspect-square flex-col justify-center overflow-clip rounded-md border-1",
      )}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 z-0 h-10 bg-linear-to-b from-black/55 via-black/25 to-transparent"
      />

      {/* Image body: click to preview */}
      <button
        type="button"
        onClick={props.onPreview}
        aria-label="Preview reference image"
        className="block flex grow-1 cursor-pointer bg-transparent text-left"
      >
        <Image
          src={props.src}
          alt={props.alt}
          width={100}
          height={100}
          loading="lazy"
          className="m-auto w-full"
        />

        {/* Maximize hint on hover (image body only) */}
        <div
          aria-hidden="true"
          className={clsx(
            "pointer-events-none absolute right-1.5 z-10 flex items-center justify-center rounded-md bg-black/50 p-1 opacity-0 transition-opacity group-hover:opacity-100",
            showRolePill ? "bottom-7" : "bottom-1.5",
          )}
        >
          <Maximize2 className="size-3 text-white" strokeWidth={2} />
        </div>
      </button>

      {/* Select checkbox: top-left, always visible, click to toggle */}
      <button
        type="button"
        role="checkbox"
        onClick={(e) => {
          e.stopPropagation();
          props.setSelected();
        }}
        aria-label={
          props.isSelected
            ? "Deselect reference image"
            : "Select reference image"
        }
        aria-checked={props.isSelected}
        className={clsx(
          "focus-visible:outline-ring absolute top-1.5 left-1.5 z-10 flex size-5 cursor-pointer items-center justify-center rounded-md border-2 opacity-60 transition group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline focus-visible:outline-2",
          props.isSelected
            ? "border-blue-500 bg-blue-500 text-white"
            : "border-white/80 bg-black/40 text-transparent hover:border-white",
        )}
      >
        <Check className="size-3" strokeWidth={3} />
      </button>

      <button
        type="button"
        aria-label="Delete reference image"
        onClick={(e) => {
          e.stopPropagation();
          props.onDelete();
        }}
        className="focus-visible:outline-ring absolute top-1.5 right-1.5 z-10 flex size-5 cursor-pointer items-center justify-center rounded-md border-2 border-white/80 bg-black/40 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline focus-visible:outline-2"
      >
        <Trash2 className="size-3 text-white" strokeWidth={2.2} />
      </button>

      {showRolePill && roleInfo && props.onChangeRole && (
        <Popover>
          <PopoverTrigger
            render={
              <button
                type="button"
                onClick={(e) => e.stopPropagation()}
                className={clsx(
                  "focus-visible:outline-ring absolute right-1 bottom-1 left-1 z-20 flex cursor-pointer items-center justify-center gap-0.5 rounded-full border px-1 py-0.5 text-[9.5px] font-medium leading-none backdrop-blur-md transition-colors focus-visible:outline focus-visible:outline-2",
                  roleInfo.accent
                    ? "border-blue-400/45 bg-black/55 text-blue-400 hover:bg-black/70"
                    : "border-(--border) bg-black/55 text-(--foreground) hover:bg-black/70",
                )}
                aria-label={`Role: ${roleInfo.label}. Click to change.`}
              >
                <span>{roleInfo.short}</span>
                <ChevronDown className="size-2.5 opacity-70" strokeWidth={2.5} />
              </button>
            }
          />
          <PopoverContent
            align="start"
            sideOffset={4}
            className="w-44 gap-0.5 p-1"
            onClick={(e) => e.stopPropagation()}
          >
            {(props.availableRoles ?? VIDEO_REFERENCE_ROLE_OPTIONS.map((o) => o.value)).map(
              (roleValue) => {
                const opt = VIDEO_REFERENCE_ROLE_BY_VALUE[roleValue];
                const selected = props.role === roleValue;
                return (
                  <button
                    key={roleValue}
                    type="button"
                    onClick={() => props.onChangeRole?.(roleValue)}
                    className={clsx(
                      "flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs",
                      selected
                        ? "bg-blue-500/15"
                        : "hover:bg-gray-800",
                    )}
                  >
                    <span
                      className={clsx(
                        "size-2 shrink-0 rounded-full",
                        opt.accent ? "bg-blue-400" : "bg-(--muted-foreground)",
                      )}
                    />
                    <span className="flex min-w-0 flex-col leading-tight">
                      <span className="text-xs">{opt.label}</span>
                      <span className="text-[10px] text-(--muted-foreground)">
                        {opt.hint}
                      </span>
                    </span>
                    {selected && (
                      <Check className="ml-auto size-3 shrink-0 text-blue-400" strokeWidth={3} />
                    )}
                  </button>
                );
              },
            )}
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}

/**
 * Full-bleed lightbox preview, used both from the sidebar grid and from
 * the Browse modal. Includes a "Use as reference" toggle so users can
 * select/deselect without closing the preview.
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
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setLoaded(false);
  }, [src]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Reference image preview"
      onClick={onClose}
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 sm:p-6"
    >
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" />

      <button
        type="button"
        aria-label="Close preview"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        className="absolute top-4 right-4 z-10 flex size-9 cursor-pointer items-center justify-center rounded-full border border-white/20 bg-black/50 text-white backdrop-blur-sm"
      >
        <X className="size-4" strokeWidth={2} />
      </button>

      <div
        className="relative z-10 flex max-h-[90vh] max-w-[90vw] flex-col items-center gap-3"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Reserved-height image slot — keeps button position stable while the image loads. */}
        <div className="relative flex h-[75vh] w-[80vw] max-w-[1100px] items-center justify-center">
          {!loaded && (
            <Skeleton className="absolute inset-0 size-full rounded-lg" />
          )}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src}
            alt={alt}
            onLoad={() => setLoaded(true)}
            className={clsx(
              "relative block h-auto max-h-full w-auto max-w-full rounded-lg border border-white/10 shadow-2xl transition-opacity duration-150",
              loaded ? "opacity-100" : "opacity-0",
            )}
          />
        </div>
        <button
          type="button"
          onClick={onToggleSelected}
          aria-pressed={isSelected}
          className={clsx(
            "flex cursor-pointer items-center gap-2 rounded-md border-2 px-4 py-2 text-sm font-medium transition-colors",
            isSelected
              ? "border-blue-500 bg-blue-500 text-white"
              : "border-white/40 bg-black/40 text-white hover:border-white",
          )}
        >
          <Check className={clsx("size-4", !isSelected && "opacity-40")} strokeWidth={3} />
          {isSelected ? "Selected as reference" : "Use as reference"}
        </button>
      </div>
    </div>,
    document.body,
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
  hasGeminiModelSelected: boolean;
  hasOnlySeedanceFastSelected: boolean;
  disabledImageResolutions: ReadonlySet<ResolutionOption>;
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
  onDeleteReferenceImage: (id: string) => void;
  referenceImages:
    | RouterOutputs["referenceImage"]["getReferenceImages"]
    | undefined;
  isLoadingRefImages: boolean;
  isLoadingModels: boolean;
  activeModels: RouterOutputs["prompt"]["getModels"];
  archivedModels: RouterOutputs["prompt"]["getModels"];
  hasOnlyOpenAIModelsSelected: boolean;
  totalGenerations: number;
  userFullName: string | null | undefined;
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
  hasGeminiModelSelected,
  hasOnlySeedanceFastSelected,
  disabledImageResolutions,
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
  onDeleteReferenceImage,
  referenceImages,
  isLoadingRefImages,
  isLoadingModels,
  activeModels,
  archivedModels,
  hasOnlyOpenAIModelsSelected,
  totalGenerations,
  userFullName,
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

  const handleChangeRole = (id: string, role: VideoReferenceRole) => {
    onVideoReferenceRolesChange((prev) => {
      const next = { ...prev };
      if (role === "first" || role === "last") {
        for (const otherId of selectedReferenceImages) {
          if (otherId !== id && next[otherId] === role) {
            next[otherId] = "refimg";
          }
        }
      }
      next[id] = role;
      const hasFrame = selectedReferenceImages.some(
        (sid) => next[sid] === "first" || next[sid] === "last",
      );
      const hasRefimgNow = selectedReferenceImages.some(
        (sid) => (next[sid] ?? "refimg") === "refimg",
      );
      if (hasFrame && hasRefimgNow) {
        // Demoting a frame → refimg means the user wants refimg-only mode;
        // sweep the remaining frame(s) along instead of blocking.
        if (role === "refimg") {
          for (const otherId of selectedReferenceImages) {
            if (next[otherId] === "first" || next[otherId] === "last") {
              next[otherId] = "refimg";
            }
          }
          return next;
        }
        toast.error(
          "First/last frames can't be combined with reference images",
        );
        return prev;
      }
      return next;
    });
  };

  const availableRolesFor = (id: string): VideoReferenceRole[] => {
    const ownRole = videoReferenceRoles[id] ?? "refimg";
    const otherHasFrame = selectedReferenceImages.some(
      (sid) =>
        sid !== id &&
        (videoReferenceRoles[sid] === "first" ||
          videoReferenceRoles[sid] === "last"),
    );
    const otherHasRefimg = selectedReferenceImages.some(
      (sid) =>
        sid !== id && (videoReferenceRoles[sid] ?? "refimg") === "refimg",
    );
    return VIDEO_REFERENCE_ROLE_OPTIONS.map((opt) => opt.value).filter(
      (role) => {
        if (role === ownRole) return true;
        // Demoting first/last → refimg is always allowed: handleChangeRole
        // sweeps the sibling frame along to keep the state legal.
        if (
          role === "refimg" &&
          otherHasFrame &&
          ownRole !== "first" &&
          ownRole !== "last"
        ) {
          return false;
        }
        if ((role === "first" || role === "last") && otherHasRefimg) {
          return false;
        }
        return true;
      },
    );
  };

  const firstFrameRefImage =
    mode === "video" && hasFirst
      ? referenceImages?.find(
          (img) => videoReferenceRoles[img.id] === "first",
        )
      : undefined;
  const lastFrameRefImage =
    mode === "video" && hasLast
      ? referenceImages?.find(
          (img) => videoReferenceRoles[img.id] === "last",
        )
      : undefined;

  return (
    <aside className="flex h-screen w-1/5 shrink-0 flex-col border border-x border-(--border)">
      <div className="flex flex-row items-center gap-4 border-y border-(--border) p-5">
        <div className="h-8 w-8 rounded-md bg-blue-400"></div>
        <div>
          <h1 className="font-heading text-lg font-bold">AI Thing</h1>
          <p className="text-xs text-(--muted-foreground)">
            All your models, in one place
          </p>
        </div>
      </div>
      <div className="flex min-w-0 grow flex-col gap-3 overflow-y-scroll p-5">
        <PromptComposer
          ref={promptComposerRef}
          isMacOS={isMacOS}
          onSubmit={onGenerate}
        />
        <Collapsible
          open={referenceImagesOpen}
          onOpenChange={onReferenceImagesOpenChange}
        >
          <CollapsibleTrigger className="flex w-full cursor-pointer flex-row items-baseline justify-between">
            <div className="flex items-baseline gap-1.5">
              <FieldLabel className="text-xxs cursor-pointer text-(--muted-foreground) uppercase">
                Reference Images
              </FieldLabel>
              {selectedReferenceImages.length > 0 && (
                <span className="text-xs text-(--muted-foreground)">
                  ({selectedReferenceImages.length} selected)
                </span>
              )}
            </div>
            {referenceImagesOpen ? (
              <ChevronUp color="var(--muted-foreground)" />
            ) : (
              <ChevronDown color="var(--muted-foreground)" />
            )}
          </CollapsibleTrigger>
          <CollapsibleContent className="max-h-80 overflow-scroll">
            <div className="my-2 grid grid-cols-3 gap-2 p-2">
              {isLoadingRefImages
                ? Array.from({ length: 6 }).map((_, i) => (
                    <Skeleton key={i} className="aspect-square rounded-md" />
                  ))
                : referenceImages?.map((img) => {
                    const isSelected = selectedReferenceImages.includes(img.id);
                    const role =
                      mode === "video" && isSelected
                        ? videoReferenceRoles[img.id] ?? "refimg"
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
                        availableRoles={
                          mode === "video" ? availableRolesFor(img.id) : undefined
                        }
                        onChangeRole={
                          mode === "video"
                            ? (newRole) => handleChangeRole(img.id, newRole)
                            : undefined
                        }
                      />
                    );
                  })}
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="col-span-3 flex cursor-pointer flex-col items-center justify-center gap-1 rounded-md border-1 border-dashed border-(--muted-foreground) py-2 hover:bg-gray-900"
              >
                <Upload size={16} className="text-(--muted-foreground)" />
                <span className="text-xs text-(--muted-foreground)">Add</span>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={onFileUpload}
              />
            </div>
            {mode === "video" && (
              <div className="flex items-center gap-3 px-2 pb-1 text-[11px] text-(--muted-foreground)">
                <span
                  className={clsx(
                    "inline-flex items-center gap-1",
                    selectedReferenceImages.length >= MAX_VIDEO_REFERENCE_IMAGES &&
                      "text-blue-400",
                  )}
                >
                  <ImageIcon className="size-3 opacity-80" strokeWidth={1.5} />
                  {selectedReferenceImages.length}/{MAX_VIDEO_REFERENCE_IMAGES}
                </span>
              </div>
            )}
            {mode === "image" && maxImageReferenceImages !== undefined && (
              <div className="flex items-center gap-1 px-2 pb-1 text-[11px] text-(--muted-foreground)">
                <ImageIcon className="size-3 opacity-80" strokeWidth={1.5} />
                {selectedReferenceImages.length}/{maxImageReferenceImages}
              </div>
            )}
          </CollapsibleContent>
        </Collapsible>
        <Field>
          <FieldLabel className="text-xxs text-(--muted-foreground) uppercase">
            Output Type
          </FieldLabel>
          <div className="flex flex-row gap-2">
            <button
              type="button"
              aria-pressed={mode === "image"}
              onClick={() => onModeChange("image")}
              className={clsx(
                "flex grow cursor-pointer items-center justify-center gap-1.5 rounded-md border border-1 px-2 py-1.5 text-sm transition-colors",
                mode === "image"
                  ? "border-blue-500 bg-blue-500/15 text-(--foreground)"
                  : "text-(--muted-foreground) hover:bg-gray-900",
              )}
            >
              <ImageIcon size={14} />
              Image
            </button>
            <button
              type="button"
              aria-pressed={mode === "video"}
              onClick={() => onModeChange("video")}
              className={clsx(
                "flex grow cursor-pointer items-center justify-center gap-1.5 rounded-md border border-1 px-2 py-1.5 text-sm transition-colors",
                mode === "video"
                  ? "border-blue-500 bg-blue-500/15 text-(--foreground)"
                  : "text-(--muted-foreground) hover:bg-gray-900",
              )}
            >
              <VideoIcon size={14} />
              Video
            </button>
          </div>
        </Field>
        <Field>
          <FieldLabel className="text-xxs text-(--muted-foreground) uppercase">
            Models
          </FieldLabel>
          {isLoadingModels ? (
            <div className="flex flex-col gap-2">
              {Array.from({ length: 2 }).map((_, i) => (
                <Skeleton key={i} className="h-12 rounded-md" />
              ))}
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {activeModels.map(({ slug, name, kind }) => (
                <ModelCard
                  key={slug}
                  slug={slug}
                  name={name}
                  kind={kind}
                  isSelected={selectedModels.includes(slug)}
                  onToggle={() => onToggleSelectedModel(slug)}
                />
              ))}
              {archivedModels.length > 0 && (
                <Collapsible
                  open={archivedModelsOpen}
                  onOpenChange={onArchivedModelsOpenChange}
                >
                  <CollapsibleTrigger className="flex w-full cursor-pointer items-center justify-between rounded-md border border-1 border-dashed border-(--border) px-4 py-2 text-left">
                    <span className="text-xs tracking-wide text-(--muted-foreground) uppercase">
                      Archived Models
                    </span>
                    {archivedModelsOpen ? (
                      <ChevronUp color="var(--muted-foreground)" size={16} />
                    ) : (
                      <ChevronDown color="var(--muted-foreground)" size={16} />
                    )}
                  </CollapsibleTrigger>
                  <CollapsibleContent className="mt-2 flex flex-col gap-2">
                    {archivedModels.map(({ slug, name, kind }) => (
                      <ModelCard
                        key={slug}
                        slug={slug}
                        name={name}
                        kind={kind}
                        isSelected={selectedModels.includes(slug)}
                        onToggle={() => onToggleSelectedModel(slug)}
                      />
                    ))}
                  </CollapsibleContent>
                </Collapsible>
              )}
            </div>
          )}
        </Field>
        {mode === "image" && (
          <Field className="w-full">
            <FieldLabel className="text-xxs text-(--muted-foreground) uppercase">
              Resolution
            </FieldLabel>
            <div className="flex flex-row gap-2">
              {RESOLUTION_OPTIONS.map((resolutionOption) => {
                const isDisabled =
                  (resolutionOption === "512" && hasOnlyOpenAIModelsSelected) ||
                  disabledImageResolutions.has(resolutionOption);

                return (
                  <button
                    key={resolutionOption}
                    disabled={isDisabled}
                    aria-disabled={isDisabled}
                    className={clsx(
                      "grow rounded-md border border-1 px-2 py-1 text-sm",
                      resolution === resolutionOption
                        ? "bg-blue-500 text-(--foreground)"
                        : "text-(--muted-foreground)",
                      isDisabled
                        ? "cursor-not-allowed opacity-40"
                        : "cursor-pointer hover:bg-gray-900",
                    )}
                    onClick={(e) => {
                      e.preventDefault();
                      if (isDisabled) return;
                      onResolutionChange(resolutionOption);
                    }}
                  >
                    {resolutionOption}
                  </button>
                );
              })}
            </div>
          </Field>
        )}
        {mode === "video" && (
          <>
            <Field className="w-full">
              <FieldLabel className="text-xxs text-(--muted-foreground) uppercase">
                Duration
              </FieldLabel>
              <div className="flex flex-row gap-2">
                {VIDEO_DURATION_OPTIONS.map((durationOption) => (
                  <button
                    key={durationOption}
                    type="button"
                    className={clsx(
                      "grow cursor-pointer rounded-md border border-1 px-2 py-1 text-sm",
                      duration === durationOption
                        ? "bg-blue-500 text-(--foreground)"
                        : "text-(--muted-foreground) hover:bg-gray-900",
                    )}
                    onClick={() => onDurationChange(durationOption)}
                  >
                    {durationOption}s
                  </button>
                ))}
              </div>
            </Field>
            <Field className="w-full">
              <FieldLabel className="text-xxs text-(--muted-foreground) uppercase">
                Resolution
              </FieldLabel>
              <div className="flex flex-row gap-2">
                {VIDEO_RESOLUTION_OPTIONS.map((videoResolutionOption) => {
                  const isDisabled =
                    videoResolutionOption === "1080p" &&
                    hasOnlySeedanceFastSelected;
                  return (
                    <button
                      key={videoResolutionOption}
                      type="button"
                      disabled={isDisabled}
                      aria-disabled={isDisabled}
                      title={
                        isDisabled
                          ? "1080p is not supported by Seedance 2.0 Fast"
                          : undefined
                      }
                      className={clsx(
                        "grow rounded-md border border-1 px-2 py-1 text-sm",
                        videoResolution === videoResolutionOption
                          ? "bg-blue-500 text-(--foreground)"
                          : "text-(--muted-foreground)",
                        isDisabled
                          ? "cursor-not-allowed opacity-40"
                          : "cursor-pointer hover:bg-gray-900",
                      )}
                      onClick={(e) => {
                        e.preventDefault();
                        if (isDisabled) return;
                        onVideoResolutionChange(videoResolutionOption);
                      }}
                    >
                      {videoResolutionOption}
                    </button>
                  );
                })}
              </div>
            </Field>
            <p className="-mt-1 flex items-start gap-2 text-xs text-(--muted-foreground)">
              {firstFrameRefImage?.url || lastFrameRefImage?.url ? (
                <>
                  <span className="inline-flex shrink-0 gap-1.5">
                    {firstFrameRefImage?.url && (
                      <span className="flex flex-col items-center">
                        <span className="relative size-7 overflow-hidden rounded border border-(--border)">
                          <Image
                            src={firstFrameRefImage.url}
                            alt="First frame reference"
                            fill
                            loading="lazy"
                            sizes="28px"
                            className="object-cover"
                          />
                        </span>
                        <span className="mt-0.5 text-[8px] tracking-wide text-blue-400 uppercase">
                          Start
                        </span>
                      </span>
                    )}
                    {lastFrameRefImage?.url && (
                      <span className="flex flex-col items-center">
                        <span className="relative size-7 overflow-hidden rounded border border-(--border)">
                          <Image
                            src={lastFrameRefImage.url}
                            alt="Last frame reference"
                            fill
                            loading="lazy"
                            sizes="28px"
                            className="object-cover"
                          />
                        </span>
                        <span className="mt-0.5 text-[8px] tracking-wide text-blue-400 uppercase">
                          End
                        </span>
                      </span>
                    )}
                  </span>
                  <span>
                    <b className="text-(--foreground)">Image-to-video</b>{" "}
                    {hasFirst && hasLast
                      ? "— morphs from your first frame to your last frame."
                      : hasFirst
                        ? "— begins on your first frame."
                        : "— ends on your last frame."}
                  </span>
                </>
              ) : hasRefImg ? (
                <span>
                  Reference images guide style and subject. Deselect them to
                  use <b className="text-(--foreground)">image-to-video</b>.
                </span>
              ) : (
                <span>
                  Tag a reference image above as{" "}
                  <b className="text-(--foreground)">first frame</b> to use{" "}
                  <b className="text-(--foreground)">image-to-video</b>.
                  Otherwise text-to-video.
                </span>
              )}
            </p>
          </>
        )}
        <Field className="w-full">
          <FieldLabel className="text-xxs text-(--muted-foreground) uppercase">
            Aspect Ratio
          </FieldLabel>
          <div className="flex flex-row flex-wrap gap-2">
            {(mode === "video"
              ? ["1:1", "4:3", "3:4", "16:9", "9:16", "21:9", "adaptive"]
              : ["1:1", "4:3", "3:4", "16:9", "9:16"]
            ).map((aspectOption) => (
              <button
                key={aspectOption}
                className={clsx(
                  "grow cursor-pointer rounded-md border border-1 px-2 py-1 text-sm",
                  aspect === aspectOption
                    ? "bg-blue-500 text-(--foreground)"
                    : "text-(--muted-foreground) hover:bg-gray-900",
                )}
                onClick={(e) => {
                  e.preventDefault();
                  onAspectChange(aspectOption);
                }}
              >
                {aspectOption}
              </button>
            ))}
          </div>
        </Field>
        <Collapsible open={advancedOpen} onOpenChange={onAdvancedOpenChange}>
          <CollapsibleTrigger className="flex w-full cursor-pointer flex-row items-baseline justify-between">
            <div className="flex items-baseline gap-1.5">
              <FieldLabel className="text-xxs cursor-pointer text-(--muted-foreground) uppercase">
                Advanced
              </FieldLabel>
              {(quality !== "auto" ||
                background !== "auto" ||
                negativePrompt.trim().length > 0 ||
                seed.trim().length > 0 ||
                thinking !== "auto" ||
                motion !== "auto" ||
                cameraFixed) && (
                <span className="text-xs text-(--muted-foreground)">
                  (modified)
                </span>
              )}
            </div>
            {advancedOpen ? (
              <ChevronUp color="var(--muted-foreground)" />
            ) : (
              <ChevronDown color="var(--muted-foreground)" />
            )}
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="mt-3 flex flex-col gap-4">
              {mode === "image" && (
                <>
                <div
                  className={clsx(
                    "flex flex-col gap-2 transition-opacity",
                    !hasOpenAIModelSelected && "opacity-50",
                  )}
                >
                  <div className="flex items-baseline justify-between">
                    <span className="text-[10px] font-medium tracking-wide text-(--muted-foreground) uppercase">
                      OpenAI
                    </span>
                    {!hasOpenAIModelSelected && (
                      <span className="text-[10px] text-(--muted-foreground)/70 italic">
                        no OpenAI model selected
                      </span>
                    )}
                  </div>
                <div className="grid grid-cols-2 gap-2">
                  <Field>
                    <AdvancedControlLabel
                      label="Quality"
                      help="Image quality. Higher uses more credits but produces sharper results."
                    />
                    <Select
                      value={quality}
                      onValueChange={(value) =>
                        onQualityChange(value ?? "auto")
                      }
                      disabled={!hasOpenAIModelSelected}
                    >
                      <SelectTrigger size="sm" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {QUALITY_OPTIONS.map((option) => (
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
                  <Field>
                    <AdvancedControlLabel
                      label="Background"
                      help="Transparent produces a PNG with no background. Auto lets the model decide."
                    />
                    <Select
                      value={background}
                      onValueChange={(value) =>
                        onBackgroundChange(value ?? "auto")
                      }
                      disabled={!hasOpenAIModelSelected}
                    >
                      <SelectTrigger size="sm" className="w-full">
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
              </div>
              <div
                className={clsx(
                  "flex flex-col gap-2 transition-opacity",
                  !hasGeminiModelSelected && "opacity-50",
                )}
              >
                <div className="flex items-baseline justify-between">
                  <span className="text-[10px] font-medium tracking-wide text-(--muted-foreground) uppercase">
                    Gemini
                  </span>
                  {!hasGeminiModelSelected && (
                    <span className="text-[10px] text-(--muted-foreground)/70 italic">
                      no Gemini model selected
                    </span>
                  )}
                </div>
                <Field>
                  <AdvancedControlLabel
                    label="Negative Prompt"
                    help="Describe what you don't want in the image (e.g. blurry, text)."
                  />
                  <Textarea
                    rows={2}
                    placeholder="e.g. blurry, low quality, text"
                    value={negativePrompt}
                    onChange={(e) => onNegativePromptChange(e.target.value)}
                    disabled={!hasGeminiModelSelected}
                  />
                </Field>
                <div className="grid grid-cols-2 gap-2">
                  <Field>
                    <AdvancedControlLabel
                      label="Seed"
                      help="Use the same seed to reproduce results. Leave blank for random."
                    />
                    <Input
                      inputMode="numeric"
                      placeholder="Random"
                      value={seed}
                      onChange={(e) =>
                        onSeedChange(e.target.value.replace(/[^0-9]/g, ""))
                      }
                      disabled={!hasGeminiModelSelected}
                    />
                  </Field>
                  <Field>
                    <AdvancedControlLabel
                      label="Thinking"
                      help="How much the model reasons before generating. Costs extra tokens. Only Gemini 3 models support thinking."
                    />
                    <Select
                      value={thinking}
                      onValueChange={(value) =>
                        onThinkingChange(value ?? "auto")
                      }
                      disabled={!hasGeminiModelSelected}
                    >
                      <SelectTrigger size="sm" className="w-full">
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
              </div>
              </>
              )}
              {mode === "video" && (
                <div className="flex flex-col gap-2">
                  <div className="flex items-baseline justify-between">
                    <span className="text-[10px] font-medium tracking-wide text-blue-400 uppercase">
                      Dreamina · Seedance
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Field>
                      <AdvancedControlLabel
                        label="Motion"
                        help="How much motion the video should have. Subtle keeps things calm; Dynamic adds more movement."
                      />
                      <Select
                        value={motion}
                        onValueChange={(value) =>
                          onMotionChange(value ?? "auto")
                        }
                      >
                        <SelectTrigger size="sm" className="w-full">
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
                    <Field>
                      <AdvancedControlLabel
                        label="Camera"
                        help="Fixed locks the camera in place. Free move lets the model add camera motion."
                      />
                      <ButtonGroup className="w-full">
                        <Button
                          type="button"
                          variant={cameraFixed ? "secondary" : "outline"}
                          size="sm"
                          aria-pressed={cameraFixed}
                          onClick={() => onCameraFixedChange(true)}
                          className="flex-1"
                        >
                          Fixed
                        </Button>
                        <Button
                          type="button"
                          variant={!cameraFixed ? "secondary" : "outline"}
                          size="sm"
                          aria-pressed={!cameraFixed}
                          onClick={() => onCameraFixedChange(false)}
                          className="flex-1"
                        >
                          Free move
                        </Button>
                      </ButtonGroup>
                    </Field>
                  </div>
                </div>
              )}
            </div>
          </CollapsibleContent>
        </Collapsible>
        <Field className="w-full">
          <FieldLabel className="text-xxs text-(--muted-foreground) uppercase">
            Runs per Model
          </FieldLabel>
          <div className="flex flex-row gap-2">
            <button
              className="cursor-pointer rounded-md border border-1 px-3 py-1 text-sm hover:bg-gray-900 active:bg-blue-500"
              onClick={() => {
                if (runs > 1) onRunsChange(runs - 1);
              }}
            >
              -
            </button>
            <input
              className="w-0 grow rounded-md border border-1 text-center text-sm"
              disabled
              value={runs}
            />
            <button
              className="cursor-pointer rounded-md border border-1 px-3 py-1 text-sm hover:bg-gray-900 active:bg-blue-500"
              onClick={() => {
                if (runs < 8) onRunsChange(runs + 1);
              }}
            >
              +
            </button>
          </div>
          <span className="mt-1 text-xs text-(--muted-foreground)">
            {totalGenerations} generation{totalGenerations !== 1 ? "s" : ""}{" "}
            will be triggered
          </span>
        </Field>
        {totalGenerations > 6 && (
          <div className="flex flex-row items-start gap-3 rounded-md border border-amber-500/50 bg-amber-500/10 p-3">
            <AlertTriangle
              size={16}
              className="mt-0.5 shrink-0 text-amber-400"
            />
            <div className="text-sm text-amber-300">
              Repeating prompts many times may lead to high usage.{" "}
              <button
                className="underline hover:text-amber-200"
                onClick={() => onRunsChange(3)}
              >
                Reduce repeat count
              </button>
            </div>
          </div>
        )}
      </div>
      <div className="flex flex-col items-center-safe gap-2 border-y border-(--border) py-4">
        {usage?.isOverQuota && !bypassMonthlyQuota && (
          <div className="mx-4 mb-1 flex w-[calc(100%-2rem)] items-start gap-3 rounded-md border border-red-500/40 bg-red-500/10 p-3">
            <AlertTriangle size={16} className="mt-0.5 shrink-0 text-red-400" />
            <div className="text-sm text-red-300">
              Out of monthly credits. Resets on{" "}
              {new Intl.DateTimeFormat(undefined, {
                dateStyle: "medium",
                timeZone: "UTC",
              }).format(new Date(usage.periodEnd))}
              .{" "}
              <button
                type="button"
                className="cursor-pointer underline hover:text-red-200"
                onClick={() => setUsageOpen(true)}
              >
                View usage
              </button>
            </div>
          </div>
        )}
        <GenerateButton
          promptComposerRef={promptComposerRef}
          selectedModelsCount={selectedModels.length}
          hasSelectedProject={hasSelectedProject}
          isOverQuota={Boolean(usage?.isOverQuota)}
          bypassMonthlyQuota={bypassMonthlyQuota}
          generateButtonLocked={generateButtonLocked}
          onGenerate={onGenerate}
        />
        <br />
        <div className="flex w-full flex-row items-center-safe justify-start gap-4 px-4">
          <UserButton>
            <UserButton.MenuItems>
              <UserButton.Action
                label="Usage"
                labelIcon={<Gauge className="size-4" />}
                onClick={() => setUsageOpen(true)}
              />
            </UserButton.MenuItems>
          </UserButton>
          {userFullName}
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
      </div>
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
