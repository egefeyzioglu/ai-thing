// @effect-diagnostics nodeBuiltinImport:off - the version store is synchronous fs by design (see VersionStore.ts)
// @effect-diagnostics globalTimers:off - fs.watch callbacks run outside Effect; the per-path debounce lives with them
// @effect-diagnostics globalDateInEffect:off - provider latency and file-name stamps, not scheduling
/**
 * ImageStore - the one writer for the project version store.
 *
 * Wraps the synchronous `VersionStore` in an Effect service so WebSocket
 * handlers, MCP tools, and the agent-write relay all go through one place that
 * publishes a change for the project after every write. A per-project watcher
 * (one `fs.watch` per directory; recursive watching is unreliable on Linux)
 * captures edits made by other tools as `external` versions.
 *
 * Provider keys: the dev runner copies the repo `.env` into the server process
 * environment, so in dev `process.env` already carries GEMINI_API_KEY,
 * OPENAI_API_KEY and ARK_API_KEY. Packaged servers have no such step, so the
 * store also reads `<T3 home>/aithing.env` and, when the server runs from a
 * checkout, the repo-root `.env`. Only those three keys are read from the
 * files and `process.env` always wins. See `loadProviderEnv`.
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import {
  type ImageCommitResult,
  type ImageFamilyGraph,
  type ImageIndex,
  type ImageManifest,
  type ImageResolution,
  type ImagesGenerateInput,
  type ImagesListModelsResult,
  type ImageVersion,
  type ImageVersionSource,
  ImagesError,
  type ThreadId,
  imageVersionRef,
  parseImageVersionRef,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import * as ServerConfig from "../config.ts";
import * as ProjectionSnapshotQuery from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as WorkspacePaths from "../workspace/WorkspacePaths.ts";
import * as ImageProviders from "./ImageProviders.ts";
import * as VersionStore from "./VersionStore.ts";

/** `ImagesGenerateInput` plus the knobs the MCP tools need. */
export interface GenerateRequest extends ImagesGenerateInput {
  /** Recorded source kind; `edit_image` records `edit`. */
  readonly kind?: "generate" | "edit";
  /** Exact project-relative path for a new file. Wins over `outputDir`. */
  readonly newPath?: string;
  /** Base name for a new file inside `outputDir`; `.png` is appended when it has no image extension. */
  readonly filename?: string;
}

export type CommitOptions = VersionStore.CommitOptions;

export class ImageStore extends Context.Service<
  ImageStore,
  {
    /** Every tracked file in the project plus the root-level brief files. */
    readonly index: (cwd: string) => Effect.Effect<ImageIndex, ImagesError>;
    /** The index now, then a fresh one after every change to the project. Starts the watcher. */
    readonly subscribe: (cwd: string) => Stream.Stream<ImageIndex, ImagesError>;
    readonly versions: (cwd: string, path: string) => Effect.Effect<ImageManifest, ImagesError>;
    readonly family: (cwd: string, path: string) => Effect.Effect<ImageFamilyGraph, ImagesError>;
    readonly star: (
      cwd: string,
      path: string,
      starred: boolean,
    ) => Effect.Effect<ImageManifest, ImagesError>;
    readonly reject: (
      cwd: string,
      path: string,
      version: number,
      rejected: boolean,
    ) => Effect.Effect<ImageManifest, ImagesError>;
    readonly relink: (
      cwd: string,
      path: string,
      version: number,
      parents: ReadonlyArray<string>,
    ) => Effect.Effect<ImageManifest, ImagesError>;
    readonly pick: (
      cwd: string,
      from: string,
      to: string,
      threadId?: ThreadId,
    ) => Effect.Effect<ImageCommitResult, ImagesError>;
    readonly restore: (
      cwd: string,
      path: string,
      version: number,
      threadId?: ThreadId,
    ) => Effect.Effect<ImageCommitResult, ImagesError>;
    /** Call a provider and record the result as a new file or the next version of `output`. */
    readonly generate: (input: GenerateRequest) => Effect.Effect<ImageCommitResult, ImagesError>;
    readonly commit: (
      cwd: string,
      rel: string,
      bytes: Buffer,
      source: ImageVersionSource,
      opts?: CommitOptions,
    ) => Effect.Effect<ImageCommitResult, ImagesError>;
    /** Capture the working file's bytes when they differ from the current version. */
    readonly syncExternal: (
      cwd: string,
      rel: string,
      source?: ImageVersionSource,
      opts?: CommitOptions,
    ) => Effect.Effect<ImageVersion | null, ImagesError>;
    readonly listModels: () => Effect.Effect<ImagesListModelsResult>;
    /** Env files consulted for provider keys, for the models tool's hint. */
    readonly providerEnvFiles: ReadonlyArray<string>;
    /** `threads/<yyyy-mm-dd>-<slug>`, project-relative; stable per thread for the server lifetime. */
    readonly threadOutputFolder: (threadId: ThreadId) => Effect.Effect<string, ImagesError>;
    /** The thread's worktree, or its project's workspace root. */
    readonly threadCwd: (threadId: ThreadId) => Effect.Effect<string, ImagesError>;
  }
  // @effect-diagnostics-next-line deterministicKeys:off - this fork's services use the aithing prefix
>()("aithing/images/ImageStore") {}

const PROVIDER_KEYS = ["GEMINI_API_KEY", "OPENAI_API_KEY", "ARK_API_KEY"] as const;
const EXCLUDED_DIRS = new Set([".git", ".aithing", "node_modules"]);
const MAX_WATCHED_DIRS = 5000;
const MAX_ADOPTED_FILES = 2000;
const WATCH_DEBOUNCE_MS = 500;
const PUBLISH_DEBOUNCE_MS = 250;

/** Parse `KEY=value` lines for the provider keys only; `base` wins. */
export function loadProviderEnv(
  files: ReadonlyArray<string>,
  base: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base };
  for (const file of files) {
    let text: string;
    try {
      text = NodeFS.readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const line of text.split(/\r?\n/)) {
      const match = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
      if (!match) continue;
      const key = match[1] as (typeof PROVIDER_KEYS)[number];
      if (!PROVIDER_KEYS.includes(key) || base[key]) continue;
      let value = match[2]!;
      if (/^(["']).*\1$/.test(value)) value = value.slice(1, -1);
      if (value) env[key] = value;
    }
  }
  return env;
}

/** The checkout this server runs from, when it runs from one. */
function repoRootEnvFile(): string | null {
  let dir = import.meta.dirname;
  for (let i = 0; i < 8; i++) {
    if (NodeFS.existsSync(NodePath.join(dir, "pnpm-workspace.yaml")))
      return NodePath.join(dir, ".env");
    const parent = NodePath.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

export function slugify(text: string, max = 48): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/g, "");
}

const isImagesError = Schema.is(ImagesError);

function toImagesError(cwd?: string, path?: string) {
  return (cause: unknown): ImagesError => {
    if (isImagesError(cause)) return cause;
    const message =
      cause instanceof Error ? cause.message : typeof cause === "string" ? cause : String(cause);
    const errorPath = cause instanceof VersionStore.VersionStoreError ? cause.path : path;
    return new ImagesError({
      message,
      ...(cwd ? { cwd } : {}),
      ...(errorPath ? { path: errorPath } : {}),
    });
  };
}

function briefFiles(root: string): string[] {
  try {
    return NodeFS.readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isFile() && VersionStore.isTextPath(entry.name))
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

/** The watcher captures images anywhere and notes only at the project root. */
function watcherCaptures(rel: string): boolean {
  return VersionStore.isVersionable(rel) && (VersionStore.isImagePath(rel) || !rel.includes("/"));
}

function isExcludedDirName(name: string): boolean {
  return EXCLUDED_DIRS.has(name) || name.startsWith(".");
}

interface WatchedProject {
  readonly dirs: Map<string, NodeFS.FSWatcher>;
  readonly pending: Map<string, NodeJS.Timeout>;
  capped: boolean;
  /** Open subscriptions; the watcher closes when the last one ends. */
  subscribers: number;
}

export const make = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const workspacePaths = yield* WorkspacePaths.WorkspacePaths;
  const snapshots = yield* ProjectionSnapshotQuery.ProjectionSnapshotQuery;
  const changes = yield* PubSub.unbounded<string>();
  const watched = new Map<string, WatchedProject>();
  const folderCache = new Map<string, string>();
  const providerEnvFiles = [
    NodePath.join(config.baseDir, "aithing.env"),
    ...(repoRootEnvFile() === null ? [] : [repoRootEnvFile()!]),
  ];

  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      for (const timer of pendingPublish.values()) clearTimeout(timer);
      pendingPublish.clear();
      for (const project of watched.values()) closeProject(project);
      watched.clear();
    }),
  );

  const logWarning = (message: string, data: Record<string, unknown>) =>
    Effect.runFork(Effect.logWarning(message, data));

  const normalize = (cwd: string) =>
    workspacePaths
      .normalizeWorkspaceRoot(cwd)
      .pipe(Effect.mapError((cause) => new ImagesError({ message: cause.message, cwd })));

  const attempt = <A>(cwd: string, path: string | undefined, f: () => A) =>
    Effect.try({ try: f, catch: toImagesError(cwd, path) });

  // Writes come in bursts (a commit then a reject, a watcher sweep), so a
  // change is published once per project after a short quiet period.
  const pendingPublish = new Map<string, NodeJS.Timeout>();
  const publishUnsafe = (root: string) => {
    const existing = pendingPublish.get(root);
    if (existing) clearTimeout(existing);
    pendingPublish.set(
      root,
      setTimeout(() => {
        pendingPublish.delete(root);
        // Timers and fs.watch callbacks run outside Effect; publishing from a
        // forked fiber is what wakes the subscriber fibers.
        Effect.runFork(PubSub.publish(changes, root));
      }, PUBLISH_DEBOUNCE_MS),
    );
  };
  const publish = (root: string) => Effect.sync(() => publishUnsafe(root));

  const indexOf = (root: string) =>
    attempt(root, undefined, (): ImageIndex => ({
      cwd: root,
      entries: VersionStore.scanIndex(root),
      briefFiles: briefFiles(root),
    }));

  // ---- watcher -----------------------------------------------------------

  const watchDir = (root: string, project: WatchedProject, dir: string): boolean => {
    if (project.dirs.has(dir)) return true;
    if (project.dirs.size >= MAX_WATCHED_DIRS) {
      if (!project.capped) {
        project.capped = true;
        logWarning("image watcher stopped adding directories", {
          cwd: root,
          limit: MAX_WATCHED_DIRS,
        });
      }
      return false;
    }
    try {
      const watcher = NodeFS.watch(dir, (_eventType, filename) => {
        if (filename) onWatchEvent(root, project, dir, filename.toString());
      });
      watcher.on("error", () => {
        watcher.close();
        project.dirs.delete(dir);
      });
      project.dirs.set(dir, watcher);
      return true;
    } catch (cause) {
      logWarning("image watcher could not NodeFS.watch directory", { dir, cause: String(cause) });
      return false;
    }
  };

  /**
   * Watch `start` and everything below it; adopt untracked files on the way.
   * A generator so the initial walk of a large project can yield to the event
   * loop between directories; returns whether anything was captured.
   */
  function* walkSteps(
    root: string,
    project: WatchedProject,
    start: string,
    adopted: { count: number },
  ): Generator<void, boolean> {
    let captured = false;
    // One read of the store for the whole walk; `append` keeps the list current.
    const manifests = VersionStore.readAllManifests(root);
    const stack = [start];
    while (stack.length) {
      // The project was released while we were walking.
      if (watched.get(root) !== project) return captured;
      const dir = stack.pop()!;
      if (!watchDir(root, project, dir)) continue;
      let entries: NodeFS.Dirent[];
      try {
        entries = NodeFS.readdirSync(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      // Shorter names first so `poster.png` is tracked before `poster-alt1.png`
      // and the alternative can be linked to it when it is adopted.
      entries.sort((a, b) => a.name.length - b.name.length || a.name.localeCompare(b.name));
      for (const entry of entries) {
        if (entry.isDirectory()) {
          if (!isExcludedDirName(entry.name)) stack.push(NodePath.join(dir, entry.name));
          continue;
        }
        if (!entry.isFile()) continue;
        const rel = VersionStore.toRel(root, NodePath.join(dir, entry.name));
        if (rel === null || !watcherCaptures(rel)) continue;
        if (adopted.count >= MAX_ADOPTED_FILES) {
          if (adopted.count === MAX_ADOPTED_FILES) {
            adopted.count++;
            logWarning("image watcher stopped adopting files", {
              cwd: root,
              limit: MAX_ADOPTED_FILES,
            });
          }
          continue;
        }
        adopted.count++;
        try {
          if (VersionStore.syncExternal(root, rel, undefined, { manifests }) !== null)
            captured = true;
        } catch (cause) {
          logWarning("image watcher could not adopt file", { rel, cause: String(cause) });
        }
      }
      yield;
    }
    return captured;
  }

  /** Synchronous walk for small subtrees that appear while watching. */
  const walk = (
    root: string,
    project: WatchedProject,
    start: string,
    adopted: { count: number },
  ) => {
    const steps = walkSteps(root, project, start, adopted);
    for (;;) {
      const step = steps.next();
      if (step.done) return step.value;
    }
  };

  /** The initial walk of a project, yielding between directories so the server stays responsive. */
  const walkInBackground = (root: string, project: WatchedProject) =>
    Effect.gen(function* () {
      const steps = walkSteps(root, project, root, { count: 0 });
      for (;;) {
        const step = steps.next();
        if (step.done) {
          if (step.value) publishUnsafe(root);
          return;
        }
        yield* Effect.yieldNow;
      }
    });

  const onWatchEvent = (root: string, project: WatchedProject, dir: string, filename: string) => {
    const abs = NodePath.join(dir, filename);
    const rel = VersionStore.toRel(root, abs);
    if (rel === null || /(^|\/)\.tmp-/.test(rel)) return;
    let stat: NodeFS.Stats | null;
    try {
      stat = NodeFS.statSync(abs);
    } catch {
      stat = null;
    }
    if (stat === null) {
      const watcher = project.dirs.get(abs);
      if (watcher) {
        watcher.close();
        project.dirs.delete(abs);
      }
      const timer = project.pending.get(rel);
      if (timer) {
        clearTimeout(timer);
        project.pending.delete(rel);
      }
      if (watcherCaptures(rel) || watcher) publishUnsafe(root);
      return;
    }
    if (stat.isDirectory()) {
      if (isExcludedDirName(NodePath.basename(abs)) || project.dirs.has(abs)) return;
      if (walk(root, project, abs, { count: 0 })) publishUnsafe(root);
      return;
    }
    if (!stat.isFile() || !watcherCaptures(rel)) return;
    const previous = project.pending.get(rel);
    if (previous) clearTimeout(previous);
    const timer = setTimeout(() => {
      project.pending.delete(rel);
      try {
        if (VersionStore.syncExternal(root, rel) !== null) publishUnsafe(root);
      } catch (cause) {
        logWarning("image watcher could not capture file", { rel, cause: String(cause) });
      }
    }, WATCH_DEBOUNCE_MS);
    timer.unref();
    project.pending.set(rel, timer);
  };

  const closeProject = (project: WatchedProject) => {
    for (const timer of project.pending.values()) clearTimeout(timer);
    project.pending.clear();
    for (const watcher of project.dirs.values()) watcher.close();
    project.dirs.clear();
  };

  /** Registers a subscriber; returns the project when its watcher still needs the initial walk. */
  const startWatcher = (root: string): WatchedProject | null => {
    const existing = watched.get(root);
    if (existing) {
      existing.subscribers++;
      return null;
    }
    const project: WatchedProject = {
      dirs: new Map(),
      pending: new Map(),
      capped: false,
      subscribers: 1,
    };
    watched.set(root, project);
    return project;
  };

  const stopWatcher = (root: string) => {
    const project = watched.get(root);
    if (!project) return;
    project.subscribers--;
    if (project.subscribers > 0) return;
    closeProject(project);
    watched.delete(root);
  };

  // ---- reads -------------------------------------------------------------

  const index: ImageStore["Service"]["index"] = (cwd) =>
    normalize(cwd).pipe(Effect.flatMap(indexOf));

  const subscribe: ImageStore["Service"]["subscribe"] = (cwd) =>
    Stream.unwrap(
      normalize(cwd).pipe(
        Effect.map((root) =>
          Stream.callback<ImageIndex, ImagesError>(
            (mailbox) =>
              Effect.gen(function* () {
                const subscription = yield* PubSub.subscribe(changes);
                const fresh = startWatcher(root);
                yield* Effect.addFinalizer(() => Effect.sync(() => stopWatcher(root)));
                Queue.offerUnsafe(mailbox, yield* indexOf(root));
                if (fresh) yield* Effect.forkScoped(walkInBackground(root, fresh));
                yield* Stream.fromSubscription(subscription).pipe(
                  Stream.filter((changed) => changed === root),
                  Stream.mapEffect(() => indexOf(root).pipe(Effect.option)),
                  Stream.runForEach((next) =>
                    Effect.sync(() => {
                      if (Option.isSome(next)) Queue.offerUnsafe(mailbox, next.value);
                    }),
                  ),
                  Effect.forkScoped,
                );
              }),
            { bufferSize: 1, strategy: "sliding" },
          ),
        ),
      ),
    );

  const trackedManifest = (root: string, path: string) =>
    attempt(root, path, () => {
      VersionStore.syncExternal(root, path);
      const manifest = VersionStore.readManifest(root, path) ?? VersionStore.adopt(root, path);
      if (!manifest) throw new VersionStore.VersionStoreError(`No versions for ${path}`, path);
      return manifest;
    });

  const versions: ImageStore["Service"]["versions"] = (cwd, path) =>
    normalize(cwd).pipe(Effect.flatMap((root) => trackedManifest(root, path)));

  const family: ImageStore["Service"]["family"] = (cwd, path) =>
    normalize(cwd).pipe(
      Effect.flatMap((root) =>
        trackedManifest(root, path).pipe(
          Effect.flatMap(() => attempt(root, path, () => VersionStore.family(root, path))),
        ),
      ),
    );

  // ---- writes ------------------------------------------------------------

  const write = <A>(cwd: string, path: string | undefined, f: (root: string) => A) =>
    normalize(cwd).pipe(
      Effect.flatMap((root) =>
        attempt(root, path, () => f(root)).pipe(Effect.tap(() => publish(root))),
      ),
    );

  const star: ImageStore["Service"]["star"] = (cwd, path, starred) =>
    write(cwd, path, (root) => {
      const manifest = VersionStore.setStarred(root, path, starred);
      if (!manifest) throw new VersionStore.VersionStoreError(`No versions for ${path}`, path);
      return manifest;
    });

  const reject: ImageStore["Service"]["reject"] = (cwd, path, version, rejected) =>
    write(cwd, path, (root) => VersionStore.setRejected(root, path, version, rejected));

  const relink: ImageStore["Service"]["relink"] = (cwd, path, version, parents) =>
    write(cwd, path, (root) => VersionStore.setParents(root, path, version, parents));

  const pick: ImageStore["Service"]["pick"] = (cwd, from, to, threadId) =>
    write(cwd, from, (root) => ({
      path: VersionStore.toRel(root, NodePath.resolve(root, to)) ?? to,
      ...VersionStore.pickVersion(root, from, to, threadId ? { threadId } : {}),
    }));

  const restore: ImageStore["Service"]["restore"] = (cwd, path, version, threadId) =>
    write(cwd, path, (root) => ({
      path: VersionStore.toRel(root, NodePath.resolve(root, path)) ?? path,
      ...VersionStore.restoreVersion(root, path, version, threadId ? { threadId } : {}),
    }));

  const commit: ImageStore["Service"]["commit"] = (cwd, rel, bytes, source, opts) =>
    write(cwd, rel, (root) => ({
      path: VersionStore.toRel(root, NodePath.resolve(root, rel)) ?? rel,
      ...VersionStore.commitVersion(root, rel, bytes, source, opts),
    }));

  const syncExternal: ImageStore["Service"]["syncExternal"] = (cwd, rel, source, opts) =>
    normalize(cwd).pipe(
      Effect.flatMap((root) =>
        attempt(root, rel, () => VersionStore.syncExternal(root, rel, source, opts)).pipe(
          Effect.tap((version) => (version ? publish(root) : Effect.void)),
        ),
      ),
    );

  // ---- threads -----------------------------------------------------------

  const threadShell = (threadId: ThreadId) =>
    snapshots.getThreadShellById(threadId).pipe(
      Effect.mapError((cause) => new ImagesError({ message: cause.message })),
      Effect.flatMap((thread) =>
        Option.isSome(thread)
          ? Effect.succeed(thread.value)
          : Effect.fail(new ImagesError({ message: `Thread ${threadId} was not found.` })),
      ),
    );

  const threadOutputFolder: ImageStore["Service"]["threadOutputFolder"] = (threadId) =>
    Effect.suspend(() => {
      const cached = folderCache.get(threadId);
      if (cached) return Effect.succeed(cached);
      return threadShell(threadId).pipe(
        Effect.map((thread) => {
          const date = thread.createdAt.slice(0, 10);
          const slug = slugify(thread.title) || threadId.slice(0, 8);
          const folder = `threads/${date}-${slug}`;
          folderCache.set(threadId, folder);
          return folder;
        }),
      );
    });

  const threadCwd: ImageStore["Service"]["threadCwd"] = (threadId) =>
    threadShell(threadId).pipe(
      Effect.flatMap((thread) =>
        thread.worktreePath
          ? Effect.succeed(thread.worktreePath)
          : snapshots.getProjectShellById(thread.projectId).pipe(
              Effect.mapError((cause) => new ImagesError({ message: cause.message })),
              Effect.flatMap((project) =>
                Option.isSome(project)
                  ? Effect.succeed(project.value.workspaceRoot)
                  : Effect.fail(
                      new ImagesError({ message: `Project for thread ${threadId} was not found.` }),
                    ),
              ),
            ),
      ),
    );

  // ---- generation --------------------------------------------------------

  const providerEnv = () => loadProviderEnv(providerEnvFiles);

  const listModels: ImageStore["Service"]["listModels"] = () =>
    Effect.sync(() => ({ models: ImageProviders.listModels(providerEnv()) }));

  const generate: ImageStore["Service"]["generate"] = (input) =>
    Effect.gen(function* () {
      const root = yield* normalize(input.cwd);
      const fail = (message: string, path?: string) =>
        Effect.fail(new ImagesError({ message, cwd: root, ...(path ? { path } : {}) }));
      const model = input.model ?? ImageProviders.DEFAULT_MODEL;
      const spec = ImageProviders.MODELS[model];
      if (!spec) {
        return yield* fail(
          `Unknown model "${model}". Known: ${Object.keys(ImageProviders.MODELS).join(", ")}`,
        );
      }

      // References: pin project files to an immutable ref so lineage never moves.
      const refs: ImageProviders.Reference[] = [];
      const pinned: string[] = [];
      const labels: string[] = [];
      for (const ref of input.references ?? []) {
        const located = yield* attempt(root, ref, () => VersionStore.resolveVersionPath(root, ref));
        const inside =
          located.version !== undefined || VersionStore.toRel(root, located.abs) !== null;
        let label = ref;
        if (inside) {
          const version = yield* attempt(root, located.rel, () => {
            if (located.version !== undefined) return located.version;
            VersionStore.syncExternal(root, located.rel);
            return (
              VersionStore.readManifest(root, located.rel) ?? VersionStore.adopt(root, located.rel)
            )?.current;
          });
          if (version !== undefined) {
            label = imageVersionRef(located.rel, version);
            pinned.push(label);
          }
        }
        const bytes = yield* attempt(root, ref, () => NodeFS.readFileSync(located.abs));
        refs.push({ path: located.abs, bytes, mimeType: ImageProviders.mimeFor(located.abs) });
        labels.push(label);
      }

      const resolution: ImageResolution =
        input.resolution ?? (spec.resolutions.includes("1K") ? "1K" : spec.resolutions[0]!);
      let aspectRatio = input.aspectRatio;
      if (!aspectRatio && refs[0]) {
        const dims = yield* Effect.promise(() => ImageProviders.dimensions(refs[0]!.bytes));
        if (dims) aspectRatio = ImageProviders.closestAspectRatio(spec, dims.width, dims.height);
      }
      aspectRatio ??= spec.aspectRatios.includes("1:1") ? "1:1" : spec.aspectRatios[0]!;

      // Destination: next version of `output`, or a new file.
      let outRel: string;
      let outputParent: string | undefined;
      if (input.output) {
        const rel = VersionStore.toRel(root, NodePath.resolve(root, input.output));
        if (rel === null || !VersionStore.isImagePath(rel)) {
          return yield* fail(
            `Output must be an image inside the project: ${input.output}`,
            input.output,
          );
        }
        if (!NodeFS.existsSync(NodePath.resolve(root, rel))) {
          return yield* fail(`Output image does not exist: ${rel}`, rel);
        }
        const manifest = yield* trackedManifest(root, rel);
        outRel = rel;
        outputParent = imageVersionRef(rel, manifest.current);
      } else {
        let candidate: string;
        if (input.newPath) {
          candidate = input.newPath;
        } else {
          const dir =
            input.outputDir ??
            (input.threadId ? yield* threadOutputFolder(input.threadId) : "generated");
          const name =
            input.filename ??
            `${slugify(input.prompt, 40) || "image"}-${Date.now().toString(36)}.png`;
          candidate = NodePath.join(dir, name);
        }
        if (!VersionStore.isImagePath(candidate)) candidate += ".png";
        const rel = VersionStore.toRel(root, NodePath.resolve(root, candidate));
        if (rel === null || NodePath.isAbsolute(candidate)) {
          return yield* fail(`New image must be inside the project: ${candidate}`, candidate);
        }
        outRel = uniquePath(root, rel);
      }

      const startedAt = Date.now();
      const generated = yield* Effect.tryPromise({
        try: () =>
          ImageProviders.generate({
            model,
            prompt: input.prompt,
            aspectRatio,
            resolution,
            refs,
            env: providerEnv(),
          }),
        catch: toImagesError(root),
      });
      const durationMs = Date.now() - startedAt;
      const bytes = yield* Effect.tryPromise({
        try: () => ImageProviders.encodeFor(outRel, generated.bytes),
        catch: toImagesError(root, outRel),
      });
      const dims = yield* Effect.promise(() => ImageProviders.dimensions(bytes));
      const estimatedCostUsd = ImageProviders.estimateCost(model, resolution);
      const parents = [...pinned];
      if (outputParent && !pinned.some((p) => parseImageVersionRef(p).path === outRel)) {
        parents.push(outputParent);
      }
      const source: ImageVersionSource = {
        kind: input.kind ?? "generate",
        prompt: input.prompt,
        model,
        provider: spec.provider,
        providerModel: generated.providerModel,
        providerRequestId: generated.providerRequestId,
        aspectRatio,
        resolution,
        references: labels,
        durationMs,
        ...(estimatedCostUsd !== undefined ? { estimatedCostUsd } : {}),
      };
      const result = yield* attempt(root, outRel, () =>
        VersionStore.commitVersion(root, outRel, bytes, source, {
          ...(dims ? { width: dims.width, height: dims.height } : {}),
          ...(input.threadId ? { threadId: input.threadId } : {}),
          parents,
        }),
      );
      yield* publish(root);
      return { path: outRel, ...result };
    });

  return ImageStore.of({
    index,
    subscribe,
    versions,
    family,
    star,
    reject,
    relink,
    pick,
    restore,
    generate,
    commit,
    syncExternal,
    listModels,
    providerEnvFiles,
    threadOutputFolder,
    threadCwd,
  });
});

/** `name.png`, then `name-2.png`, ... until neither the file nor a manifest for it exists. */
export function uniquePath(root: string, rel: string): string {
  const ext = NodePath.extname(rel);
  const stem = rel.slice(0, rel.length - ext.length);
  const taken = (candidate: string) =>
    NodeFS.existsSync(NodePath.resolve(root, candidate)) ||
    VersionStore.readManifestSafe(root, candidate) !== null;
  if (!taken(rel)) return rel;
  for (let n = 2; ; n++) {
    const candidate = `${stem}-${n}${ext}`;
    if (!taken(candidate)) return candidate;
  }
}

export const layer = Layer.effect(ImageStore, make);
