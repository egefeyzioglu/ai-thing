"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronUp,
  Loader2,
  MessagesSquare,
  Send,
  Sparkles,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { ProjectSwitcher } from "src/app/_components/project-switcher";
import { useActiveProject } from "src/app/_hooks/use-active-project";
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
import { Textarea } from "src/components/ui/textarea";
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

function GeminiIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M12 24A14.304 14.304 0 0 0 0 12 14.304 14.304 0 0 0 12 0a14.304 14.304 0 0 0 12 12 14.304 14.304 0 0 0-12 12" />
    </svg>
  );
}

const WORKSHOP_MODELS = [
  {
    slug: "gpt-5.4-mini" as const,
    name: "GPT 5.4 Mini",
    provider: "OpenAI",
    description: "Fast · concise",
    iconBg: "bg-black dark:bg-neutral-800",
    LogoIcon: OpenAIIcon,
  },
  {
    slug: "gemini-3-flash-preview" as const,
    name: "Gemini 3 Flash",
    provider: "Google",
    description: "Fast · multimodal",
    iconBg: "bg-blue-500",
    LogoIcon: GeminiIcon,
  },
];

type WorkshopModel = (typeof WORKSHOP_MODELS)[number]["slug"];
type WorkshopMessage = RouterOutputs["workshop"]["list"][number];

type WorkshopComposerProps = {
  selectedProjectId: string | null;
  sendIsPending: boolean;
  sendPrompt: (prompt: string) => void;
  selectedModel: WorkshopModel;
  setSelectedModel: (model: WorkshopModel) => void;
  isMacOS: boolean | null;
};

function WorkshopComposer(props: WorkshopComposerProps) {
  const {
    selectedProjectId,
    sendIsPending,
    sendPrompt,
    selectedModel,
    setSelectedModel,
    isMacOS,
  } = props;

  const [composer, setComposer] = useState("");

  const handleSend = () => {
    if (!canSend) return;
    sendPrompt(trimmedComposer);
    setComposer("");
  };

  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    handleSend();
  };

  const trimmedComposer = composer.trim();
  const canSend =
    trimmedComposer.length > 0 && selectedProjectId !== null && !sendIsPending;

  const textareaShouldBeDisabled = selectedProjectId === null || sendIsPending;
  const currentModel = WORKSHOP_MODELS.find((m) => m.slug === selectedModel);

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
      <div className="relative">
        <Textarea
          value={composer}
          onChange={(event) => setComposer(event.target.value)}
          onKeyDown={handleComposerKeyDown}
          placeholder={
            selectedProjectId
              ? "Ask for prompt feedback or revisions..."
              : "Select a project to start..."
          }
          disabled={textareaShouldBeDisabled}
          className="max-h-48 min-h-24 resize-none pb-10"
        />
        <div className="absolute right-2 bottom-2 left-2 flex items-center justify-between">
          <Select
            value={selectedModel}
            onValueChange={(value) => setSelectedModel(value!)}
            disabled={textareaShouldBeDisabled}
          >
            <SelectTrigger
              size="sm"
              className="text-muted-foreground hover:text-foreground h-6 cursor-pointer gap-1.5 border-none bg-transparent px-0 text-xs shadow-none transition-colors focus-visible:ring-0 disabled:cursor-not-allowed disabled:opacity-50 [&>svg]:size-3"
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
              <span>{currentModel?.name}</span>
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
          <Button
            type="button"
            size="icon"
            className="h-7 w-7 cursor-pointer"
            disabled={!canSend}
            onClick={handleSend}
            aria-label="Send message"
          >
            {sendIsPending ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Send className="size-3.5" />
            )}
          </Button>
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
            ? "border-blue-500/30 bg-blue-500/15 text-foreground whitespace-pre-wrap"
            : "border-border bg-card text-card-foreground",
        )}
      >
        {!isUser && (
          <div className="mb-2 flex items-center">
            <ModelBadge slug={message.model} />
          </div>
        )}
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
                <h3 className="mt-2 mb-1 text-sm font-semibold">{children}</h3>
              );
            },
            h4({ children }) {
              return (
<<<<<<< HEAD
                <h4 className="text-md pbs-2 pbe-2 font-bold">{children}</h4>
=======
                <h4 className="mt-2 mb-1 text-sm font-semibold">{children}</h4>
>>>>>>> ff8819a (Refresh workshop prompt UI)
              );
            },
            h5({ children }) {
              return (
<<<<<<< HEAD
                <h5 className="text-md pbs-2 pbe-2 font-bold">{children}</h5>
=======
                <h5 className="mt-2 mb-1 text-sm font-semibold">{children}</h5>
>>>>>>> ff8819a (Refresh workshop prompt UI)
              );
            },
            h6({ children }) {
              return (
<<<<<<< HEAD
                <h6 className="text-md pbs-2 pbe-2 font-bold">{children}</h6>
=======
                <h6 className="mt-2 mb-1 text-sm font-semibold">{children}</h6>
>>>>>>> ff8819a (Refresh workshop prompt UI)
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
      </div>
    </div>
  );
}

function WorkshopToolCallLine({ message }: { message: WorkshopMessage }) {
  const agentName =
    WORKSHOP_MODELS.find((model) => model.slug === message.model)?.name ??
    "Agent";

  return (
    <div className="flex justify-center [animation:promptGroupFadeIn_0.25s_ease_both]">
      <div className="text-muted-foreground border-border bg-card/60 flex max-w-[min(520px,90%)] items-center gap-2 rounded-full border px-3 py-1.5 text-xs backdrop-blur-sm">
        <Sparkles className="size-3 shrink-0 text-blue-400" />
        <span className="truncate">
          <span className="font-medium">{agentName}</span> suggested a prompt
        </span>
      </div>
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
      className="overflow-hidden rounded-lg border border-blue-500/30 bg-blue-500/10 [animation:promptGroupFadeIn_0.3s_ease_both]"
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
          <CollapsibleTrigger
            aria-label={expanded ? "Collapse suggested prompt" : "Expand suggested prompt"}
            className="flex size-7 cursor-pointer items-center justify-center rounded-md text-(--muted-foreground) hover:bg-blue-500/15 hover:text-foreground transition-colors"
          >
            {expanded ? (
              <ChevronUp className="size-4" />
            ) : (
              <ChevronDown className="size-4" />
            )}
          </CollapsibleTrigger>
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
}: {
  selectedProjectId: string | null;
}) {
  return (
    <div className="flex min-h-[40vh] flex-1 flex-col items-center justify-center gap-3 text-center">
      <div className="bg-card border-border flex size-11 items-center justify-center rounded-xl border">
        <MessagesSquare className="text-muted-foreground size-5" />
      </div>
      <p className="text-foreground text-sm font-medium">
        {selectedProjectId
          ? "Start a conversation with the workshop"
          : "Select a project to start"}
      </p>
      <p className="text-muted-foreground/60 max-w-sm text-xs">
        {selectedProjectId
          ? "Describe what you want to create and the assistant will help you craft a prompt"
          : "Workshop history is scoped to each project"}
      </p>
    </div>
  );
}

export default function WorkshopPage() {
  const [selectedModel, setSelectedModel] =
    useState<WorkshopModel>("gpt-5.4-mini");
  const [clearDialogOpen, setClearDialogOpen] = useState(false);
  const [isMacOS, setIsMacOS] = useState<boolean | null>(null);
  const [suggestedPromptExpanded, setSuggestedPromptExpanded] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);
  const suggestedPromptRef = useRef<HTMLDivElement>(null);
  const optimisticUserMessageIdRef = useRef<string | null>(null);
  const utils = api.useUtils();
  const router = useRouter();

  useEffect(() => {
    setIsMacOS(navigator?.userAgent.toLowerCase().includes("mac"));
  }, []);

  const { data: projects, isLoading: isLoadingProjects } =
    api.project.list.useQuery();
  const {
    selectedProjectId,
    selectedProject,
    onSelectProject: handleSelectProject,
  } = useActiveProject(projects);

  const messagesQuery = api.workshop.list.useQuery(
    { projectId: selectedProjectId ?? "" },
    { enabled: Boolean(selectedProjectId) },
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

  const sendMessage = api.workshop.sendMessage.useMutation({
    onSuccess: ({ userMessage, assistantMessages }, variables) => {
      const optimisticId = optimisticUserMessageIdRef.current;
      optimisticUserMessageIdRef.current = null;

      utils.workshop.list.setData({ projectId: variables.projectId }, (old) => [
        ...(old ?? []).filter((message) => message.id !== optimisticId),
        userMessage,
        ...assistantMessages,
      ]);
      void utils.workshop.list.invalidate({ projectId: variables.projectId });
    },
    onError: (error, variables) => {
      optimisticUserMessageIdRef.current = null;
      toast.error(error.message || "Failed to generate assistant response");
      void utils.workshop.list.invalidate({ projectId: variables.projectId });
    },
  });

  const clearMessages = api.workshop.clear.useMutation({
    onSuccess: () => {
      if (!selectedProjectId) return;
      utils.workshop.list.setData({ projectId: selectedProjectId }, []);
      void utils.workshop.list.invalidate({ projectId: selectedProjectId });
      setClearDialogOpen(false);
      toast.success("Workshop history cleared");
    },
    onError: () => {
      toast.error("Failed to clear workshop history");
    },
  });

  useEffect(() => {
    const target = suggestedPromptRef.current ?? bottomRef.current;
    target?.scrollIntoView({ block: "end" });
  }, [messages.length, sendMessage.isPending, latestSuggestedPrompt]);

  const sendPrompt = (prompt: string) => {
    const trimmedPrompt = prompt.trim();
    if (!selectedProjectId || !trimmedPrompt || sendMessage.isPending) return;

    const optimisticId = `optimistic-${crypto.randomUUID()}`;
    optimisticUserMessageIdRef.current = optimisticId;
    utils.workshop.list.setData({ projectId: selectedProjectId }, (old) => [
      ...(old ?? []),
      {
        id: optimisticId,
        userId: "",
        projectId: selectedProjectId,
        role: "user",
        model: null,
        content: trimmedPrompt,
        createdAt: new Date(),
      },
    ]);

    sendMessage.mutate({
      projectId: selectedProjectId,
      content: trimmedPrompt,
      model: selectedModel,
    });
  };

  const handleClear = () => {
    if (!selectedProjectId) return;
    clearMessages.mutate({ projectId: selectedProjectId });
  };

  const handleUseSuggestedPrompt = () => {
    if (!latestSuggestedPrompt) return;

    try {
      sessionStorage.setItem(
        WORKSHOP_ACCEPTED_PROMPT_STORAGE_KEY,
        latestSuggestedPrompt,
      );
    } catch (error) {
      console.error("Failed to save workshop suggested prompt", error);
      toast.error("Failed to use suggested prompt");
      return;
    }

    router.push("/");
  };

  const isLoadingMessages =
    Boolean(selectedProjectId) && messagesQuery.isLoading;
  const errorMessage =
    messagesQuery.error && messagesQuery.error.data?.code !== "NOT_FOUND"
      ? messagesQuery.error.message
      : undefined;

  return (
    <main className="bg-background text-foreground flex h-screen w-screen flex-col overflow-hidden">
      <header className="bg-background/95 border-(--border) sticky top-0 z-30 flex items-center justify-between gap-4 border-b px-6 py-4 backdrop-blur">
        <div className="flex min-w-0 items-center gap-3">
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
        <div className="flex items-center gap-2">
          <ProjectSwitcher
            projects={projects}
            selectedProject={selectedProject}
            selectedProjectId={selectedProjectId}
            isLoading={isLoadingProjects}
            onSelectProject={handleSelectProject}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="cursor-pointer"
            disabled={!selectedProjectId || messages.length === 0}
            onClick={() => setClearDialogOpen(true)}
          >
            <Trash2 />
            Clear
          </Button>
        </div>
      </header>

      <section className="flex min-h-0 flex-1 flex-col">
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
              <WorkshopEmptyState selectedProjectId={selectedProjectId} />
            ) : (
              messages.map((message) =>
                message.role === "suggest_prompt" ? (
                  <WorkshopToolCallLine key={message.id} message={message} />
                ) : (
                  <WorkshopMessageBubble key={message.id} message={message} />
                ),
              )
            )}
            {sendMessage.isPending && (
              <div className="flex justify-start [animation:promptGroupFadeIn_0.25s_ease_both]">
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
                  onUse={handleUseSuggestedPrompt}
                />
              </div>
            )}
            <div ref={bottomRef} />
          </div>
        </div>

        <div className="border-(--border) bg-background/95 border-t px-6 py-4 backdrop-blur">
          <div className="mx-auto flex w-full max-w-4xl flex-col gap-3">
            <WorkshopComposer
              selectedProjectId={selectedProjectId}
              sendIsPending={sendMessage.isPending}
              sendPrompt={sendPrompt}
              selectedModel={selectedModel}
              setSelectedModel={setSelectedModel}
              isMacOS={isMacOS}
            />
          </div>
        </div>
      </section>

      <ConfirmDialog
        open={clearDialogOpen}
        title="Clear workshop history?"
        description="This deletes every workshop message in the selected project."
        confirmLabel="Clear"
        isPending={clearMessages.isPending}
        onConfirm={handleClear}
        onCancel={() => setClearDialogOpen(false)}
      />
    </main>
  );
}
