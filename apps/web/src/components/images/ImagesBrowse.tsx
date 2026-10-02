import type { EnvironmentId, ImageIndex, ImageIndexEntry } from "@t3tools/contracts";
import { FileText } from "lucide-react";
import { useMemo, useState } from "react";

import { cn } from "~/lib/utils";
import { imagesEnvironment } from "~/state/images";
import { useAtomCommand } from "~/state/use-atom-command";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Spinner } from "~/components/ui/spinner";
import { Switch } from "~/components/ui/switch";

import { ImageTile } from "./ImageTile";
import { reviewSetFor, type LightboxRequest, type QueryState } from "./useImageAssetUrl";

type BrowseView = "thread" | "outputs" | "refs" | "picks" | "all";

const VIEWS: ReadonlyArray<{ id: BrowseView; label: string }> = [
  { id: "thread", label: "This thread" },
  { id: "outputs", label: "Outputs" },
  { id: "refs", label: "Refs" },
  { id: "picks", label: "Picks" },
  { id: "all", label: "All" },
];

const isRefPath = (path: string) => /(^|\/)(refs|inputs)\//.test(path);

function matchesView(entry: ImageIndexEntry, view: BrowseView, threadId: string | null): boolean {
  switch (view) {
    case "thread":
      return threadId !== null && entry.threads.includes(threadId);
    case "outputs":
      return (
        entry.lastKind === "generate" ||
        entry.lastKind === "edit" ||
        entry.kinds.includes("generate") ||
        entry.kinds.includes("edit")
      );
    case "refs":
      return entry.usedAsRef || isRefPath(entry.path);
    case "picks":
      return entry.starred;
    case "all":
      return true;
  }
}

export interface ImagesBrowseProps {
  environmentId: EnvironmentId;
  cwd: string;
  threadId: string | null;
  index: QueryState<ImageIndex>;
  selectedPath: string | null;
  onSelect: (path: string) => void;
  onReview: (request: LightboxRequest) => void;
}

export function ImagesBrowse({
  environmentId,
  cwd,
  threadId,
  index,
  selectedPath,
  onSelect,
  onReview,
}: ImagesBrowseProps) {
  const [chosenView, setView] = useState<BrowseView>(threadId ? "thread" : "all");
  const [showDropped, setShowDropped] = useState(false);
  // "This thread" only exists while a thread is open.
  const view: BrowseView = chosenView === "thread" && threadId === null ? "all" : chosenView;

  const star = useAtomCommand(imagesEnvironment.star);
  const reject = useAtomCommand(imagesEnvironment.reject);

  const entries = index.data?.entries ?? null;
  const visible = useMemo(() => {
    if (!entries) return [];
    return entries
      .filter((entry) => matchesView(entry, view, threadId))
      .filter((entry) => showDropped || (entry.exists && !entry.rejected))
      .sort((a, b) => b.lastCreatedAt.localeCompare(a.lastCreatedAt));
  }, [entries, showDropped, threadId, view]);
  const hiddenCount = useMemo(
    () =>
      entries
        ? entries.filter(
            (entry) => matchesView(entry, view, threadId) && (!entry.exists || entry.rejected),
          ).length
        : 0,
    [entries, threadId, view],
  );

  return (
    <div className="@container flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-col gap-2 border-b px-3 py-2">
        <div className="flex flex-wrap items-center gap-1">
          {VIEWS.filter((candidate) => candidate.id !== "thread" || threadId !== null).map(
            (candidate) => (
              <Button
                key={candidate.id}
                size="xs"
                variant={view === candidate.id ? "secondary" : "ghost-muted"}
                aria-pressed={view === candidate.id}
                onClick={() => setView(candidate.id)}
              >
                {candidate.label}
              </Button>
            ),
          )}
          <label className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
            <Switch
              size="sm"
              checked={showDropped}
              onCheckedChange={setShowDropped}
              aria-label="Show dropped images"
            />
            Dropped{hiddenCount > 0 ? ` (${hiddenCount})` : ""}
          </label>
        </div>
        {index.data && index.data.briefFiles.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1 text-xs">
            <span className="text-muted-foreground">Brief</span>
            {index.data.briefFiles.map((file) => (
              <Badge key={file} variant="outline" size="sm">
                <FileText aria-hidden />
                {file.slice(file.lastIndexOf("/") + 1)}
              </Badge>
            ))}
          </div>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {index.error && !entries ? (
          <p className="text-xs text-destructive-foreground">{index.error}</p>
        ) : index.loading && !entries ? (
          <div className="flex items-center justify-center py-10">
            <Spinner size="md" tone="muted" />
          </div>
        ) : visible.length === 0 ? (
          <p className="py-10 text-center text-xs text-muted-foreground">
            {entries && entries.length === 0
              ? "No tracked images in this project yet."
              : "Nothing in this view."}
          </p>
        ) : (
          <div className={cn("grid grid-cols-2 gap-2 @lg:grid-cols-3 @3xl:grid-cols-4")}>
            {visible.map((entry) => {
              const review = index.data ? reviewSetFor(index.data, entry) : null;
              return (
                <ImageTile
                  key={entry.path}
                  environmentId={environmentId}
                  cwd={cwd}
                  entry={entry}
                  selected={entry.path === selectedPath}
                  reviewCount={review?.items.length ?? 0}
                  onOpen={() => onSelect(entry.path)}
                  onReview={() => {
                    if (review) onReview(review);
                  }}
                  onStar={(starred) => {
                    void star({
                      environmentId,
                      input: { cwd, path: entry.path, starred },
                    });
                  }}
                  onDrop={(rejected) => {
                    void reject({
                      environmentId,
                      input: {
                        cwd,
                        path: entry.path,
                        version: entry.current,
                        rejected,
                      },
                    });
                  }}
                />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
