"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { ArrowLeft, Loader2, Send, Trash2 } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";

import { ProjectSwitcher } from "src/app/_components/project-switcher";
import { useActiveProject } from "src/app/_hooks/use-active-project";
import { Button, buttonVariants } from "src/components/ui/button";
import { ConfirmDialog } from "src/components/ui/confirm-dialog";
import { Skeleton } from "src/components/ui/skeleton";
import { Textarea } from "src/components/ui/textarea";
import { cn } from "src/lib/utils";
import { WORKSHOP_DRAFT_STORAGE_KEY } from "src/lib/workshop";
import { api, type RouterOutputs } from "src/trpc/react";

const WORKSHOP_MODELS = [
  { slug: "gpt-5.4-mini", name: "GPT 5.4 Mini" },
  { slug: "gemini-3-flash-preview", name: "Gemini 3 Flash" },
] as const;

type WorkshopModel = (typeof WORKSHOP_MODELS)[number]["slug"];
type WorkshopMessage = RouterOutputs["workshop"]["list"][number];

function WorkshopMessageBubble({ message }: { message: WorkshopMessage }) {
  const isUser = message.role === "user";

  return (
    <div
      className={cn("flex w-full", isUser ? "justify-end" : "justify-start")}
    >
      <div
        className={cn(
          "max-w-[min(780px,85%)] rounded-lg border px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap",
          isUser
            ? "text-foreground border-blue-500/30 bg-blue-500/15"
            : "border-border bg-card text-card-foreground",
        )}
      >
        {!isUser && message.model && (
          <div className="text-muted-foreground mb-2 text-xs">
            {WORKSHOP_MODELS.find((model) => model.slug === message.model)
              ?.name ?? message.model}
          </div>
        )}
        {message.content}
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

export default function WorkshopPage() {
  const [composer, setComposer] = useState("");
  const [selectedModel, setSelectedModel] =
    useState<WorkshopModel>("gpt-5.4-mini");
  const [clearDialogOpen, setClearDialogOpen] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const utils = api.useUtils();

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

  const sendMessage = api.workshop.sendMessage.useMutation({
    onSuccess: ({ userMessage, assistantMessage }) => {
      if (!selectedProjectId) return;
      utils.workshop.list.setData({ projectId: selectedProjectId }, (old) => [
        ...(old ?? []),
        userMessage,
        assistantMessage,
      ]);
      setComposer("");
      void utils.workshop.list.invalidate({ projectId: selectedProjectId });
    },
    onError: (error) => {
      toast.error(error.message || "Failed to generate assistant response");
      if (selectedProjectId) {
        void utils.workshop.list.invalidate({ projectId: selectedProjectId });
      }
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

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length, sendMessage.isPending]);

  const trimmedComposer = composer.trim();
  const canSend =
    Boolean(selectedProjectId) &&
    trimmedComposer.length > 0 &&
    !sendMessage.isPending;

  const handleSend = () => {
    if (!canSend || !selectedProjectId) return;
    sendMessage.mutate({
      projectId: selectedProjectId,
      content: trimmedComposer,
      model: selectedModel,
    });
  };

  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    handleSend();
  };

  const handleClear = () => {
    if (!selectedProjectId) return;
    clearMessages.mutate({ projectId: selectedProjectId });
  };

  const isLoadingMessages =
    Boolean(selectedProjectId) && messagesQuery.isLoading;
  const errorMessage =
    messagesQuery.error && messagesQuery.error.data?.code !== "NOT_FOUND"
      ? messagesQuery.error.message
      : undefined;

  return (
    <main className="bg-background text-foreground flex h-screen w-screen flex-col overflow-hidden">
      <header className="bg-background/95 border-border sticky top-0 z-30 flex items-center justify-between gap-4 border-b px-6 py-4 backdrop-blur">
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
          <ProjectSwitcher
            projects={projects}
            selectedProject={selectedProject}
            selectedProjectId={selectedProjectId}
            isLoading={isLoadingProjects}
            onSelectProject={handleSelectProject}
          />
          <div className="min-w-0">
            <h1 className="text-sm font-semibold">Prompt Workshop</h1>
            <p className="text-muted-foreground truncate text-xs">
              {selectedProject?.name ?? "Select a project"} chat history
            </p>
          </div>
        </div>
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
      </header>

      <section className="flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-8">
          <div className="mx-auto flex w-full max-w-5xl flex-col gap-5">
            {errorMessage ? (
              <div className="text-muted-foreground flex min-h-[40vh] items-center justify-center text-sm">
                Failed to load workshop history: {errorMessage}
              </div>
            ) : isLoadingMessages ? (
              <MessageSkeleton />
            ) : messages.length === 0 ? (
              <div className="text-muted-foreground flex min-h-[40vh] items-center justify-center text-sm">
                {selectedProjectId
                  ? "No workshop messages in this project yet"
                  : "Select a project to start a workshop chat"}
              </div>
            ) : (
              messages.map((message) => (
                <WorkshopMessageBubble key={message.id} message={message} />
              ))
            )}
            {sendMessage.isPending && (
              <div className="flex justify-start">
                <div className="border-border bg-card text-muted-foreground flex items-center gap-2 rounded-lg border px-4 py-3 text-sm">
                  <Loader2 className="size-4 animate-spin" />
                  Thinking
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>
        </div>

        <div className="border-border border-t px-6 py-4">
          <div className="mx-auto flex w-full max-w-5xl flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              {WORKSHOP_MODELS.map((model) => (
                <Button
                  key={model.slug}
                  type="button"
                  variant={selectedModel === model.slug ? "default" : "outline"}
                  size="sm"
                  className="cursor-pointer"
                  onClick={() => setSelectedModel(model.slug)}
                >
                  {model.name}
                </Button>
              ))}
            </div>
            <div className="flex items-end gap-2">
              <Textarea
                value={composer}
                onChange={(event) => setComposer(event.target.value)}
                onKeyDown={handleComposerKeyDown}
                placeholder={
                  selectedProjectId
                    ? "Ask for prompt feedback or revisions..."
                    : "Select a project to start..."
                }
                disabled={!selectedProjectId || sendMessage.isPending}
                className="max-h-48 min-h-20 resize-none"
              />
              <Button
                type="button"
                size="icon-lg"
                className="cursor-pointer"
                disabled={!canSend}
                onClick={handleSend}
                aria-label="Send message"
              >
                {sendMessage.isPending ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <Send />
                )}
              </Button>
            </div>
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
