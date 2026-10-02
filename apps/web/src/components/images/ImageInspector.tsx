import {
  ThreadId,
  parseImageVersionRef,
  type EnvironmentId,
  type ImageIndexEntry,
  type ImageVersion,
} from "@t3tools/contracts";
import {
  AtSign,
  Check,
  ChevronRight,
  Columns2,
  Copy,
  Download,
  History,
  ImageOff,
  Maximize2,
  Star,
  X,
} from "lucide-react";
import { useState } from "react";

import { useComposerDraftStore, type ComposerThreadTarget } from "~/composerDraftStore";
import { cn } from "~/lib/utils";
import { imagesEnvironment } from "~/state/images";
import { useAtomCommand } from "~/state/use-atom-command";
import { formatRelativeTimeLabel } from "~/timestampFormat";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "~/components/ui/collapsible";
import { Spinner } from "~/components/ui/spinner";

import { ImageCompare } from "./ImageCompare";
import { ImageLineage } from "./ImageLineage";
import { ImageRerun } from "./ImageRerun";
import {
  formatImageBytes,
  imageAspectLabel,
  imageBasename,
  imageDirname,
  shortThreadId,
  useImageAssetUrl,
  useImageFamily,
  useImageVersions,
  type ImageVersionItem,
  type LightboxRequest,
} from "./useImageAssetUrl";

function Section({
  title,
  defaultOpen = true,
  action,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="border-t">
      <Collapsible defaultOpen={defaultOpen} className="group">
        <div className="flex h-9 items-center gap-1 pr-2">
          <CollapsibleTrigger className="flex h-full min-w-0 flex-1 items-center gap-2 px-3 text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:underline">
            <ChevronRight
              className="size-3.5 transition-transform group-data-open:rotate-90"
              aria-hidden
            />
            <span className="font-medium text-foreground/90">{title}</span>
          </CollapsibleTrigger>
          {action}
        </div>
        <CollapsiblePanel>{children}</CollapsiblePanel>
      </Collapsible>
    </div>
  );
}

function VersionThumb({
  environmentId,
  cwd,
  path,
  version,
  shown,
  onSelect,
}: {
  environmentId: EnvironmentId;
  cwd: string;
  path: string;
  version: ImageVersion;
  shown: boolean;
  onSelect: () => void;
}) {
  const asset = useImageAssetUrl(environmentId, cwd, path, version.n);
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-label={`Version ${version.n}`}
      aria-current={shown}
      className={cn(
        "relative size-14 shrink-0 cursor-pointer overflow-hidden rounded-md bg-muted outline-none ring-2 ring-offset-1 ring-offset-background transition-[box-shadow]",
        shown ? "ring-ring" : "ring-transparent hover:ring-border",
        version.rejected && "opacity-45",
      )}
    >
      {asset._tag === "Success" ? (
        <img src={asset.url} alt="" draggable={false} className="size-full object-cover" />
      ) : asset._tag === "Failure" ? (
        <ImageOff className="m-auto size-4 text-muted-foreground" aria-hidden />
      ) : (
        <Spinner size="xs" tone="muted" className="m-auto" />
      )}
      <span
        className={cn(
          "absolute bottom-0.5 left-0.5 rounded-sm bg-black/65 px-1 font-mono text-3xs leading-4 text-white",
          version.rejected && "line-through",
        )}
      >
        v{version.n}
      </span>
      {version.rejected ? (
        <span className="pointer-events-none absolute inset-x-0 top-1/2 h-px -rotate-45 scale-x-150 bg-destructive" />
      ) : null}
    </button>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </>
  );
}

export interface ImageInspectorProps {
  environmentId: EnvironmentId;
  cwd: string;
  threadId: string | null;
  path: string;
  entry: ImageIndexEntry | undefined;
  /** A version to show instead of the current one, e.g. from a lineage click. */
  requestedVersion: number | null;
  composerDraftTarget?: ComposerThreadTarget;
  onSelectPath: (path: string, version?: number) => void;
  onOpenLightbox: (request: LightboxRequest) => void;
}

export function ImageInspector({
  environmentId,
  cwd,
  threadId,
  path,
  entry,
  requestedVersion,
  composerDraftTarget,
  onSelectPath,
  onOpenLightbox,
}: ImageInspectorProps) {
  const versions = useImageVersions(environmentId, cwd, path);
  const family = useImageFamily(environmentId, cwd, path);
  const manifest = versions.data;
  const current = manifest?.current ?? entry?.current ?? 1;
  // The panel keys this component on path and requested version, so initial state is enough.
  const [shownVersion, setShownVersion] = useState<number | null>(requestedVersion);
  const shown = shownVersion ?? current;
  const version = manifest?.versions.find((candidate) => candidate.n === shown) ?? null;
  const isCurrent = shown === current;
  const asset = useImageAssetUrl(environmentId, cwd, path, isCurrent ? null : shown);
  const [compare, setCompare] = useState<{
    left: ImageVersionItem;
    right: ImageVersionItem;
    leftLabel: string;
    rightLabel: string;
  } | null>(null);
  const [copied, setCopied] = useState(false);

  const star = useAtomCommand(imagesEnvironment.star);
  const reject = useAtomCommand(imagesEnvironment.reject);
  const restore = useAtomCommand(imagesEnvironment.restore);
  const threadInput = threadId ? { threadId: ThreadId.make(threadId) } : {};

  const width = version?.width ?? (isCurrent ? entry?.width : undefined);
  const height = version?.height ?? (isCurrent ? entry?.height : undefined);
  const source = version?.source;
  const starred = manifest?.starred ?? entry?.starred ?? false;
  const name = imageBasename(path);
  const folder = imageDirname(path);
  const shownItem: ImageVersionItem = {
    path,
    version: shown,
    ref: `${path}@${shown}`,
    ...(width !== undefined ? { width } : {}),
    ...(height !== undefined ? { height } : {}),
    ...(source?.model !== undefined ? { model: source.model } : {}),
    ...(source?.estimatedCostUsd !== undefined ? { costUsd: source.estimatedCostUsd } : {}),
    starred,
    rejected: version?.rejected ?? false,
  };

  const openCompare = () => {
    const firstParent = version?.parents?.[0];
    if (!isCurrent) {
      setCompare({
        left: shownItem,
        right: { path, version: current, ref: `${path}@${current}` },
        leftLabel: "shown",
        rightLabel: "current",
      });
      return;
    }
    if (firstParent) {
      const parsed = parseImageVersionRef(firstParent);
      setCompare({
        left: shownItem,
        right: {
          path: parsed.path,
          version: parsed.version ?? 1,
          ref: firstParent,
        },
        leftLabel: "this",
        rightLabel: "parent",
      });
    }
  };
  const canCompare = !isCurrent || (version?.parents?.length ?? 0) > 0;

  const openFullScreen = () => {
    const nodes = family.data?.nodes ?? [];
    const items: ImageVersionItem[] = nodes
      .filter((node) => node.exists)
      .map((node) => ({
        path: node.path,
        version: node.n,
        ref: node.ref,
        ...(node.width !== undefined ? { width: node.width } : {}),
        ...(node.height !== undefined ? { height: node.height } : {}),
        ...(node.model !== undefined ? { model: node.model } : {}),
        starred: node.starred,
        rejected: node.rejected,
      }));
    const list = items.length > 0 ? items : [shownItem];
    const initialIndex = Math.max(
      0,
      list.findIndex((item) => item.ref === shownItem.ref),
    );
    onOpenLightbox({ items: list, initialIndex });
  };

  const attachToMessage = () => {
    if (!composerDraftTarget) return;
    const store = useComposerDraftStore.getState();
    const existing = store.getComposerDraft(composerDraftTarget)?.prompt ?? "";
    const token = `@${path}@${shown}`;
    const next = existing.length === 0 ? `${token} ` : `${existing.replace(/\s*$/, "")} ${token} `;
    store.setPrompt(composerDraftTarget, next);
  };

  const copyPrompt = async () => {
    if (!source?.prompt) return;
    try {
      await navigator.clipboard.writeText(source.prompt);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard unavailable; nothing to report inline.
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="flex flex-col gap-2 p-3">
        <div className="flex aspect-[4/3] w-full items-center justify-center overflow-hidden rounded-lg border bg-muted/40">
          {asset._tag === "Success" ? (
            <img
              src={asset.url}
              alt={name}
              draggable={false}
              className={cn(
                "max-h-full max-w-full object-contain",
                version?.rejected && "opacity-50",
              )}
            />
          ) : asset._tag === "Failure" ? (
            <ImageOff className="size-6 text-muted-foreground" aria-hidden />
          ) : (
            <Spinner size="md" tone="muted" />
          )}
        </div>
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="truncate font-mono text-xs">
              {folder ? <span className="text-muted-foreground">{folder}/</span> : null}
              <span className="font-medium">{name}</span>
            </div>
            <div className="mt-0.5 text-2xs text-muted-foreground">
              v{shown}
              {!isCurrent ? ` (current v${current})` : ""}
              {width && height ? ` · ${width} × ${height}` : ""}
              {version ? ` · ${formatImageBytes(version.size)}` : ""}
              {version ? ` · ${formatRelativeTimeLabel(version.createdAt)}` : ""}
              {version?.rejected ? " · dropped" : ""}
            </div>
          </div>
          <Button
            size="icon-xs"
            variant="ghost-muted"
            aria-label={starred ? "Unstar" : "Star"}
            aria-pressed={starred}
            onClick={() =>
              void star({
                environmentId,
                input: { cwd, path, starred: !starred },
              })
            }
          >
            <Star className={cn(starred && "fill-current text-warning-foreground")} />
          </Button>
        </div>

        {manifest && manifest.versions.length > 0 ? (
          <div className="flex gap-1.5 overflow-x-auto py-1">
            {manifest.versions.map((candidate) => (
              <VersionThumb
                key={candidate.n}
                environmentId={environmentId}
                cwd={cwd}
                path={path}
                version={candidate}
                shown={candidate.n === shown}
                onSelect={() => setShownVersion(candidate.n)}
              />
            ))}
          </div>
        ) : versions.loading ? (
          <div className="flex h-14 items-center">
            <Spinner size="sm" tone="muted" />
          </div>
        ) : versions.error ? (
          <p className="text-2xs text-destructive-foreground">{versions.error}</p>
        ) : null}

        <div className="flex flex-wrap gap-1">
          {!isCurrent ? (
            <Button
              size="xs"
              variant="outline"
              onClick={() =>
                void restore({
                  environmentId,
                  input: { cwd, path, version: shown, ...threadInput },
                })
              }
            >
              <History aria-hidden />
              Restore as current
            </Button>
          ) : null}
          <Button
            size="xs"
            variant="outline"
            onClick={() =>
              void reject({
                environmentId,
                input: {
                  cwd,
                  path,
                  version: shown,
                  rejected: !(version?.rejected ?? false),
                },
              })
            }
          >
            <X aria-hidden />
            {version?.rejected ? "Undrop" : "Drop"}
          </Button>
          <Button size="xs" variant="outline" disabled={!canCompare} onClick={openCompare}>
            <Columns2 aria-hidden />
            Compare with…
          </Button>
          <Button size="xs" variant="outline" onClick={openFullScreen}>
            <Maximize2 aria-hidden />
            Full screen
          </Button>
          <Button
            size="xs"
            variant="outline"
            disabled={asset._tag !== "Success"}
            render={
              <a
                href={asset._tag === "Success" ? asset.url : undefined}
                download={
                  isCurrent
                    ? name
                    : `${name.replace(/(\.[^.]*)?$/, "")}-v${shown}${name.match(/\.[^.]*$/)?.[0] ?? ""}`
                }
              />
            }
          >
            <Download aria-hidden />
            Download
          </Button>
          {composerDraftTarget ? (
            <Button size="xs" variant="outline" onClick={attachToMessage}>
              <AtSign aria-hidden />
              Attach to message
            </Button>
          ) : null}
        </div>
      </div>

      {source && (source.prompt || source.model) ? (
        <Section title="Generation">
          <dl className="grid grid-cols-[72px_1fr] gap-x-3 gap-y-1.5 px-3 pb-3 text-xs">
            {source.model ? (
              <Detail label="Model">
                {source.model}
                {source.provider ? (
                  <span className="text-muted-foreground"> · {source.provider}</span>
                ) : null}
              </Detail>
            ) : null}
            {width && height ? (
              <Detail label="Size">
                {width} × {height}
                <span className="text-muted-foreground">
                  {" "}
                  ({source.aspectRatio ?? imageAspectLabel(width, height)}
                  {source.resolution ? ` · ${source.resolution}` : ""})
                </span>
              </Detail>
            ) : source.aspectRatio || source.resolution ? (
              <Detail label="Size">
                {[source.aspectRatio, source.resolution].filter(Boolean).join(" · ")}
              </Detail>
            ) : null}
            {source.references && source.references.length > 0 ? (
              <Detail label="Refs">
                <span className="flex flex-wrap gap-1">
                  {source.references.map((ref) => {
                    const parsed = parseImageVersionRef(ref);
                    return (
                      <Badge
                        key={ref}
                        variant="outline"
                        size="sm"
                        className="max-w-full cursor-pointer"
                        render={<button type="button" />}
                        onClick={() => onSelectPath(parsed.path, parsed.version)}
                      >
                        <span className="truncate">{imageBasename(ref)}</span>
                      </Badge>
                    );
                  })}
                </span>
              </Detail>
            ) : null}
            {source.estimatedCostUsd !== undefined ? (
              <Detail label="Cost">${source.estimatedCostUsd.toFixed(2)}</Detail>
            ) : null}
            <Detail label="By">
              {version?.threadId ? (
                <span className="font-mono">{shortThreadId(version.threadId)}</span>
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
              <span className="text-muted-foreground"> · {source.kind}</span>
            </Detail>
          </dl>
        </Section>
      ) : version ? (
        <Section title="Version">
          <dl className="grid grid-cols-[72px_1fr] gap-x-3 gap-y-1.5 px-3 pb-3 text-xs">
            <Detail label="Kind">
              {source?.kind}
              {source?.tool ? (
                <span className="text-muted-foreground"> · {source.tool}</span>
              ) : null}
              {source?.pickedFrom ? (
                <span className="text-muted-foreground"> · from {source.pickedFrom}</span>
              ) : null}
              {source?.restoredFrom ? (
                <span className="text-muted-foreground"> · from v{source.restoredFrom}</span>
              ) : null}
            </Detail>
            {version.threadId ? (
              <Detail label="By">
                <span className="font-mono">{shortThreadId(version.threadId)}</span>
              </Detail>
            ) : null}
          </dl>
        </Section>
      ) : null}

      {source?.prompt ? (
        <Section
          title="Prompt"
          action={
            <Button
              size="icon-xs"
              variant="ghost-muted"
              aria-label={copied ? "Copied" : "Copy prompt"}
              onClick={() => void copyPrompt()}
            >
              {copied ? <Check /> : <Copy />}
            </Button>
          }
        >
          <p className="whitespace-pre-wrap px-3 pb-3 text-xs leading-relaxed text-foreground/85">
            {source.prompt}
          </p>
        </Section>
      ) : null}

      <Section title="Lineage">
        <ImageLineage
          environmentId={environmentId}
          cwd={cwd}
          threadId={threadId}
          selectedPath={path}
          shownVersion={shown}
          family={family}
          onSelect={(targetPath, targetVersion) => {
            if (targetPath === path) setShownVersion(targetVersion);
            else onSelectPath(targetPath, targetVersion);
          }}
        />
      </Section>

      <Section title="Rerun without the agent" defaultOpen={false}>
        <ImageRerun
          key={`${path}@${shown}`}
          environmentId={environmentId}
          cwd={cwd}
          threadId={threadId}
          path={path}
          version={version}
          width={width}
          height={height}
        />
      </Section>

      {compare ? (
        <ImageCompare
          environmentId={environmentId}
          cwd={cwd}
          left={compare.left}
          right={compare.right}
          leftLabel={compare.leftLabel}
          rightLabel={compare.rightLabel}
          onClose={() => setCompare(null)}
        />
      ) : null}
    </div>
  );
}
