"use client";

import Image from "next/image";
import { useState } from "react";

import { api } from "src/trpc/react";

import { Button } from "src/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "src/components/ui/card";
import { Input } from "src/components/ui/input";
import { Skeleton } from "src/components/ui/skeleton";

export const dynamic = "force-dynamic";

const MODELS = ["gpt-5.4-mini", "gemini-2.5-flash-image"] as const;
type ModelId = (typeof MODELS)[number];

const MODEL_LABELS: Record<ModelId, string> = {
  "gpt-5.4-mini": "GPT 5.4 Mini",
  "gemini-2.5-flash-image": "Nano Banana (gemini-2.5-flash-image)",
};

function modelLabel(model: string): string {
  return MODEL_LABELS[model as ModelId] ?? model;
}

type PendingMap = Record<string, Set<ModelId>>;

export default function Home() {
  const [prompt, setPrompt] = useState("");
  const [pending, setPending] = useState<PendingMap>({});
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const utils = api.useUtils();
  const promptsQuery = api.prompt.list.useQuery();

  const createPrompt = api.prompt.create.useMutation();
  const openai = api.image.generateOpenAI.useMutation();
  const nanoBanana = api.image.generateGemini.useMutation();

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

  // const isGenerating = createPrompt.isPending || Object.keys(pending).length > 0;

  const handleSubmit = async () => {
    const trimmed = prompt.trim();
    if (!trimmed) return;
    setErrorMessage(null);

    let promptRow;
    try {
      promptRow = await createPrompt.mutateAsync({ text: trimmed });
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Failed to create prompt");
      return;
    }
    setPrompt("");
    await utils.prompt.list.invalidate();

    const promptId = promptRow.id;
    for (const model of MODELS) setPendingFor(promptId, model, true);

    const fireOpenAi = openai
      .mutateAsync({ promptId })
      .catch((err: unknown) => {
        setErrorMessage(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        setPendingFor(promptId, "gpt-5.4-mini", false);
        void utils.prompt.list.invalidate();
      });

    const fireNano = nanoBanana
      .mutateAsync({ promptId })
      .catch((err: unknown) => {
        setErrorMessage(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        setPendingFor(promptId, "gemini-2.5-flash-image", false);
        void utils.prompt.list.invalidate();
      });

    await Promise.all([fireOpenAi, fireNano]);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && e.ctrlKey) void handleSubmit();
  };

  return (
    <main className="flex min-h-screen flex-col items-center bg-neutral-950 p-8 text-neutral-100">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-8">
        <header className="flex flex-col items-center gap-2 text-center">
          <h1 className="text-3xl font-semibold tracking-tight">AI Thing</h1>
          <p className="text-sm text-neutral-400">
            Generate images side-by-side with GPT and Gemini. They&apos;re saved
            to UploadThing automatically.
          </p>
        </header>

        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Describe what you want to see…  (Ctrl+Enter to submit)"
            className="flex-1"
          />
          <Button
            onClick={() => void handleSubmit()}
            disabled={prompt.trim().length === 0}
          >
            Generate
          </Button>
        </div>

        {errorMessage ? (
          <p className="text-sm text-red-400">{errorMessage}</p>
        ) : null}

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
              No prompts yet. Enter one above to generate your first images.
            </p>
          ) : (
            <ul className="flex flex-col gap-8">
              {promptsQuery.data?.map((p) => {
                const pendingModels = pending[p.id] ?? new Set<ModelId>();
                const completedModels = new Set(p.images.map((i) => i.model));

                return (
                  <li key={p.id} className="flex flex-col gap-3">
                    <div className="flex flex-col gap-1">
                      <p className="text-sm text-neutral-200">{p.text}</p>
                      <p className="text-[10px] uppercase tracking-wide text-neutral-600">
                        {new Date(p.createdAt).toLocaleString()}
                      </p>
                    </div>

                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                      {p.images.map((img) => (
                        <Card
                          key={img.id}
                          className="overflow-hidden border-neutral-800 bg-neutral-900 py-0 text-neutral-100"
                        >
                          <CardHeader className="px-4 pt-4">
                            <CardTitle className="text-sm font-medium text-neutral-200">
                              {modelLabel(img.model)}
                            </CardTitle>
                          </CardHeader>
                          <CardContent className="px-0 pb-0">
                            <div className="relative aspect-square w-full">
                              <Image
                                src={img.url}
                                alt={p.text}
                                fill
                                sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
                                className="object-cover"
                                unoptimized
                              />
                            </div>
                          </CardContent>
                          <CardFooter className="px-4 py-3">
                            <p className="text-[10px] uppercase tracking-wide text-neutral-600">
                              {new Date(img.createdAt).toLocaleString()}
                            </p>
                          </CardFooter>
                        </Card>
                      ))}

                      {[...pendingModels]
                        .filter((m) => !completedModels.has(m))
                        .map((m) => (
                          <Card
                            key={`pending-${p.id}-${m}`}
                            className="overflow-hidden border-neutral-800 bg-neutral-900 py-0 text-neutral-100"
                          >
                            <CardHeader className="px-4 pt-4">
                              <CardTitle className="text-sm font-medium text-neutral-200">
                                {modelLabel(m)}
                              </CardTitle>
                            </CardHeader>
                            <CardContent className="px-0 pb-0">
                              <Skeleton className="aspect-square w-full rounded-none" />
                            </CardContent>
                            <CardFooter className="px-4 py-3">
                              <p className="text-[10px] uppercase tracking-wide text-neutral-600">
                                Generating…
                              </p>
                            </CardFooter>
                          </Card>
                        ))}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}
