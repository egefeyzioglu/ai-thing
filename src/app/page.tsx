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

const MODEL_LABELS: Record<string, string> = {
  "gpt-5.4-mini": "GPT 5.4 Mini",
  "gemini-2.5-flash-image": "Nano Banana (gemini-2.5-flash-image)",
};

function modelLabel(model: string): string {
  return MODEL_LABELS[model] ?? model;
}

export default function Home() {
  const [prompt, setPrompt] = useState("");

  const utils = api.useUtils();
  const imagesQuery = api.image.list.useQuery();

  const onSuccess = async () => {
    await utils.image.list.invalidate();
  };

  const openai = api.image.catOtter.useMutation({ onSuccess });
  const nanoBanana = api.image.catOtterNanoBanana.useMutation({ onSuccess });

  const isGenerating = openai.isPending || nanoBanana.isPending;
  const pendingCount =
    (openai.isPending ? 1 : 0) + (nanoBanana.isPending ? 1 : 0);

  const handleSubmit = () => {
    const trimmed = prompt.trim();
    if (!trimmed || isGenerating) return;
    openai.mutate({ prompt: trimmed });
    nanoBanana.mutate({ prompt: trimmed });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && e.ctrlKey) handleSubmit();
  };

  const errorMessage = openai.error?.message ?? nanoBanana.error?.message;

  return (
    <main className="flex min-h-screen flex-col items-center bg-neutral-950 p-8 text-neutral-100">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-8">
        <header className="flex flex-col items-center gap-2 text-center">
          <h1 className="text-3xl font-semibold tracking-tight">
            Cat &amp; Otter Image Generator
          </h1>
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
            placeholder="Describe what you want to see…"
            disabled={isGenerating}
            className="flex-1"
          />
          <Button
            onClick={handleSubmit}
            disabled={isGenerating || prompt.trim().length === 0}
          >
            {isGenerating ? "Generating…" : "Generate"}
          </Button>
        </div>

        {errorMessage ? (
          <p className="text-sm text-red-400">{errorMessage}</p>
        ) : null}

        <section className="flex flex-col gap-4">
          <h2 className="text-lg font-medium text-neutral-200">Gallery</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: pendingCount }).map((_, i) => (
              <Skeleton
                key={`pending-${i}`}
                className="aspect-square w-full rounded-lg"
              />
            ))}

            {imagesQuery.isLoading
              ? Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton
                    key={`loading-${i}`}
                    className="aspect-square w-full rounded-lg"
                  />
                ))
              : imagesQuery.data?.map((img) => (
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
                          alt={img.prompt}
                          fill
                          sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
                          className="object-cover"
                          unoptimized
                        />
                      </div>
                    </CardContent>
                    <CardFooter className="flex flex-col items-start gap-1 px-4 py-3">
                      <p className="line-clamp-3 text-xs text-neutral-400">
                        {img.prompt}
                      </p>
                      <p className="text-[10px] uppercase tracking-wide text-neutral-600">
                        {new Date(img.createdAt).toLocaleString()}
                      </p>
                    </CardFooter>
                  </Card>
                ))}
          </div>

          {!imagesQuery.isLoading &&
          (imagesQuery.data?.length ?? 0) === 0 &&
          pendingCount === 0 ? (
            <p className="text-center text-sm text-neutral-500">
              No images yet. Enter a prompt above to generate your first.
            </p>
          ) : null}
        </section>
      </div>
    </main>
  );
}
