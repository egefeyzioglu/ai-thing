"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
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
import { Skeleton } from "src/components/ui/skeleton";

export const dynamic = "force-dynamic";

const MODELS = ["gpt-5.4-mini", "gemini-2.5-flash-image"] as const;
type ModelId = (typeof MODELS)[number];

const MODEL_LABELS: Record<ModelId, string> = {
  "gpt-5.4-mini": "GPT 5.4 Mini",
  "gemini-2.5-flash-image": "Nano Banana (gemini-2.5-flash-image)",
};

const RESOLUTIONS = ["512", "1024", "2048"] as const;
type Resolution = (typeof RESOLUTIONS)[number];

const ASPECT_RATIOS = ["1:1", "4:3", "3:4", "16:9", "9:16"] as const;
type AspectRatio = (typeof ASPECT_RATIOS)[number];

function modelLabel(model: string): string {
  return MODEL_LABELS[model as ModelId] ?? model;
}

type PendingMap = Record<string, Set<ModelId>>;

export default function Home() {
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const [pending, setPending] = useState<PendingMap>({});
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [selectedModels, setSelectedModels] = useState<Set<ModelId>>(
    () => new Set(MODELS),
  );
  const [resolution, setResolution] = useState<Resolution>("1024");
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>("1:1");

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  };

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

  const toggleModel = (model: ModelId) => {
    setSelectedModels((prev) => {
      const next = new Set(prev);
      if (next.has(model)) next.delete(model);
      else next.add(model);
      return next;
    });
  };

  const handleSubmit = async () => {
    const trimmed = prompt.trim();
    if (!trimmed) return;
    if (selectedModels.size === 0) {
      setErrorMessage("Select at least one model.");
      return;
    }
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
    for (const model of selectedModels) setPendingFor(promptId, model, true);

    const fires: Promise<unknown>[] = [];

    if (selectedModels.has("gpt-5.4-mini")) {
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

    if (selectedModels.has("gemini-2.5-flash-image")) {
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

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && e.ctrlKey) void handleSubmit();
  };

  const selectClass =
    "w-full rounded-md border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 outline-none transition focus:border-neutral-600";

  return (
    <main className="flex min-h-screen bg-neutral-950 text-neutral-100">
      <aside className="sticky top-0 flex h-screen w-80 shrink-0 flex-col gap-5 overflow-y-auto border-r border-neutral-800 bg-neutral-950 p-6">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold tracking-tight">AI Thing</h1>
          <p className="text-xs text-neutral-500">
            Generate images side-by-side.
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <label
            htmlFor="prompt"
            className="text-xs font-medium uppercase tracking-wide text-neutral-400"
          >
            Prompt
          </label>
          <textarea
            id="prompt"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Describe what you want to see…  (Ctrl+Enter to submit)"
            rows={5}
            className="w-full resize-y rounded-md border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 outline-none transition placeholder:text-neutral-600 focus:border-neutral-600"
          />
        </div>

        <fieldset className="flex flex-col gap-2">
          <legend className="text-xs font-medium uppercase tracking-wide text-neutral-400">
            Models
          </legend>
          {MODELS.map((m) => (
            <label
              key={m}
              className="flex cursor-pointer items-center gap-2 text-sm text-neutral-200"
            >
              <input
                type="checkbox"
                checked={selectedModels.has(m)}
                onChange={() => toggleModel(m)}
                className="h-4 w-4 cursor-pointer accent-neutral-200"
              />
              <span>{MODEL_LABELS[m]}</span>
            </label>
          ))}
        </fieldset>

        <div className="flex flex-col gap-2">
          <label
            htmlFor="resolution"
            className="text-xs font-medium uppercase tracking-wide text-neutral-400"
          >
            Resolution
          </label>
          <select
            id="resolution"
            value={resolution}
            onChange={(e) => setResolution(e.target.value as Resolution)}
            className={selectClass}
          >
            {RESOLUTIONS.map((r) => (
              <option key={r} value={r}>
                {r}px
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-2">
          <label
            htmlFor="aspect-ratio"
            className="text-xs font-medium uppercase tracking-wide text-neutral-400"
          >
            Aspect ratio
          </label>
          <select
            id="aspect-ratio"
            value={aspectRatio}
            onChange={(e) => setAspectRatio(e.target.value as AspectRatio)}
            className={selectClass}
          >
            {ASPECT_RATIOS.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </div>

        <Button
          onClick={() => void handleSubmit()}
          disabled={prompt.trim().length === 0 || selectedModels.size === 0}
        >
          Generate
        </Button>

        {errorMessage ? (
          <p className="text-sm text-red-400">{errorMessage}</p>
        ) : null}

        <div className="mt-auto pt-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void handleLogout()}
            className="w-full text-neutral-400 hover:text-neutral-100"
          >
            Sign out
          </Button>
        </div>
      </aside>

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
      </div>
    </main>
  );
}
