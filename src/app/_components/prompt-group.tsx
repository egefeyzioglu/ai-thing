"use client";

import Image from "next/image";

import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "src/components/ui/card";
import { Skeleton } from "src/components/ui/skeleton";
import type { RouterOutputs } from "src/trpc/react";

import { type ModelId, modelLabel } from "src/app/_components/models";

type PromptWithImages = RouterOutputs["prompt"]["list"][number];

type PromptGroupProps = {
  prompt: PromptWithImages;
  pendingModels: Set<ModelId>;
};

export function PromptGroup({ prompt, pendingModels }: PromptGroupProps) {
  const completedModels = new Set(prompt.images.map((i) => i.model));

  return (
    <li className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <p className="text-sm text-neutral-200">{prompt.text}</p>
        <p className="text-[10px] uppercase tracking-wide text-neutral-600">
          {new Date(prompt.createdAt).toLocaleString()}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {prompt.images.map((img) => (
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
                  alt={prompt.text}
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
              key={`pending-${prompt.id}-${m}`}
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
}
