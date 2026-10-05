import { useAtomValue } from "@effect/atom-react";
import {
  IMAGE_STORE_DIR,
  parseImageVersionRef,
  type AssetResource,
  type EnvironmentId,
  type ImageIndex,
  type ImageIndexEntry,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Option from "effect/Option";
import { AsyncResult, type Atom } from "effect/unstable/reactivity";
import { useMemo } from "react";

import { useAssetUrlState, type AssetUrlState } from "~/assets/assetUrls";
import { imagesEnvironment } from "~/state/images";

/** Path of stored version `N` of a tracked file, relative to the workspace root. */
function imageVersionStorePath(path: string, version: number): string {
  const slash = path.lastIndexOf("/");
  const dot = path.lastIndexOf(".");
  const ext = dot > slash ? path.slice(dot) : "";
  return `${IMAGE_STORE_DIR}/${path}/v${version}${ext}`;
}

/**
 * Signed URL for a project image. Without a version it serves the working
 * file; with one it serves the immutable copy in the version store.
 */
export function useImageAssetUrl(
  environmentId: EnvironmentId | null,
  cwd: string,
  path: string | null,
  version?: number | null,
): AssetUrlState {
  const resource = useMemo<AssetResource | null>(
    () =>
      path === null
        ? null
        : {
            _tag: "draft-workspace-file",
            cwd,
            path: version ? imageVersionStorePath(path, version) : path,
          },
    [cwd, path, version],
  );
  return useAssetUrlState(environmentId, resource);
}

export function imageBasename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

export function imageDirname(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? "" : path.slice(0, slash);
}

export function shortThreadId(threadId: string): string {
  return threadId.length > 8 ? threadId.slice(0, 8) : threadId;
}

export function formatImageBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(0)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

/** `16:9` for 1920×1080; falls back to a rounded decimal ratio for odd sizes. */
export function imageAspectLabel(width: number, height: number): string {
  if (width <= 0 || height <= 0) return "";
  const divisor = gcd(width, height);
  const w = width / divisor;
  const h = height / divisor;
  if (w <= 32 && h <= 32) return `${w}:${h}`;
  return `${(width / height).toFixed(2)}:1`;
}

/** Picks the `W:H` option closest to the image's own ratio. */
export function closestAspectRatio(
  options: ReadonlyArray<string>,
  width: number | undefined,
  height: number | undefined,
): string | undefined {
  if (!width || !height || options.length === 0) return options[0];
  const target = width / height;
  let best: string | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const option of options) {
    const [w, h] = option.split(":").map(Number);
    if (!w || !h) continue;
    const distance = Math.abs(w / h - target);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = option;
    }
  }
  return best ?? options[0];
}

export interface QueryState<A> {
  data: A | null;
  loading: boolean;
  error: string | null;
}

function queryState<A, E>(result: AsyncResult.AsyncResult<A, E>): QueryState<A> {
  const data = Option.getOrNull(AsyncResult.value(result));
  const failure = AsyncResult.isFailure(result) ? Cause.squash(result.cause) : null;
  return {
    data,
    loading: AsyncResult.isInitial(result) || (data === null && result.waiting),
    error:
      failure === null
        ? null
        : failure instanceof Error
          ? failure.message
          : typeof failure === "object" && failure !== null && "message" in failure
            ? String((failure as { message: unknown }).message)
            : "Request failed.",
  };
}

function useQueryState<A, E>(atom: Atom.Atom<AsyncResult.AsyncResult<A, E>>): QueryState<A> {
  const result = useAtomValue(atom);
  return useMemo(() => queryState(result), [result]);
}

export function useImageIndex(environmentId: EnvironmentId, cwd: string) {
  return useQueryState(imagesEnvironment.index({ environmentId, input: { cwd } }));
}

export function useImageVersions(environmentId: EnvironmentId, cwd: string, path: string) {
  return useQueryState(imagesEnvironment.versions({ environmentId, input: { cwd, path } }));
}

export function useImageFamily(environmentId: EnvironmentId, cwd: string, path: string) {
  return useQueryState(imagesEnvironment.family({ environmentId, input: { cwd, path } }));
}

export function useImageModels(environmentId: EnvironmentId, cwd: string) {
  return useQueryState(imagesEnvironment.models({ environmentId, input: { cwd } }));
}

/** One image in the lightbox or compare views. */
export interface ImageVersionItem {
  path: string;
  version: number;
  ref: string;
  width?: number;
  height?: number;
  model?: string;
  costUsd?: number;
  starred?: boolean;
  rejected?: boolean;
}

export interface LightboxRequest {
  items: ReadonlyArray<ImageVersionItem>;
  source?: ImageVersionItem;
  initialIndex: number;
}

function entryToItem(entry: ImageIndexEntry, version = entry.current): ImageVersionItem {
  return {
    path: entry.path,
    version,
    ref: `${entry.path}@${version}`,
    ...(entry.width !== undefined ? { width: entry.width } : {}),
    ...(entry.height !== undefined ? { height: entry.height } : {}),
    ...(entry.model !== undefined ? { model: entry.model } : {}),
    starred: entry.starred,
    rejected: entry.rejected,
  };
}

const reviewable = (entry: ImageIndexEntry) => entry.exists && !entry.rejected && !entry.starred;

/**
 * Alternatives worth culling around an entry: its children, or failing that
 * the siblings generated from the same parent. The source is the version the
 * set derives from so the lightbox can compare and "use" against it.
 */
export function reviewSetFor(index: ImageIndex, entry: ImageIndexEntry): LightboxRequest | null {
  const byPath = new Map(index.entries.map((candidate) => [candidate.path, candidate]));
  const childPaths = new Set(entry.children.map((ref) => parseImageVersionRef(ref).path));
  const children = index.entries.filter(
    (candidate) =>
      candidate.path !== entry.path && childPaths.has(candidate.path) && reviewable(candidate),
  );
  if (children.length > 0) {
    return {
      items: children.map((child) => entryToItem(child)),
      source: entryToItem(entry),
      initialIndex: 0,
    };
  }
  const parentPaths = new Set(entry.parents.map((ref) => parseImageVersionRef(ref).path));
  if (parentPaths.size === 0) return null;
  const siblings = index.entries.filter(
    (candidate) =>
      candidate.path !== entry.path &&
      reviewable(candidate) &&
      candidate.parents.some((ref) => parentPaths.has(parseImageVersionRef(ref).path)),
  );
  if (siblings.length === 0) return null;
  const parentRef = entry.parents.find((ref) => byPath.has(parseImageVersionRef(ref).path));
  const parsed = parentRef ? parseImageVersionRef(parentRef) : null;
  const parentEntry = parsed ? byPath.get(parsed.path) : undefined;
  return {
    items: [entryToItem(entry), ...siblings.map((sibling) => entryToItem(sibling))],
    ...(parentEntry
      ? {
          source: entryToItem(parentEntry, parsed?.version ?? parentEntry.current),
        }
      : {}),
    initialIndex: 0,
  };
}
