"use client";

import { useUser } from "@clerk/nextjs";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
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
import {
  isExpectedTRPCError,
  isGenerationCancelledTRPCError,
} from "src/lib/trpc-errors";
import { useUploadThing } from "src/lib/uploadthing";
import { WORKSHOP_ACCEPTED_PROMPT_STORAGE_KEY } from "src/lib/workshop";
import { api } from "src/trpc/react";

import posthog from "posthog-js";

import { MediaGallery } from "./_components/media-gallery";
import type { PromptComposerHandle } from "./_components/prompt-composer";
import {
  Sidebar,
  MAX_VIDEO_REFERENCE_IMAGES,
  type PromptModelSlug,
  type ResolutionOption,
  type VideoDuration,
  type VideoResolution,
} from "./_components/sidebar";
import { useActiveProject } from "./_hooks/use-active-project";
import { useLocalStorage } from "src/lib/localStorage";
import {
  setSessionStorage,
  useSessionStorage,
  type SessionStorageValue,
} from "src/lib/sessionStorage";

type PendingDelete =
  | { type: "referenceImage"; id: string }
  | { type: "prompt"; id: string }
  | { type: "media"; id: string };

type VideoReferenceRole = "first" | "last" | "refimg";
type GenerationDetails = SessionStorageValue<"generationDetails">;

function normalizeVideoRoles(
  prev: Record<string, VideoReferenceRole>,
  selected: string[],
): Record<string, VideoReferenceRole> {
  const next: Record<string, VideoReferenceRole> = {};
  let firstTaken = false;
  let lastTaken = false;
  let hasRefimg = false;
  for (const id of selected) {
    const existing = prev[id];
    if (existing === "first" && !firstTaken) {
      next[id] = "first";
      firstTaken = true;
    } else if (existing === "last" && !lastTaken) {
      next[id] = "last";
      lastTaken = true;
    } else if (existing === "refimg") {
      next[id] = "refimg";
      hasRefimg = true;
    }
  }
  // Decide refimg-only mode upfront: either prev already had refimgs, or
  // there are more unassigned refs than free frame slots (which would
  // otherwise force some defaults into the refimg branch and produce an
  // illegal {first, last, refimg} mix). When so, demote any preserved
  // frames so the second pass yields a clean refimg-only set.
  const unclaimedCount = selected.filter((id) => !next[id]).length;
  const freeFrameSlots = (firstTaken ? 0 : 1) + (lastTaken ? 0 : 1);
  if (hasRefimg || unclaimedCount > freeFrameSlots) {
    hasRefimg = true;
    for (const id of selected) {
      if (next[id] === "first" || next[id] === "last") {
        next[id] = "refimg";
      }
    }
    firstTaken = false;
    lastTaken = false;
  }
  for (const id of selected) {
    if (next[id]) continue;
    // Stay in refimg-only mode if the user has any refimgs; otherwise
    // fill the missing frame slot (first then last) so the second image
    // in image-to-video defaults to the end frame, not an illegal mix.
    if (hasRefimg) {
      next[id] = "refimg";
    } else if (!firstTaken) {
      next[id] = "first";
      firstTaken = true;
    } else if (!lastTaken) {
      next[id] = "last";
      lastTaken = true;
    } else {
      next[id] = "refimg";
    }
  }
  // Backfill: a solitary "last" with no "first" (e.g., user unselected the
  // first frame) becomes the new first frame, since last_frame alone would
  // serialize as last-frame-only image-to-video.
  if (!firstTaken && lastTaken) {
    const loneLastId = selected.find((id) => next[id] === "last");
    if (loneLastId) next[loneLastId] = "first";
  }
  return next;
}

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
const SEEDANCE_FAST_SLUGS = new Set<PromptModelSlug>([
  "dreamina-seedance-2-0-fast",
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
  const [videoReferenceRoles, setVideoReferenceRoles] = useState<
    Record<string, "first" | "last" | "refimg">
  >({});
  const [generationDetails, setGenerationDetails, generationDetailsLoaded] =
    useSessionStorage("generationDetails");
  const selectedModels = generationDetails.selectedModels as PromptModelSlug[];
  const mode = generationDetails.mode;
  const resolution = generationDetails.resolution;
  const videoResolution = generationDetails.videoResolution;
  const duration = generationDetails.duration;
  const aspect = generationDetails.aspect;
  const runs = generationDetails.runs;
  const [advanced, setAdvanced] = useSessionStorage("imageGenerationAdvanced");
  const [videoAdvanced, setVideoAdvanced] = useSessionStorage(
    "videoGenerationAdvanced",
  );
  const [isMacOS, setIsMacOS] = useState<boolean | null>(null);
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

  const updateGenerationDetails = useCallback(
    (
      update:
        | Partial<GenerationDetails>
        | ((prev: GenerationDetails) => Partial<GenerationDetails>),
    ) => {
      setGenerationDetails((prev) => ({
        ...prev,
        ...(typeof update === "function" ? update(prev) : update),
      }));
    },
    [setGenerationDetails],
  );

  const setSelectedModels = useCallback(
    (
      update:
        | PromptModelSlug[]
        | ((prev: PromptModelSlug[]) => PromptModelSlug[]),
    ) => {
      updateGenerationDetails((prev) => ({
        selectedModels:
          typeof update === "function"
            ? update(prev.selectedModels as PromptModelSlug[])
            : update,
        modelsInitialized: true,
      }));
    },
    [updateGenerationDetails],
  );
  const setMode = useCallback(
    (value: GenerationDetails["mode"]) =>
      updateGenerationDetails({ mode: value }),
    [updateGenerationDetails],
  );
  const setResolution = useCallback(
    (value: ResolutionOption) => updateGenerationDetails({ resolution: value }),
    [updateGenerationDetails],
  );
  const setVideoResolution = useCallback(
    (value: VideoResolution) =>
      updateGenerationDetails({ videoResolution: value }),
    [updateGenerationDetails],
  );
  const setDuration = useCallback(
    (value: VideoDuration) => updateGenerationDetails({ duration: value }),
    [updateGenerationDetails],
  );
  const setAspect = useCallback(
    (value: string) => updateGenerationDetails({ aspect: value }),
    [updateGenerationDetails],
  );
  const setRuns = useCallback(
    (value: number) => updateGenerationDetails({ runs: value }),
    [updateGenerationDetails],
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
        setSessionStorage("promptText", acceptedPrompt);
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
    mode,
    resolution,
    videoResolution,
    duration,
    aspect,
    runs,
    selectedProjectId,
  ]);

  useEffect(() => {
    setVideoReferenceRoles((prev) =>
      normalizeVideoRoles(prev, selectedReferenceImages),
    );
  }, [selectedReferenceImages, mode]);

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
  const runGeneration = api.media.runGeneration.useMutation();
  const deletePromptMutation = api.prompt.deletePrompt.useMutation({
    onSuccess: () => {
      toast.success("Generation deleted");
      void utils.prompt.list.invalidate();
    },
    onError: () => {
      toast.error("Failed to delete generation");
    },
  });
  const movePromptMutation = api.prompt.movePrompt.useMutation({
    onSuccess: () => {
      toast.success("Generation moved");
      void utils.prompt.list.invalidate();
    },
    onError: () => {
      toast.error("Failed to move generation");
    },
  });
  const deleteMediaMutation = api.media.deleteMedia.useMutation({
    onSuccess: () => {
      toast.success("Deleted");
      void utils.prompt.list.invalidate();
    },
    onError: () => {
      toast.error("Failed to delete");
    },
  });
  const reuseAsReference =
    api.referenceImage.createReferenceImageFromGenerated.useMutation();
  const galleryActionRef = useRef({
    effectiveBypassMonthlyQuota,
    movePromptMutation,
    reuseAsReference,
    runGeneration,
    selectedProjectId,
    usage,
    usageQuery,
    utils,
  });
  useLayoutEffect(() => {
    galleryActionRef.current = {
      effectiveBypassMonthlyQuota,
      movePromptMutation,
      reuseAsReference,
      runGeneration,
      selectedProjectId,
      usage,
      usageQuery,
      utils,
    };
  });

  const toggleSelectedModel = (slug: PromptModelSlug) => {
    setSelectedModels((prev) =>
      prev.includes(slug) ? prev.filter((i) => i !== slug) : [...prev, slug],
    );
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
      deleteMediaMutation.mutate({ id: pendingDelete.id });
    }

    setPendingDelete(null);
  };

  const handleDeletePrompt = useCallback((id: string) => {
    setPendingDelete({ type: "prompt", id });
  }, []);

  const handleMovePrompt = useCallback(
    (id: string, projectId: string) => {
      galleryActionRef.current.movePromptMutation.mutate({ id, projectId });
    },
    [],
  );

  const handleDeleteMedia = useCallback((id: string) => {
    setPendingDelete({ type: "media", id });
  }, []);

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
          setSelectedReferenceImages((prev) => {
            const dedupedNew = createdReferenceIds.filter(
              (id) => !prev.includes(id),
            );
            if (mode !== "video") {
              return [...prev, ...dedupedNew];
            }
            const remaining = Math.max(
              0,
              MAX_VIDEO_REFERENCE_IMAGES - prev.length,
            );
            const accepted = dedupedNew.slice(0, remaining);
            const rejected = dedupedNew.length - accepted.length;
            if (rejected > 0) {
              toast.error(
                rejected === 1
                  ? `1 uploaded image not selected — video accepts at most ${MAX_VIDEO_REFERENCE_IMAGES} reference images`
                  : `${rejected} uploaded images not selected — video accepts at most ${MAX_VIDEO_REFERENCE_IMAGES} reference images`,
              );
            }
            if (accepted.length === 0) return prev;
            const hasFirst = prev.some(
              (sid) => videoReferenceRoles[sid] === "first",
            );
            const hasLast = prev.some(
              (sid) => videoReferenceRoles[sid] === "last",
            );
            if (hasFirst && hasLast) {
              setVideoReferenceRoles((prevRoles) => {
                const nextRoles = { ...prevRoles };
                for (const sid of prev) {
                  if (
                    nextRoles[sid] === "first" ||
                    nextRoles[sid] === "last"
                  ) {
                    nextRoles[sid] = "refimg";
                  }
                }
                return nextRoles;
              });
              toast.info(
                "First and last frames are now reference images so you can add more.",
              );
            }
            return [...prev, ...accepted];
          });
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
        mode,
        models: selectedModels,
        repeatCount: runs,
        referenceImages:
          selectedReferenceImages.length > 0
            ? mode === "video"
              ? selectedReferenceImages.map((id) => ({
                  id,
                  role: videoReferenceRoles[id] ?? "refimg",
                }))
              : selectedReferenceImages
            : undefined,
        resolution: mode === "image" ? resolution : undefined,
        videoResolution: mode === "video" ? videoResolution : undefined,
        duration: mode === "video" ? duration : undefined,
        aspectRatio: aspect,
        quality: mode === "image" ? advanced.quality : undefined,
        background: mode === "image" ? advanced.background : undefined,
        negativePrompt:
          mode === "image" ? advanced.negativePrompt || undefined : undefined,
        seed: mode === "image" ? advanced.seed || undefined : undefined,
        thinking: mode === "image" ? advanced.thinking : undefined,
        motion: mode === "video" ? videoAdvanced.motion : undefined,
        cameraFixed: mode === "video" ? videoAdvanced.cameraFixed : undefined,
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
        result.media.map((img) =>
          runGeneration.mutateAsync(
            {
              mediaId: img.id,
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
      const completedGenerationResults = generationResults.filter(
        (generationResult) =>
          generationResult.status === "fulfilled" ||
          !isGenerationCancelledTRPCError(generationResult.reason),
      );
      if (completedGenerationResults.length === 0) return;
      const failedGenerationCount = completedGenerationResults.filter(
        (generationResult) =>
          generationResult.status === "rejected" ||
          generationResult.value.status === "failed",
      ).length;
      posthog.capture("image_generation_completed", {
        total: completedGenerationResults.length,
        succeeded: completedGenerationResults.length - failedGenerationCount,
        failed: failedGenerationCount,
        models: selectedModels,
      });
      notifyPromptDone({
        failureState:
          failedGenerationCount === 0
            ? "none"
            : failedGenerationCount === completedGenerationResults.length
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
  const handleGenerateRef = useRef(handleGenerate);
  useLayoutEffect(() => {
    handleGenerateRef.current = handleGenerate;
  });
  const handleGenerateStable = useCallback(() => {
    void handleGenerateRef.current();
  }, []);

  const handleReuseAsReference = useCallback(
    async (imageId: string) => {
      const { reuseAsReference, utils } = galleryActionRef.current;
      let result;
      try {
        result = await reuseAsReference.mutateAsync({ mediaId: imageId });
      } catch (err) {
        console.error("Failed to reuse image as reference", err);
        toast.error("Failed to reuse image as reference");
        return;
      }
      try {
        await utils.referenceImage.getReferenceImages.invalidate();
      } catch (err) {
        console.error("Failed to refresh reference images after reuse", err);
      }
      setSelectedReferenceImages((prev) =>
        prev.includes(result.referenceImageRow.id)
          ? prev
          : [...prev, result.referenceImageRow.id],
      );
      posthog.capture("generated_image_reused_as_reference", {
        image_id: imageId,
      });
      toast.success("Image reused as reference");
      setReferenceImagesOpen(true);
    },
    [],
  );

  const handleRetryImage = useCallback(
    (imageId: string) => {
      const {
        effectiveBypassMonthlyQuota,
        runGeneration,
        selectedProjectId,
        usage,
        usageQuery,
        utils,
      } = galleryActionRef.current;
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
          media: p.media.map((img) =>
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
        {
          mediaId: imageId,
          retry: true,
          requestQuotaBypass: effectiveBypassMonthlyQuota,
        },
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
              failureState:
                !!error || data?.status === "failed" ? "all" : "none",
            });
          },
        },
      );
    },
    [],
  );

  useEffect(() => {
    setIsMacOS(navigator?.userAgent.toLowerCase().includes("mac"));
  }, []);

  const lastInitializedModeRef = useRef<typeof mode | null>(null);

  useEffect(() => {
    if (!generationDetailsLoaded) return;
    if (!models) return;
    if (lastInitializedModeRef.current === mode) return;
    lastInitializedModeRef.current = mode;
    const availableModelSlugs = new Set(
      models.filter((model) => model.kind === mode).map((model) => model.slug),
    );
    const restoredModels = selectedModels.filter((slug) =>
      availableModelSlugs.has(slug),
    );
    const defaultModels = models
      .filter((model) => !model.isArchived && model.kind === mode)
      .map((model) => model.slug);
    if (generationDetails.modelsInitialized) {
      if (selectedModels.length > 0 && restoredModels.length === 0) {
        setSelectedModels(defaultModels);
        return;
      }
      if (restoredModels.length !== selectedModels.length) {
        setSelectedModels(restoredModels);
      }
      return;
    }
    setSelectedModels(defaultModels);
  }, [
    generationDetailsLoaded,
    generationDetails.modelsInitialized,
    mode,
    models,
    selectedModels,
    setSelectedModels,
  ]);

  const totalGenerations = runs * selectedModels.length;
  const currentRequestCost = selectedModels.reduce(
    (total, model) =>
      total +
      runs *
        calculateGenerationCredits({
          model,
          resolution,
          aspectRatio: aspect,
          videoResolution,
          duration,
        }),
    0,
  );
  const activeModels =
    models?.filter((model) => !model.isArchived && model.kind === mode) ?? [];
  const archivedModels =
    models?.filter((model) => model.isArchived && model.kind === mode) ?? [];
  const hasOnlyOpenAIModelsSelected =
    selectedModels.length > 0 &&
    selectedModels.every((model) => OPENAI_MODEL_SLUGS.has(model));
  const hasOpenAIModelSelected = selectedModels.some((model) =>
    OPENAI_MODEL_SLUGS.has(model),
  );
  const hasGeminiModelSelected = selectedModels.some((model) =>
    GEMINI_MODEL_SLUGS.has(model),
  );
  const hasOnlySeedanceFastSelected =
    mode === "video" &&
    selectedModels.length > 0 &&
    selectedModels.every((model) => SEEDANCE_FAST_SLUGS.has(model));
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
  }, [hasOnlyOpenAIModelsSelected, resolution, setResolution]);

  useEffect(() => {
    if (hasOnlySeedanceFastSelected && videoResolution === "1080p") {
      setVideoResolution("720p");
    }
  }, [hasOnlySeedanceFastSelected, setVideoResolution, videoResolution]);

  useEffect(() => {
    const IMAGE_ASPECTS = new Set(["1:1", "4:3", "3:4", "16:9", "9:16"]);
    if (mode === "image" && !IMAGE_ASPECTS.has(aspect)) {
      setAspect("1:1");
    }
  }, [aspect, mode, setAspect]);

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
        videoReferenceRoles={videoReferenceRoles}
        onVideoReferenceRolesChange={setVideoReferenceRoles}
        selectedModels={selectedModels}
        onToggleSelectedModel={toggleSelectedModel}
        mode={mode}
        onModeChange={setMode}
        resolution={resolution}
        onResolutionChange={setResolution}
        videoResolution={videoResolution}
        onVideoResolutionChange={setVideoResolution}
        duration={duration}
        onDurationChange={setDuration}
        motion={videoAdvanced.motion}
        onMotionChange={(value) =>
          setVideoAdvanced((s) => ({ ...s, motion: value }))
        }
        cameraFixed={videoAdvanced.cameraFixed}
        onCameraFixedChange={(value) =>
          setVideoAdvanced((s) => ({ ...s, cameraFixed: value }))
        }
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
        hasOnlySeedanceFastSelected={hasOnlySeedanceFastSelected}
        isMacOS={isMacOS}
        promptComposerRef={promptComposerRef}
        hasSelectedProject={Boolean(selectedProjectId)}
        runs={runs}
        onRunsChange={setRuns}
        generateButtonLocked={generateButtonLocked}
        onGenerate={handleGenerateStable}
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
      <MediaGallery
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
        onDeletePrompt={handleDeletePrompt}
        onMovePrompt={handleMovePrompt}
        onDeleteMedia={handleDeleteMedia}
        onReuseAsReference={handleReuseAsReference}
        onRetryMedia={handleRetryImage}
      />
    </main>
  );
}
