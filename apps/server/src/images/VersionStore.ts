// @effect-diagnostics nodeBuiltinImport:off - deliberately synchronous: one process, one writer, no Effect in the hot path
// @effect-diagnostics globalDate:off
/**
 * Versioned project files, stored next to the working file.
 *
 * The working file stays plain; history lives under
 * `<root>/.aithing/versions/<rel>/manifest.json` plus `v<N>.<ext>`. Manifests
 * on disk are the source of truth. Everything here is synchronous and runs in
 * the one server process, so there is no cross-process lock: the server is
 * the single writer.
 */
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import {
  IMAGE_STORE_DIR,
  type ImageFamilyGraph,
  type ImageFamilyNode,
  type ImageIndexEntry,
  type ImageManifest,
  type ImageVersion,
  type ImageVersionSource,
  imageVersionRef,
  parseImageVersionRef,
} from "@t3tools/contracts";

const SCHEMA_VERSION = 1;

export type CommitOptions = {
  threadId?: string;
  width?: number;
  height?: number;
  parents?: ReadonlyArray<string>;
  /**
   * Preloaded manifests for parent inference during bulk adoption. The list
   * is updated in place with every manifest written, so one walk reads the
   * store once instead of once per file.
   */
  manifests?: ImageManifest[];
};

export class VersionStoreError extends Error {
  readonly path: string | undefined;
  constructor(message: string, path?: string) {
    super(message);
    this.name = "VersionStoreError";
    this.path = path;
  }
}

export function isImagePath(rel: string): boolean {
  return /\.(png|jpe?g|webp|gif)$/i.test(rel);
}
export function isTextPath(rel: string): boolean {
  return /\.(md|txt)$/i.test(rel);
}
/** Any project file may be tracked when a tool writes it; the watcher only auto-captures images and notes. */
function isTrackable(rel: string): boolean {
  return (
    !NodePath.isAbsolute(rel) &&
    rel.length > 0 &&
    !rel.split("/").includes("..") &&
    !/(^|\/)\.tmp-/.test(rel) &&
    !/(^|\/)\.aithing(\/|$)/.test(rel)
  );
}
export function isVersionable(rel: string): boolean {
  return isTrackable(rel) && (isImagePath(rel) || isTextPath(rel));
}

/** Project-relative posix path, or null when outside the root or inside the store. */
export function toRel(root: string, abs: string): string | null {
  const rel = NodePath.relative(NodePath.resolve(root), NodePath.resolve(abs));
  if (!rel || rel === ".." || rel.startsWith(`..${NodePath.sep}`) || NodePath.isAbsolute(rel))
    return null;
  const posix = rel.split(NodePath.sep).join("/");
  return posix === ".aithing" || posix.startsWith(".aithing/") ? null : posix;
}

function checkedRel(root: string, rel: string): string {
  const clean = toRel(root, NodePath.resolve(root, rel));
  if (NodePath.isAbsolute(rel) || clean === null) {
    throw new VersionStoreError(
      `Path must be inside the project and outside .aithing: ${rel}`,
      rel,
    );
  }
  return clean;
}

function storeDir(root: string, rel: string): string {
  return NodePath.join(NodePath.resolve(root), IMAGE_STORE_DIR, checkedRel(root, rel));
}
export function versionFile(root: string, rel: string, n: number): string {
  if (!Number.isSafeInteger(n) || n < 1)
    throw new VersionStoreError(`Invalid version number: ${n}`, rel);
  return NodePath.join(storeDir(root, rel), `v${n}${NodePath.extname(rel)}`);
}
export function readManifest(root: string, rel: string): ImageManifest | null {
  let json: string;
  try {
    json = NodeFS.readFileSync(NodePath.join(storeDir(root, rel), "manifest.json"), "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
  const manifest = JSON.parse(json) as ImageManifest;
  if (
    !manifest ||
    manifest.schemaVersion !== SCHEMA_VERSION ||
    manifest.path !== checkedRel(root, rel) ||
    !Array.isArray(manifest.versions) ||
    !manifest.versions.length ||
    !manifest.versions.some((v) => v.n === manifest.current)
  ) {
    throw new VersionStoreError(`Invalid version manifest: ${rel}`, rel);
  }
  return manifest;
}

/** `readManifest` that treats a corrupt or foreign manifest as absent. */
export function readManifestSafe(root: string, rel: string): ImageManifest | null {
  try {
    return readManifest(root, rel);
  } catch {
    return null;
  }
}

function sha256(bytes: Buffer): string {
  return NodeCrypto.createHash("sha256").update(bytes).digest("hex");
}

function atomicWrite(path: string, bytes: Buffer | string): void {
  NodeFS.mkdirSync(NodePath.dirname(path), { recursive: true });
  const tmp = NodePath.join(NodePath.dirname(path), `.tmp-${NodeCrypto.randomUUID()}`);
  try {
    NodeFS.writeFileSync(tmp, bytes, { flag: "wx" });
    NodeFS.renameSync(tmp, path);
  } finally {
    NodeFS.rmSync(tmp, { force: true });
  }
}
function writeManifest(root: string, rel: string, manifest: ImageManifest): void {
  atomicWrite(
    NodePath.join(storeDir(root, rel), "manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  );
}
function workingBytes(root: string, rel: string): Buffer | null {
  try {
    return NodeFS.readFileSync(NodePath.resolve(root, rel));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
}
function currentVersion(manifest: ImageManifest): ImageVersion {
  return manifest.versions.find((v) => v.n === manifest.current)!;
}
function validateParents(parents: ReadonlyArray<string>): string[] {
  return [
    ...new Set(
      parents.map((ref) => {
        const parsed = parseImageVersionRef(ref);
        if (parsed.version === undefined) {
          throw new VersionStoreError(`Parent must be an immutable version ref: ${ref}`);
        }
        if (!isTrackable(parsed.path)) {
          throw new VersionStoreError(`Parent must be a project-relative path ref: ${ref}`);
        }
        return imageVersionRef(parsed.path, parsed.version);
      }),
    ),
  ];
}

function append(
  root: string,
  rel: string,
  manifest: ImageManifest | null,
  bytes: Buffer,
  source: ImageVersionSource,
  opts: CommitOptions = {},
): { manifest: ImageManifest; version: ImageVersion } {
  const n = manifest ? Math.max(...manifest.versions.map((v) => v.n)) + 1 : 1;
  const explicitParents = opts.parents === undefined ? undefined : validateParents(opts.parents);
  const inferredParents =
    n === 1 &&
    explicitParents === undefined &&
    (source.kind === "adopt" || source.kind === "agent_write" || source.kind === "external")
      ? inferParents(root, rel, bytes, opts.manifests)
      : null;
  const parents = explicitParents ?? inferredParents ?? undefined;
  const version: ImageVersion = {
    n,
    file: `v${n}${NodePath.extname(rel)}`,
    sha256: sha256(bytes),
    size: bytes.length,
    ...(opts.width !== undefined ? { width: opts.width } : {}),
    ...(opts.height !== undefined ? { height: opts.height } : {}),
    createdAt: new Date().toISOString(),
    ...(opts.threadId ? { threadId: opts.threadId } : {}),
    source,
    ...(parents?.length ? { parents } : {}),
    ...(inferredParents?.length ? { inferred: true } : {}),
  };
  const next: ImageManifest = {
    schemaVersion: SCHEMA_VERSION,
    path: checkedRel(root, rel),
    current: n,
    versions: [...(manifest?.versions ?? []), version],
    ...(manifest?.starred ? { starred: true } : {}),
  };
  atomicWrite(versionFile(root, rel, n), bytes);
  writeManifest(root, rel, next);
  if (opts.manifests) {
    const at = opts.manifests.findIndex((m) => m.path === next.path);
    if (at >= 0) opts.manifests[at] = next;
    else opts.manifests.push(next);
  }
  return { manifest: next, version };
}

function syncInternal(
  root: string,
  rel: string,
  opts?: CommitOptions,
): { manifest: ImageManifest | null; version: ImageVersion | null } {
  const manifest = readManifest(root, rel);
  const bytes = workingBytes(root, rel);
  if (bytes === null || (manifest && sha256(bytes) === currentVersion(manifest).sha256)) {
    return { manifest, version: null };
  }
  return append(root, rel, manifest, bytes, { kind: manifest ? "external" : "adopt" }, opts);
}

/** Start tracking an existing working file (version 1 = its current bytes). */
export function adopt(root: string, rel: string): ImageManifest | null {
  if (!isTrackable(rel)) throw new VersionStoreError(`Not a trackable project path: ${rel}`, rel);
  const bytes = workingBytes(root, rel);
  if (bytes === null) return null;
  return readManifest(root, rel) ?? append(root, rel, null, bytes, { kind: "adopt" }).manifest;
}

/** Capture a change made outside the store (watcher). Returns the new version, or null if nothing changed. */
export function syncExternal(
  root: string,
  rel: string,
  source?: ImageVersionSource,
  opts?: CommitOptions,
): ImageVersion | null {
  if (!isTrackable(rel)) throw new VersionStoreError(`Not a trackable project path: ${rel}`, rel);
  if (!source) return syncInternal(root, rel, opts).version;
  const manifest = readManifest(root, rel);
  const bytes = workingBytes(root, rel);
  if (bytes === null || (manifest && sha256(bytes) === currentVersion(manifest).sha256))
    return null;
  return append(root, rel, manifest, bytes, source, opts).version;
}

/** Write bytes to the working file and record them as the next version. */
export function commitVersion(
  root: string,
  rel: string,
  bytes: Buffer,
  source: ImageVersionSource,
  opts: CommitOptions = {},
): { version: ImageVersion; created: boolean } {
  if (!isTrackable(rel)) throw new VersionStoreError(`Not a trackable project path: ${rel}`, rel);
  const { manifest } = syncInternal(root, rel);
  if (manifest && currentVersion(manifest).sha256 === sha256(bytes)) {
    if (workingBytes(root, rel) === null) atomicWrite(NodePath.resolve(root, rel), bytes);
    return { version: currentVersion(manifest), created: false };
  }
  const { version } = append(root, rel, manifest, bytes, source, opts);
  atomicWrite(NodePath.resolve(root, rel), bytes);
  return { version, created: true };
}

export function restoreVersion(
  root: string,
  rel: string,
  n: number,
  opts: CommitOptions = {},
): { version: ImageVersion; created: boolean } {
  const clean = checkedRel(root, rel);
  const file = versionFile(root, clean, n);
  if (!NodeFS.existsSync(file))
    throw new VersionStoreError(`No such version: ${imageVersionRef(clean, n)}`, clean);
  const manifest = readManifest(root, clean);
  const stored = manifest?.versions.find((v) => v.n === n);
  return commitVersion(
    root,
    clean,
    NodeFS.readFileSync(file),
    { kind: "restore", restoredFrom: n },
    {
      ...opts,
      parents: [imageVersionRef(clean, n)],
      ...(stored?.width !== undefined ? { width: stored.width } : {}),
      ...(stored?.height !== undefined ? { height: stored.height } : {}),
    },
  );
}

export function pickVersion(
  root: string,
  fromRef: string,
  toRel: string,
  opts: CommitOptions = {},
): { version: ImageVersion; created: boolean } {
  const parsed = parseImageVersionRef(fromRef);
  const rel = checkedRel(root, parsed.path);
  if (parsed.version === undefined) syncExternal(root, rel);
  const manifest = readManifest(root, rel) ?? adopt(root, rel);
  if (!manifest) throw new VersionStoreError(`No versions for ${rel}`, rel);
  const n = parsed.version ?? manifest.current;
  const sourceVersion = manifest.versions.find((v) => v.n === n);
  if (!sourceVersion)
    throw new VersionStoreError(`No such version: ${imageVersionRef(rel, n)}`, rel);
  const resolvedRef = imageVersionRef(rel, n);
  const bytes = NodeFS.readFileSync(versionFile(root, rel, n));
  return commitVersion(
    root,
    checkedRel(root, toRel),
    bytes,
    { kind: "pick", pickedFrom: resolvedRef },
    {
      ...opts,
      parents: [resolvedRef],
      ...(sourceVersion.width !== undefined ? { width: sourceVersion.width } : {}),
      ...(sourceVersion.height !== undefined ? { height: sourceVersion.height } : {}),
    },
  );
}

/** Resolve `path` or `path@N` to a readable file. Outside the project only absolute image paths are readable (references, `view_image`). */
export function resolveVersionPath(
  root: string,
  ref: string,
): { rel: string; version?: number; abs: string } {
  const parsed = parseImageVersionRef(ref);
  const rel = toRel(root, NodePath.resolve(root, parsed.path));
  if (rel === null) {
    const abs = NodePath.resolve(root, parsed.path);
    const outside = NodePath.relative(NodePath.resolve(root), abs);
    const isOutside =
      outside === ".." || outside.startsWith(`..${NodePath.sep}`) || NodePath.isAbsolute(outside);
    if (parsed.version !== undefined || !isOutside) {
      throw new VersionStoreError(
        `Path must be inside the project and outside .aithing: ${parsed.path}`,
        parsed.path,
      );
    }
    if (!isImagePath(parsed.path)) {
      throw new VersionStoreError(
        `Only image files can be read from outside the project: ${parsed.path}`,
        parsed.path,
      );
    }
    if (!NodeFS.existsSync(abs) || !NodeFS.statSync(abs).isFile())
      throw new VersionStoreError(`Image not found: ${ref}`, parsed.path);
    return { rel: parsed.path, abs };
  }
  const abs =
    parsed.version === undefined
      ? NodePath.resolve(root, rel)
      : versionFile(root, rel, parsed.version);
  if (!NodeFS.existsSync(abs) || !NodeFS.statSync(abs).isFile())
    throw new VersionStoreError(`Image not found: ${ref}`, rel);
  return { rel, ...(parsed.version === undefined ? {} : { version: parsed.version }), abs };
}

export function setStarred(root: string, rel: string, starred: boolean): ImageManifest | null {
  const clean = checkedRel(root, rel);
  const manifest = readManifest(root, clean) ?? adopt(root, clean);
  if (!manifest) return null;
  const { starred: _previous, ...rest } = manifest;
  const next: ImageManifest = starred ? { ...rest, starred: true } : rest;
  writeManifest(root, clean, next);
  return next;
}

function updateVersion(
  root: string,
  rel: string,
  n: number,
  update: (v: ImageVersion) => ImageVersion,
): ImageManifest {
  const clean = checkedRel(root, rel);
  const manifest = readManifest(root, clean);
  if (!manifest) throw new VersionStoreError(`No versions for ${clean}`, clean);
  let found = false;
  const versions = manifest.versions.map((v) => {
    if (v.n !== n) return v;
    found = true;
    return update(v);
  });
  if (!found) throw new VersionStoreError(`No such version: ${imageVersionRef(clean, n)}`, clean);
  const next: ImageManifest = { ...manifest, versions };
  writeManifest(root, clean, next);
  return next;
}

export function setParents(
  root: string,
  rel: string,
  n: number,
  parents: ReadonlyArray<string>,
): ImageManifest {
  const nextParents = validateParents(parents);
  return updateVersion(root, rel, n, (v) => {
    const { parents: _parents, inferred: _inferred, ...rest } = v;
    return nextParents.length ? { ...rest, parents: nextParents } : rest;
  });
}

export function setRejected(
  root: string,
  rel: string,
  n: number,
  rejected: boolean,
): ImageManifest {
  return updateVersion(root, rel, n, (v) => {
    const { rejected: _rejected, ...rest } = v;
    return rejected ? { ...rest, rejected: true } : rest;
  });
}

export function readAllManifests(root: string): ImageManifest[] {
  const base = NodePath.join(NodePath.resolve(root), IMAGE_STORE_DIR);
  const out: ImageManifest[] = [];
  const walk = (dir: string) => {
    let entries: NodeFS.Dirent[];
    try {
      entries = NodeFS.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    if (entries.some((e) => e.isFile() && e.name === "manifest.json")) {
      const rel = NodePath.relative(base, dir).split(NodePath.sep).join("/");
      try {
        const m = readManifest(root, rel);
        if (m) out.push(m);
      } catch {
        /* corrupt manifest: skip */
      }
      return;
    }
    for (const e of entries) if (e.isDirectory()) walk(NodePath.join(dir, e.name));
  };
  walk(base);
  return out;
}

function sameKind(a: string, b: string): boolean {
  return (isImagePath(a) && isImagePath(b)) || (isTextPath(a) && isTextPath(b));
}

/** Guess parents for a first version that arrived untracked: identical bytes, or a `-v2`/`alt1`/`final` style name. */
function inferParents(
  root: string,
  rel: string,
  bytes: Buffer,
  manifests: ReadonlyArray<ImageManifest> = readAllManifests(root),
): string[] | null {
  const hash = sha256(bytes);
  const sameSha = manifests.flatMap((m) =>
    m.versions.filter((v) => v.sha256 === hash).map((v) => ({ m, v })),
  );
  if (sameSha.length) {
    sameSha.sort((a, b) => {
      const ac =
        a.v.n === a.m.current && NodeFS.existsSync(NodePath.resolve(root, a.m.path)) ? 1 : 0;
      const bc =
        b.v.n === b.m.current && NodeFS.existsSync(NodePath.resolve(root, b.m.path)) ? 1 : 0;
      if (ac !== bc) return bc - ac;
      return b.v.createdAt.localeCompare(a.v.createdAt);
    });
    return [imageVersionRef(sameSha[0]!.m.path, sameSha[0]!.v.n)];
  }

  const dir =
    NodePath.dirname(rel) === "." ? "" : NodePath.dirname(rel).split(NodePath.sep).join("/");
  const ext = NodePath.extname(rel);
  const stem0 = NodePath.basename(rel, ext);
  const candidates: { stem: string; manifest: ImageManifest }[] = [];
  const checkStem = (stem: string, differentImageExtOnly = false) => {
    for (const m of manifests) {
      if (
        m.path === rel ||
        !sameKind(rel, m.path) ||
        !NodeFS.existsSync(NodePath.resolve(root, m.path))
      )
        continue;
      const mDir =
        NodePath.dirname(m.path) === "."
          ? ""
          : NodePath.dirname(m.path).split(NodePath.sep).join("/");
      if (mDir !== dir) continue;
      const mExt = NodePath.extname(m.path).toLowerCase();
      if (differentImageExtOnly && (!isImagePath(rel) || mExt === ext.toLowerCase())) continue;
      if (NodePath.basename(m.path, NodePath.extname(m.path)) === stem)
        candidates.push({ stem, manifest: m });
    }
  };
  checkStem(stem0, true);
  let stem = stem0;
  const suffix =
    /[-_ .]?(v\d+|\d+|copy|alt(ernative)?\d*|final|new|edit(ed)?|fixed|revised|variant\d*|option\d*|[a-e])$/i;
  for (;;) {
    const next = stem.replace(suffix, "");
    if (next === stem || !next) break;
    stem = next;
    checkStem(stem);
  }
  if (!candidates.length) return null;
  const last = (m: ImageManifest) => m.versions[m.versions.length - 1]!.createdAt;
  candidates.sort(
    (a, b) => b.stem.length - a.stem.length || last(b.manifest).localeCompare(last(a.manifest)),
  );
  const m = candidates[0]!.manifest;
  return [imageVersionRef(m.path, m.current)];
}

/** Every tracked file in the project, summarised from the manifests. */
export function scanIndex(root: string): ImageIndexEntry[] {
  const manifests = readAllManifests(root);
  const paths = new Set(manifests.map((m) => m.path));
  const parentPaths = new Map<string, Set<string>>();
  const childPaths = new Map<string, Set<string>>();
  for (const m of manifests) {
    for (const v of m.versions) {
      for (const p of v.parents ?? []) {
        const parent = parseImageVersionRef(p).path;
        if (!paths.has(parent) || parent === m.path) continue;
        if (!parentPaths.has(m.path)) parentPaths.set(m.path, new Set());
        parentPaths.get(m.path)!.add(parent);
        if (!childPaths.has(parent)) childPaths.set(parent, new Set());
        childPaths.get(parent)!.add(m.path);
      }
    }
  }
  const neighbors = new Map<string, Set<string>>();
  for (const p of paths) neighbors.set(p, new Set());
  for (const [child, parents] of parentPaths) {
    for (const parent of parents) {
      neighbors.get(child)!.add(parent);
      neighbors.get(parent)!.add(child);
    }
  }
  const familyInfo = new Map<string, { id: string; size: number }>();
  const seen = new Set<string>();
  for (const p of [...paths].sort()) {
    if (seen.has(p)) continue;
    const stack = [p];
    const component: string[] = [];
    seen.add(p);
    while (stack.length) {
      const cur = stack.pop()!;
      component.push(cur);
      for (const n of neighbors.get(cur) ?? []) {
        if (!seen.has(n)) {
          seen.add(n);
          stack.push(n);
        }
      }
    }
    const id = [...component].sort()[0]!;
    for (const node of component) familyInfo.set(node, { id, size: component.length });
  }
  const out: ImageIndexEntry[] = manifests.map((m) => {
    const cur = m.versions.find((v) => v.n === m.current) ?? m.versions[m.versions.length - 1]!;
    const info = familyInfo.get(m.path) ?? { id: m.path, size: 1 };
    return {
      path: m.path,
      current: m.current,
      versions: m.versions.length,
      starred: !!m.starred,
      kinds: [...new Set(m.versions.map((v) => v.source.kind))],
      threads: [...new Set(m.versions.map((v) => v.threadId).filter((t): t is string => !!t))],
      refs: [...new Set(m.versions.flatMap((v) => v.source.references ?? []))],
      usedAsRef: false,
      lastKind: cur.source.kind,
      lastCreatedAt: cur.createdAt,
      ...(cur.width !== undefined ? { width: cur.width } : {}),
      ...(cur.height !== undefined ? { height: cur.height } : {}),
      size: cur.size,
      exists: NodeFS.existsSync(NodePath.resolve(root, m.path)),
      parents: [...(parentPaths.get(m.path) ?? new Set<string>())].sort(),
      children: [...(childPaths.get(m.path) ?? new Set<string>())].sort(),
      familyId: info.id,
      familySize: info.size,
      inferred: m.versions.some((v) => v.inferred),
      rejected: !!cur.rejected,
      ...(cur.source.prompt !== undefined ? { prompt: cur.source.prompt } : {}),
      ...(cur.source.model !== undefined ? { model: cur.source.model } : {}),
    };
  });
  const refd = new Set(out.flatMap((e) => e.refs.map((r) => parseImageVersionRef(r).path)));
  return out
    .map((e) => ({ ...e, usedAsRef: refd.has(e.path) }))
    .sort((a, b) => (a.lastCreatedAt < b.lastCreatedAt ? 1 : -1));
}

/** Every version connected to this file through parent links, across paths. */
export function family(root: string, rel: string): ImageFamilyGraph {
  const start = checkedRel(root, rel);
  const manifests = readAllManifests(root);
  if (!manifests.some((m) => m.path === start))
    throw new VersionStoreError(`No versions for ${start}`, start);
  const byRef = new Map<string, { manifest: ImageManifest; version: ImageVersion }>();
  for (const m of manifests)
    for (const v of m.versions)
      byRef.set(imageVersionRef(m.path, v.n), { manifest: m, version: v });
  const neighbors = new Map<string, Set<string>>();
  for (const ref of byRef.keys()) neighbors.set(ref, new Set());
  for (const [ref, item] of byRef) {
    for (const parent of item.version.parents ?? []) {
      if (!neighbors.has(parent)) continue;
      neighbors.get(ref)!.add(parent);
      neighbors.get(parent)!.add(ref);
    }
  }
  const startRefs = manifests
    .find((m) => m.path === start)!
    .versions.map((v) => imageVersionRef(start, v.n));
  const seen = new Set<string>(startRefs);
  const stack = [...startRefs];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const n of neighbors.get(cur) ?? []) {
      if (!seen.has(n)) {
        seen.add(n);
        stack.push(n);
      }
    }
  }
  const nodes: ImageFamilyNode[] = [...seen]
    .map((ref) => {
      const { manifest, version } = byRef.get(ref)!;
      return {
        ref,
        path: manifest.path,
        n: version.n,
        current: version.n === manifest.current,
        exists: NodeFS.existsSync(NodePath.resolve(root, manifest.path)),
        starred: !!manifest.starred,
        rejected: !!version.rejected,
        createdAt: version.createdAt,
        kind: version.source.kind,
        ...(version.threadId ? { threadId: version.threadId } : {}),
        ...(version.width !== undefined ? { width: version.width } : {}),
        ...(version.height !== undefined ? { height: version.height } : {}),
        size: version.size,
        parents: version.parents ?? [],
        inferred: !!version.inferred,
        ...(version.source.prompt !== undefined ? { prompt: version.source.prompt } : {}),
        ...(version.source.model !== undefined ? { model: version.source.model } : {}),
      };
    })
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const nodeRefs = new Set(nodes.map((n) => n.ref));
  return {
    nodes,
    roots: nodes.filter((n) => !n.parents.some((p) => nodeRefs.has(p))).map((n) => n.ref),
  };
}
