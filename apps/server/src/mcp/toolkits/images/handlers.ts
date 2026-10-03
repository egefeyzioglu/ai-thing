// @effect-diagnostics nodeBuiltinImport:off - reads version bytes the synchronous store just wrote
/**
 * Image tool handlers. Each resolves the calling thread's project root and
 * image folder from the MCP invocation, then goes through `ImageStore` so the
 * side panel sees every change. Results carry previews as image blocks; the
 * registration in `ImagesToolRegistration.ts` turns them into MCP content.
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import {
  type ImageFamilyGraph,
  type ImageManifest,
  type ImageVersion,
  ImagesError,
  type McpCapabilityUnavailableError,
  type ThreadId,
  imageVersionRef,
  parseImageVersionRef,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";

import * as ImageProviders from "../../../images/ImageProviders.ts";
import { type GenerateRequest, ImageStore } from "../../../images/ImageStore.ts";
import * as VersionStore from "../../../images/VersionStore.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import type {
  EditImageInput,
  GenerateImageInput,
  ImageHistoryInput,
  ImagesToolOutput,
  ListImageModelsInput,
  RestoreImageVersionInput,
  ViewImageInput,
} from "./tools.ts";

const PREVIEW_SIDE = 768;
const VARIANT_PREVIEW_SIDE = 512;

type ToolEffect<A = ImagesToolOutput> = Effect.Effect<
  A,
  ImagesError | McpCapabilityUnavailableError,
  McpInvocationContext.McpInvocationContext
>;

export interface ImagesToolHandlers {
  readonly list_image_models: (input: ListImageModelsInput) => ToolEffect;
  readonly generate_image: (input: GenerateImageInput) => ToolEffect;
  readonly edit_image: (input: EditImageInput) => ToolEffect;
  readonly image_history: (input: ImageHistoryInput) => ToolEffect;
  readonly restore_image_version: (input: RestoreImageVersionInput) => ToolEffect;
  readonly view_image: (input: ViewImageInput) => ToolEffect;
}

export interface ThreadImageContext {
  readonly threadId: ThreadId;
  readonly cwd: string;
  readonly outputFolder: string;
}

const readable = (root: string, ref: string): boolean => {
  try {
    VersionStore.resolveVersionPath(root, ref);
    return true;
  } catch {
    return false;
  }
};

/**
 * Agents often pass a bare file name for something they just generated, so a
 * relative path that is not at the project root is retried in the thread's
 * image folder. Unresolvable refs are returned as given so the store reports
 * the real error.
 */
export function locateImageRef(context: ThreadImageContext, ref: string): string {
  const parsed = parseImageVersionRef(ref);
  if (NodePath.isAbsolute(parsed.path) || readable(context.cwd, ref)) return ref;
  const inFolder = `${context.outputFolder}/${parsed.path}`;
  const candidate =
    parsed.version === undefined ? inFolder : imageVersionRef(inFolder, parsed.version);
  return readable(context.cwd, candidate) ? candidate : ref;
}

const money = (usd: number | undefined) =>
  usd === undefined ? "cost unknown" : `~$${usd.toFixed(3)}`;
const size = (v: { width?: number; height?: number }) =>
  v.width !== undefined && v.height !== undefined ? `${v.width}x${v.height}` : "size unknown";
const truncate = (text: string, max: number) =>
  text.length <= max ? text : `${text.slice(0, max - 1)}…`;

function describeVersion(v: ImageVersion): string {
  const bits = [`v${v.n}`, v.createdAt.replace("T", " ").slice(0, 16), v.source.kind];
  if (v.source.model) bits.push(v.source.model);
  if (v.source.prompt) bits.push(JSON.stringify(truncate(v.source.prompt, 80)));
  bits.push(size(v));
  if (v.rejected) bits.push("REJECTED");
  const parents = v.parents?.length ? `  from: ${v.parents.join(", ")}` : "";
  return `${bits.join("  ")}${parents}`;
}

export function historyText(
  path: string,
  manifest: ImageManifest,
  family: ImageFamilyGraph,
): string {
  const current = manifest.versions.find((v) => v.n === manifest.current)!;
  const lines = [
    `${path} — ${manifest.versions.length} version${manifest.versions.length === 1 ? "" : "s"}, current v${manifest.current}${manifest.starred ? ", starred" : ""}`,
    ...manifest.versions.map((v) =>
      v.n === manifest.current ? `* ${describeVersion(v)}` : `  ${describeVersion(v)}`,
    ),
  ];
  if (current.parents?.length) lines.push(`Derived from: ${current.parents.join(", ")}`);
  const currentParents = new Set(current.parents ?? []);
  const related = family.nodes.filter((node) => node.path !== path && node.current && node.exists);
  if (related.length) {
    lines.push("Related:");
    for (const node of related) {
      const alternative = node.parents.some((p) => currentParents.has(p)) ? " (alternative)" : "";
      const from = node.parents.length ? ` from ${node.parents.join(", ")}` : "";
      lines.push(`  ${node.ref}${alternative}${from}${node.rejected ? " REJECTED" : ""}`);
    }
  }
  return lines.join("\n");
}

export const make = Effect.gen(function* () {
  const store = yield* ImageStore;

  const context: ToolEffect<ThreadImageContext> = Effect.gen(function* () {
    const scope = yield* McpInvocationContext.requireMcpCapability("images");
    const cwd = yield* store.threadCwd(scope.threadId);
    const outputFolder = yield* store.threadOutputFolder(scope.threadId);
    return { threadId: scope.threadId, cwd, outputFolder };
  });

  const fail = (message: string, path?: string) =>
    Effect.fail(new ImagesError({ message, ...(path ? { path } : {}) }));

  const versionBytes = (cwd: string, path: string, n: number) =>
    Effect.try({
      try: () => NodeFS.readFileSync(VersionStore.versionFile(cwd, path, n)),
      catch: (cause) => new ImagesError({ message: String(cause), cwd, path }),
    });

  const preview = (bytes: Buffer, side: number) =>
    Effect.tryPromise({
      try: () => ImageProviders.preview(bytes, side),
      catch: (cause) =>
        new ImagesError({ message: `Could not render a preview: ${String(cause)}` }),
    });

  const savedLine = (cwd: string, path: string, version: ImageVersion) =>
    `Saved ${NodePath.resolve(cwd, path)} (${size(version)}, ${version.source.model ?? version.source.kind}, ${money(version.source.estimatedCostUsd)}) — version ${version.n}`;

  const savedResult = (cwd: string, path: string, version: ImageVersion, side = PREVIEW_SIDE) =>
    Effect.gen(function* () {
      const bytes = yield* versionBytes(cwd, path, version.n);
      const image = yield* preview(bytes, side);
      return {
        text: savedLine(cwd, path, version),
        images: [image],
        structured: {
          path: NodePath.resolve(cwd, path),
          relativePath: path,
          ref: imageVersionRef(path, version.n),
          version: version.n,
          width: version.width,
          height: version.height,
          model: version.source.model,
          estimatedCostUsd: version.source.estimatedCostUsd,
        },
      } satisfies ImagesToolOutput;
    });

  const list_image_models: ImagesToolHandlers["list_image_models"] = () =>
    Effect.gen(function* () {
      const ctx = yield* context;
      const { models } = yield* store.listModels();
      const rows = models.map((m) => {
        const cost = Object.entries(m.estimatedCostUsd)
          .map(([res, usd]) => `${res} $${usd.toFixed(3)}`)
          .join(", ");
        return [
          `${m.id}${m.isDefault ? " (default)" : ""}`,
          `provider: ${m.provider}`,
          m.available ? "available" : `unavailable (${m.key} not set)`,
          `resolutions: ${m.resolutions.join("/")}`,
          `ratios: ${m.aspectRatios.join(" ")}`,
          `references: ${m.references ? "yes" : "no"}`,
          `cost/image: ${cost || "unknown"}`,
          m.note,
        ].join("\n    ");
      });
      const text = [
        "Image models:",
        ...rows.map((row) => `- ${row}`),
        "",
        `Keys come from the server environment, then ${store.providerEnvFiles.join(", then ")}.`,
        `This thread's images are saved under ${ctx.outputFolder}/ in ${ctx.cwd}.`,
        "Files are versioned: path@N addresses version N; image_history lists them and restore_image_version brings one back.",
        "Alternatives saved under new names next to their source are linked to it automatically.",
      ].join("\n");
      return {
        text,
        images: [],
        structured: {
          outputFolder: ctx.outputFolder,
          models: models.map((m) => ({ id: m.id, provider: m.provider, available: m.available })),
        },
      };
    });

  const generate_image: ImagesToolHandlers["generate_image"] = (input) =>
    Effect.gen(function* () {
      const ctx = yield* context;
      const output = input.output ? locateImageRef(ctx, input.output) : undefined;
      const outputExists = output !== undefined && readable(ctx.cwd, output);
      const result = yield* store.generate({
        cwd: ctx.cwd,
        threadId: ctx.threadId,
        prompt: input.prompt,
        ...(input.model !== undefined ? { model: input.model } : {}),
        ...(input.aspect_ratio !== undefined ? { aspectRatio: input.aspect_ratio } : {}),
        ...(input.resolution !== undefined ? { resolution: input.resolution } : {}),
        references: (input.reference_images ?? []).map((ref) => locateImageRef(ctx, ref)),
        ...(outputExists ? { output } : output ? { newPath: output } : {}),
        ...(input.filename && !output ? { filename: NodePath.basename(input.filename) } : {}),
        outputDir: ctx.outputFolder,
      });
      return yield* savedResult(ctx.cwd, result.path, result.version);
    });

  const edit_image: ImagesToolHandlers["edit_image"] = (input) =>
    Effect.gen(function* () {
      const ctx = yield* context;
      const sourceRef = locateImageRef(ctx, input.path);
      const source = yield* Effect.try({
        try: () => VersionStore.resolveVersionPath(ctx.cwd, sourceRef),
        catch: (cause) =>
          new ImagesError({
            message: String(cause instanceof Error ? cause.message : cause),
            path: input.path,
          }),
      });
      if (source.version === undefined && VersionStore.toRel(ctx.cwd, source.abs) === null) {
        return yield* fail(
          "edit_image needs an image inside the project. Use generate_image with reference_images for files elsewhere.",
          input.path,
        );
      }
      const model = input.model ?? ImageProviders.DEFAULT_MODEL;
      const spec = ImageProviders.MODELS[model];
      if (!spec) return yield* fail(`Unknown model "${model}". Call list_image_models.`);
      const dims = yield* Effect.tryPromise({
        try: () => ImageProviders.dimensions(NodeFS.readFileSync(source.abs)),
        catch: (cause) =>
          new ImagesError({
            message: `Could not read ${input.path}: ${cause instanceof Error ? cause.message : String(cause)}`,
            path: input.path,
          }),
      });
      const aspectRatio = dims
        ? ImageProviders.closestAspectRatio(spec, dims.width, dims.height)
        : undefined;
      const references = [
        sourceRef,
        ...(input.extra_references ?? []).map((ref) => locateImageRef(ctx, ref)),
      ];
      const base: GenerateRequest = {
        cwd: ctx.cwd,
        threadId: ctx.threadId,
        kind: "edit",
        prompt: input.prompt,
        model,
        ...(aspectRatio !== undefined ? { aspectRatio } : {}),
        ...(input.resolution !== undefined ? { resolution: input.resolution } : {}),
        references,
      };
      const variants = input.variants ?? 1;

      if (variants <= 1) {
        const output = input.output ? locateImageRef(ctx, input.output) : source.rel;
        const outputExists = readable(ctx.cwd, output);
        const result = yield* store.generate({
          ...base,
          ...(outputExists ? { output } : { newPath: output }),
        });
        return yield* savedResult(ctx.cwd, result.path, result.version);
      }

      // Siblings next to the source, first free -altN names, never the source itself.
      const ext = NodePath.extname(source.rel);
      const dir = NodePath.dirname(source.rel) === "." ? "" : `${NodePath.dirname(source.rel)}/`;
      const stem = NodePath.basename(source.rel, ext);
      const names: string[] = [];
      for (let k = 1; names.length < variants; k++) {
        const candidate = `${dir}${stem}-alt${k}${ext}`;
        if (
          NodeFS.existsSync(NodePath.resolve(ctx.cwd, candidate)) ||
          VersionStore.readManifestSafe(ctx.cwd, candidate)
        )
          continue;
        names.push(candidate);
      }
      const outcomes = yield* Effect.all(
        names.map((newPath) => store.generate({ ...base, newPath }).pipe(Effect.result)),
        { concurrency: "unbounded" },
      );
      const lines: string[] = [];
      const images: Array<{ data: string; mimeType: string }> = [];
      const saved: Array<Record<string, unknown>> = [];
      const failures: string[] = [];
      for (const [i, outcome] of outcomes.entries()) {
        if (Result.isSuccess(outcome)) {
          const { path, version } = outcome.success;
          lines.push(savedLine(ctx.cwd, path, version));
          const bytes = yield* versionBytes(ctx.cwd, path, version.n);
          images.push(yield* preview(bytes, VARIANT_PREVIEW_SIDE));
          saved.push({
            path: NodePath.resolve(ctx.cwd, path),
            ref: imageVersionRef(path, version.n),
          });
        } else {
          const message = outcome.failure.message;
          lines.push(`Failed ${names[i]}: ${message}`);
          failures.push(message);
        }
      }
      if (saved.length === 0) {
        return yield* fail(`All ${variants} variants failed: ${failures.join(" | ")}`, source.rel);
      }
      lines.push(
        `Previews are in the order listed. All are children of ${imageVersionRef(source.rel, source.version ?? VersionStore.readManifestSafe(ctx.cwd, source.rel)?.current ?? 1)}.`,
      );
      return { text: lines.join("\n"), images, structured: { saved, failed: failures.length } };
    });

  const image_history: ImagesToolHandlers["image_history"] = (input) =>
    Effect.gen(function* () {
      const ctx = yield* context;
      const { path } = parseImageVersionRef(locateImageRef(ctx, input.path));
      const rel = VersionStore.toRel(ctx.cwd, NodePath.resolve(ctx.cwd, path));
      if (rel === null)
        return yield* fail("image_history only covers files inside the project.", input.path);
      const manifest = yield* store.versions(ctx.cwd, rel);
      const family = yield* store.family(ctx.cwd, rel);
      const current = manifest.versions.find((v) => v.n === manifest.current)!;
      const bytes = yield* versionBytes(ctx.cwd, rel, manifest.current);
      const image = yield* preview(bytes, PREVIEW_SIDE);
      return {
        text: historyText(rel, manifest, family),
        images: [image],
        structured: {
          path: NodePath.resolve(ctx.cwd, rel),
          current: manifest.current,
          versions: manifest.versions.map((v) => ({
            n: v.n,
            kind: v.source.kind,
            createdAt: v.createdAt,
            rejected: !!v.rejected,
          })),
          derivedFrom: current.parents ?? [],
        },
      };
    });

  const restore_image_version: ImagesToolHandlers["restore_image_version"] = (input) =>
    Effect.gen(function* () {
      const ctx = yield* context;
      const { path } = parseImageVersionRef(locateImageRef(ctx, input.path));
      const result = yield* store.restore(ctx.cwd, path, input.version, ctx.threadId);
      const out = yield* savedResult(ctx.cwd, result.path, result.version);
      return {
        ...out,
        text: result.created
          ? `Restored ${result.path}@${input.version} as version ${result.version.n}. ${out.text}`
          : `${result.path} already has the bytes of version ${input.version} (current v${result.version.n}).`,
      };
    });

  const view_image: ImagesToolHandlers["view_image"] = (input) =>
    Effect.gen(function* () {
      const ctx = yield* context;
      const ref = locateImageRef(ctx, input.path);
      const located = yield* Effect.try({
        try: () => VersionStore.resolveVersionPath(ctx.cwd, ref),
        catch: (cause) =>
          new ImagesError({
            message: cause instanceof Error ? cause.message : String(cause),
            path: input.path,
          }),
      });
      const bytes = yield* Effect.try({
        try: () => NodeFS.readFileSync(located.abs),
        catch: (cause) => new ImagesError({ message: String(cause), path: input.path }),
      });
      const image = yield* preview(bytes, input.max_side ?? 1024);
      const manifest =
        VersionStore.toRel(ctx.cwd, NodePath.resolve(ctx.cwd, located.rel)) === null
          ? null
          : VersionStore.readManifestSafe(ctx.cwd, located.rel);
      const versionNote = manifest
        ? ` — version ${located.version ?? manifest.current} of ${manifest.versions.length}${located.version === undefined || located.version === manifest.current ? " (current)" : ""}`
        : "";
      return {
        text: `${located.abs} (${image.width}x${image.height})${versionNote}`,
        images: [image],
        structured: {
          path: located.abs,
          width: image.width,
          height: image.height,
          ...(manifest
            ? { version: located.version ?? manifest.current, versions: manifest.versions.length }
            : {}),
        },
      };
    });

  return {
    list_image_models,
    generate_image,
    edit_image,
    image_history,
    restore_image_version,
    view_image,
  } satisfies ImagesToolHandlers;
});
