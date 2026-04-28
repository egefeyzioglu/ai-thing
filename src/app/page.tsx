"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { api } from "src/trpc/react";

import { Skeleton } from "src/components/ui/skeleton";

import { type GenerateOptions, type ModelId } from "src/app/_components/models";
import { PromptGroup } from "src/app/_components/prompt-group";
import { Sidebar } from "src/app/_components/sidebar";

export const dynamic = "force-dynamic";

type PendingMap = Record<string, Set<ModelId>>;

export default function Home() {
  const router = useRouter();
  const [pending, setPending] = useState<PendingMap>({});
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const utils = api.useUtils();
  const promptsQuery = api.prompt.list.useQuery();

  const createPrompt = api.prompt.create.useMutation();
  const openai = api.image.generateOpenAI.useMutation();
  const nanoBanana = api.image.generateGemini.useMutation();

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  };

  const setPendingFor = (promptId: string, model: ModelId, on: boolean) => {
    setPending((prev) => {
      const next: PendingMap = { ...prev };
      const current = new Set(next[promptId] ?? []);
      if (on) current.add(model);
      else current.delete(model);
      if (current.size === 0) {
        delete next[promptId];
      } else {
        next[promptId] = current;
      }
      return next;
    });
  };

  const handleGenerate = async ({ prompt, models }: GenerateOptions) => {
    let promptRow;
    try {
      promptRow = await createPrompt.mutateAsync({ text: prompt });
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : "Failed to create prompt",
      );
      return;
    }
    await utils.prompt.list.invalidate();

    const promptId = promptRow.id;
    for (const model of models) setPendingFor(promptId, model, true);

    const fires: Promise<unknown>[] = [];

    if (models.has("gpt-5.4-mini")) {
      fires.push(
        openai
          .mutateAsync({ promptId })
          .catch((err: unknown) => {
            setErrorMessage(err instanceof Error ? err.message : String(err));
          })
          .finally(() => {
            setPendingFor(promptId, "gpt-5.4-mini", false);
            void utils.prompt.list.invalidate();
          }),
      );
    }

    if (models.has("gemini-2.5-flash-image")) {
      fires.push(
        nanoBanana
          .mutateAsync({ promptId })
          .catch((err: unknown) => {
            setErrorMessage(err instanceof Error ? err.message : String(err));
          })
          .finally(() => {
            setPendingFor(promptId, "gemini-2.5-flash-image", false);
            void utils.prompt.list.invalidate();
          }),
      );
    }

    await Promise.all(fires);
  };

  return (
    <main className="flex min-h-screen bg-neutral-950 text-neutral-100">
      <Sidebar
        onSubmit={handleGenerate}
        onLogout={handleLogout}
        errorMessage={errorMessage}
        setErrorMessage={setErrorMessage}
      />

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
                  <PromptGroup
                    key={p.id}
                    prompt={p}
                    pendingModels={pending[p.id] ?? new Set<ModelId>()}
                  />
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
