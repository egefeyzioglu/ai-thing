"use client";

import { Label } from "src/components/ui/label";
import { Field, FieldLabel } from "src/components/ui/field";
import { Textarea } from "src/components/ui/textarea";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "src/components/ui/collapsible";
import { Checkbox } from "src/components/ui/checkbox";
import { Skeleton } from "src/components/ui/skeleton";
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

import { useUser, UserButton } from "@clerk/nextjs";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";

import {
  ChevronUp,
  ChevronDown,
  Trash2,
  Upload,
  AlertTriangle,
} from "lucide-react";
import clsx from "clsx";
import { toast } from "sonner";

import { api, type RouterInputs } from "src/trpc/react";
import { useUploadThing } from "src/lib/uploadthing";
import { notifyPromptDone } from "src/lib/notify";

// import { SUPPORTED_MODELS } from "src/server/api/routers/prompt";
import PromptGroup from "./_components/prompt-group";
import { ProjectSwitcher } from "./_components/project-switcher";

type PromptModelSlug =
  RouterInputs["prompt"]["createWithGenerations"]["models"][number];
type ResolutionOption = "512" | "1K" | "2K" | "4K";

type PendingDelete =
  | { type: "referenceImage"; id: string }
  | { type: "prompt"; id: string }
  | { type: "image"; id: string };

const PUSH_PERMISSION_PROMPT_STORAGE_KEY = "ai-thing.pushPermissionPrompt";
const ACTIVE_PROJECT_STORAGE_KEY = "ai-thing.activeProjectByUser";
const OPENAI_MODEL_SLUGS = new Set<PromptModelSlug>([
  "gpt-image-2",
  "gpt-5.4-mini",
]);
const RESOLUTION_OPTIONS: ResolutionOption[] = ["512", "1K", "2K", "4K"];

type StoredActiveProjects = Record<string, string>;

function isStoredActiveProjects(value: unknown): value is StoredActiveProjects {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  return Object.entries(value).every(
    ([userId, projectId]) =>
      userId.length > 0 &&
      typeof projectId === "string" &&
      projectId.length > 0,
  );
}

function readStoredActiveProjects(): StoredActiveProjects {
  try {
    const raw = localStorage.getItem(ACTIVE_PROJECT_STORAGE_KEY);
    if (!raw) return {};

    const parsed: unknown = JSON.parse(raw);
    return isStoredActiveProjects(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function readStoredActiveProjectId(userId: string) {
  return readStoredActiveProjects()[userId] ?? null;
}

function writeStoredActiveProjectId(userId: string, projectId: string) {
  const stored = readStoredActiveProjects();
  stored[userId] = projectId;

  try {
    localStorage.setItem(ACTIVE_PROJECT_STORAGE_KEY, JSON.stringify(stored));
  } catch {
    // Ignore unavailable storage, such as private browsing quota failures.
  }
}

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

type ReferenceImageProps = {
  src: string;
  alt: string;
  isSelected: boolean;
  imageId: string;
  onDelete: () => void;
  setSelected: () => void;
};

function ReferenceImage(props: ReferenceImageProps) {
  return (
    <div className={clsx("group relative overflow-clip rounded-md border-1")}>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 z-0 h-10 bg-linear-to-b from-black/45 via-black/20 to-transparent"
      />
      <button
        type="button"
        onClick={props.setSelected}
        aria-label={
          props.isSelected
            ? "Deselect reference image"
            : "Select reference image"
        }
        aria-pressed={props.isSelected}
        className="block w-full cursor-pointer bg-transparent text-left"
      >
        <div
          className={clsx(
            "absolute top-1.5 left-1.5 z-10 size-4 cursor-pointer rounded-full border-2 border-(--muted-foreground)",
            props.isSelected
              ? "border-blue-500 opacity-100"
              : "opacity-30 transition-opacity group-hover:opacity-100",
          )}
        >
          <div
            className={clsx(
              "absolute top-0.25 left-0.25 size-2.5 rounded-full",
              props.isSelected
                ? "bg-blue-500 opacity-100"
                : "bg-(--muted-foreground) opacity-30 transition-opacity group-hover:opacity-60",
            )}
          />
        </div>

        <Image
          src={props.src}
          alt={props.alt}
          width={100}
          height={100}
          className="m-auto w-full"
        />
      </button>

      <button
        type="button"
        aria-label="Delete reference image"
        onClick={(e) => {
          e.stopPropagation();
          props.onDelete?.();
        }}
        className="focus-visible:outline-ring absolute top-1.5 right-1.5 z-10 flex size-4 cursor-pointer items-center justify-center rounded-full border-2 border-(--muted-foreground) opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline focus-visible:outline-2"
      >
        <Trash2
          className="size-2.5 text-(--muted-foreground)"
          strokeWidth={2.2}
        />
      </button>
    </div>
  );
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
  const [isMacOS, setIsMacOS] = useState<boolean | null>(null);
  const [promptText, setPromptText] = useState("");
  const [runs, setRuns] = useState(1);
  const [pushPermissionDialogOpen, setPushPermissionDialogOpen] =
    useState(false);
  const [generateButtonLocked, setGenerateButtonLocked] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(
    null,
  );
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
    null,
  );
  const generateButtonLockedRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
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
    unlockGenerateButton();
  }, [
    promptText,
    selectedModels,
    selectedReferenceImages,
    resolution,
    aspect,
    runs,
    selectedProjectId,
  ]);

  const user = useUser();

  const utils = api.useUtils();

  const { data: referenceImages, isLoading: isLoadingRefImages } =
    api.referenceImage.getReferenceImages.useQuery();

  const { data: models, isLoading: isLoadingModels } =
    api.prompt.getModels.useQuery();

  const { data: projects, isLoading: isLoadingProjects } =
    api.project.list.useQuery();

  const userId = user.user?.id;
  const selectedProject = projects?.find(
    (project) => project.id === selectedProjectId,
  );

  const handleSelectProject = useCallback(
    (projectId: string) => {
      setSelectedProjectId(projectId);
      if (userId) writeStoredActiveProjectId(userId, projectId);
    },
    [userId],
  );

  useEffect(() => {
    if (!userId || !projects) return;
    if (projects.length === 0) {
      setSelectedProjectId(null);
      return;
    }

    if (
      selectedProjectId &&
      projects.some((project) => project.id === selectedProjectId)
    ) {
      return;
    }

    const storedProjectId = readStoredActiveProjectId(userId);
    const fallbackProjectId =
      storedProjectId &&
      projects.some((project) => project.id === storedProjectId)
        ? storedProjectId
        : (projects.find((project) => project.isDefault)?.id ??
          projects[0]?.id);

    if (fallbackProjectId) {
      setSelectedProjectId(fallbackProjectId);
      writeStoredActiveProjectId(userId, fallbackProjectId);
    }
  }, [projects, selectedProjectId, userId]);

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
    const trimmedPrompt = promptText.trim();
    if (!trimmedPrompt || selectedModels.length === 0 || !selectedProjectId)
      return;
    if (generateButtonLockedRef.current) return;

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
      });
    } catch (reason) {
      console.error(
        `Error when generating prompt with text "${trimmedPrompt}"`,
        reason,
      );
      return;
    } finally {
      utils.prompt.list.invalidate().catch((reason) => {
        console.error(
          "Failed to invalidate prompt.list, user will have to refresh.",
          reason,
        );
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
            },
            {
              onSuccess: () => {
                utils.prompt.list.invalidate().catch((reason) => {
                  console.error(
                    "Failed to invalidate images query, user will have to refresh.",
                    reason,
                  );
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
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (
      (isMacOS && e.metaKey && e.key === "Enter") ||
      (!isMacOS && e.ctrlKey && e.key === "Enter")
    ) {
      e.preventDefault();
      void handleGenerate();
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
    toast.success("Image reused as reference");
    setReferenceImagesOpen(true);
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
  const activeModels = models?.filter((model) => !model.isArchived) ?? [];
  const archivedModels = models?.filter((model) => model.isArchived) ?? [];
  const hasOnlyOpenAIModelsSelected =
    selectedModels.length > 0 &&
    selectedModels.every((model) => OPENAI_MODEL_SLUGS.has(model));
  const canGenerate =
    Boolean(promptText.trim()) &&
    selectedModels.length > 0 &&
    Boolean(selectedProjectId) &&
    !generateButtonLocked;
  const isGalleryLoading =
    isLoadingProjects || !selectedProjectId || promptsQuery.isLoading;

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
      <aside className="flex h-screen w-1/5 flex-col border border-x border-(--border)">
        <div className="flex flex-row items-center gap-4 border-y border-(--border) p-5">
          <div className="h-8 w-8 rounded-md bg-blue-400"></div>
          <div>
            <h1 className="font-heading text-lg font-bold">AI Thing</h1>
            <p className="text-xs text-(--muted-foreground)">
              All your models, in one place
            </p>
          </div>
        </div>
        <div className="flex grow flex-col gap-3 overflow-y-scroll p-5">
          <Field>
            <FieldLabel className="text-xxs text-(--muted-foreground) uppercase">
              Prompt
            </FieldLabel>
            <Textarea
              id="prompt"
              placeholder="What do you want to create?.."
              value={promptText}
              onChange={(e) => setPromptText(e.target.value)}
              onKeyDown={handleKeyDown}
            />
            <span
              className={clsx(
                "mx-0 text-xs text-(--muted-foreground)",
                isMacOS === null ? "opacity-0" : "opacity-80",
              )}
            >
              Press {isMacOS ? "⌘" : "Ctrl"} + Enter to submit
            </span>
          </Field>
          <Collapsible
            open={referenceImagesOpen}
            onOpenChange={setReferenceImagesOpen}
          >
            <CollapsibleTrigger className="flex w-full cursor-pointer flex-row justify-between">
              <FieldLabel className="text-xxs cursor-pointer text-(--muted-foreground) uppercase">
                Reference Images
              </FieldLabel>
              {referenceImagesOpen ? (
                <ChevronUp color="var(--muted-foreground)" />
              ) : (
                <ChevronDown color="var(--muted-foreground)" />
              )}
            </CollapsibleTrigger>
            {selectedReferenceImages.length > 0 ? (
              <span className="mx-0 text-xs text-(--muted-foreground)">
                {`(${selectedReferenceImages.length} image${selectedReferenceImages.length > 1 ? "s" : ""} selected)`}
              </span>
            ) : (
              ""
            )}
            <CollapsibleContent className="max-h-80 overflow-scroll">
              <div className="my-2 grid grid-cols-3 gap-2 p-2">
                {isLoadingRefImages
                  ? Array.from({ length: 6 }).map((_, i) => (
                      <Skeleton key={i} className="aspect-square rounded-md" />
                    ))
                  : referenceImages?.map((img) => (
                      <ReferenceImage
                        key={img.id}
                        src={img.url ?? ""}
                        alt="Reference image"
                        imageId={img.id}
                        isSelected={selectedReferenceImages.includes(img.id)}
                        setSelected={() => {
                          if (selectedReferenceImages.includes(img.id))
                            setSelectedReferenceImages(
                              selectedReferenceImages.filter(
                                (e) => e !== img.id,
                              ),
                            );
                          else
                            setSelectedReferenceImages([
                              ...selectedReferenceImages,
                              img.id,
                            ]);
                        }}
                        onDelete={() => {
                          setPendingDelete({
                            type: "referenceImage",
                            id: img.id,
                          });
                        }}
                      />
                    ))}
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex aspect-square cursor-pointer flex-col items-center justify-center gap-1 rounded-md border-1 border-dashed border-(--muted-foreground) hover:bg-gray-900"
                >
                  <Upload size={16} className="text-(--muted-foreground)" />
                  <span className="text-xs text-(--muted-foreground)">Add</span>
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={handleFileUpload}
                />
              </div>
            </CollapsibleContent>
          </Collapsible>
          <Field>
            <FieldLabel className="text-xxs text-(--muted-foreground) uppercase">
              Models
            </FieldLabel>
            {isLoadingModels ? (
              <div className="flex flex-col gap-2">
                {Array.from({ length: 2 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 rounded-md" />
                ))}
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {activeModels.map(({ slug, name }) => (
                  <div
                    key={slug}
                    role="checkbox"
                    aria-checked={selectedModels.includes(slug)}
                    aria-labelledby={`model-select-${slug}-label`}
                    tabIndex={0}
                    className={clsx(
                      "flex cursor-pointer flex-row items-center gap-4 rounded-md border border-1 px-4 py-2 text-(--foreground)",
                      selectedModels.includes(slug)
                        ? "border-blue-500 bg-gray-800"
                        : "hover:bg-gray-900",
                    )}
                    onClick={() => toggleSelectedModel(slug)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        toggleSelectedModel(slug);
                      }
                    }}
                  >
                    <Checkbox
                      id={`model-select-${slug}`}
                      accentColor="blue-500"
                      checked={selectedModels.includes(slug)}
                      tabIndex={-1}
                      className="pointer-events-none"
                    />
                    <Label
                      id={`model-select-${slug}-label`}
                      className="pointer-events-none cursor-pointer flex-col items-start"
                    >
                      <span>{name}</span>
                      <span className="text-xs text-(--muted-foreground)">
                        {slug}
                      </span>
                    </Label>
                  </div>
                ))}
                {archivedModels.length > 0 && (
                  <Collapsible
                    open={archivedModelsOpen}
                    onOpenChange={setArchivedModelsOpen}
                  >
                    <CollapsibleTrigger className="flex w-full cursor-pointer items-center justify-between rounded-md border border-1 border-dashed border-(--border) px-4 py-2 text-left">
                      <span className="text-xs tracking-wide text-(--muted-foreground) uppercase">
                        Archived Models
                      </span>
                      {archivedModelsOpen ? (
                        <ChevronUp color="var(--muted-foreground)" size={16} />
                      ) : (
                        <ChevronDown
                          color="var(--muted-foreground)"
                          size={16}
                        />
                      )}
                    </CollapsibleTrigger>
                    <CollapsibleContent className="mt-2 flex flex-col gap-2">
                      {archivedModels.map(({ slug, name }) => (
                        <div
                          key={slug}
                          role="checkbox"
                          aria-checked={selectedModels.includes(slug)}
                          aria-labelledby={`model-select-${slug}-label`}
                          tabIndex={0}
                          className={clsx(
                            "flex cursor-pointer flex-row items-center gap-4 rounded-md border border-1 px-4 py-2 text-(--foreground)",
                            selectedModels.includes(slug)
                              ? "border-blue-500 bg-gray-800"
                              : "hover:bg-gray-900",
                          )}
                          onClick={() => toggleSelectedModel(slug)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              toggleSelectedModel(slug);
                            }
                          }}
                        >
                          <Checkbox
                            id={`model-select-${slug}`}
                            accentColor="blue-500"
                            checked={selectedModels.includes(slug)}
                            tabIndex={-1}
                            className="pointer-events-none"
                          />
                          <Label
                            id={`model-select-${slug}-label`}
                            className="pointer-events-none cursor-pointer flex-col items-start"
                          >
                            <span>{name}</span>
                            <span className="text-xs text-(--muted-foreground)">
                              {slug}
                            </span>
                          </Label>
                        </div>
                      ))}
                    </CollapsibleContent>
                  </Collapsible>
                )}
              </div>
            )}
          </Field>
          <Field className="w-full">
            <FieldLabel className="text-xxs text-(--muted-foreground) uppercase">
              Resolution
            </FieldLabel>
            <div className="flex flex-row gap-2">
              {RESOLUTION_OPTIONS.map((resolutionOption) => {
                const isDisabled =
                  resolutionOption === "512" && hasOnlyOpenAIModelsSelected;

                return (
                  <button
                    key={resolutionOption}
                    disabled={isDisabled}
                    aria-disabled={isDisabled}
                    className={clsx(
                      "grow rounded-md border border-1 px-2 py-1 text-sm",
                      resolution === resolutionOption
                        ? "bg-blue-500 text-(--foreground)"
                        : "text-(--muted-foreground)",
                      isDisabled
                        ? "cursor-not-allowed opacity-40"
                        : "cursor-pointer hover:bg-gray-900",
                    )}
                    onClick={(e) => {
                      e.preventDefault();
                      if (isDisabled) return;
                      setResolution(resolutionOption);
                    }}
                  >
                    {resolutionOption}
                  </button>
                );
              })}
            </div>
          </Field>
          <Field className="w-full">
            <FieldLabel className="text-xxs text-(--muted-foreground) uppercase">
              Aspect Ratio
            </FieldLabel>
            <div className="flex flex-row gap-2">
              {["1:1", "4:3", "3:4", "16:9", "9:16"].map((aspectOption) => (
                <button
                  key={aspectOption}
                  className={clsx(
                    "grow cursor-pointer rounded-md border border-1 px-2 py-1 text-sm",
                    aspect === aspectOption
                      ? "bg-blue-500 text-(--foreground)"
                      : "text-(--muted-foreground) hover:bg-gray-900",
                  )}
                  onClick={(e) => {
                    e.preventDefault();
                    setAspect(aspectOption);
                  }}
                >
                  {aspectOption}
                </button>
              ))}
            </div>
          </Field>
          <Field className="w-full">
            <FieldLabel className="text-xxs text-(--muted-foreground) uppercase">
              Runs per Model
            </FieldLabel>
            <div className="flex flex-row gap-2">
              <button
                className="cursor-pointer rounded-md border border-1 px-3 py-1 text-sm hover:bg-gray-900 active:bg-blue-500"
                onClick={() => {
                  if (runs > 1) setRuns(runs - 1);
                }}
              >
                -
              </button>
              <input
                className="w-0 grow rounded-md border border-1 text-center text-sm"
                disabled
                value={runs}
              />
              <button
                className="cursor-pointer rounded-md border border-1 px-3 py-1 text-sm hover:bg-gray-900 active:bg-blue-500"
                onClick={() => {
                  if (runs < 8) setRuns(runs + 1);
                }}
              >
                +
              </button>
            </div>
            <span className="mt-1 text-xs text-(--muted-foreground)">
              {totalGenerations} generation{totalGenerations !== 1 ? "s" : ""}{" "}
              will be triggered
            </span>
          </Field>
          {totalGenerations > 6 && (
            <div className="flex flex-row items-start gap-3 rounded-md border border-amber-500/50 bg-amber-500/10 p-3">
              <AlertTriangle
                size={16}
                className="mt-0.5 shrink-0 text-amber-400"
              />
              <div className="text-sm text-amber-300">
                Repeating prompts many times may lead to high usage.{" "}
                <button
                  className="underline hover:text-amber-200"
                  onClick={() => setRuns(3)}
                >
                  Reduce repeat count
                </button>
              </div>
            </div>
          )}
        </div>
        <div className="flex flex-col items-center-safe gap-2 border-y border-(--border) py-4">
          <button
            aria-busy={generateButtonLocked}
            className={clsx(
              "w-2/3 cursor-pointer rounded-md border border-1 px-4 py-2",
              canGenerate
                ? "hover:bg-gray-900 active:bg-gray-500"
                : "cursor-not-allowed opacity-50",
            )}
            disabled={!canGenerate}
            onClick={handleGenerate}
          >
            {generateButtonLocked ? "Generating..." : "Generate"}
          </button>
          <br />
          <div className="flex w-full flex-row items-center-safe justify-start gap-4 px-4">
            <UserButton />
            {user.user?.fullName}
          </div>
        </div>
      </aside>
      <div className="flex max-h-screen w-full flex-col overflow-x-hidden overflow-y-scroll">
        <div className="bg-background/95 sticky top-0 z-30 flex items-center justify-between gap-3 px-9 py-4 backdrop-blur">
          <div className="flex items-center gap-3">
            <ProjectSwitcher
              projects={projects}
              selectedProject={selectedProject}
              selectedProjectId={selectedProjectId}
              isLoading={isLoadingProjects}
              onSelectProject={handleSelectProject}
            />
            {(prompts?.length ?? 0) > 0 && (
              <p className="text-muted-foreground/60 text-xs font-medium">
                {prompts?.length ?? 0}{" "}
                {(prompts?.length ?? 0) === 1 ? "generation" : "generations"} in
                this project
              </p>
            )}
          </div>
        </div>
        {promptsQuery.error &&
        promptsQuery.error.data?.code !== "NOT_FOUND" ? (
          <div className="flex flex-1 items-center justify-center">
            <p className="text-muted-foreground text-sm">
              Failed to load generations: {promptsQuery.error.message}
            </p>
          </div>
        ) : isGalleryLoading ? (
          <div className="flex flex-1 items-center justify-center">
            <p className="text-muted-foreground text-sm">Loading...</p>
          </div>
        ) : (prompts?.length ?? 0) === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3">
            <div className="bg-card border-border flex size-11 items-center justify-center rounded-xl border">
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <rect
                  x="2"
                  y="2"
                  width="7"
                  height="7"
                  rx="1.5"
                  stroke="var(--muted-foreground)"
                  strokeWidth="1.5"
                />
                <rect
                  x="11"
                  y="2"
                  width="7"
                  height="7"
                  rx="1.5"
                  stroke="var(--muted-foreground)"
                  strokeWidth="1.5"
                />
                <rect
                  x="2"
                  y="11"
                  width="7"
                  height="7"
                  rx="1.5"
                  stroke="var(--muted-foreground)"
                  strokeWidth="1.5"
                />
                <rect
                  x="11"
                  y="11"
                  width="7"
                  height="7"
                  rx="1.5"
                  stroke="var(--muted-foreground)"
                  strokeWidth="1.5"
                />
              </svg>
            </div>
            <p className="text-muted-foreground text-sm">
              No generations in this project yet
            </p>
            <p className="text-muted-foreground/60 text-xs">
              Write a prompt and hit Generate
            </p>
          </div>
        ) : (
          <div className="flex w-full flex-col gap-12 px-9 py-8">
            {(prompts ?? []).map((prompt) => (
              <PromptGroup
                key={prompt.id}
                id={prompt.id}
                prompt={prompt.text}
                aspectRatio={prompt.aspectRatio ?? undefined}
                createdAt={prompt.createdAt}
                models={models ?? []}
                images={prompt.images.map((image) => ({
                  id: image.id,
                  url: image.url ?? "",
                  modelSlug: image.model,
                  status: image.status,
                  key: image.key ?? "",
                  error: image.error ?? undefined,
                  createdAt: image.createdAt,
                  updatedAt: image.updatedAt,
                }))}
                referenceImages={
                  (prompt.referenceImages as string[])?.length > 0
                    ? (prompt.referenceImages as string[]).map((id) => ({
                        id,
                        url:
                          referenceImages?.find((r) => r.id === id)?.url ??
                          undefined,
                      }))
                    : []
                }
                onDeletePrompt={() =>
                  setPendingDelete({ type: "prompt", id: prompt.id })
                }
                onDeleteImage={(imageId) =>
                  setPendingDelete({ type: "image", id: imageId })
                }
                onReuseAsReference={handleReuseAsReference}
                onRetryImage={(imageId) => {
                  console.log("[retry] clicked, imageId:", imageId);
                  if (!selectedProjectId) return;
                  toast.info("Retry generation started");
                  utils.prompt.list.setData(
                    { projectId: selectedProjectId },
                    (old) =>
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
                  console.log(
                    "[retry] optimistic update applied, calling runGeneration",
                  );
                  runGeneration.mutate(
                    { imageId, retry: true },
                    {
                      onSuccess: (data) =>
                        console.log("[retry] succeeded, result:", data),
                      onError: (err) =>
                        console.error("[retry] mutation error:", err),
                      onSettled: (data, error) => {
                        console.log("[retry] settled, invalidating list");
                        void utils.prompt.list.invalidate();
                        notifyPromptDone({
                          failureState:
                            !!error || data?.status === "failed"
                              ? "all"
                              : "none",
                        });
                      },
                    },
                  );
                }}
              />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
