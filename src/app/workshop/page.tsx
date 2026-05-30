"use client";

import { useUser } from "@clerk/nextjs";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type ReactElement,
} from "react";
import {
  ArrowLeft,
  Brain,
  Check,
  ChevronDown,
  ChevronUp,
  Folder,
  ImagePlus,
  Loader2,
  MessagesSquare,
  Pencil,
  Plus,
  Send,
  Sparkles,
  Square,
  Trash2,
  X,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button, buttonVariants } from "src/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "src/components/ui/collapsible";
import { ConfirmDialog } from "src/components/ui/confirm-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "src/components/ui/select";
import { Skeleton } from "src/components/ui/skeleton";
import { Input } from "src/components/ui/input";
import { Textarea } from "src/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "src/components/ui/tooltip";
import { useActiveProject } from "src/app/_hooks/use-active-project";
import { useLocalStorage, type LocalStorageValue } from "src/lib/localStorage";
import { useUploadThing } from "src/lib/uploadthing";
import { cn } from "src/lib/utils";
import {
  WORKSHOP_ACCEPTED_PROMPT_STORAGE_KEY,
  WORKSHOP_DRAFT_STORAGE_KEY,
} from "src/lib/workshop";
import { api, type RouterOutputs } from "src/trpc/react";

import Markdown from "react-markdown";

function OpenAIIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zm-9.023 12.608a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zm-9.661-4.125a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zm-1.26-10.383a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.338 7.921zm16.597 3.855l-5.843-3.371 2.019-1.168a.076.076 0 0 1 .071 0l4.83 2.786a4.5 4.5 0 0 1-.677 8.098v-5.683a.795.795 0 0 0-.4-.662zm2.01-3.023l-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135l-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08L8.704 5.46a.795.795 0 0 0-.393.681v6.728zm1.097-2.365l2.679-1.547 2.679 1.546v3.093l-2.679 1.546-2.679-1.546V13.5z" />
    </svg>
  );
}

const WORKSHOP_MODELS = [
  {
    slug: "gpt-5.4" as const,
    name: "GPT 5.4",
    provider: "OpenAI",
    description: "Balanced · thinking",
    iconBg: "bg-black dark:bg-neutral-800",
    LogoIcon: OpenAIIcon,
  },
  {
    slug: "gpt-5.5" as const,
    name: "GPT 5.5",
    provider: "OpenAI",
    description: "Deep · thinking",
    iconBg: "bg-black dark:bg-neutral-800",
    LogoIcon: OpenAIIcon,
  },
  {
    slug: "gpt-5.4-mini" as const,
    name: "GPT 5.4 Mini",
    provider: "OpenAI",
    description: "Fast · thinking",
    iconBg: "bg-black dark:bg-neutral-800",
    LogoIcon: OpenAIIcon,
  },
];

const WORKSHOP_REASONING_EFFORTS = [
  { value: "low", label: "Low", shortLabel: "Low · Quick" },
  { value: "medium", label: "Medium", shortLabel: "Medium · Normal" },
  { value: "high", label: "High", shortLabel: "High · Deep" },
  { value: "xhigh", label: "Extra High", shortLabel: "Extra High" },
] as const;

type WorkshopModel = (typeof WORKSHOP_MODELS)[number]["slug"];
type WorkshopReasoningEffort =
  (typeof WORKSHOP_REASONING_EFFORTS)[number]["value"];
type WorkshopMessage = RouterOutputs["workshop"]["list"][number];
type WorkshopThread = RouterOutputs["workshop"]["listThreads"][number];
type WorkshopSendResult = RouterOutputs["workshop"]["sendMessage"];
type Project = RouterOutputs["project"]["list"][number];
type PendingWorkshopAttachment = {
  id: string;
  url: string | null;
  mimeType: string;
};

type WorkshopStreamEvent =
  | {
      event: "thread";
      data: { thread: WorkshopThread };
    }
  | {
      event: "reasoning_delta";
      data: { delta: string };
    }
  | {
      event: "done";
      data: WorkshopSendResult;
    }
  | {
      event: "error";
      data: { message?: string };
    };

function formatRelativeTime(date: Date | string): string {
  const diff = Date.now() - new Date(date).getTime();
  const hours = Math.floor(diff / 3_600_000);
  const days = Math.floor(diff / 86_400_000);
  if (diff < 60_000) return "just now";
  if (hours < 1) return `${Math.floor(diff / 60_000)}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}

const THREADS_SHOWN_INITIALLY = 6;

function WorkshopTooltip({
  label,
  children,
}: {
  label: string;
  children: ReactElement;
}) {
  return (
    <Tooltip>
      <TooltipTrigger render={children} />
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function ProjectSection({
  project,
  selectedProjectId,
  selectedThreadId,
  onSelectThread,
  onNewThread,
  onRenameThread,
  onDeleteThread,
  createIsPending,
  createTargetProjectId,
  renameIsPending,
  deleteIsPending,
}: {
  project: Project;
  selectedProjectId: string | null;
  selectedThreadId: string | null;
  onSelectThread: (threadId: string, projectId: string) => void;
  onNewThread: (projectId: string) => void;
  onRenameThread: (thread: WorkshopThread, title: string) => void;
  onDeleteThread: (thread: WorkshopThread) => void;
  createIsPending: boolean;
  createTargetProjectId: string | null;
  renameIsPending: boolean;
  deleteIsPending: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [editingThreadId, setEditingThreadId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");

  const threadsQuery = api.workshop.listThreads.useQuery(
    { projectId: project.id },
    { enabled: expanded },
  );

  const threads = threadsQuery.data ?? [];
  const visibleThreads = showAll
    ? threads
    : threads.slice(0, THREADS_SHOWN_INITIALLY);
  const hiddenCount = threads.length - THREADS_SHOWN_INITIALLY;
  const isCreatingForThis =
    createIsPending && createTargetProjectId === project.id;

  useEffect(() => {
    if (selectedProjectId === project.id) setExpanded(true);
  }, [project.id, selectedProjectId]);

  const submitRename = (thread: WorkshopThread) => {
    const trimmedTitle = editingTitle.trim();
    if (!trimmedTitle || renameIsPending) return;
    onRenameThread(thread, trimmedTitle);
    setEditingThreadId(null);
    setEditingTitle("");
  };

  return (
    <Collapsible open={expanded} onOpenChange={setExpanded}>
      <div className="group hover:bg-muted/40 flex items-center gap-1 rounded-md px-1 py-1">
        <WorkshopTooltip
          label={expanded ? "Collapse project" : "Expand project"}
        >
          <CollapsibleTrigger
            aria-label={
              expanded ? `Collapse ${project.name}` : `Expand ${project.name}`
            }
            aria-expanded={expanded}
            className="hover:bg-muted/60 flex shrink-0 cursor-pointer items-center justify-center rounded p-0.5 transition-colors"
          >
            <ChevronDown
              className={cn(
                "text-muted-foreground size-3 transition-transform duration-150",
                !expanded && "-rotate-90",
              )}
            />
          </CollapsibleTrigger>
        </WorkshopTooltip>
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="hover:bg-muted/60 flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-left transition-colors"
        >
          <Folder className="text-muted-foreground size-3.5 shrink-0" />
          <span className="min-w-0 flex-1 truncate text-sm font-semibold">
            {project.name}
          </span>
        </button>
        <WorkshopTooltip label="New thread">
          <button
            type="button"
            aria-label={`New thread in ${project.name}`}
            onClick={(e) => {
              e.stopPropagation();
              onNewThread(project.id);
            }}
            disabled={createIsPending}
            className="hover:bg-muted/60 flex shrink-0 cursor-pointer items-center justify-center rounded p-0.5 opacity-0 transition-opacity group-hover:opacity-100 disabled:cursor-not-allowed"
          >
            {isCreatingForThis ? (
              <Loader2 className="text-muted-foreground size-3 animate-spin" />
            ) : (
              <Plus className="text-muted-foreground size-3" />
            )}
          </button>
        </WorkshopTooltip>
      </div>

      <CollapsibleContent>
        <div className="border-border/40 mb-1 ml-4 border-l pl-2">
          {threadsQuery.isLoading ? (
            <div className="flex flex-col gap-1 py-1 pr-1">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-5 rounded" />
              ))}
            </div>
          ) : visibleThreads.length === 0 ? (
            <p className="text-muted-foreground/60 py-1.5 pr-1 text-xs">
              No threads yet
            </p>
          ) : (
            <div className="flex flex-col gap-0.5 py-0.5 pr-1">
              {visibleThreads.map((thread) => {
                const isSelected = thread.id === selectedThreadId;
                const isEditing = thread.id === editingThreadId;
                return (
                  <div
                    key={thread.id}
                    className={cn(
                      "group/thread flex items-center gap-1 rounded-md transition-colors",
                      isSelected
                        ? "bg-muted/60 text-foreground"
                        : "text-muted-foreground hover:bg-muted/40 hover:text-foreground",
                    )}
                  >
                    {isEditing ? (
                      <form
                        className="flex min-w-0 flex-1 items-center gap-1 px-1 py-1"
                        onSubmit={(event) => {
                          event.preventDefault();
                          submitRename(thread);
                        }}
                      >
                        <Input
                          value={editingTitle}
                          onChange={(event) =>
                            setEditingTitle(event.target.value)
                          }
                          autoFocus
                          className="h-6 text-xs"
                        />
                        <WorkshopTooltip label="Save name">
                          <button
                            type="submit"
                            disabled={renameIsPending || !editingTitle.trim()}
                            className="hover:bg-muted/60 flex size-6 shrink-0 cursor-pointer items-center justify-center rounded disabled:cursor-not-allowed disabled:opacity-50"
                            aria-label="Save thread name"
                          >
                            <Check className="size-3" />
                          </button>
                        </WorkshopTooltip>
                        <WorkshopTooltip label="Cancel rename">
                          <button
                            type="button"
                            onClick={() => {
                              setEditingThreadId(null);
                              setEditingTitle("");
                            }}
                            className="hover:bg-muted/60 flex size-6 shrink-0 cursor-pointer items-center justify-center rounded"
                            aria-label="Cancel rename"
                          >
                            <X className="size-3" />
                          </button>
                        </WorkshopTooltip>
                      </form>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => onSelectThread(thread.id, project.id)}
                          aria-current={isSelected ? "page" : undefined}
                          className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left"
                        >
                          <span
                            className={cn(
                              "min-w-0 flex-1 truncate text-xs",
                              isSelected ? "font-semibold" : "font-medium",
                            )}
                          >
                            {thread.title}
                          </span>
                          <span className="text-muted-foreground/60 shrink-0 text-[10px]">
                            {formatRelativeTime(thread.updatedAt)}
                          </span>
                        </button>
                        <div className="flex shrink-0 items-center pr-1 opacity-0 transition-opacity group-hover/thread:opacity-100">
                          <WorkshopTooltip label="Rename thread">
                            <button
                              type="button"
                              onClick={() => {
                                setEditingThreadId(thread.id);
                                setEditingTitle(thread.title);
                              }}
                              className="hover:bg-muted/60 flex size-6 cursor-pointer items-center justify-center rounded"
                              aria-label={`Rename ${thread.title}`}
                            >
                              <Pencil className="size-3" />
                            </button>
                          </WorkshopTooltip>
                          <WorkshopTooltip label="Delete thread">
                            <button
                              type="button"
                              onClick={() => onDeleteThread(thread)}
                              disabled={deleteIsPending}
                              className="hover:bg-destructive/15 hover:text-destructive flex size-6 cursor-pointer items-center justify-center rounded disabled:cursor-not-allowed disabled:opacity-50"
                              aria-label={`Delete ${thread.title}`}
                            >
                              <Trash2 className="size-3" />
                            </button>
                          </WorkshopTooltip>
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
              {hiddenCount > 0 && !showAll && (
                <button
                  type="button"
                  onClick={() => setShowAll(true)}
                  className="text-muted-foreground/50 hover:text-muted-foreground cursor-pointer px-2 py-1 text-left text-xs"
                >
                  Show more
                </button>
              )}
            </div>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function WorkshopProjectsSidebar({
  projects,
  isLoadingProjects,
  selectedProjectId,
  selectedThreadId,
  onSelectThread,
  onNewThread,
  onRenameThread,
  onDeleteThread,
  createIsPending,
  createTargetProjectId,
  renameIsPending,
  deleteIsPending,
}: {
  projects: RouterOutputs["project"]["list"] | undefined;
  isLoadingProjects: boolean;
  selectedProjectId: string | null;
  selectedThreadId: string | null;
  onSelectThread: (threadId: string, projectId: string) => void;
  onNewThread: (projectId: string) => void;
  onRenameThread: (thread: WorkshopThread, title: string) => void;
  onDeleteThread: (thread: WorkshopThread) => void;
  createIsPending: boolean;
  createTargetProjectId: string | null;
  renameIsPending: boolean;
  deleteIsPending: boolean;
}) {
  return (
    <aside className="bg-background/80 flex w-64 shrink-0 flex-col border-r border-(--border)">
      <div className="flex items-center gap-2 border-b border-(--border) px-4 py-3">
        <span className="text-muted-foreground text-[10px] font-semibold tracking-widest uppercase">
          Projects
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {isLoadingProjects ? (
          <div className="flex flex-col gap-2 p-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-6 rounded" />
            ))}
          </div>
        ) : !projects || projects.length === 0 ? (
          <p className="text-muted-foreground px-4 py-3 text-xs">No projects</p>
        ) : (
          <div className="flex flex-col gap-0.5">
            {projects.map((project) => (
              <ProjectSection
                key={project.id}
                project={project}
                selectedProjectId={selectedProjectId}
                selectedThreadId={selectedThreadId}
                onSelectThread={onSelectThread}
                onNewThread={onNewThread}
                onRenameThread={onRenameThread}
                onDeleteThread={onDeleteThread}
                createIsPending={createIsPending}
                createTargetProjectId={createTargetProjectId}
                renameIsPending={renameIsPending}
                deleteIsPending={deleteIsPending}
              />
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}

type WorkshopComposerProps = {
  selectedProjectId: string | null;
  sendIsPending: boolean;
  sendPrompt: (
    prompt: string,
    referenceImageIds: string[],
    attachments: PendingWorkshopAttachment[],
  ) => void;
  stopGeneration: () => void;
  selectedModel: WorkshopModel;
  setSelectedModel: (model: WorkshopModel) => void;
  selectedReasoningEffort: WorkshopReasoningEffort;
  setSelectedReasoningEffort: (effort: WorkshopReasoningEffort) => void;
  isMacOS: boolean | null;
};

function WorkshopComposer(props: WorkshopComposerProps) {
  const {
    selectedProjectId,
    sendIsPending,
    sendPrompt,
    stopGeneration,
    selectedModel,
    setSelectedModel,
    selectedReasoningEffort,
    setSelectedReasoningEffort,
    isMacOS,
  } = props;

  const [composer, setComposer] = useState("");
  const [pendingAttachments, setPendingAttachments] = useState<
    PendingWorkshopAttachment[]
  >([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { startUpload, isUploading } = useUploadThing("imageUploader");
  const utils = api.useUtils();
  const createRefImage = api.referenceImage.createReferenceImage.useMutation();

  const handleSend = () => {
    if (!canSend) return;
    const attachments = pendingAttachments;
    sendPrompt(
      trimmedComposer,
      attachments.map((attachment) => attachment.id),
      attachments,
    );
    setComposer("");
    setPendingAttachments([]);
  };

  const handleFileUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files?.length) return;

    const filesToUpload = Array.from(files);
    try {
      const uploaded = await startUpload(filesToUpload);
      if (!uploaded?.length) {
        toast.error("Image attachment upload failed");
        return;
      }

      const created = await Promise.allSettled(
        uploaded.map((file, index) =>
          createRefImage.mutateAsync({
            url: file.ufsUrl,
            mimeType: filesToUpload[index]?.type ?? undefined,
          }),
        ),
      );
      const attachments = created
        .filter(
          (
            result,
          ): result is PromiseFulfilledResult<
            Awaited<ReturnType<typeof createRefImage.mutateAsync>>
          > => result.status === "fulfilled",
        )
        .map((result) =>
          result.value
            ? {
                id: result.value.id,
                url: result.value.url,
                mimeType: result.value.mimeType,
              }
            : undefined,
        )
        .filter(
          (attachment): attachment is PendingWorkshopAttachment =>
            attachment !== undefined,
        );
      const failedCount = created.filter(
        (result) => result.status === "rejected",
      ).length;

      if (attachments.length > 0) {
        setPendingAttachments((prev) => [
          ...prev,
          ...attachments.filter(
            (attachment) => !prev.some((item) => item.id === attachment.id),
          ),
        ]);
        void utils.referenceImage.getReferenceImages.invalidate();
      }

      if (failedCount > 0) {
        toast.error(
          failedCount === 1
            ? "Failed to attach 1 image"
            : `Failed to attach ${failedCount} images`,
        );
      }
    } catch (error) {
      console.error("Failed to upload workshop image attachment", error);
      toast.error("Image attachment upload failed");
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    handleSend();
  };

  const trimmedComposer = composer.trim();
  const canSend =
    (trimmedComposer.length > 0 || pendingAttachments.length > 0) &&
    selectedProjectId !== null &&
    !sendIsPending &&
    !isUploading;

  const textareaShouldBeDisabled =
    selectedProjectId === null || sendIsPending || isUploading;
  const controlsShouldBeDisabled =
    selectedProjectId === null || sendIsPending || isUploading;
  const currentModel = WORKSHOP_MODELS.find((m) => m.slug === selectedModel);
  const currentReasoningEffort = WORKSHOP_REASONING_EFFORTS.find(
    (effort) => effort.value === selectedReasoningEffort,
  );

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 192)}px`;
  }, [composer]);

  useEffect(() => {
    try {
      const draft = sessionStorage.getItem(WORKSHOP_DRAFT_STORAGE_KEY);
      if (draft) {
        setComposer(draft);
        sessionStorage.removeItem(WORKSHOP_DRAFT_STORAGE_KEY);
      }
    } catch (error) {
      console.error("Failed to read workshop draft", error);
    }
  }, []);

  return (
    <div className="flex flex-col gap-2">
      <div className="border-input bg-background relative rounded-lg border transition-colors focus-within:border-blue-500">
        {pendingAttachments.length > 0 && (
          <div className="border-border/70 flex gap-2 overflow-x-auto border-b p-2">
            {pendingAttachments.map((attachment) => (
              <div
                key={attachment.id}
                className="group border-border bg-muted relative size-16 shrink-0 overflow-hidden rounded-md border"
              >
                {attachment.url ? (
                  <Image
                    src={attachment.url}
                    alt="Pending image attachment"
                    fill
                    sizes="64px"
                    className="object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center">
                    <ImagePlus className="text-muted-foreground size-5" />
                  </div>
                )}
                <button
                  type="button"
                  aria-label="Remove image attachment"
                  className="bg-background/90 text-foreground absolute top-1 right-1 flex size-5 cursor-pointer items-center justify-center rounded-full opacity-0 shadow-sm transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                  onClick={() =>
                    setPendingAttachments((prev) =>
                      prev.filter((item) => item.id !== attachment.id),
                    )
                  }
                >
                  <X className="size-3" />
                </button>
              </div>
            ))}
          </div>
        )}
        <Textarea
          ref={textareaRef}
          value={composer}
          onChange={(event) => setComposer(event.target.value)}
          onKeyDown={handleComposerKeyDown}
          placeholder={
            selectedProjectId
              ? "Ask for prompt feedback or revisions..."
              : "Select a project thread to start..."
          }
          disabled={textareaShouldBeDisabled}
          className="max-h-48 min-h-24 resize-none overflow-y-auto rounded-none border-0 bg-transparent pb-10 focus:border-0 focus:ring-0"
        />
        <div className="absolute right-2 bottom-2 left-2 flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1">
            <WorkshopTooltip label="Attach image">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="text-muted-foreground hover:text-foreground h-6 w-6 cursor-pointer"
                disabled={controlsShouldBeDisabled}
                onClick={() => fileInputRef.current?.click()}
                aria-label="Attach image"
              >
                {isUploading ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <ImagePlus className="size-3.5" />
                )}
              </Button>
            </WorkshopTooltip>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={handleFileUpload}
            />
            <div className="bg-border/70 h-4 w-px shrink-0" />
            <Select
              value={selectedModel}
              onValueChange={(value) => setSelectedModel(value!)}
              disabled={controlsShouldBeDisabled}
            >
              <SelectTrigger
                size="sm"
                className="text-muted-foreground hover:text-foreground h-6 max-w-36 cursor-pointer gap-1.5 border-none bg-transparent px-0 text-xs shadow-none transition-colors focus-visible:ring-0 disabled:cursor-not-allowed disabled:opacity-50 [&>svg]:size-3"
              >
                {currentModel && (
                  <div
                    className={cn(
                      "flex size-4 shrink-0 items-center justify-center rounded-sm",
                      currentModel.iconBg,
                    )}
                  >
                    <currentModel.LogoIcon className="size-2.5 text-white" />
                  </div>
                )}
                <span className="truncate">{currentModel?.name}</span>
              </SelectTrigger>
              <SelectContent
                align="start"
                alignItemWithTrigger={false}
                className="min-w-64"
              >
                {WORKSHOP_MODELS.map((model) => (
                  <SelectItem
                    key={model.slug}
                    value={model.slug}
                    className="cursor-pointer py-2 pr-10 pl-2"
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className={cn(
                          "flex size-8 shrink-0 items-center justify-center rounded-lg",
                          model.iconBg,
                        )}
                      >
                        <model.LogoIcon className="size-4 text-white" />
                      </div>
                      <div className="flex min-w-0 flex-col gap-0.5">
                        <span className="text-sm leading-none font-medium">
                          {model.name}
                        </span>
                        <span className="text-muted-foreground text-xs">
                          {model.provider} · {model.description}
                        </span>
                      </div>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="bg-border/70 h-4 w-px shrink-0" />
            <Select
              value={selectedReasoningEffort}
              onValueChange={(value) => setSelectedReasoningEffort(value!)}
              disabled={controlsShouldBeDisabled}
            >
              <SelectTrigger
                size="sm"
                className="text-muted-foreground hover:text-foreground h-6 max-w-40 cursor-pointer gap-1.5 border-none bg-transparent px-0 text-xs shadow-none transition-colors focus-visible:ring-0 disabled:cursor-not-allowed disabled:opacity-50 [&>svg]:size-3"
              >
                <Brain className="size-3.5 shrink-0" />
                <span className="truncate">
                  {currentReasoningEffort?.shortLabel}
                </span>
              </SelectTrigger>
              <SelectContent
                align="start"
                alignItemWithTrigger={false}
                className="min-w-44"
              >
                <div className="text-muted-foreground px-2 py-1.5 text-[10px] font-medium">
                  Reasoning
                </div>
                {WORKSHOP_REASONING_EFFORTS.map((effort) => (
                  <SelectItem
                    key={effort.value}
                    value={effort.value}
                    className="cursor-pointer"
                  >
                    {effort.label}
                    {effort.value === "medium" ? " (default)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <WorkshopTooltip
            label={sendIsPending ? "Stop generation" : "Send message"}
          >
            <Button
              type="button"
              size="icon"
              className="h-7 w-7 cursor-pointer"
              disabled={!canSend && !sendIsPending}
              onClick={sendIsPending ? stopGeneration : handleSend}
              aria-label={sendIsPending ? "Stop generation" : "Send message"}
            >
              {sendIsPending ? (
                <Square className="size-3.5 fill-current" />
              ) : (
                <Send className="size-3.5" />
              )}
            </Button>
          </WorkshopTooltip>
        </div>
      </div>
      <span
        className={cn(
          "mx-0 text-xs text-(--muted-foreground)",
          isMacOS === null ? "opacity-0" : "opacity-80",
        )}
      >
        Press Enter to send · Shift + Enter for a new line
      </span>
    </div>
  );
}

function ModelBadge({ slug }: { slug: string | null }) {
  const model = WORKSHOP_MODELS.find((m) => m.slug === slug);
  if (!model) {
    return (
      <span className="text-muted-foreground text-xs">{slug ?? "Agent"}</span>
    );
  }

  return (
    <span className="text-muted-foreground inline-flex items-center gap-1.5 text-xs">
      <span
        className={cn(
          "flex size-4 shrink-0 items-center justify-center rounded-sm",
          model.iconBg,
        )}
      >
        <model.LogoIcon className="size-2.5 text-white" />
      </span>
      <span className="font-medium">{model.name}</span>
    </span>
  );
}

function WorkshopMessageBubble({ message }: { message: WorkshopMessage }) {
  const isUser = message.role === "user";
  const attachments = message.attachments ?? [];

  return (
    <div
      className={cn(
        "flex w-full [animation:promptGroupFadeIn_0.25s_ease_both]",
        isUser ? "justify-end" : "justify-start",
      )}
    >
      <div
        className={cn(
          "max-w-[min(780px,85%)] rounded-lg border px-4 py-3 text-sm leading-relaxed shadow-sm",
          isUser
            ? "text-foreground border-blue-500/30 bg-blue-500/15 whitespace-pre-wrap"
            : "border-border bg-card text-card-foreground",
        )}
      >
        {!isUser && (
          <div className="mb-2 flex items-center">
            <ModelBadge slug={message.model} />
          </div>
        )}
        {attachments.length > 0 && (
          <div
            className={cn(
              "grid gap-2",
              message.content && "mb-3",
              attachments.length === 1
                ? "max-w-[280px] grid-cols-1"
                : attachments.length <= 4
                  ? "grid-cols-2"
                  : "grid-cols-3",
            )}
          >
            {attachments.map((attachment) =>
              attachment.url ? (
                <div
                  key={attachment.id}
                  className="border-border/60 bg-muted relative aspect-square overflow-hidden rounded-md border"
                >
                  <Image
                    src={attachment.url}
                    alt="Workshop image attachment"
                    fill
                    sizes="(max-width: 768px) 40vw, 160px"
                    className="object-cover"
                  />
                </div>
              ) : null,
            )}
          </div>
        )}
        {message.content && (
          <Markdown
            components={{
              blockquote({ children }) {
                return (
                  <blockquote className="border-border/60 text-muted-foreground my-1 border-l-2 pl-3 italic">
                    {children}
                  </blockquote>
                );
              },
              h1({ children }) {
                return (
                  <h1 className="mt-2 mb-1 text-lg font-bold">{children}</h1>
                );
              },
              h2({ children }) {
                return (
                  <h2 className="mt-2 mb-1 text-base font-bold">{children}</h2>
                );
              },
              h3({ children }) {
                return (
                  <h3 className="mt-2 mb-1 text-sm font-semibold">
                    {children}
                  </h3>
                );
              },
              h4({ children }) {
                return (
                  <h4 className="text-md pbs-2 pbe-2 font-bold">{children}</h4>
                );
              },
              h5({ children }) {
                return (
                  <h5 className="text-md pbs-2 pbe-2 font-bold">{children}</h5>
                );
              },
              h6({ children }) {
                return (
                  <h6 className="text-md pbs-2 pbe-2 font-bold">{children}</h6>
                );
              },
              ol({ children }) {
                return <ol className="my-1 ml-5 list-decimal">{children}</ol>;
              },
              ul({ children }) {
                return <ul className="my-1 ml-5 list-disc">{children}</ul>;
              },
              pre({ children }) {
                return (
                  <pre className="bg-background/60 border-border/60 my-1 overflow-x-auto rounded-md border p-2 text-xs">
                    {children}
                  </pre>
                );
              },
              code({ children }) {
                return (
                  <code className="bg-background/60 border-border/60 rounded border px-1 py-0.5 font-mono text-xs">
                    {children}
                  </code>
                );
              },
              p({ children }) {
                return <p className="mb-1 last:mb-0">{children}</p>;
              },
            }}
          >
            {message.content}
          </Markdown>
        )}
      </div>
    </div>
  );
}

function WorkshopToolCallLine({ message }: { message: WorkshopMessage }) {
  const agentName =
    WORKSHOP_MODELS.find((model) => model.slug === message.model)?.name ??
    "Agent";

  return (
    <div className="flex [animation:promptGroupFadeIn_0.25s_ease_both] justify-center">
      <div className="text-muted-foreground border-border bg-card/60 flex max-w-[min(520px,90%)] items-center gap-2 rounded-full border px-3 py-1.5 text-xs backdrop-blur-sm">
        <Sparkles className="size-3 shrink-0 text-blue-400" />
        <span className="truncate">
          <span className="font-medium">{agentName}</span> suggested a prompt
        </span>
      </div>
    </div>
  );
}

function WorkshopReasoningSummaryLine({
  message,
}: {
  message: WorkshopMessage;
}) {
  const [expanded, setExpanded] = useState(
    message.id.startsWith("streaming-reasoning-"),
  );
  const agentName =
    WORKSHOP_MODELS.find((model) => model.slug === message.model)?.name ??
    "Agent";

  return (
    <div className="flex [animation:promptGroupFadeIn_0.25s_ease_both] justify-start">
      <Collapsible
        open={expanded}
        onOpenChange={setExpanded}
        className="border-border bg-card/70 max-w-[min(680px,85%)] overflow-hidden rounded-lg border text-sm shadow-sm"
      >
        <CollapsibleTrigger className="text-muted-foreground hover:text-foreground flex w-full cursor-pointer items-center justify-between gap-3 px-4 py-2.5 text-left transition-colors">
          <span className="flex min-w-0 items-center gap-2">
            <Brain className="size-3.5 shrink-0 text-blue-400" />
            <span className="truncate text-xs">
              <span className="font-medium">{agentName}</span> reasoning summary
            </span>
          </span>
          {expanded ? (
            <ChevronUp className="size-4 shrink-0" />
          ) : (
            <ChevronDown className="size-4 shrink-0" />
          )}
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="border-border/70 text-muted-foreground border-t px-4 py-3 text-xs leading-relaxed">
            <Markdown
              components={{
                p({ children }) {
                  return <p className="mb-1 last:mb-0">{children}</p>;
                },
                ul({ children }) {
                  return <ul className="my-1 ml-4 list-disc">{children}</ul>;
                },
                ol({ children }) {
                  return <ol className="my-1 ml-4 list-decimal">{children}</ol>;
                },
              }}
            >
              {message.content}
            </Markdown>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

function MessageSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <Skeleton className="h-24 w-2/3 rounded-lg" />
      <Skeleton className="ml-auto h-16 w-1/2 rounded-lg" />
      <Skeleton className="h-32 w-3/4 rounded-lg" />
    </div>
  );
}

function SuggestedPromptCard({
  prompt,
  expanded,
  onExpandedChange,
  onUse,
}: {
  prompt: string;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  onUse: () => void;
}) {
  return (
    <Collapsible
      open={expanded}
      onOpenChange={onExpandedChange}
      className="[animation:promptGroupFadeIn_0.3s_ease_both] overflow-hidden rounded-lg border border-blue-500/30 bg-blue-500/10"
    >
      <div className="flex items-center justify-between gap-2 px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-1.5">
          <Sparkles className="size-3.5 shrink-0 text-blue-400" />
          <h2 className="text-[10px] font-semibold tracking-wide text-blue-300 uppercase">
            Suggested prompt
          </h2>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button
            type="button"
            size="sm"
            className="cursor-pointer bg-blue-500 text-white hover:bg-blue-500/90"
            onClick={onUse}
          >
            <Check />
            Use prompt
          </Button>
          <WorkshopTooltip
            label={
              expanded ? "Collapse suggested prompt" : "Expand suggested prompt"
            }
          >
            <CollapsibleTrigger
              aria-label={
                expanded
                  ? "Collapse suggested prompt"
                  : "Expand suggested prompt"
              }
              className="hover:text-foreground flex size-7 cursor-pointer items-center justify-center rounded-md text-(--muted-foreground) transition-colors hover:bg-blue-500/15"
            >
              {expanded ? (
                <ChevronUp className="size-4" />
              ) : (
                <ChevronDown className="size-4" />
              )}
            </CollapsibleTrigger>
          </WorkshopTooltip>
        </div>
      </div>
      <CollapsibleContent>
        <div className="border-t border-blue-500/20 px-4 py-3">
          <p className="text-foreground/90 line-clamp-6 text-sm leading-relaxed whitespace-pre-wrap">
            {prompt}
          </p>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function WorkshopEmptyState({
  selectedProjectId,
  selectedThreadId,
}: {
  selectedProjectId: string | null;
  selectedThreadId: string | null;
}) {
  const heading = selectedProjectId
    ? selectedThreadId
      ? "Start a conversation with the workshop"
      : "Start a workshop thread"
    : "Select a thread to get started";

  const body = selectedProjectId
    ? "Describe what you want to create and the assistant will help you craft a prompt"
    : "Choose a project from the sidebar and select or create a thread";

  return (
    <div className="flex min-h-[40vh] flex-1 flex-col items-center justify-center gap-3 text-center">
      <div className="bg-card border-border flex size-11 items-center justify-center rounded-xl border">
        <MessagesSquare className="text-muted-foreground size-5" />
      </div>
      <p className="text-foreground text-sm font-medium">{heading}</p>
      <p className="text-muted-foreground/60 max-w-sm text-xs">{body}</p>
    </div>
  );
}

function isOpenAIWorkshopModel(model: WorkshopModel) {
  return model.startsWith("gpt-");
}

function parseWorkshopStreamBlock(block: string): WorkshopStreamEvent | null {
  let event = "message";
  const dataLines: string[] = [];

  for (const line of block.split("\n")) {
    if (line.startsWith("event:")) {
      event = line.slice("event:".length).trim();
    } else if (line.startsWith("data:")) {
      dataLines.push(line.slice("data:".length).trimStart());
    }
  }

  if (dataLines.length === 0) return null;

  return {
    event,
    data: JSON.parse(dataLines.join("\n")) as unknown,
  } as WorkshopStreamEvent;
}

export default function WorkshopPage() {
  const [selectedModel, setSelectedModel] = useState<WorkshopModel>("gpt-5.4");
  const [selectedReasoningEffort, setSelectedReasoningEffort] =
    useState<WorkshopReasoningEffort>("medium");
  const [threadToDelete, setThreadToDelete] = useState<WorkshopThread | null>(
    null,
  );
  const [isMacOS, setIsMacOS] = useState<boolean | null>(null);
  const [suggestedPromptExpanded, setSuggestedPromptExpanded] = useState(true);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
    null,
  );
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [createTargetProjectId, setCreateTargetProjectId] = useState<
    string | null
  >(null);
  const [isStreamingSend, setIsStreamingSend] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const suggestedPromptRef = useRef<HTMLDivElement>(null);
  const optimisticUserMessageIdRef = useRef<string | null>(null);
  const streamingReasoningMessageIdRef = useRef<string | null>(null);
  const streamAbortControllerRef = useRef<AbortController | null>(null);
  const utils = api.useUtils();
  const router = useRouter();
  const user = useUser();
  const [bypassMonthlyQuota, setBypassMonthlyQuota] =
    useLocalStorage("bypassMonthlyQuota");
  const canBypassLimits = user.user?.publicMetadata.canBypassLimits === true;
  const effectiveBypassMonthlyQuota = canBypassLimits && bypassMonthlyQuota;

  useEffect(() => {
    setIsMacOS(navigator?.userAgent.toLowerCase().includes("mac"));
  }, []);

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

  const { data: projects, isLoading: isLoadingProjects } =
    api.project.list.useQuery();
  const { selectedProjectId: activeProjectId, onSelectProject } =
    useActiveProject(projects);
  const [lastThreadByProject, setLastThreadByProject] = useLocalStorage(
    "workshopLastThreadByProject",
  );

  const selectedProjectThreadsQuery = api.workshop.listThreads.useQuery(
    { projectId: selectedProjectId ?? "" },
    { enabled: Boolean(selectedProjectId && !selectedThreadId) },
  );

  const messagesQuery = api.workshop.list.useQuery(
    { projectId: selectedProjectId ?? "", threadId: selectedThreadId ?? "" },
    { enabled: Boolean(selectedProjectId && selectedThreadId) },
  );
  const messages = useMemo(
    () => messagesQuery.data ?? [],
    [messagesQuery.data],
  );
  const latestSuggestedPrompt = useMemo(() => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (message?.role === "suggest_prompt") return message.content;
    }

    return null;
  }, [messages]);

  useEffect(() => {
    if (latestSuggestedPrompt) setSuggestedPromptExpanded(true);
  }, [latestSuggestedPrompt]);

  const rememberThread = (projectId: string, threadId: string) => {
    setLastThreadByProject(
      (prev: LocalStorageValue<"workshopLastThreadByProject">) => {
        const next = prev.filter((item) => item.projectId !== projectId);
        return [...next, { projectId, threadId }];
      },
    );
  };

  useEffect(() => {
    if (!selectedProjectId && activeProjectId) {
      setSelectedProjectId(activeProjectId);
    }
  }, [activeProjectId, selectedProjectId]);

  useEffect(() => {
    if (!selectedProjectId || selectedThreadId) return;

    const rememberedThreadId = lastThreadByProject.find(
      (item) => item.projectId === selectedProjectId,
    )?.threadId;
    if (!rememberedThreadId) return;

    const threads = selectedProjectThreadsQuery.data;
    if (!threads) return;

    if (threads.some((thread) => thread.id === rememberedThreadId)) {
      setSelectedThreadId(rememberedThreadId);
    } else {
      setLastThreadByProject((prev) =>
        prev.filter((item) => item.projectId !== selectedProjectId),
      );
    }
  }, [
    lastThreadByProject,
    selectedProjectId,
    selectedProjectThreadsQuery.data,
    selectedThreadId,
    setLastThreadByProject,
  ]);

  const applySendResult = (
    result: WorkshopSendResult,
    variables: { projectId: string },
  ) => {
    const optimisticId = optimisticUserMessageIdRef.current;
    const streamingReasoningId = streamingReasoningMessageIdRef.current;
    optimisticUserMessageIdRef.current = null;
    streamingReasoningMessageIdRef.current = null;

    setSelectedProjectId(variables.projectId);
    setSelectedThreadId(result.thread.id);
    onSelectProject(variables.projectId);
    rememberThread(variables.projectId, result.thread.id);
    utils.workshop.list.setData(
      { projectId: variables.projectId, threadId: result.thread.id },
      (old) => [
        ...(old ?? []).filter(
          (message) =>
            message.id !== optimisticId && message.id !== streamingReasoningId,
        ),
        result.userMessage,
        ...result.assistantMessages,
      ],
    );
    utils.workshop.listThreads.setData(
      { projectId: variables.projectId },
      (old) => {
        const filtered = (old ?? []).filter(
          (item) => item.id !== result.thread.id,
        );
        return [result.thread, ...filtered];
      },
    );
    void utils.workshop.list.invalidate({
      projectId: variables.projectId,
      threadId: result.thread.id,
    });
    void utils.workshop.listThreads.invalidate({
      projectId: variables.projectId,
    });
    void utils.usage.getCurrent.invalidate();
  };

  const sendMessage = api.workshop.sendMessage.useMutation({
    onSuccess: (result, variables) => {
      applySendResult(result, variables);
    },
    onError: (error, variables) => {
      optimisticUserMessageIdRef.current = null;
      streamingReasoningMessageIdRef.current = null;
      toast.error(error.message || "Failed to generate assistant response");
      if (variables.threadId) {
        void utils.workshop.list.invalidate({
          projectId: variables.projectId,
          threadId: variables.threadId,
        });
      }
      void utils.usage.getCurrent.invalidate();
    },
  });

  const createThread = api.workshop.createThread.useMutation({
    onSuccess: (thread) => {
      setSelectedProjectId(thread.projectId);
      setSelectedThreadId(thread.id);
      onSelectProject(thread.projectId);
      rememberThread(thread.projectId, thread.id);
      setCreateTargetProjectId(null);
      utils.workshop.listThreads.setData(
        { projectId: thread.projectId },
        (old) => [
          thread,
          ...(old ?? []).filter((item) => item.id !== thread.id),
        ],
      );
      void utils.workshop.listThreads.invalidate({
        projectId: thread.projectId,
      });
    },
    onError: () => {
      setCreateTargetProjectId(null);
      toast.error("Failed to create workshop thread");
    },
  });

  const renameThread = api.workshop.renameThread.useMutation({
    onSuccess: (thread) => {
      utils.workshop.listThreads.setData(
        { projectId: thread.projectId },
        (old) =>
          (old ?? []).map((item) => (item.id === thread.id ? thread : item)),
      );
      void utils.workshop.listThreads.invalidate({
        projectId: thread.projectId,
      });
    },
    onError: () => {
      toast.error("Failed to rename workshop thread");
    },
  });

  const deleteThread = api.workshop.deleteThread.useMutation({
    onSuccess: (_, variables) => {
      utils.workshop.listThreads.setData(
        { projectId: variables.projectId },
        (old) => (old ?? []).filter((item) => item.id !== variables.threadId),
      );
      utils.workshop.list.setData(
        { projectId: variables.projectId, threadId: variables.threadId },
        [],
      );
      setLastThreadByProject((prev) =>
        prev.filter((item) => item.threadId !== variables.threadId),
      );
      if (selectedThreadId === variables.threadId) {
        setSelectedThreadId(null);
        setSelectedProjectId(variables.projectId);
      }
      setThreadToDelete(null);
      void utils.workshop.listThreads.invalidate({
        projectId: variables.projectId,
      });
    },
    onError: () => {
      toast.error("Failed to delete workshop thread");
    },
  });

  const sendIsPending = sendMessage.isPending || isStreamingSend;

  useEffect(() => {
    const target = suggestedPromptRef.current ?? bottomRef.current;
    target?.scrollIntoView({ block: "end" });
  }, [messages.length, sendIsPending, latestSuggestedPrompt]);

  const handleSelectThread = (threadId: string, projectId: string) => {
    setSelectedProjectId(projectId);
    setSelectedThreadId(threadId);
    onSelectProject(projectId);
    rememberThread(projectId, threadId);
  };

  const handleNewThread = (projectId: string) => {
    if (createThread.isPending) return;
    setCreateTargetProjectId(projectId);
    createThread.mutate({ projectId });
  };

  const addOptimisticUserMessage = (
    projectId: string,
    threadId: string,
    optimisticId: string,
    content: string,
    attachments: PendingWorkshopAttachment[],
  ) => {
    utils.workshop.list.setData({ projectId, threadId }, (old) => [
      ...(old ?? []),
      {
        id: optimisticId,
        userId: "",
        projectId,
        threadId,
        role: "user",
        model: null,
        content,
        referenceImages:
          attachments.length > 0
            ? attachments.map((attachment) => attachment.id)
            : null,
        referenceImageIds: attachments.map((attachment) => attachment.id),
        attachments,
        createdAt: new Date(),
      },
    ]);
  };

  const appendStreamingReasoningDelta = (
    projectId: string,
    threadId: string,
    model: WorkshopModel,
    delta: string,
  ) => {
    let reasoningId = streamingReasoningMessageIdRef.current;
    if (!reasoningId) {
      reasoningId = `streaming-reasoning-${crypto.randomUUID()}`;
      streamingReasoningMessageIdRef.current = reasoningId;
    }

    const targetId = reasoningId;
    utils.workshop.list.setData({ projectId, threadId }, (old) => {
      const messages = old ?? [];
      const existing = messages.find((message) => message.id === targetId);
      if (existing) {
        return messages.map((message) =>
          message.id === targetId
            ? { ...message, content: `${message.content}${delta}` }
            : message,
        );
      }

      return [
        ...messages,
        {
          id: targetId,
          userId: "",
          projectId,
          threadId,
          role: "reasoning_summary",
          model,
          content: delta,
          referenceImages: null,
          referenceImageIds: [],
          attachments: [],
          createdAt: new Date(),
        },
      ];
    });
  };

  const sendPromptStream = async (
    prompt: string,
    referenceImageIds: string[],
    attachments: PendingWorkshopAttachment[],
  ) => {
    if (!selectedProjectId || isStreamingSend) return;

    const projectId = selectedProjectId;
    const model = selectedModel;
    const optimisticId = `optimistic-${crypto.randomUUID()}`;
    optimisticUserMessageIdRef.current = optimisticId;
    let activeThreadId = selectedThreadId;
    let hasAddedOptimisticUser = false;
    let hasReceivedTerminalEvent = false;

    if (activeThreadId) {
      addOptimisticUserMessage(
        projectId,
        activeThreadId,
        optimisticId,
        prompt,
        attachments,
      );
      hasAddedOptimisticUser = true;
    }

    setIsStreamingSend(true);
    const abortController = new AbortController();
    streamAbortControllerRef.current = abortController;

    try {
      const response = await fetch("/api/workshop/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: abortController.signal,
        body: JSON.stringify({
          projectId,
          threadId: selectedThreadId ?? undefined,
          content: prompt,
          model,
          reasoningEffort: selectedReasoningEffort,
          requestQuotaBypass: effectiveBypassMonthlyQuota,
          referenceImageIds,
        }),
      });

      if (!response.ok || !response.body) {
        throw new Error("Failed to generate assistant response");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const blocks = buffer.split("\n\n");
        buffer = blocks.pop() ?? "";

        for (const block of blocks) {
          const streamEvent = parseWorkshopStreamBlock(block);
          if (!streamEvent) continue;

          if (streamEvent.event === "thread") {
            const { thread } = streamEvent.data;
            activeThreadId = thread.id;
            setSelectedProjectId(projectId);
            setSelectedThreadId(thread.id);
            onSelectProject(projectId);
            rememberThread(projectId, thread.id);
            utils.workshop.listThreads.setData({ projectId }, (old) => {
              const filtered = (old ?? []).filter(
                (item) => item.id !== thread.id,
              );
              return [thread, ...filtered];
            });

            if (!hasAddedOptimisticUser) {
              addOptimisticUserMessage(
                projectId,
                thread.id,
                optimisticId,
                prompt,
                attachments,
              );
              hasAddedOptimisticUser = true;
            }
          } else if (streamEvent.event === "reasoning_delta") {
            if (!activeThreadId) continue;
            appendStreamingReasoningDelta(
              projectId,
              activeThreadId,
              model,
              streamEvent.data.delta,
            );
          } else if (streamEvent.event === "done") {
            hasReceivedTerminalEvent = true;
            applySendResult(streamEvent.data, { projectId });
          } else if (streamEvent.event === "error") {
            hasReceivedTerminalEvent = true;
            throw new Error(
              streamEvent.data.message ??
                "Failed to generate assistant response",
            );
          }
        }
      }

      if (buffer.trim()) {
        const streamEvent = parseWorkshopStreamBlock(buffer);
        if (streamEvent?.event === "done") {
          hasReceivedTerminalEvent = true;
          applySendResult(streamEvent.data, { projectId });
        } else if (streamEvent?.event === "error") {
          hasReceivedTerminalEvent = true;
          throw new Error(
            streamEvent.data.message ?? "Failed to generate assistant response",
          );
        }
      }

      if (!hasReceivedTerminalEvent) {
        throw new Error("Workshop stream ended before completion");
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        toast.info("Generation stopped");
      } else {
        toast.error(
          error instanceof Error
            ? error.message
            : "Failed to generate assistant response",
        );
      }
      optimisticUserMessageIdRef.current = null;
      streamingReasoningMessageIdRef.current = null;
      if (activeThreadId) {
        utils.workshop.list.setData(
          { projectId, threadId: activeThreadId },
          (old) =>
            (old ?? []).filter(
              (message) =>
                message.id !== optimisticId &&
                !message.id.startsWith("streaming-reasoning-"),
            ),
        );
        void utils.workshop.list.invalidate({
          projectId,
          threadId: activeThreadId,
        });
      }
      hasAddedOptimisticUser = false;
      void utils.usage.getCurrent.invalidate();
    } finally {
      setIsStreamingSend(false);
      streamAbortControllerRef.current = null;
    }
  };

  const sendPrompt = (
    prompt: string,
    referenceImageIds: string[],
    attachments: PendingWorkshopAttachment[],
  ) => {
    const trimmedPrompt = prompt.trim();
    if (
      !selectedProjectId ||
      (trimmedPrompt.length === 0 && referenceImageIds.length === 0) ||
      sendIsPending
    )
      return;

    if (isOpenAIWorkshopModel(selectedModel)) {
      void sendPromptStream(trimmedPrompt, referenceImageIds, attachments);
      return;
    }

    if (selectedThreadId) {
      const optimisticId = `optimistic-${crypto.randomUUID()}`;
      optimisticUserMessageIdRef.current = optimisticId;
      addOptimisticUserMessage(
        selectedProjectId,
        selectedThreadId,
        optimisticId,
        trimmedPrompt,
        attachments,
      );
    }

    sendMessage.mutate({
      projectId: selectedProjectId,
      threadId: selectedThreadId ?? undefined,
      content: trimmedPrompt,
      model: selectedModel,
      reasoningEffort: selectedReasoningEffort,
      requestQuotaBypass: effectiveBypassMonthlyQuota,
      referenceImageIds,
    });
  };

  const stopGeneration = () => {
    streamAbortControllerRef.current?.abort();
  };

  const isLoadingMessages =
    Boolean(selectedProjectId && selectedThreadId) && messagesQuery.isLoading;
  const errorMessage =
    messagesQuery.error && messagesQuery.error.data?.code !== "NOT_FOUND"
      ? messagesQuery.error.message
      : undefined;

  return (
    <main className="bg-background text-foreground flex h-screen w-screen flex-col overflow-hidden">
      <header className="bg-background/95 sticky top-0 z-30 flex items-center justify-between gap-4 border-b border-(--border) px-6 py-4 backdrop-blur">
        <div className="flex min-w-0 items-center gap-3">
          <WorkshopTooltip label="Back to generations">
            <Link
              href="/"
              aria-label="Back to generations"
              className={buttonVariants({
                variant: "ghost",
                size: "icon",
                className: "cursor-pointer",
              })}
            >
              <ArrowLeft />
            </Link>
          </WorkshopTooltip>
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-blue-500/15 ring-1 ring-blue-500/30">
              <Sparkles className="size-4 text-blue-400" />
            </div>
            <div className="min-w-0">
              <h1 className="font-heading text-base leading-tight font-bold">
                Prompt Workshop
              </h1>
              <p className="text-muted-foreground truncate text-xs">
                Refine prompts with an AI collaborator
              </p>
            </div>
          </div>
        </div>
      </header>

      <section className="flex min-h-0 flex-1">
        <WorkshopProjectsSidebar
          projects={projects}
          isLoadingProjects={isLoadingProjects}
          selectedProjectId={selectedProjectId}
          selectedThreadId={selectedThreadId}
          onSelectThread={handleSelectThread}
          onNewThread={handleNewThread}
          onRenameThread={(thread, title) =>
            renameThread.mutate({
              projectId: thread.projectId,
              threadId: thread.id,
              title,
            })
          }
          onDeleteThread={setThreadToDelete}
          createIsPending={createThread.isPending}
          createTargetProjectId={createTargetProjectId}
          renameIsPending={renameThread.isPending}
          deleteIsPending={deleteThread.isPending}
        />

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-8">
            <div className="mx-auto flex w-full max-w-4xl flex-col gap-5">
              {errorMessage ? (
                <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 text-center">
                  <div className="border-destructive/40 bg-destructive/10 text-destructive flex size-11 items-center justify-center rounded-xl border">
                    <Trash2 className="size-5" />
                  </div>
                  <p className="text-foreground text-sm font-medium">
                    Failed to load workshop history
                  </p>
                  <p className="text-muted-foreground/60 max-w-sm text-xs">
                    {errorMessage}
                  </p>
                </div>
              ) : isLoadingMessages ? (
                <MessageSkeleton />
              ) : messages.length === 0 ? (
                <WorkshopEmptyState
                  selectedProjectId={selectedProjectId}
                  selectedThreadId={selectedThreadId}
                />
              ) : (
                messages.map((message) =>
                  message.role === "suggest_prompt" ? (
                    <WorkshopToolCallLine key={message.id} message={message} />
                  ) : message.role === "reasoning_summary" ? (
                    <WorkshopReasoningSummaryLine
                      key={message.id}
                      message={message}
                    />
                  ) : (
                    <WorkshopMessageBubble key={message.id} message={message} />
                  ),
                )
              )}
              {sendIsPending && (
                <div className="flex [animation:promptGroupFadeIn_0.25s_ease_both] justify-start">
                  <div className="border-border bg-card text-muted-foreground flex items-center gap-2 rounded-lg border px-4 py-3 text-sm shadow-sm">
                    <Loader2 className="size-3.5 animate-spin text-blue-400" />
                    <span className="animate-pulse">Thinking…</span>
                  </div>
                </div>
              )}
              {latestSuggestedPrompt && (
                <div ref={suggestedPromptRef}>
                  <SuggestedPromptCard
                    prompt={latestSuggestedPrompt}
                    expanded={suggestedPromptExpanded}
                    onExpandedChange={setSuggestedPromptExpanded}
                    onUse={() => {
                      try {
                        sessionStorage.setItem(
                          WORKSHOP_ACCEPTED_PROMPT_STORAGE_KEY,
                          latestSuggestedPrompt,
                        );
                      } catch (error) {
                        console.error(
                          "Failed to save workshop suggested prompt",
                          error,
                        );
                        toast.error("Failed to use suggested prompt");
                        return;
                      }
                      router.push("/");
                    }}
                  />
                </div>
              )}
              <div ref={bottomRef} />
            </div>
          </div>

          <div className="bg-background/95 border-t border-(--border) px-6 py-4 backdrop-blur">
            <div className="mx-auto flex w-full max-w-4xl flex-col gap-3">
              <WorkshopComposer
                selectedProjectId={selectedProjectId}
                sendIsPending={sendIsPending}
                sendPrompt={sendPrompt}
                stopGeneration={stopGeneration}
                selectedModel={selectedModel}
                setSelectedModel={setSelectedModel}
                selectedReasoningEffort={selectedReasoningEffort}
                setSelectedReasoningEffort={setSelectedReasoningEffort}
                isMacOS={isMacOS}
              />
            </div>
          </div>
        </div>
      </section>

      <ConfirmDialog
        open={threadToDelete !== null}
        title="Delete workshop thread?"
        description="This deletes the selected workshop thread and every message in it."
        confirmLabel="Delete"
        isPending={deleteThread.isPending}
        onConfirm={() => {
          if (!threadToDelete) return;
          deleteThread.mutate({
            projectId: threadToDelete.projectId,
            threadId: threadToDelete.id,
          });
        }}
        onCancel={() => setThreadToDelete(null)}
      />
    </main>
  );
}
