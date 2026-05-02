"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";

import { api } from "src/trpc/react";

import { Gallery } from "src/app/_components/gallery";
import { type GenerateOptions } from "src/app/_components/models";
import { Sidebar } from "src/app/_components/sidebar";
import { notifyPromptDone } from "src/lib/notify";

export function Workspace() {
  const router = useRouter();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Lifted state so the Gallery can push a reference image selection into the
  // Sidebar (e.g. "Use as reference" on a generated image).
  const [selectedReferenceImages, setSelectedReferenceImages] = useState<
    string[]
  >([]);
  const [referenceImagesOpen, setReferenceImagesOpen] = useState(false);

  const utils = api.useUtils();
  const createWithGenerations = api.prompt.createWithGenerations.useMutation();
  const runGeneration = api.image.runGeneration.useMutation();

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  };

  const handleGenerate = async ({
    prompt,
    models,
    repeatCount,
    referenceImages,
  }: GenerateOptions) => {
    let result;
    try {
      result = await createWithGenerations.mutateAsync({
        text: prompt,
        models: [...models],
        repeatCount,
        referenceImages: referenceImages,
      });
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : "Failed to create prompt",
      );
      return;
    }
    await utils.prompt.list.invalidate();

    // Fire each generation in parallel; the server persists success/failure
    // onto the image row, so we just need to invalidate to pick it up.
    await Promise.all(
      result.images.map((img) =>
        runGeneration
          .mutateAsync({ imageId: img.id })
          .catch((err: unknown) => {
            // Network/transport failure (the server-side handler converts
            // generation errors into a `failed` row instead of throwing).
            setErrorMessage(err instanceof Error ? err.message : String(err));
          })
          .finally(() => {
            void utils.prompt.list.invalidate();
          }),
      ),
    );

    notifyPromptDone();
  };

  /** Called from Gallery when a generated image is added as a reference. */
  const handleUseAsReference = useCallback(
    (referenceImageId: string) => {
      setSelectedReferenceImages((prev) =>
        prev.includes(referenceImageId) ? prev : [...prev, referenceImageId],
      );
      setReferenceImagesOpen(true);
    },
    [],
  );

  return (
    <main className="flex min-h-screen bg-neutral-950 text-neutral-100">
      <Sidebar
        onSubmit={handleGenerate}
        onLogout={handleLogout}
        errorMessage={errorMessage}
        setErrorMessage={setErrorMessage}
        selectedReferenceImages={selectedReferenceImages}
        setSelectedReferenceImages={setSelectedReferenceImages}
        referenceImagesOpen={referenceImagesOpen}
        setReferenceImagesOpen={setReferenceImagesOpen}
      />
      <Gallery onUseAsReference={handleUseAsReference} />
    </main>
  );
}
