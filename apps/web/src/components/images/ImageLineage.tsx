import {
  ThreadId,
  parseImageVersionRef,
  type EnvironmentId,
  type ImageFamilyGraph,
  type ImageFamilyNode,
} from "@t3tools/contracts";
import { ImageOff, Star, Unlink } from "lucide-react";
import { useMemo } from "react";

import { cn } from "~/lib/utils";
import { imagesEnvironment } from "~/state/images";
import { useAtomCommand } from "~/state/use-atom-command";
import { formatRelativeTimeLabel } from "~/timestampFormat";
import { Button } from "~/components/ui/button";
import { Spinner } from "~/components/ui/spinner";

import { imageBasename, useImageAssetUrl, type QueryState } from "./useImageAssetUrl";

interface LineageTree {
  roots: ImageFamilyNode[];
  childrenOf: Map<string, ImageFamilyNode[]>;
}

const byCreatedAt = (a: ImageFamilyNode, b: ImageFamilyNode) =>
  a.createdAt.localeCompare(b.createdAt) || a.n - b.n;

function buildTree(graph: ImageFamilyGraph): LineageTree {
  const byRef = new Map(graph.nodes.map((node) => [node.ref, node]));
  const childrenOf = new Map<string, ImageFamilyNode[]>();
  const attached = new Set<string>();
  for (const node of graph.nodes) {
    for (const parent of node.parents) {
      if (!byRef.has(parent)) continue;
      const list = childrenOf.get(parent) ?? [];
      list.push(node);
      childrenOf.set(parent, list);
      attached.add(node.ref);
    }
  }
  for (const list of childrenOf.values()) list.sort(byCreatedAt);
  const roots = new Map<string, ImageFamilyNode>();
  for (const ref of graph.roots) {
    const node = byRef.get(ref);
    if (node) roots.set(ref, node);
  }
  // Versions whose recorded parents live outside this family still need a row.
  for (const node of graph.nodes) {
    if (!attached.has(node.ref) && !roots.has(node.ref)) roots.set(node.ref, node);
  }
  return { roots: [...roots.values()].sort(byCreatedAt), childrenOf };
}

function LineageRow({
  environmentId,
  cwd,
  node,
  selectedPath,
  shownRef,
  depth,
  onSelect,
  onUse,
  onUnlink,
}: {
  environmentId: EnvironmentId;
  cwd: string;
  node: ImageFamilyNode;
  selectedPath: string;
  shownRef: string;
  depth: number;
  onSelect: (path: string, version: number) => void;
  onUse: (ref: string) => void;
  onUnlink: (node: ImageFamilyNode) => void;
}) {
  const asset = useImageAssetUrl(environmentId, cwd, node.exists ? node.path : null, node.n);
  const isSelectedFile = node.path === selectedPath;
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-md py-1 pr-1 text-xs",
        node.inferred
          ? "border-l-2 border-dashed border-border pl-2"
          : "border-l-2 border-border/50 pl-2",
        node.ref === shownRef && "bg-accent/60",
        node.rejected && "opacity-55",
      )}
      style={{ marginLeft: depth * 14 }}
    >
      <button
        type="button"
        className="size-8 shrink-0 cursor-pointer overflow-hidden rounded-sm bg-muted outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => onSelect(node.path, node.n)}
        aria-label={`Show ${node.ref}`}
      >
        {asset._tag === "Success" ? (
          <img src={asset.url} alt="" draggable={false} className="size-full object-cover" />
        ) : asset._tag === "Failure" || !node.exists ? (
          <ImageOff className="m-auto size-3 text-muted-foreground" aria-hidden />
        ) : (
          <Spinner size="xs" tone="muted" className="m-auto" />
        )}
      </button>
      <button
        type="button"
        className="min-w-0 flex-1 cursor-pointer text-left outline-none focus-visible:underline"
        onClick={() => onSelect(node.path, node.n)}
      >
        <span className={cn("block truncate font-mono", isSelectedFile && "font-medium")}>
          {imageBasename(node.path)}
          <span className="text-muted-foreground">@{node.n}</span>
          {node.current ? <span className="ml-1 text-muted-foreground">current</span> : null}
          {node.starred ? (
            <Star className="ml-1 inline size-3 fill-current text-warning-foreground" aria-hidden />
          ) : null}
        </span>
        <span className="block truncate text-2xs text-muted-foreground">
          {node.kind}
          {node.rejected ? " · dropped" : ""}
          {node.inferred ? " · guessed" : ""} · {formatRelativeTimeLabel(node.createdAt)}
        </span>
      </button>
      {node.inferred ? (
        <Button
          size="icon-xs"
          variant="ghost-muted"
          aria-label="Unlink guessed parent"
          onClick={() => onUnlink(node)}
        >
          <Unlink />
        </Button>
      ) : null}
      {!isSelectedFile && node.exists ? (
        <Button
          size="xs"
          variant="outline"
          aria-label={`Copy ${node.ref} onto ${imageBasename(selectedPath)} as a new version`}
          onClick={() => onUse(node.ref)}
        >
          Use
        </Button>
      ) : null}
    </div>
  );
}

export interface ImageLineageProps {
  environmentId: EnvironmentId;
  cwd: string;
  threadId: string | null;
  selectedPath: string;
  shownVersion: number;
  family: QueryState<ImageFamilyGraph>;
  onSelect: (path: string, version: number) => void;
}

/** The derivation tree around a file: roots first, children under the version they came from. */
export function ImageLineage({
  environmentId,
  cwd,
  threadId,
  selectedPath,
  shownVersion,
  family,
  onSelect,
}: ImageLineageProps) {
  const relink = useAtomCommand(imagesEnvironment.relink);
  const pick = useAtomCommand(imagesEnvironment.pick);
  const tree = useMemo(() => (family.data ? buildTree(family.data) : null), [family.data]);
  const shownRef = `${selectedPath}@${shownVersion}`;

  if (family.error && !tree) {
    return <p className="px-3 pb-3 text-xs text-destructive-foreground">{family.error}</p>;
  }
  if (!tree) {
    return (
      <div className="flex justify-center px-3 pb-3">
        <Spinner size="sm" tone="muted" />
      </div>
    );
  }
  if (tree.roots.length === 0) {
    return <p className="px-3 pb-3 text-xs text-muted-foreground">No lineage recorded.</p>;
  }

  const rows: Array<{ node: ImageFamilyNode; depth: number }> = [];
  const visited = new Set<string>();
  const walk = (node: ImageFamilyNode, depth: number) => {
    if (visited.has(node.ref)) return;
    visited.add(node.ref);
    rows.push({ node, depth });
    for (const child of tree.childrenOf.get(node.ref) ?? []) walk(child, depth + 1);
  };
  for (const root of tree.roots) walk(root, 0);

  return (
    <div className="flex flex-col gap-0.5 px-3 pb-3">
      {rows.map(({ node, depth }) => (
        <LineageRow
          key={node.ref}
          environmentId={environmentId}
          cwd={cwd}
          node={node}
          selectedPath={selectedPath}
          shownRef={shownRef}
          depth={depth}
          onSelect={onSelect}
          onUse={(ref) => {
            void pick({
              environmentId,
              input: {
                cwd,
                from: ref,
                to: selectedPath,
                ...(threadId ? { threadId: ThreadId.make(threadId) } : {}),
              },
            });
          }}
          onUnlink={(target) => {
            const { path, version } = parseImageVersionRef(target.ref);
            void relink({
              environmentId,
              input: { cwd, path, version: version ?? target.n, parents: [] },
            });
          }}
        />
      ))}
    </div>
  );
}
