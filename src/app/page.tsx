"use client";

import { Label } from "src/components/ui/label";
import { Field, FieldLabel } from "src/components/ui/field";
import { Textarea } from "src/components/ui/textarea";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "src/components/ui/collapsible";
import { Checkbox } from "src/components/ui/checkbox";
import { Skeleton } from "src/components/ui/skeleton";

import { useUser, UserButton } from "@clerk/nextjs";

import { useEffect, useRef, useState } from "react";
import Image from "next/image"

import { ChevronUp, ChevronDown, Upload, AlertTriangle} from "lucide-react"
import clsx from "clsx";

import { api, type RouterInputs } from "src/trpc/react";
import { useUploadThing } from "src/lib/uploadthing";

// import { SUPPORTED_MODELS } from "src/server/api/routers/prompt";
import PromptGroup from "./_components/prompt-group";

type PromptModelSlug =
  RouterInputs["prompt"]["createWithGenerations"]["models"][number];

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
    <div className={clsx("group border-1 rounded-md overflow-clip relative")}>
      <button
        type="button"
        onClick={props.setSelected}
        aria-label={props.isSelected ? "Deselect reference image" : "Select reference image"}
        aria-pressed={props.isSelected}
        className="block w-full cursor-pointer bg-transparent text-left"
      >
        <div className={clsx("size-4 border-2 border-(--muted-foreground) absolute top-1.5 left-1.5 rounded-full cursor-pointer",
          props.isSelected ? "opacity-100 border-blue-500" : "opacity-30 transition-opacity group-hover:opacity-100")}>
          <div className={clsx("size-2.5 absolute top-0.25 left-0.25 rounded-full",
            props.isSelected ? "bg-blue-500 opacity-100" :
              "bg-(--muted-foreground) opacity-30 transition-opacity group-hover:opacity-60"
          )} />
        </div>

        <Image
          src={props.src} alt={props.alt}
          width={100} height={100}
          className="m-auto w-full" />
      </button>

      <button
        type="button"
        aria-label="Delete reference image"
        onClick={(e) => {
          e.stopPropagation();
          props.onDelete?.();
        }}
        className="size-4 absolute top-1.5 right-1.5 rounded-full border-2 border-(--muted-foreground) opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring flex items-center justify-center cursor-pointer z-10"
      >
        <div className="relative size-2.5">
          <div className="absolute inset-0 rotate-45 bg-(--muted-foreground) h-[2px] m-auto" />
          <div className="absolute inset-0 -rotate-45 bg-(--muted-foreground) h-[2px] m-auto" />
        </div>
      </button>
    </div>
  );
}

export default function Home() {
  const [referenceImagesOpen, setReferenceImagesOpen] = useState(false);
  const [selectedReferenceImages, setSelectedReferenceImages] = useState<string[]>([]);
  const [selectedModels, setSelectedModels] = useState<PromptModelSlug[]>([]);
  const [resolution, setResolution] = useState("1024");
  const [aspect, setAspect] = useState("1:1");
  const [isMacOS, setIsMacOS] = useState<boolean | null>(null);
  const [promptText, setPromptText] = useState("");
  const [runs, setRuns] = useState(1);
  const [batchRunning, setBatchRunning] = useState(false);
  const batchRunningRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const user = useUser();

  const utils = api.useUtils();

  const { data: referenceImages, isLoading: isLoadingRefImages } =
    api.referenceImage.getReferenceImages.useQuery();

  const { data: models, isLoading: isLoadingModels } =
    api.prompt.getModels.useQuery();

  const deleteRefImage = api.referenceImage.deleteReferenceImage.useMutation({
    onSuccess: () => {
      void utils.referenceImage.getReferenceImages.invalidate();
    },
  });

  const createRefImage = api.referenceImage.createReferenceImage.useMutation({
    onSuccess: () => {
      void utils.referenceImage.getReferenceImages.invalidate();
    },
  });

  const promptsQuery = api.prompt.list.useQuery();
  const prompts = promptsQuery.data;

  const { startUpload } = useUploadThing("imageUploader");

  const createPrompt = api.prompt.createWithGenerations.useMutation();
  const runGeneration = api.image.runGeneration.useMutation();
  const deletePromptMutation = api.prompt.deletePrompt.useMutation({
    onSuccess: () => void utils.prompt.list.invalidate(),
  });
  const deleteImageMutation = api.image.deleteImage.useMutation({
    onSuccess: () => void utils.prompt.list.invalidate(),
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

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files?.length) return;
    const res = await startUpload(Array.from(files));
    if (res) {
      for (const uploaded of res) {
        createRefImage.mutate({ url: uploaded.ufsUrl });
      }
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleGenerate = async () => {
    const trimmedPrompt = promptText.trim();
    if (!trimmedPrompt || selectedModels.length === 0) return;
    if (batchRunningRef.current) return;
    batchRunningRef.current = true;
    setBatchRunning(true);
    try {
      const result = await createPrompt.mutateAsync({
        text: trimmedPrompt,
        models: selectedModels,
        repeatCount: runs,
        referenceImages: selectedReferenceImages.length > 0 ? selectedReferenceImages : undefined,
        resolution,
        aspectRatio: aspect,
      }, {
        onSuccess: ()=>{
          utils.prompt.list.invalidate().catch((reason) => {
            console.error("Failed to invalidate prompt.list, user will have to refresh.", reason);
          });
        }
      });

      await Promise.allSettled(
        result.images.map((img) =>
          runGeneration.mutateAsync({
            imageId: img.id
          }, {
            onSuccess: () => {
              utils.prompt.list.invalidate().catch((reason) => {
                console.error("Failed to invalidate images query, user will have to refresh.", reason);
              });
            }
          }),
        ),
      );
    } catch {
      // createPrompt failed
      console.error(`Failed to generate one or more images for prompt: "${trimmedPrompt}"`);
    } finally {
      batchRunningRef.current = false;
      setBatchRunning(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((isMacOS && e.metaKey && e.key === "Enter") ||
        (!isMacOS && e.ctrlKey && e.key === "Enter")) {
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
      return;
    }
    await utils.referenceImage.getReferenceImages.invalidate();
    setSelectedReferenceImages((prev) =>
      prev.includes(result.referenceImageRow.id)
        ? prev
        : [...prev, result.referenceImageRow.id],
    );
    setReferenceImagesOpen(true);
  };

  useEffect(
    () => {setIsMacOS(navigator?.userAgent.toLowerCase().includes("mac"))},
    []);
  
  const [hasInitializedModels, setHasInitializedModels] = useState(false);

  useEffect(
    () => {
      if (models && !hasInitializedModels) {
        setSelectedModels(models.map(m => m.slug));
        setHasInitializedModels(true);
      }
    },
    [models, hasInitializedModels]
  );

  const totalGenerations = runs * selectedModels.length;

  return (
    <main className="w-full grow flex flex-row text-gray-200">
      <aside className="w-1/5 h-screen border border-x border-(--border) flex flex-col">
        <div className="border-y border-(--border) flex flex-row gap-4 items-center p-5">
          <div className="w-8 h-8 bg-blue-400 rounded-md"></div>
          <div>
            <h1 className="text-lg font-heading font-bold">AI Thing</h1>
            <p className="text-xs text-(--muted-foreground)">All your models, in one place</p>
          </div>
        </div>
        <div className="p-5 flex flex-col gap-3 overflow-y-scroll grow">
          <Field>
            <FieldLabel className="uppercase text-xxs text-(--muted-foreground)">Prompt</FieldLabel>
            <Textarea
              id="prompt"
              placeholder="What do you want to create?.."
              value={promptText}
              onChange={(e) => setPromptText(e.target.value)}
              onKeyDown={handleKeyDown}
            />
            <span className={clsx("text-xs text-(--muted-foreground) mx-0", isMacOS === null ? "opacity-0" : "opacity-80")}>
              Press {isMacOS ? "⌘" : "Ctrl"} + Enter to submit
            </span>
          </Field>
          <Collapsible open={referenceImagesOpen} onOpenChange={setReferenceImagesOpen}>
            <CollapsibleTrigger className="w-full flex flex-row justify-between cursor-pointer">
              <FieldLabel className="uppercase text-xxs text-(--muted-foreground) cursor-pointer">
                Reference Images
              </FieldLabel>
              {referenceImagesOpen ? <ChevronUp color="var(--muted-foreground)" /> : <ChevronDown color="var(--muted-foreground)" />}
            </CollapsibleTrigger>
            {
            selectedReferenceImages.length > 0 ?
            <span className="text-xs text-(--muted-foreground) mx-0">
              {`(${selectedReferenceImages.length} image${selectedReferenceImages.length > 1 ? 's' : ''} selected)`}
            </span> :
            ""
            }
            <CollapsibleContent className="max-h-80 overflow-scroll">
              <div className="grid grid-cols-3 gap-2 my-2 p-2">
                {isLoadingRefImages ? (
                  Array.from({ length: 6 }).map((_, i) => (
                    <Skeleton key={i} className="aspect-square rounded-md" />
                  ))
                ) : (
                  referenceImages?.map((img) => (
                    <ReferenceImage
                      key={img.id}
                      src={img.url ?? ""}
                      alt="Reference image"
                      imageId={img.id}
                      isSelected={selectedReferenceImages.includes(img.id)}
                      setSelected={() => {
                        if (selectedReferenceImages.includes(img.id))
                          setSelectedReferenceImages(selectedReferenceImages.filter((e) => e !== img.id));
                        else
                          setSelectedReferenceImages([...selectedReferenceImages, img.id]);
                      }}
                      onDelete={() => {
                        deleteRefImage.mutate({ id: img.id });
                        setSelectedReferenceImages(selectedReferenceImages.filter((e) => e !== img.id));
                      }}
                    />
                  ))
                )}
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="border-1 border-dashed border-(--muted-foreground) rounded-md flex flex-col items-center justify-center gap-1 cursor-pointer hover:bg-gray-900 aspect-square"
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
            <FieldLabel className="uppercase text-xxs text-(--muted-foreground)">Models</FieldLabel>
            {isLoadingModels ? (
              <div className="flex flex-col gap-2">
                {Array.from({ length: 2 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 rounded-md" />
                ))}
              </div>
            ) : (
              models?.map(({ slug, name, provider: by }) => (
                <div key={slug}
                  role="button"
                  tabIndex={0}
                  className={clsx("flex flex-row items-center gap-4 px-4 py-2 border border-1 text-(--foreground) rounded-md cursor-pointer",
                    selectedModels.includes(slug) ? "bg-gray-800 border-blue-500" : "hover:bg-gray-900"
                  )}
                  onClick={() => toggleSelectedModel(slug)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      toggleSelectedModel(slug);
                    }
                  }}
                >
                  <Checkbox id={`model-select-${slug}`} accentColor="blue-500"
                    checked={selectedModels.includes(slug)}
                    tabIndex={-1} aria-hidden />
                  <Label htmlFor={`model-select-${slug}`} className="flex-col items-start cursor-pointer">
                    {name}<br/>
                    <span className="text-(--muted-foreground)">{by}</span>
                  </Label>
                </div>
              ))
            )}
          </Field>
          <Field className="w-full">
            <FieldLabel className="uppercase text-xxs text-(--muted-foreground)">Resolution</FieldLabel>
            <div className="flex flex-row gap-2">
              {
                ["512", "1024", "2048"].map((resolutionOption) => (
                  <button key={resolutionOption}
                    className={clsx("px-2 py-1 border border-1 text-sm rounded-md cursor-pointer grow",
                      resolution === resolutionOption ? "bg-blue-500 text-(--foreground)" : "hover:bg-gray-900 text-(--muted-foreground) "
                    )}
                    onClick={(e)=>{
                      e.preventDefault();
                      setResolution(resolutionOption)
                    }}
                  >
                    {resolutionOption} px
                  </button>
                ))
              }
            </div>
          </Field>
          <Field className="w-full">
            <FieldLabel className="uppercase text-xxs text-(--muted-foreground)">Aspect Ratio</FieldLabel>
            <div className="flex flex-row gap-2">
              {
                ["1:1", "4:3", "3:4", "16:9", "9:16"].map((aspectOption) => (
                  <button key={aspectOption}
                    className={clsx("px-2 py-1 border border-1 text-sm rounded-md cursor-pointer grow",
                      aspect === aspectOption ? "bg-blue-500 text-(--foreground)" : "hover:bg-gray-900 text-(--muted-foreground) "
                    )}
                    onClick={(e)=>{
                      e.preventDefault();
                      setAspect(aspectOption)
                    }}
                  >
                    {aspectOption}
                  </button>
                ))
              }
            </div>
          </Field>
          <Field className="w-full">
            <FieldLabel className="uppercase text-xxs text-(--muted-foreground)">Runs per Model</FieldLabel>
            <div className="flex flex-row gap-2">
              <button
                className="border border-1 text-sm rounded-md px-3 py-1 cursor-pointer hover:bg-gray-900 active:bg-blue-500"
                onClick={()=>{if(runs > 1) setRuns(runs - 1);}}
              >
                -
              </button>
              <input className="border border-1 text-sm rounded-md text-center w-0 grow" disabled value={runs}/>
              <button
                className="border border-1 text-sm rounded-md px-3 py-1 cursor-pointer hover:bg-gray-900 active:bg-blue-500"
                onClick={()=>{if(runs < 8) setRuns(runs + 1);}}
              >
                +
              </button>
            </div>
            <span className="text-xs text-(--muted-foreground) mt-1">
              {totalGenerations} generation{totalGenerations !== 1 ? "s" : ""} will be triggered
            </span>
          </Field>
          {totalGenerations > 6 && (
            <div className="rounded-md border border-amber-500/50 bg-amber-500/10 p-3 flex flex-row gap-3 items-start">
              <AlertTriangle size={16} className="text-amber-400 shrink-0 mt-0.5" />
              <div className="text-sm text-amber-300">
                Repeating prompts many times may lead to high usage.{" "}
                <button className="underline hover:text-amber-200" onClick={() => setRuns(3)}>
                  Reduce repeat count
                </button>
              </div>
            </div>
          )}
        </div>
        <div className="border-y border-(--border) flex flex-col items-center-safe py-4 gap-2">
          <button
            className={clsx(
              "px-4 py-2 border border-1 rounded-md cursor-pointer w-2/3",
              (promptText.trim() && selectedModels.length > 0 && !batchRunning)
                ? "hover:bg-gray-900 active:bg-gray-500"
                : "opacity-50 cursor-not-allowed"
            )}
            disabled={!promptText.trim() || selectedModels.length === 0 || batchRunning}
            onClick={handleGenerate}
          >
            {batchRunning ? "Generating..." : "Generate"}
          </button>
          <br/>
          <div className="flex flex-row items-center-safe gap-4 justify-start w-full px-4">
            <UserButton />
            {user.user?.fullName}
          </div>
        </div>
      </aside>
      <div className="flex flex-col w-full overflow-x-hidden overflow-y-scroll max-h-screen">
        {prompts === undefined ? (
          <div className="flex-1 flex items-center justify-center">
            <p className="text-sm text-muted-foreground">Loading...</p>
          </div>
        ) : prompts.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3">
            <div className="size-11 rounded-xl bg-card border border-border flex items-center justify-center">
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <rect x="2" y="2" width="7" height="7" rx="1.5" stroke="var(--muted-foreground)" strokeWidth="1.5"/>
                <rect x="11" y="2" width="7" height="7" rx="1.5" stroke="var(--muted-foreground)" strokeWidth="1.5"/>
                <rect x="2" y="11" width="7" height="7" rx="1.5" stroke="var(--muted-foreground)" strokeWidth="1.5"/>
                <rect x="11" y="11" width="7" height="7" rx="1.5" stroke="var(--muted-foreground)" strokeWidth="1.5"/>
              </svg>
            </div>
            <p className="text-sm text-muted-foreground">No generations yet</p>
            <p className="text-xs text-muted-foreground/60">Write a prompt and hit Generate</p>
          </div>
        ) : (
          <div className="px-9 py-8 w-full flex flex-col gap-12">
            <p className="text-xs text-muted-foreground/60 font-medium">
              {prompts.length} {prompts.length === 1 ? "generation" : "generations"}
            </p>
            {prompts.map((prompt) => (
              <PromptGroup
                key={prompt.id}
                id={prompt.id}
                prompt={prompt.text}
                aspectRatio={prompt.aspectRatio ?? undefined}
                createdAt={prompt.createdAt}
                models={models ?? []}
                images={prompt.images.map(image => ({
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
                        url: referenceImages?.find(r => r.id === id)?.url ?? undefined,
                      }))
                    : []
                }
                onDeletePrompt={
                  () => deletePromptMutation.mutate(
                    { id: prompt.id},
                    {
                      onSuccess: () => {
                        utils.prompt.list.invalidate().catch((reason) => {
                          if(reason instanceof Error) throw reason;
                          console.error("Failed to invalidate images query, user will have to refresh.", reason);
                        });
                      }})}
                onDeleteImage={
                  (imageId) => deleteImageMutation.mutate(
                    { id: imageId },
                    {
                      onSuccess: () => {
                        utils.image.invalidate().catch((reason) => {
                          if(reason instanceof Error) throw reason;
                          console.error("Failed to invalidate images query, user will have to refresh.", reason);
                        });
                      }})}
                onReuseAsReference={handleReuseAsReference}
                onRetryImage={(imageId) => {
                  console.log("[retry] clicked, imageId:", imageId);
                  utils.prompt.list.setData(undefined, (old) =>
                    old?.map((p) => ({
                      ...p,
                      images: p.images.map((img) =>
                        img.id === imageId
                          ? { ...img, status: "pending" as const, error: null }
                          : img
                      ),
                    }))
                  );
                  console.log("[retry] optimistic update applied, calling runGeneration");
                  runGeneration.mutate(
                    { imageId, retry: true },
                    {
                      onSuccess: (data) => console.log("[retry] succeeded, result:", data),
                      onError: (err) => console.error("[retry] mutation error:", err),
                      onSettled: () => {
                        console.log("[retry] settled, invalidating list");
                        void utils.prompt.list.invalidate();
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
