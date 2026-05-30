"use client";

import { useUser } from "@clerk/nextjs";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "src/components/ui/alert-dialog";
import { calculateGenerationCredits } from "src/lib/credits";
import { notifyPromptDone } from "src/lib/notify";
import { isExpectedTRPCError } from "src/lib/trpc-errors";
import { useUploadThing } from "src/lib/uploadthing";
import { WORKSHOP_ACCEPTED_PROMPT_STORAGE_KEY } from "src/lib/workshop";
import { api } from "src/trpc/react";

import posthog from "posthog-js";

import { ImageGallery } from "./_components/image-gallery";
import type { PromptComposerHandle } from "./_components/prompt-composer";
import {
  Sidebar,
  type PromptModelSlug,
  type ResolutionOption,
} from "./_components/sidebar";
import { useActiveProject } from "./_hooks/use-active-project";
import { useLocalStorage } from "src/lib/localStorage";
import { useSessionStorage } from "src/lib/sessionStorage";

type PendingDelete =
  | { type: "referenceImage"; id: string }
  | { type: "prompt"; id: string }
  | { type: "image"; id: string };

const PUSH_PERMISSION_PROMPT_STORAGE_KEY = "ai-thing.pushPermissionPrompt";
const OPENAI_MODEL_SLUGS = new Set<PromptModelSlug>([
  "gpt-image-2",
  "gpt-5.4-mini",
]);
const GEMINI_MODEL_SLUGS = new Set<PromptModelSlug>([
  "gemini-2.5-flash-image",
  "gemini-3.1-flash-image-preview",
  "gemini-3-pro-image-preview",
]);

function hasDismissedPushPermissionPrompt() {
  try {
    return (
      sessionStorage.getItem(PUSH_PERMISSION_PROMPT_STORAGE_KEY) === "dismissed"
    );
  } catch {
    return true;
  }
}

function rememberPushPermissionPromptDismissal() {
  try {
    sessionStorage.setItem(PUSH_PERMISSION_PROMPT_STORAGE_KEY, "dismissed");
  } catch {
    /* ignore unavailable storage */
  }
}

function formatResetDate(date: Date | string | undefined) {
  if (!date) return "the next reset";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(date));
}

export default function Home() {
  const [referenceImagesOpen, setReferenceImagesOpen] = useState(false);
  const [archivedModelsOpen, setArchivedModelsOpen] = useState(false);
  const [selectedReferenceImages, setSelectedReferenceImages] = useState<
    string[]
  >([]);
  const [selectedModels, setSelectedModels] = useState<PromptModelSlug[]>([]);
  const [resolution, setResolution] = useState<ResolutionOption>("1K");
  const [aspect, setAspect] = useState("1:1");
  const [advanced, setAdvanced] = useSessionStorage(
    "imageGenerationAdvanced",
  );
  const [isMacOS, setIsMacOS] = useState<boolean | null>(null);
  const [runs, setRuns] = useState(1);
  const [pushPermissionDialogOpen, setPushPermissionDialogOpen] =
    useState(false);
  const [generateButtonLocked, setGenerateButtonLocked] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(
    null,
  );
  const [bypassMonthlyQuota, setBypassMonthlyQuota] =
    useLocalStorage("bypassMonthlyQuota");

  const generateButtonLockedRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const promptComposerRef = useRef<PromptComposerHandle>(null);
  const generateButtonTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  const unlockGenerateButton = () => {
    generateButtonLockedRef.current = false;
    if (generateButtonTimeoutRef.current !== null) {
      clearTimeout(generateButtonTimeoutRef.current);
      generateButtonTimeoutRef.current = null;
    }
    setGenerateButtonLocked(false);
  };

  useEffect(() => {
    return () => {
      if (generateButtonTimeoutRef.current !== null) {
        clearTimeout(generateButtonTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    try {
      const acceptedPrompt = sessionStorage.getItem(
        WORKSHOP_ACCEPTED_PROMPT_STORAGE_KEY,
      );
      if (acceptedPrompt) {
        promptComposerRef.current?.setValue(acceptedPrompt);
        sessionStorage.removeItem(WORKSHOP_ACCEPTED_PROMPT_STORAGE_KEY);
      }
    } catch (error) {
      console.error("Failed to read workshop suggested prompt", error);
    }
  }, []);

  useEffect(() => {
    const composer = promptComposerRef.current;
    if (!composer) return;
    return composer.subscribeTextChange(() => {
      if (generateButtonLockedRef.current) {
        unlockGenerateButton();
      }
    });
  }, []);

  const user = useUser();
  const canBypassLimits = user.user?.publicMetadata.canBypassLimits === true;
  const effectiveBypassMonthlyQuota = canBypassLimits && bypassMonthlyQuota;
  const utils = api.useUtils();

  const { data: referenceImages, isLoading: isLoadingRefImages } =
    api.referenceImage.getReferenceImages.useQuery();

  const { data: models, isLoading: isLoadingModels } =
    api.prompt.getModels.useQuery();

  const { data: projects, isLoading: isLoadingProjects } =
    api.project.list.useQuery();
  const usageQuery = api.usage.getCurrent.useQuery(undefined, {
    staleTime: 0,
  });
  const usage = usageQuery.data;
  const isLoadingUsage = usageQuery.isLoading;

  const {
    selectedProjectId,
    selectedProject,
    onSelectProject: handleSelectProject,
  } = useActiveProject(projects);

  useEffect(() => {
    unlockGenerateButton();
  }, [
    selectedModels,
    selectedReferenceImages,
    resolution,
    aspect,
    runs,
    selectedProjectId,
  ]);

  useEffect(() => {
    if (user.isLoaded && !canBypassLimits && bypassMonthlyQuota) {
      setBypassMonthlyQuota(false);
    }
  }, [
    bypassMonthlyQuota,
    canBypassLimits,
    setBypassMonthlyQuota,
    user.isLoaded,
  ]);

  const deleteRefImage = api.referenceImage.deleteReferenceImage.useMutation({
    onSuccess: () => {
      toast.success("Reference image deleted");
      void utils.referenceImage.getReferenceImages.invalidate();
    },
    onError: () => {
      toast.error("Failed to delete reference image");
    },
  });

  const createRefImage = api.referenceImage.createReferenceImage.useMutation({
    onSuccess: () => {
      void utils.referenceImage.getReferenceImages.invalidate();
    },
  });

  const promptsQuery = api.prompt.list.useQuery(
    { projectId: selectedProjectId ?? "" },
    { enabled: Boolean(selectedProjectId) },
  );
  const prompts = promptsQuery.data;

  const { startUpload } = useUploadThing("imageUploader");

  const createPrompt = api.prompt.createWithGenerations.useMutation();
  const runGeneration = api.image.runGeneration.useMutation();
  const deletePromptMutation = api.prompt.deletePrompt.useMutation({
    onSuccess: () => {
      toast.success("Generation deleted");
      void utils.prompt.list.invalidate();
    },
    onError: () => {
      toast.error("Failed to delete generation");
    },
  });
  const deleteImageMutation = api.image.deleteImage.useMutation({
    onSuccess: () => {
      toast.success("Image deleted");
      void utils.prompt.list.invalidate();
    },
    onError: () => {
      toast.error("Failed to delete image");
    },
  });
  const reuseAsReference =
    api.referenceImage.createReferenceImageFromGenerated.useMutation();

  const toggleSelectedModel = (slug: PromptModelSlug) => {
    if (selectedModels.includes(slug)) {
      setSelectedModels(selectedModels.filter((i) => i !== slug));
    } else {
      setSelectedModels([...selectedModels, slug]);
    }
  };

  const maybeShowPushPermissionDialog = () => {
    if (typeof window === "undefined") return;
    if (!("Notification" in window)) return;
    if (Notification.permission !== "default") return;
    if (hasDismissedPushPermissionPrompt()) return;

    setPushPermissionDialogOpen(true);
  };

  const handleAllowPushNotifications = () => {
    setPushPermissionDialogOpen(false);
    void Notification.requestPermission();
  };

  const handleDeclinePushNotifications = () => {
    rememberPushPermissionPromptDismissal();
    setPushPermissionDialogOpen(false);
  };

  const handleConfirmDelete = () => {
    if (!pendingDelete) return;

    if (pendingDelete.type === "referenceImage") {
      const id = pendingDelete.id;
      deleteRefImage.mutate(
        { id },
        {
          onSuccess: () => {
            setSelectedReferenceImages((prev) => prev.filter((e) => e !== id));
          },
        },
      );
    } else if (pendingDelete.type === "prompt") {
      deletePromptMutation.mutate({ id: pendingDelete.id });
    } else {
      deleteImageMutation.mutate({ id: pendingDelete.id });
    }

    setPendingDelete(null);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files?.length) return;
    const filesToUpload = Array.from(files);
    try {
      const res = await startUpload(filesToUpload);
      if (res?.length) {
        const created = await Promise.allSettled(
          res.map((uploaded, index) =>
            createRefImage.mutateAsync({
              url: uploaded.ufsUrl,
              mimeType: filesToUpload[index]?.type ?? undefined,
            }),
          ),
        );
        const createdReferenceIds = created
          .filter(
            (
              result,
            ): result is PromiseFulfilledResult<
              Awaited<ReturnType<typeof createRefImage.mutateAsync>>
            > => result.status === "fulfilled",
          )
          .map((result) => result.value?.id)
          .filter((id): id is string => typeof id === "string");
        const failedCount = created.filter(
          (result) => result.status === "rejected",
        ).length;

        if (createdReferenceIds.length > 0) {
          await utils.referenceImage.getReferenceImages.invalidate();
          setSelectedReferenceImages((prev) => [
            ...prev,
            ...createdReferenceIds.filter((id) => !prev.includes(id)),
          ]);
          setReferenceImagesOpen(true);
        }

        if (failedCount === 0) {
          posthog.capture("reference_image_uploaded", {
            count: res.length,
          });
          toast.success(
            res.length === 1
              ? "Reference image uploaded"
              : `${res.length} reference images uploaded`,
          );
        } else {
          toast.error(
            failedCount === 1
              ? "Failed to upload 1 reference image"
              : `Failed to upload ${failedCount} reference images`,
          );
        }
      } else {
        toast.error("Reference image upload failed");
      }
    } catch (error) {
      console.error("Failed to upload reference image", error);
      toast.error("Reference image upload failed");
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleGenerate = async () => {
    const trimmedPrompt = (promptComposerRef.current?.getValue() ?? "").trim();
    if (!trimmedPrompt || selectedModels.length === 0 || !selectedProjectId)
      return;
    if (generateButtonLockedRef.current) return;
    if (!effectiveBypassMonthlyQuota && usage?.isOverQuota) {
      toast.error(
        `Monthly credit limit reached. Credits reset on ${formatResetDate(usage.periodEnd)}.`,
      );
      return;
    }

    posthog.capture("image_generation_started", {
      models: selectedModels,
      model_count: selectedModels.length,
      resolution,
      aspect_ratio: aspect,
      runs,
      total_generations: selectedModels.length * runs,
      has_reference_images: selectedReferenceImages.length > 0,
      reference_image_count: selectedReferenceImages.length,
      prompt_length: trimmedPrompt.length,
    });

    maybeShowPushPermissionDialog();
    generateButtonLockedRef.current = true;
    setGenerateButtonLocked(true);
    let result;

    try {
      result = await createPrompt.mutateAsync({
        projectId: selectedProjectId,
        text: trimmedPrompt,
        models: selectedModels,
        repeatCount: runs,
        referenceImages:
          selectedReferenceImages.length > 0
            ? selectedReferenceImages
            : undefined,
        resolution,
        aspectRatio: aspect,
        quality: advanced.quality,
        background: advanced.background,
        negativePrompt: advanced.negativePrompt || undefined,
        seed: advanced.seed || undefined,
        thinking: advanced.thinking,
        requestQuotaBypass: effectiveBypassMonthlyQuota,
      });
    } catch (reason) {
      if (isExpectedTRPCError(reason)) {
        toast.error(
          `Monthly credit limit reached. Credits reset on ${formatResetDate(usage?.periodEnd)}.`,
        );
      } else {
        toast.error("Failed to start generation");
        console.error(
          `Error when generating prompt with text "${trimmedPrompt}"`,
          reason,
        );
      }
      return;
    } finally {
      utils.prompt.list.invalidate().catch((reason) => {
        console.error(
          "Failed to invalidate prompt.list, user will have to refresh.",
          reason,
        );
      });
      usageQuery.refetch().catch((reason) => {
        console.error("Failed to refetch usage query.", reason);
      });
      generateButtonTimeoutRef.current = setTimeout(() => {
        generateButtonLockedRef.current = false;
        generateButtonTimeoutRef.current = null;
        setGenerateButtonLocked(false);
      }, 3000);
    }

    let generationResults;
    try {
      generationResults = await Promise.allSettled(
        result.images.map((img) =>
          runGeneration.mutateAsync(
            {
              imageId: img.id,
              requestQuotaBypass: effectiveBypassMonthlyQuota,
            },
            {
              onSuccess: () => {
                utils.prompt.list.invalidate().catch((reason) => {
                  console.error(
                    "Failed to invalidate images query, user will have to refresh.",
                    reason,
                  );
                });
                usageQuery.refetch().catch((reason) => {
                  console.error("Failed to refetch usage query.", reason);
                });
              },
            },
          ),
        ),
      );
      const failedGenerationCount = generationResults.filter(
        (generationResult) =>
          generationResult.status === "rejected" ||
          generationResult.value.status === "failed",
      ).length;
      posthog.capture("image_generation_completed", {
        total: generationResults.length,
        succeeded: generationResults.length - failedGenerationCount,
        failed: failedGenerationCount,
        models: selectedModels,
      });
      notifyPromptDone({
        failureState:
          failedGenerationCount === 0
            ? "none"
            : failedGenerationCount === generationResults.length
              ? "all"
              : "some",
      });
    } catch {
      // runGeneration failed
      console.error(
        `Failed to generate one or more images for prompt: "${trimmedPrompt}"`,
      );
    } finally {
      utils.prompt.list.invalidate().catch((reason) => {
        console.error(
          "Failed to invalidate images query. Some images may be stuck generating until a refresh",
          reason,
        );
      });
      usageQuery.refetch().catch((reason) => {
        console.error("Failed to refetch usage query.", reason);
      });
    }
  };

  const handleReuseAsReference = async (imageId: string) => {
    let result;
    try {
      result = await reuseAsReference.mutateAsync({ imageId });
    } catch (err) {
      console.error("Failed to reuse image as reference", err);
      toast.error("Failed to reuse image as reference");
      return;
    }
    await utils.referenceImage.getReferenceImages.invalidate();
    setSelectedReferenceImages((prev) =>
      prev.includes(result.referenceImageRow.id)
        ? prev
        : [...prev, result.referenceImageRow.id],
    );
    posthog.capture("generated_image_reused_as_reference", { image_id: imageId });
    toast.success("Image reused as reference");
    setReferenceImagesOpen(true);
  };

  const handleRetryImage = (imageId: string) => {
    console.log("[retry] clicked, imageId:", imageId);
    if (!selectedProjectId) return;
    if (!effectiveBypassMonthlyQuota && usage?.isOverQuota) {
      toast.error(
        `Monthly credit limit reached. Credits reset on ${formatResetDate(usage.periodEnd)}.`,
      );
      return;
    }

    posthog.capture("image_retry_started", { image_id: imageId });
    toast.info("Retry generation started");
    utils.prompt.list.setData({ projectId: selectedProjectId }, (old) =>
      old?.map((p) => ({
        ...p,
        images: p.images.map((img) =>
          img.id === imageId
            ? {
                ...img,
                status: "pending" as const,
                error: null,
              }
            : img,
        ),
      })),
    );
    console.log("[retry] optimistic update applied, calling runGeneration");
    runGeneration.mutate(
      { imageId, retry: true, requestQuotaBypass: effectiveBypassMonthlyQuota },
      {
        onSuccess: (data) => console.log("[retry] succeeded, result:", data),
        onError: (err) => {
          if (isExpectedTRPCError(err)) {
            toast.error(
              `Monthly credit limit reached. Credits reset on ${formatResetDate(usage?.periodEnd)}.`,
            );
          } else {
            console.error("[retry] mutation error:", err);
          }
        },
        onSettled: (data, error) => {
          console.log("[retry] settled, invalidating list");
          void utils.prompt.list.invalidate();
          void usageQuery.refetch();
          notifyPromptDone({
            failureState: !!error || data?.status === "failed" ? "all" : "none",
          });
        },
      },
    );
  };

  useEffect(() => {
    setIsMacOS(navigator?.userAgent.toLowerCase().includes("mac"));
  }, []);

  const [hasInitializedModels, setHasInitializedModels] = useState(false);

  useEffect(() => {
    if (models && !hasInitializedModels) {
      setSelectedModels(
        models.filter((model) => !model.isArchived).map((model) => model.slug),
      );
      setHasInitializedModels(true);
    }
  }, [models, hasInitializedModels]);

  const totalGenerations = runs * selectedModels.length;
  const currentRequestCost = selectedModels.reduce(
    (total, model) =>
      total +
      runs *
        calculateGenerationCredits({
          model,
          resolution,
          aspectRatio: aspect,
        }),
    0,
  );
  const activeModels = models?.filter((model) => !model.isArchived) ?? [];
  const archivedModels = models?.filter((model) => model.isArchived) ?? [];
  const hasOnlyOpenAIModelsSelected =
    selectedModels.length > 0 &&
    selectedModels.every((model) => OPENAI_MODEL_SLUGS.has(model));
  const hasOpenAIModelSelected = selectedModels.some((model) =>
    OPENAI_MODEL_SLUGS.has(model),
  );
  const hasGeminiModelSelected = selectedModels.some((model) =>
    GEMINI_MODEL_SLUGS.has(model),
  );
  const isGalleryLoading =
    isLoadingProjects || !selectedProjectId || promptsQuery.isLoading;
  const galleryErrorMessage =
    promptsQuery.error && promptsQuery.error.data?.code !== "NOT_FOUND"
      ? promptsQuery.error.message
      : undefined;

  useEffect(() => {
    if (hasOnlyOpenAIModelsSelected && resolution === "512") {
      setResolution("1K");
    }
  }, [hasOnlyOpenAIModelsSelected, resolution]);

  useEffect(() => {
    if (promptsQuery.error?.data?.code !== "NOT_FOUND" || !projects?.length) {
      return;
    }

    const fallbackProjectId =
      projects.find((project) => project.isDefault)?.id ?? projects[0]?.id;
    if (fallbackProjectId && fallbackProjectId !== selectedProjectId) {
      handleSelectProject(fallbackProjectId);
    }
  }, [
    handleSelectProject,
    projects,
    promptsQuery.error?.data?.code,
    selectedProjectId,
  ]);

  return (
    <main className="flex w-full grow flex-row text-gray-200">
      <AlertDialog
        open={pushPermissionDialogOpen}
        onOpenChange={setPushPermissionDialogOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Notify when images are ready?</AlertDialogTitle>
            <AlertDialogDescription>
              If this window is not focused when generation finishes, we can
              send a browser notification.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={handleDeclinePushNotifications}>
              Not now
            </AlertDialogCancel>
            <AlertDialogAction onClick={handleAllowPushNotifications}>
              Allow notifications
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this item?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="cursor-pointer">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className="cursor-pointer"
              onClick={handleConfirmDelete}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <Sidebar
        referenceImagesOpen={referenceImagesOpen}
        onReferenceImagesOpenChange={setReferenceImagesOpen}
        archivedModelsOpen={archivedModelsOpen}
        onArchivedModelsOpenChange={setArchivedModelsOpen}
        selectedReferenceImages={selectedReferenceImages}
        onSelectedReferenceImagesChange={setSelectedReferenceImages}
        selectedModels={selectedModels}
        onToggleSelectedModel={toggleSelectedModel}
        resolution={resolution}
        onResolutionChange={setResolution}
        aspect={aspect}
        onAspectChange={setAspect}
        advancedOpen={advanced.advancedOpen}
        onAdvancedOpenChange={(open) =>
          setAdvanced((s) => ({ ...s, advancedOpen: open }))
        }
        quality={advanced.quality}
        onQualityChange={(value) =>
          setAdvanced((s) => ({ ...s, quality: value }))
        }
        background={advanced.background}
        onBackgroundChange={(value) =>
          setAdvanced((s) => ({ ...s, background: value }))
        }
        negativePrompt={advanced.negativePrompt}
        onNegativePromptChange={(value) =>
          setAdvanced((s) => ({ ...s, negativePrompt: value }))
        }
        seed={advanced.seed}
        onSeedChange={(value) =>
          setAdvanced((s) => ({ ...s, seed: value }))
        }
        thinking={advanced.thinking}
        onThinkingChange={(value) =>
          setAdvanced((s) => ({ ...s, thinking: value }))
        }
        hasOpenAIModelSelected={hasOpenAIModelSelected}
        hasGeminiModelSelected={hasGeminiModelSelected}
        isMacOS={isMacOS}
        promptComposerRef={promptComposerRef}
        hasSelectedProject={Boolean(selectedProjectId)}
        runs={runs}
        onRunsChange={setRuns}
        generateButtonLocked={generateButtonLocked}
        onGenerate={handleGenerate}
        fileInputRef={fileInputRef}
        onFileUpload={handleFileUpload}
        onDeleteReferenceImage={(id) =>
          setPendingDelete({ type: "referenceImage", id })
        }
        referenceImages={referenceImages}
        isLoadingRefImages={isLoadingRefImages}
        isLoadingModels={isLoadingModels}
        activeModels={activeModels}
        archivedModels={archivedModels}
        hasOnlyOpenAIModelsSelected={hasOnlyOpenAIModelsSelected}
        totalGenerations={totalGenerations}
        userFullName={user.user?.fullName}
        usage={usage}
        isLoadingUsage={isLoadingUsage}
        currentRequestCost={currentRequestCost}
        canBypassLimits={canBypassLimits}
        bypassMonthlyQuota={effectiveBypassMonthlyQuota}
        onBypassMonthlyQuotaChange={setBypassMonthlyQuota}
      />
      <ImageGallery
        projects={projects}
        project={selectedProject}
        selectedProjectId={selectedProjectId}
        isLoadingProjects={isLoadingProjects}
        onSelectProject={handleSelectProject}
        prompts={prompts}
        errorMessage={galleryErrorMessage}
        isLoading={isGalleryLoading}
        models={models}
        referenceImages={referenceImages}
        onDeletePrompt={(id) => setPendingDelete({ type: "prompt", id })}
        onDeleteImage={(id) => setPendingDelete({ type: "image", id })}
        onReuseAsReference={handleReuseAsReference}
        onRetryImage={handleRetryImage}
      />
    </main>
  );
}
