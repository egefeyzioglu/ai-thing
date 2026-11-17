"use client";

import { memo } from "react";
import { Image as ImageIcon } from "lucide-react";

import PromptGroup from "./prompt-group";
import { ProjectSwitcher } from "./project-switcher";
import { VideoPoller } from "./video-poller";

import { Skeleton } from "src/components/ui/skeleton";
import { useLocalStorage } from "src/lib/localStorage";
import type { RouterOutputs } from "src/trpc/react";

type PromptList = RouterOutputs["prompt"]["list"];
type ProjectList = RouterOutputs["project"]["list"];
type ModelList = RouterOutputs["prompt"]["getModels"];
type ReferenceImageList = RouterOutputs["referenceImage"]["getReferenceImages"];

type MediaGalleryProps = {
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
  onMovePrompt: (promptId: string, projectId: string) => void;
  onDeleteMedia: (mediaId: string) => void;
  onReuseAsReference: (mediaId: string) => Promise<void>;
  onRetryMedia: (mediaId: string) => void;
  onReusePrompt: (
    text: string,
    options: { mode: "image" | "video"; aspectRatio?: string },
  ) => void;
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

export const MediaGallery = memo(function MediaGallery({
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
  onMovePrompt,
  onDeleteMedia,
  onReuseAsReference,
  onRetryMedia,
  onReusePrompt,
}: MediaGalleryProps) {
  const promptCount = prompts?.length ?? 0;
  const [pinnedImages, setPinnedImages] = useLocalStorage("pinnedImages");

  return (
    <div className="flex h-screen min-w-0 flex-1 flex-col overflow-x-hidden overflow-y-auto">
      <header className="bg-background/85 sticky top-0 z-30 flex h-14 shrink-0 items-center justify-between gap-3 border-b px-6 backdrop-blur-md lg:px-8">
        <div className="flex min-w-0 items-center gap-3">
          <ProjectSwitcher
            projects={projects}
            selectedProject={project}
            selectedProjectId={selectedProjectId}
            isLoading={isLoadingProjects}
            onSelectProject={onSelectProject}
          />
          {promptCount > 0 && (
            <p className="text-muted-foreground text-xs tabular-nums">
              {promptCount} {promptCount === 1 ? "generation" : "generations"}
            </p>
          )}
        </div>
      </header>
      {errorMessage ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
          <p className="text-sm font-medium">Couldn&apos;t load generations</p>
          <p className="text-muted-foreground max-w-md text-xs">
            {errorMessage}
          </p>
        </div>
      ) : isLoading ? (
        <div className="flex w-full flex-col gap-12 px-6 py-6 lg:px-8">
          {Array.from({ length: 3 }).map((_, index) => (
            <PromptGroupSkeleton key={index} />
          ))}
        </div>
      ) : promptCount === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
          <div className="bg-card text-muted-foreground flex size-12 items-center justify-center rounded-xl border">
            <ImageIcon className="size-5" />
          </div>
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium">Nothing here yet</p>
            <p className="text-muted-foreground max-w-xs text-sm">
              Describe an image or video in the panel on the left, pick some
              models and hit Generate. Results from every model show up here
              side by side.
            </p>
          </div>
        </div>
      ) : (
        <div className="flex w-full flex-col divide-y px-6 lg:px-8 [&>*]:py-8">
          {(prompts ?? []).map((prompt) => (
            <PromptGroup
              key={prompt.id}
              id={prompt.id}
              prompt={prompt.text}
              aspectRatio={prompt.aspectRatio ?? undefined}
              createdAt={prompt.createdAt}
              models={models ?? []}
              projects={projects}
              currentProjectId={selectedProjectId}
              images={prompt.media.map((mediaItem) => ({
                id: mediaItem.id,
                url: mediaItem.url ?? "",
                modelSlug: mediaItem.model,
                status: mediaItem.status,
                mediaType: mediaItem.type,
                mimeType: mediaItem.mimeType,
                durationMs: mediaItem.durationMs,
                key: mediaItem.key ?? "",
                error: mediaItem.error ?? undefined,
                createdAt: mediaItem.createdAt,
                updatedAt: mediaItem.updatedAt,
              }))}
              referenceImages={(() => {
                const raw = prompt.referenceImages;
                if (!Array.isArray(raw)) return [];
                const ids = raw.flatMap((item): string[] => {
                  if (typeof item === "string") return [item];
                  if (
                    item &&
                    typeof item === "object" &&
                    "id" in item &&
                    typeof (item as { id?: unknown }).id === "string"
                  ) {
                    return [(item as { id: string }).id];
                  }
                  return [];
                });
                return ids.map((id) => ({
                  id,
                  url:
                    referenceImages?.find((r) => r.id === id)?.url ??
                    undefined,
                }));
              })()}
              onDeletePrompt={() => onDeletePrompt(prompt.id)}
              onMovePrompt={(projectId) => onMovePrompt(prompt.id, projectId)}
              onDeleteMedia={onDeleteMedia}
              onReuseAsReference={onReuseAsReference}
              onRetryMedia={onRetryMedia}
              onReusePrompt={() =>
                onReusePrompt(prompt.text, {
                  mode: prompt.media.some((m) => m.type === "video")
                    ? "video"
                    : "image",
                  aspectRatio: prompt.aspectRatio ?? undefined,
                })
              }
              pinnedImages={pinnedImages}
              onPinnedImagesChange={setPinnedImages}
            />
          ))}
        </div>
      )}
      {selectedProjectId &&
        (prompts ?? []).flatMap((prompt) =>
          prompt.media
            .filter(
              (m) => m.type === "video" && m.status === "running",
            )
            .map((m) => (
              <VideoPoller
                key={m.id}
                mediaId={m.id}
                projectId={selectedProjectId}
              />
            )),
      )}
    </div>
  );
});
