import * as Schema from "effect/Schema";

import { IsoDateTime, NonNegativeInt, ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";

/**
 * Versioned project images.
 *
 * A project is a plain folder. The working file stays an ordinary file any tool
 * can read; its history lives next to it under `<cwd>/.aithing/versions/<rel>/`
 * as `manifest.json` plus one file per version. Immutable refs look like
 * `path@N`. Lineage comes from `parents` refs, never from file names.
 */
export const IMAGE_STORE_DIR = ".aithing/versions";

export const ImageVersionSourceKind = Schema.Literals([
  "generate",
  "edit",
  "upload",
  "agent_write",
  "external",
  "restore",
  "pick",
  "adopt",
]);
export type ImageVersionSourceKind = typeof ImageVersionSourceKind.Type;

export const ImageResolution = Schema.Literals(["1K", "2K", "4K"]);
export type ImageResolution = typeof ImageResolution.Type;

/** Flat so the manifest on disk and the wire share one shape. Fields only apply to some kinds. */
export const ImageVersionSource = Schema.Struct({
  kind: ImageVersionSourceKind,
  prompt: Schema.optionalKey(Schema.String),
  model: Schema.optionalKey(Schema.String),
  provider: Schema.optionalKey(Schema.String),
  providerModel: Schema.optionalKey(Schema.String),
  providerRequestId: Schema.optionalKey(Schema.NullOr(Schema.String)),
  aspectRatio: Schema.optionalKey(Schema.String),
  resolution: Schema.optionalKey(Schema.String),
  references: Schema.optionalKey(Schema.Array(Schema.String)),
  durationMs: Schema.optionalKey(Schema.Number),
  /** Estimated provider cost of this generation, USD. */
  estimatedCostUsd: Schema.optionalKey(Schema.Number),
  /** `restore`: the version number that was restored. */
  restoredFrom: Schema.optionalKey(Schema.Int),
  /** `pick`: the `path@N` ref that was copied onto this path. */
  pickedFrom: Schema.optionalKey(Schema.String),
  /** `agent_write`: the tool that wrote the file, when known. */
  tool: Schema.optionalKey(Schema.String),
  originalName: Schema.optionalKey(Schema.String),
});
export type ImageVersionSource = typeof ImageVersionSource.Type;

export const ImageVersion = Schema.Struct({
  n: Schema.Int,
  file: Schema.String,
  sha256: Schema.String,
  size: NonNegativeInt,
  width: Schema.optionalKey(Schema.Int),
  height: Schema.optionalKey(Schema.Int),
  createdAt: IsoDateTime,
  threadId: Schema.optionalKey(Schema.String),
  source: ImageVersionSource,
  parents: Schema.optionalKey(Schema.Array(Schema.String)),
  /** Parents were guessed (same bytes, or a `-v2`/`alt1` style name) rather than recorded. */
  inferred: Schema.optionalKey(Schema.Boolean),
  /** Culled in triage. Views hide it, lineage keeps it. */
  rejected: Schema.optionalKey(Schema.Boolean),
});
export type ImageVersion = typeof ImageVersion.Type;

export const ImageManifest = Schema.Struct({
  schemaVersion: Schema.Int,
  path: Schema.String,
  current: Schema.Int,
  versions: Schema.Array(ImageVersion),
  starred: Schema.optionalKey(Schema.Boolean),
});
export type ImageManifest = typeof ImageManifest.Type;

/** One tracked file, summarised from its manifest and the derivation graph. */
export const ImageIndexEntry = Schema.Struct({
  path: Schema.String,
  current: Schema.Int,
  versions: Schema.Int,
  starred: Schema.Boolean,
  kinds: Schema.Array(ImageVersionSourceKind),
  threads: Schema.Array(Schema.String),
  refs: Schema.Array(Schema.String),
  usedAsRef: Schema.Boolean,
  lastKind: ImageVersionSourceKind,
  lastCreatedAt: IsoDateTime,
  width: Schema.optionalKey(Schema.Int),
  height: Schema.optionalKey(Schema.Int),
  size: NonNegativeInt,
  exists: Schema.Boolean,
  parents: Schema.Array(Schema.String),
  children: Schema.Array(Schema.String),
  familyId: Schema.String,
  familySize: Schema.Int,
  inferred: Schema.Boolean,
  /** The current version was culled. */
  rejected: Schema.Boolean,
  /** Prompt and model of the current version, when it was generated. */
  prompt: Schema.optionalKey(Schema.String),
  model: Schema.optionalKey(Schema.String),
});
export type ImageIndexEntry = typeof ImageIndexEntry.Type;

export const ImageIndex = Schema.Struct({
  cwd: Schema.String,
  entries: Schema.Array(ImageIndexEntry),
  /** Root-level markdown and text files: the project brief. */
  briefFiles: Schema.Array(Schema.String),
});
export type ImageIndex = typeof ImageIndex.Type;

export const ImageFamilyNode = Schema.Struct({
  ref: Schema.String,
  path: Schema.String,
  n: Schema.Int,
  current: Schema.Boolean,
  exists: Schema.Boolean,
  starred: Schema.Boolean,
  rejected: Schema.Boolean,
  createdAt: IsoDateTime,
  kind: ImageVersionSourceKind,
  threadId: Schema.optionalKey(Schema.String),
  width: Schema.optionalKey(Schema.Int),
  height: Schema.optionalKey(Schema.Int),
  size: NonNegativeInt,
  parents: Schema.Array(Schema.String),
  inferred: Schema.Boolean,
  prompt: Schema.optionalKey(Schema.String),
  model: Schema.optionalKey(Schema.String),
});
export type ImageFamilyNode = typeof ImageFamilyNode.Type;

export const ImageFamilyGraph = Schema.Struct({
  nodes: Schema.Array(ImageFamilyNode),
  roots: Schema.Array(Schema.String),
});
export type ImageFamilyGraph = typeof ImageFamilyGraph.Type;

export const ImageModelInfo = Schema.Struct({
  id: Schema.String,
  provider: Schema.String,
  available: Schema.Boolean,
  /** Env var that enables the model, for the settings hint. */
  key: Schema.String,
  isDefault: Schema.Boolean,
  resolutions: Schema.Array(ImageResolution),
  aspectRatios: Schema.Array(Schema.String),
  references: Schema.Boolean,
  note: Schema.String,
  /** Rough per-image cost in USD keyed by resolution. */
  estimatedCostUsd: Schema.Record(Schema.String, Schema.Number),
});
export type ImageModelInfo = typeof ImageModelInfo.Type;

export class ImagesError extends Schema.TaggedError<ImagesError>()("ImagesError", {
  message: Schema.String,
  cwd: Schema.optionalKey(Schema.String),
  path: Schema.optionalKey(Schema.String),
}) {}

const Cwd = TrimmedNonEmptyString;
const RelPath = TrimmedNonEmptyString;

export const ImagesIndexInput = Schema.Struct({ cwd: Cwd });
export type ImagesIndexInput = typeof ImagesIndexInput.Type;

export const ImagesSubscribeInput = Schema.Struct({ cwd: Cwd });
export type ImagesSubscribeInput = typeof ImagesSubscribeInput.Type;

export const ImagesPathInput = Schema.Struct({ cwd: Cwd, path: RelPath });
export type ImagesPathInput = typeof ImagesPathInput.Type;

export const ImagesStarInput = Schema.Struct({ cwd: Cwd, path: RelPath, starred: Schema.Boolean });
export type ImagesStarInput = typeof ImagesStarInput.Type;

export const ImagesRejectInput = Schema.Struct({
  cwd: Cwd,
  path: RelPath,
  version: Schema.Int,
  rejected: Schema.Boolean,
});
export type ImagesRejectInput = typeof ImagesRejectInput.Type;

export const ImagesRelinkInput = Schema.Struct({
  cwd: Cwd,
  path: RelPath,
  version: Schema.Int,
  /** Immutable `path@N` refs. Empty detaches the version. */
  parents: Schema.Array(Schema.String),
});
export type ImagesRelinkInput = typeof ImagesRelinkInput.Type;

export const ImagesPickInput = Schema.Struct({
  cwd: Cwd,
  /** `path` or `path@N` to copy from. */
  from: RelPath,
  /** Project-relative destination path; becomes a `pick` version there. */
  to: RelPath,
  threadId: Schema.optionalKey(ThreadId),
});
export type ImagesPickInput = typeof ImagesPickInput.Type;

export const ImagesRestoreInput = Schema.Struct({
  cwd: Cwd,
  path: RelPath,
  version: Schema.Int,
  threadId: Schema.optionalKey(ThreadId),
});
export type ImagesRestoreInput = typeof ImagesRestoreInput.Type;

export const ImageCommitResult = Schema.Struct({
  path: Schema.String,
  version: ImageVersion,
  created: Schema.Boolean,
});
export type ImageCommitResult = typeof ImageCommitResult.Type;

/** Manual rerun from the side panel: no agent involved. */
export const ImagesGenerateInput = Schema.Struct({
  cwd: Cwd,
  threadId: Schema.optionalKey(ThreadId),
  prompt: TrimmedNonEmptyString,
  model: Schema.optionalKey(Schema.String),
  aspectRatio: Schema.optionalKey(Schema.String),
  resolution: Schema.optionalKey(ImageResolution),
  /** Reference images, `path` or `path@N`. */
  references: Schema.optionalKey(Schema.Array(Schema.String)),
  /** Existing project-relative image to overwrite as its next version. */
  output: Schema.optionalKey(RelPath),
  /** Folder for a new file when `output` is not given. Defaults to the thread's output folder. */
  outputDir: Schema.optionalKey(Schema.String),
});
export type ImagesGenerateInput = typeof ImagesGenerateInput.Type;

export const ImagesListModelsInput = Schema.Struct({ cwd: Schema.optionalKey(Cwd) });
export type ImagesListModelsInput = typeof ImagesListModelsInput.Type;

export const ImagesListModelsResult = Schema.Struct({ models: Schema.Array(ImageModelInfo) });
export type ImagesListModelsResult = typeof ImagesListModelsResult.Type;

/** Parse `path@N`; a bare path has no version. */
export function parseImageVersionRef(ref: string): { path: string; version?: number } {
  const match = /^(.*)@(\d+)$/.exec(ref);
  if (!match || !Number.isSafeInteger(Number(match[2])) || Number(match[2]) < 1) {
    return { path: ref };
  }
  return { path: match[1]!, version: Number(match[2]) };
}

export function imageVersionRef(path: string, version: number): string {
  return `${path}@${version}`;
}

export function isImageStorePath(path: string): boolean {
  return `${IMAGE_STORE_DIR}/${path}`.length > 0 && /(^|\/)\.aithing(\/|$)/.test(path);
}
