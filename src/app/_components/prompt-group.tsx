"use client";

import Image from "next/image";

import { Button } from "src/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "src/components/ui/card";
import { Skeleton } from "src/components/ui/skeleton";
import { api, type RouterOutputs } from "src/trpc/react";

import { modelLabel } from "src/app/_components/models";

type PromptWithImages = RouterOutputs["prompt"]["list"][number];
type ImageRow = PromptWithImages["images"][number];

type PromptGroupProps = {
  prompt: PromptWithImages;
};

export function PromptGroup({ prompt }: PromptGroupProps) {
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
          <ImageCard key={img.id} prompt={prompt} image={img} />
        ))}
      </div>
    </li>
  );
}

function ImageCard({
  prompt,
  image,
}: {
  prompt: PromptWithImages;
  image: ImageRow;
}) {
  const utils = api.useUtils();
  const retry = api.image.runGeneration.useMutation({
    onSettled: () => {
      void utils.prompt.list.invalidate();
    },
  });

  const handleRetry = () => {
    retry.mutate({ imageId: image.id, retry: true });
  };

  // While a retry is in flight, the row may still read as `failed` until the
  // server-side update lands and the list query refetches. Treat that window
  // as pending in the UI so the user gets immediate feedback.
  const displayStatus =
    retry.isPending && image.status === "failed" ? "pending" : image.status;

  return (
    <Card className="overflow-hidden border-neutral-800 bg-neutral-900 py-0 text-neutral-100">
      <CardHeader className="px-4 pt-4">
        <CardTitle className="text-sm font-medium text-neutral-200">
          {modelLabel(image.model)}
        </CardTitle>
      </CardHeader>
      <CardContent className="px-0 pb-0">
        {displayStatus === "succeeded" && image.url ? (
          <div className="relative aspect-square w-full">
            <Image
              src={image.url}
              alt={prompt.text}
              fill
              sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
              className="object-cover"
              unoptimized
            />
          </div>
        ) : displayStatus === "failed" ? (
          <div className="flex aspect-square w-full flex-col items-center justify-center gap-3 bg-neutral-950 px-4 text-center">
            <p className="text-xs text-red-400">
              {image.error ?? "Generation failed"}
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={handleRetry}
              disabled={retry.isPending}
            >
              Retry
            </Button>
          </div>
        ) : (
          <Skeleton className="aspect-square w-full rounded-none" />
        )}
      </CardContent>
      <CardFooter className="px-4 py-3">
        <p className="text-[10px] uppercase tracking-wide text-neutral-600">
          {displayStatus === "pending"
            ? "Generating…"
            : displayStatus === "failed"
              ? "Failed"
              : new Date(image.createdAt).toLocaleString()}
        </p>
      </CardFooter>
    </Card>
  );
}
