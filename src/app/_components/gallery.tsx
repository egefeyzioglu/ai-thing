"use client";

import { Skeleton } from "src/components/ui/skeleton";
import { api } from "src/trpc/react";

import { PromptGroup } from "src/app/_components/prompt-group";

export function Gallery() {
  const promptsQuery = api.prompt.list.useQuery();

  return (
    <div className="flex-1 overflow-x-hidden p-8">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        <section className="flex flex-col gap-6">
          <h2 className="text-lg font-medium text-neutral-200">Gallery</h2>

          {promptsQuery.isLoading ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="aspect-square w-full rounded-lg" />
              ))}
            </div>
          ) : (promptsQuery.data?.length ?? 0) === 0 ? (
            <p className="text-center text-sm text-neutral-500">
              No prompts yet. Enter one in the sidebar to generate your first
              images.
            </p>
          ) : (
            <ul className="flex flex-col gap-8">
              {promptsQuery.data?.map((p) => (
                <PromptGroup key={p.id} prompt={p} />
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
