"use client";

import PromptGroup from "./prompt-group";
import { ProjectSwitcher } from "./project-switcher";

import { Skeleton } from "src/components/ui/skeleton";
import { useLocalStorage } from "src/lib/localStorage";
import type { RouterOutputs } from "src/trpc/react";

type PromptList = RouterOutputs["prompt"]["list"];
type ProjectList = RouterOutputs["project"]["list"];
type ModelList = RouterOutputs["prompt"]["getModels"];
type ReferenceImageList = RouterOutputs["referenceImage"]["getReferenceImages"];

type ImageGalleryProps = {
  projects: ProjectList | undefined;
  project: ProjectList[number] | undefined;
  selectedProjectId: string | null;
  isLoadingProjects: boolean;
  onSelectProject: (projectId: string) => void;
  prompts: PromptList | undefined;
  errorMessage?: string;
  isLoading: boolean;
  models: ModelList | undefined;
  referenceImages: ReferenceImageList | undefined;
  onDeletePrompt: (promptId: string) => void;
  onDeleteImage: (imageId: string) => void;
  onReuseAsReference: (imageId: string) => Promise<void>;
  onRetryImage: (imageId: string) => void;
};

function PromptGroupSkeleton() {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-2">
          <Skeleton className="h-4 w-2/3 rounded-md" />
          <Skeleton className="h-4 w-1/2 rounded-md" />
          <Skeleton className="h-3 w-24 rounded-md" />
        </div>
        <Skeleton className="size-7 rounded-md" />
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 3 }).map((_, index) => (
          <div
            key={index}
            className="bg-card border-border overflow-hidden rounded-lg border"
          >
            <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
              <div className="space-y-1.5">
                <Skeleton className="h-3 w-24 rounded-md" />
                <Skeleton className="h-2.5 w-32 rounded-md" />
              </div>
              <Skeleton className="h-6 w-16 rounded-md" />
            </div>
            <div className="p-3.5">
              <Skeleton className="aspect-square w-full rounded-md" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ImageGallery({
  projects,
  project,
  selectedProjectId,
  isLoadingProjects,
  onSelectProject,
  prompts,
  errorMessage,
  isLoading,
  models,
  referenceImages,
  onDeletePrompt,
  onDeleteImage,
  onReuseAsReference,
  onRetryImage,
}: ImageGalleryProps) {
  const promptCount = prompts?.length ?? 0;
  const [pinnedImages, setPinnedImages] = useLocalStorage("pinnedImages");

  return (
    <div className="flex max-h-screen w-full flex-col overflow-x-hidden overflow-y-scroll">
      <div className="bg-background/95 sticky top-0 z-30 flex items-center justify-between gap-3 px-9 py-4 backdrop-blur">
        <div className="flex items-center gap-3">
          <ProjectSwitcher
            projects={projects}
            selectedProject={project}
            selectedProjectId={selectedProjectId}
            isLoading={isLoadingProjects}
            onSelectProject={onSelectProject}
          />
          {promptCount > 0 && (
            <p className="text-muted-foreground/60 text-xs font-medium">
              {promptCount} {promptCount === 1 ? "generation" : "generations"}{" "}
              in this project
            </p>
          )}
        </div>
      </div>
      {errorMessage ? (
        <div className="flex flex-1 items-center justify-center">
          <p className="text-muted-foreground text-sm">
            Failed to load generations: {errorMessage}
          </p>
        </div>
      ) : isLoading ? (
        <div className="flex w-full flex-col gap-12 px-9 py-8">
          {Array.from({ length: 3 }).map((_, index) => (
            <PromptGroupSkeleton key={index} />
          ))}
        </div>
      ) : promptCount === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3">
          <div className="bg-card border-border flex size-11 items-center justify-center rounded-xl border">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <rect
                x="2"
                y="2"
                width="7"
                height="7"
                rx="1.5"
                stroke="var(--muted-foreground)"
                strokeWidth="1.5"
              />
              <rect
                x="11"
                y="2"
                width="7"
                height="7"
                rx="1.5"
                stroke="var(--muted-foreground)"
                strokeWidth="1.5"
              />
              <rect
                x="2"
                y="11"
                width="7"
                height="7"
                rx="1.5"
                stroke="var(--muted-foreground)"
                strokeWidth="1.5"
              />
              <rect
                x="11"
                y="11"
                width="7"
                height="7"
                rx="1.5"
                stroke="var(--muted-foreground)"
                strokeWidth="1.5"
              />
            </svg>
          </div>
          <p className="text-muted-foreground text-sm">
            No generations in this project yet
          </p>
          <p className="text-muted-foreground/60 text-xs">
            Write a prompt and hit Generate
          </p>
        </div>
      ) : (
        <div className="flex w-full flex-col gap-12 px-9 py-8">
          {(prompts ?? []).map((prompt) => (
            <PromptGroup
              key={prompt.id}
              id={prompt.id}
              prompt={prompt.text}
              aspectRatio={prompt.aspectRatio ?? undefined}
              createdAt={prompt.createdAt}
              models={models ?? []}
              images={prompt.images.map((image) => ({
                id: image.id,
                url: image.url ?? "",
                modelSlug: image.model,
                status: image.status,
                key: image.key ?? "",
                error: image.error ?? undefined,
                createdAt: image.createdAt,
                updatedAt: image.updatedAt,
              }))}
              referenceImages={
                (prompt.referenceImages as string[])?.length > 0
                  ? (prompt.referenceImages as string[]).map((id) => ({
                      id,
                      url:
                        referenceImages?.find((r) => r.id === id)?.url ??
                        undefined,
                    }))
                  : []
              }
              onDeletePrompt={() => onDeletePrompt(prompt.id)}
              onDeleteImage={onDeleteImage}
              onReuseAsReference={onReuseAsReference}
              onRetryImage={onRetryImage}
              pinnedImages={pinnedImages}
              onPinnedImagesChange={setPinnedImages}
            />
          ))}
        </div>
      )}
    </div>
  );
}
