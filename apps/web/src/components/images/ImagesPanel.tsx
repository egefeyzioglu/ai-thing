import type { EnvironmentId } from "@t3tools/contracts";
import { ChevronLeft } from "lucide-react";
import { useCallback, useState } from "react";

import type { ComposerThreadTarget } from "~/composerDraftStore";
import { Button } from "~/components/ui/button";
import { Toggle, ToggleGroup } from "~/components/ui/toggle-group";

import { ImageInspector } from "./ImageInspector";
import { ImageLightbox } from "./ImageLightbox";
import { ImagesBrowse } from "./ImagesBrowse";
import { imageBasename, useImageIndex, type LightboxRequest } from "./useImageAssetUrl";

export interface ImagesPanelProps {
  environmentId: EnvironmentId;
  cwd: string;
  threadId: string | null;
  /** When present, Inspect offers "Attach to message" into this composer draft. */
  composerDraftTarget?: ComposerThreadTarget;
}

type Mode = "browse" | "inspect";

/** Right-panel surface for the project's versioned images: a grid to browse and an inspector. Key it on cwd. */
export default function ImagesPanel({
  environmentId,
  cwd,
  threadId,
  composerDraftTarget,
}: ImagesPanelProps) {
  const index = useImageIndex(environmentId, cwd);
  const [mode, setMode] = useState<Mode>("browse");
  const [selected, setSelected] = useState<{
    path: string;
    version: number | null;
  } | null>(null);
  const [lightbox, setLightbox] = useState<LightboxRequest | null>(null);

  const select = useCallback((path: string, version?: number) => {
    setSelected({ path, version: version ?? null });
    setMode("inspect");
  }, []);

  const entry = selected
    ? index.data?.entries.find((candidate) => candidate.path === selected.path)
    : undefined;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b px-2">
        {mode === "inspect" ? (
          <Button
            size="icon-xs"
            variant="ghost-muted"
            aria-label="Back to browse"
            onClick={() => setMode("browse")}
          >
            <ChevronLeft />
          </Button>
        ) : null}
        <ToggleGroup
          aria-label="Images view"
          variant="segmented"
          value={[mode]}
          onValueChange={(next) => {
            const value = next[0];
            if (value === "browse" || (value === "inspect" && selected)) setMode(value);
          }}
        >
          <Toggle value="browse">Browse</Toggle>
          <Toggle value="inspect" disabled={!selected}>
            Inspect
          </Toggle>
        </ToggleGroup>
        {mode === "inspect" && selected ? (
          <span className="min-w-0 truncate text-xs text-muted-foreground">
            {imageBasename(selected.path)}
          </span>
        ) : null}
      </div>

      {mode === "inspect" && selected ? (
        <ImageInspector
          key={`${selected.path}@${selected.version ?? "current"}`}
          environmentId={environmentId}
          cwd={cwd}
          threadId={threadId}
          path={selected.path}
          entry={entry}
          requestedVersion={selected.version}
          {...(composerDraftTarget ? { composerDraftTarget } : {})}
          onSelectPath={select}
          onOpenLightbox={setLightbox}
        />
      ) : (
        <ImagesBrowse
          environmentId={environmentId}
          cwd={cwd}
          threadId={threadId}
          index={index}
          selectedPath={selected?.path ?? null}
          onSelect={select}
          onReview={setLightbox}
        />
      )}

      {lightbox ? (
        <ImageLightbox
          environmentId={environmentId}
          cwd={cwd}
          threadId={threadId}
          items={lightbox.items}
          {...(lightbox.source ? { source: lightbox.source } : {})}
          initialIndex={lightbox.initialIndex}
          onClose={() => setLightbox(null)}
        />
      ) : null}
    </div>
  );
}
