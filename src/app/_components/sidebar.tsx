"use client";

import { useState, type RefObject } from "react";

import { UserButton } from "@clerk/nextjs";
import {
  ChevronDown,
  ChevronUp,
  Gauge,
  Trash2,
  Upload,
  AlertTriangle,
} from "lucide-react";
import Image from "next/image";
import clsx from "clsx";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "src/components/ui/collapsible";
import { Checkbox } from "src/components/ui/checkbox";
import { Field, FieldLabel } from "src/components/ui/field";
import { Label } from "src/components/ui/label";
import { Skeleton } from "src/components/ui/skeleton";
import { Textarea } from "src/components/ui/textarea";
import type { RouterInputs, RouterOutputs } from "src/trpc/react";
import { UsageModal } from "./usage-modal";

export type PromptModelSlug =
  RouterInputs["prompt"]["createWithGenerations"]["models"][number];
export type ResolutionOption = "512" | "1K" | "2K" | "4K";

export const RESOLUTION_OPTIONS: ResolutionOption[] = ["512", "1K", "2K", "4K"];

type ReferenceImageProps = {
  src: string;
  alt: string;
  isSelected: boolean;
  onDelete: () => void;
  setSelected: () => void;
};

function ReferenceImage(props: ReferenceImageProps) {
  return (
    <div
      className={clsx(
        "group relative flex flex-col justify-center overflow-clip rounded-md border-1",
      )}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 z-0 h-10 bg-linear-to-b from-black/45 via-black/20 to-transparent"
      />
      <button
        type="button"
        onClick={props.setSelected}
        aria-label={
          props.isSelected
            ? "Deselect reference image"
            : "Select reference image"
        }
        aria-pressed={props.isSelected}
        className="block flex grow-1 cursor-pointer bg-transparent text-left"
      >
        <div
          className={clsx(
            "absolute top-1.5 left-1.5 z-10 size-4 cursor-pointer rounded-full border-2 border-(--muted-foreground)",
            props.isSelected
              ? "border-blue-500 opacity-100"
              : "opacity-30 transition-opacity group-hover:opacity-100",
          )}
        >
          <div
            className={clsx(
              "absolute top-0.25 left-0.25 size-2.5 rounded-full",
              props.isSelected
                ? "bg-blue-500 opacity-100"
                : "bg-(--muted-foreground) opacity-30 transition-opacity group-hover:opacity-60",
            )}
          />
        </div>

        <Image
          src={props.src}
          alt={props.alt}
          width={100}
          height={100}
          className="m-auto w-full"
        />
      </button>

      <button
        type="button"
        aria-label="Delete reference image"
        onClick={(e) => {
          e.stopPropagation();
          props.onDelete();
        }}
        className="focus-visible:outline-ring absolute top-1.5 right-1.5 z-10 flex size-4 cursor-pointer items-center justify-center rounded-full border-2 border-(--muted-foreground) opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline focus-visible:outline-2"
      >
        <Trash2
          className="size-2.5 text-(--muted-foreground)"
          strokeWidth={2.2}
        />
      </button>
    </div>
  );
}

type SidebarProps = {
  referenceImagesOpen: boolean;
  onReferenceImagesOpenChange: (open: boolean) => void;
  archivedModelsOpen: boolean;
  onArchivedModelsOpenChange: (open: boolean) => void;
  selectedReferenceImages: string[];
  onSelectedReferenceImagesChange: (ids: string[]) => void;
  selectedModels: PromptModelSlug[];
  onToggleSelectedModel: (slug: PromptModelSlug) => void;
  resolution: ResolutionOption;
  onResolutionChange: (resolution: ResolutionOption) => void;
  aspect: string;
  onAspectChange: (aspect: string) => void;
  isMacOS: boolean | null;
  promptText: string;
  onPromptTextChange: (text: string) => void;
  onPromptKeyDown: (event: React.KeyboardEvent) => void;
  runs: number;
  onRunsChange: (runs: number) => void;
  generateButtonLocked: boolean;
  canGenerate: boolean;
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
  selectedModels,
  onToggleSelectedModel,
  resolution,
  onResolutionChange,
  aspect,
  onAspectChange,
  isMacOS,
  promptText,
  onPromptTextChange,
  onPromptKeyDown,
  runs,
  onRunsChange,
  generateButtonLocked,
  canGenerate,
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

  return (
    <aside className="flex h-screen w-1/5 flex-col border border-x border-(--border)">
      <div className="flex flex-row items-center gap-4 border-y border-(--border) p-5">
        <div className="h-8 w-8 rounded-md bg-blue-400"></div>
        <div>
          <h1 className="font-heading text-lg font-bold">AI Thing</h1>
          <p className="text-xs text-(--muted-foreground)">
            All your models, in one place
          </p>
        </div>
      </div>
      <div className="flex grow flex-col gap-3 overflow-y-scroll p-5">
        <Field>
          <FieldLabel className="text-xxs text-(--muted-foreground) uppercase">
            Prompt
          </FieldLabel>
          <Textarea
            id="prompt"
            placeholder="What do you want to create?.."
            value={promptText}
            onChange={(e) => onPromptTextChange(e.target.value)}
            onKeyDown={onPromptKeyDown}
          />
          <span
            className={clsx(
              "mx-0 text-xs text-(--muted-foreground)",
              isMacOS === null ? "opacity-0" : "opacity-80",
            )}
          >
            Press {isMacOS ? "⌘" : "Ctrl"} + Enter to submit
          </span>
        </Field>
        <Collapsible
          open={referenceImagesOpen}
          onOpenChange={onReferenceImagesOpenChange}
        >
          <CollapsibleTrigger className="flex w-full cursor-pointer flex-row justify-between">
            <FieldLabel className="text-xxs cursor-pointer text-(--muted-foreground) uppercase">
              Reference Images
            </FieldLabel>
            {referenceImagesOpen ? (
              <ChevronUp color="var(--muted-foreground)" />
            ) : (
              <ChevronDown color="var(--muted-foreground)" />
            )}
          </CollapsibleTrigger>
          {selectedReferenceImages.length > 0 ? (
            <span className="mx-0 text-xs text-(--muted-foreground)">
              {`(${selectedReferenceImages.length} image${selectedReferenceImages.length > 1 ? "s" : ""} selected)`}
            </span>
          ) : (
            ""
          )}
          <CollapsibleContent className="max-h-80 overflow-scroll">
            <div className="my-2 grid grid-cols-3 gap-2 p-2">
              {isLoadingRefImages
                ? Array.from({ length: 6 }).map((_, i) => (
                    <Skeleton key={i} className="aspect-square rounded-md" />
                  ))
                : referenceImages?.map((img) => (
                    <ReferenceImage
                      key={img.id}
                      src={img.url ?? ""}
                      alt="Reference image"
                      isSelected={selectedReferenceImages.includes(img.id)}
                      setSelected={() => {
                        if (selectedReferenceImages.includes(img.id)) {
                          onSelectedReferenceImagesChange(
                            selectedReferenceImages.filter((e) => e !== img.id),
                          );
                        } else {
                          onSelectedReferenceImagesChange([
                            ...selectedReferenceImages,
                            img.id,
                          ]);
                        }
                      }}
                      onDelete={() => onDeleteReferenceImage(img.id)}
                    />
                  ))}
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
          </CollapsibleContent>
        </Collapsible>
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
              {activeModels.map(({ slug, name }) => (
                <div
                  key={slug}
                  role="checkbox"
                  aria-checked={selectedModels.includes(slug)}
                  aria-labelledby={`model-select-${slug}-label`}
                  tabIndex={0}
                  className={clsx(
                    "flex cursor-pointer flex-row items-center gap-4 rounded-md border border-1 px-4 py-2 text-(--foreground)",
                    selectedModels.includes(slug)
                      ? "border-blue-500 bg-gray-800"
                      : "hover:bg-gray-900",
                  )}
                  onClick={() => onToggleSelectedModel(slug)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onToggleSelectedModel(slug);
                    }
                  }}
                >
                  <Checkbox
                    id={`model-select-${slug}`}
                    accentColor="blue-500"
                    checked={selectedModels.includes(slug)}
                    tabIndex={-1}
                    className="pointer-events-none"
                  />
                  <Label
                    id={`model-select-${slug}-label`}
                    className="pointer-events-none cursor-pointer flex-col items-start"
                  >
                    <span>{name}</span>
                    <span className="text-xs text-(--muted-foreground)">
                      {slug}
                    </span>
                  </Label>
                </div>
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
                    {archivedModels.map(({ slug, name }) => (
                      <div
                        key={slug}
                        role="checkbox"
                        aria-checked={selectedModels.includes(slug)}
                        aria-labelledby={`model-select-${slug}-label`}
                        tabIndex={0}
                        className={clsx(
                          "flex cursor-pointer flex-row items-center gap-4 rounded-md border border-1 px-4 py-2 text-(--foreground)",
                          selectedModels.includes(slug)
                            ? "border-blue-500 bg-gray-800"
                            : "hover:bg-gray-900",
                        )}
                        onClick={() => onToggleSelectedModel(slug)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            onToggleSelectedModel(slug);
                          }
                        }}
                      >
                        <Checkbox
                          id={`model-select-${slug}`}
                          accentColor="blue-500"
                          checked={selectedModels.includes(slug)}
                          tabIndex={-1}
                          className="pointer-events-none"
                        />
                        <Label
                          id={`model-select-${slug}-label`}
                          className="pointer-events-none cursor-pointer flex-col items-start"
                        >
                          <span>{name}</span>
                          <span className="text-xs text-(--muted-foreground)">
                            {slug}
                          </span>
                        </Label>
                      </div>
                    ))}
                  </CollapsibleContent>
                </Collapsible>
              )}
            </div>
          )}
        </Field>
        <Field className="w-full">
          <FieldLabel className="text-xxs text-(--muted-foreground) uppercase">
            Resolution
          </FieldLabel>
          <div className="flex flex-row gap-2">
            {RESOLUTION_OPTIONS.map((resolutionOption) => {
              const isDisabled =
                resolutionOption === "512" && hasOnlyOpenAIModelsSelected;

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
        <Field className="w-full">
          <FieldLabel className="text-xxs text-(--muted-foreground) uppercase">
            Aspect Ratio
          </FieldLabel>
          <div className="flex flex-row gap-2">
            {["1:1", "4:3", "3:4", "16:9", "9:16"].map((aspectOption) => (
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
            <AlertTriangle
              size={16}
              className="mt-0.5 shrink-0 text-red-400"
            />
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
        <button
          aria-busy={generateButtonLocked}
          className={clsx(
            "w-2/3 cursor-pointer rounded-md border border-1 px-4 py-2",
            canGenerate
              ? "hover:bg-gray-900 active:bg-gray-500"
              : "cursor-not-allowed opacity-50",
          )}
          disabled={!canGenerate}
          onClick={onGenerate}
        >
          {generateButtonLocked
            ? "Generating..."
            : usage?.isOverQuota && !bypassMonthlyQuota
              ? "Out of credits"
              : "Generate"}
        </button>
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
      </div>
    </aside>
  );
}
