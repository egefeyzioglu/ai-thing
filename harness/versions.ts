import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";

export const STORE_DIR = ".aithing/versions";
export const SCHEMA_VERSION = 1;
export type GenerationInfo = { prompt: string; model: string; provider: string; providerModel?: string; providerRequestId?: string | null; aspectRatio?: string; resolution?: string; references?: string[]; durationMs?: number };
export type VersionSource =
  | ({ kind: "generate" } & GenerationInfo)
  | ({ kind: "edit" } & GenerationInfo)
  | { kind: "upload"; originalName?: string }
  | { kind: "agent_write"; tool?: string }        // written through the ACP client filesystem by an agent
  | { kind: "external" }
  | { kind: "restore"; from: number }
  | { kind: "pick"; from: string }
  | { kind: "adopt" };
export type Version = { n: number; file: string; sha256: string; size: number; width?: number; height?: number; createdAt: string; threadId?: string; source: VersionSource; parents?: string[]; inferred?: true };
export type Manifest = { schemaVersion: number; path: string; current: number; versions: Version[]; starred?: boolean };
export type CommitOptions = { threadId?: string; width?: number; height?: number; parents?: string[] };

/** Any project file may be tracked when a tool writes it; the watcher only auto-captures images and notes. */
export function isTrackable(rel: string): boolean {
  return toRel("/", resolve("/", rel)) !== null && !isAbsolute(rel) && !rel.split("/").includes("..") && !/(^|\/)\.tmp-/.test(rel);
}
export function isVersionable(rel: string): boolean {
  return isTrackable(rel) && /\.(png|jpe?g|webp|gif|md|txt)$/i.test(rel);
}
export function isImagePath(rel: string): boolean { return /\.(png|jpe?g|webp|gif)$/i.test(rel); }

export function toRel(root: string, abs: string): string | null {
  const rel = relative(resolve(root), resolve(abs));
  if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return null;
  const posix = rel.split(sep).join("/");
  return posix === ".aithing" || posix.startsWith(".aithing/") ? null : posix;
}

function checkedRel(root: string, rel: string): string {
  const clean = toRel(root, resolve(root, rel));
  if (isAbsolute(rel) || clean === null) throw new Error(`Path must be inside the project and outside .aithing: ${rel}`);
  return clean;
}

export function storeDir(root: string, rel: string): string { return join(resolve(root), STORE_DIR, checkedRel(root, rel)); }
export function versionFile(root: string, rel: string, n: number): string {
  if (!Number.isSafeInteger(n) || n < 1) throw new Error(`Invalid version number: ${n}`);
  return join(storeDir(root, rel), `v${n}${extname(rel)}`);
}
export function readManifest(root: string, rel: string): Manifest | null {
  let json: string;
  try { json = readFileSync(join(storeDir(root, rel), "manifest.json"), "utf8"); }
  catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return null; throw e; }
  const manifest = JSON.parse(json) as Manifest;
  if (!manifest || manifest.schemaVersion !== SCHEMA_VERSION || manifest.path !== checkedRel(root, rel) || !Array.isArray(manifest.versions) || !manifest.versions.length || !manifest.versions.some(v => v.n === manifest.current)) throw new Error(`Invalid version manifest: ${rel}`);
  return manifest;
}
export function sha256(bytes: Buffer): string { return createHash("sha256").update(bytes).digest("hex"); }
export function parseVersionRef(ref: string): { path: string; version?: number } {
  const match = /^(.*)@(\d+)$/.exec(ref);
  if (!match || !Number.isSafeInteger(Number(match[2])) || Number(match[2]) < 1) return { path: ref };
  return { path: match[1], version: Number(match[2]) };
}

const sleeper = new Int32Array(new SharedArrayBuffer(4));
function stealStaleLock(lock: string): void {
  const sentinel = `${lock}-steal`;
  let owner: ReturnType<typeof statSync>;
  try { mkdirSync(sentinel); owner = statSync(sentinel); }
  catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    try { if (Date.now() - statSync(sentinel).mtimeMs > 30000) rmSync(sentinel, { recursive: true, force: true }); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
    return;
  }
  try {
    // Serialize cleaners and recheck after acquiring the sentinel: a previous
    // cleaner may already have removed the stale lock and a writer replaced it.
    try { if (Date.now() - statSync(lock).mtimeMs > 30000) rmSync(lock, { recursive: true, force: true }); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
  } finally {
    try { const current = statSync(sentinel); if (current.dev === owner.dev && current.ino === owner.ino) rmSync(sentinel, { recursive: true, force: true }); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
  }
}
function withLock<T>(root: string, rel: string, fn: () => T): T {
  if (!isTrackable(rel)) throw new Error(`Not a trackable project path: ${rel}`);
  const dir = storeDir(root, rel), lock = join(dir, ".lock"), deadline = Date.now() + 5000;
  mkdirSync(dir, { recursive: true });
  let owner: ReturnType<typeof statSync>;
  for (;;) {
    try { mkdirSync(lock); owner = statSync(lock); break; }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e; }
    try { if (Date.now() - statSync(lock).mtimeMs > 30000) stealStaleLock(lock); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for version lock: ${rel}`);
    Atomics.wait(sleeper, 0, 0, 25);
  }
  try { return fn(); }
  finally {
    try { const current = statSync(lock); if (current.dev === owner.dev && current.ino === owner.ino) rmSync(lock, { recursive: true, force: true }); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
  }
}

function atomicWrite(path: string, bytes: Buffer | string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = join(dirname(path), `.tmp-${randomUUID()}`);
  try { writeFileSync(tmp, bytes, { flag: "wx" }); renameSync(tmp, path); }
  finally { rmSync(tmp, { force: true }); }
}
function workingBytes(root: string, rel: string): Buffer | null {
  try { return readFileSync(resolve(root, rel)); }
  catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return null; throw e; }
}
function currentVersion(manifest: Manifest): Version { return manifest.versions.find(v => v.n === manifest.current)!; }
function versionRef(rel: string, n: number): string { return `${rel}@${n}`; }
function validateParents(parents: string[]): string[] {
  return [...new Set(parents.map((ref) => {
    const parsed = parseVersionRef(ref);
    if (parsed.version === undefined) throw new Error(`Parent must be an immutable version ref: ${ref}`);
    if (!isTrackable(parsed.path)) throw new Error(`Parent must be a project-relative path ref: ${ref}`);
    return versionRef(parsed.path, parsed.version);
  }))];
}
function append(root: string, rel: string, manifest: Manifest | null, bytes: Buffer, source: VersionSource, opts: CommitOptions = {}): { manifest: Manifest; version: Version } {
  const n = manifest ? Math.max(...manifest.versions.map(v => v.n)) + 1 : 1;
  const explicitParents = opts.parents === undefined ? undefined : validateParents(opts.parents);
  const inferredParents = n === 1 && explicitParents === undefined && (source.kind === "adopt" || source.kind === "agent_write") ? inferParents(root, rel, bytes) : null;
  const { parents: _parents, ...restOpts } = opts;
  const parents = explicitParents ?? inferredParents ?? undefined;
  const version: Version = {
    n, file: `v${n}${extname(rel)}`, sha256: sha256(bytes), size: bytes.length, ...restOpts, createdAt: new Date().toISOString(), source,
    ...(parents?.length ? { parents } : {}),
    ...(inferredParents?.length ? { inferred: true as const } : {}),
  };
  const next: Manifest = { schemaVersion: SCHEMA_VERSION, path: checkedRel(root, rel), current: n, versions: [...(manifest?.versions ?? []), version], ...(manifest?.starred ? { starred: true } : {}) };
  atomicWrite(versionFile(root, rel, n), bytes);
  atomicWrite(join(storeDir(root, rel), "manifest.json"), JSON.stringify(next, null, 2) + "\n");
  return { manifest: next, version };
}
function syncUnderLock(root: string, rel: string): { manifest: Manifest | null; version: Version | null } {
  const manifest = readManifest(root, rel), bytes = workingBytes(root, rel);
  if (bytes === null || (manifest && sha256(bytes) === currentVersion(manifest).sha256)) return { manifest, version: null };
  return append(root, rel, manifest, bytes, { kind: manifest ? "external" : "adopt" });
}

export function adopt(root: string, rel: string): Manifest | null {
  return withLock(root, rel, () => {
    const bytes = workingBytes(root, rel);
    if (bytes === null) return null;
    return readManifest(root, rel) ?? append(root, rel, null, bytes, { kind: "adopt" }).manifest;
  });
}
export function syncExternal(root: string, rel: string): Version | null { return withLock(root, rel, () => syncUnderLock(root, rel).version); }
export function commitVersion(root: string, rel: string, bytes: Buffer, source: VersionSource, opts: CommitOptions = {}): { version: Version; created: boolean } {
  return withLock(root, rel, () => {
    const { manifest } = syncUnderLock(root, rel);
    if (manifest && currentVersion(manifest).sha256 === sha256(bytes)) {
      if (workingBytes(root, rel) === null) atomicWrite(resolve(root, rel), bytes); // deleted working file: put it back
      return { version: currentVersion(manifest), created: false };
    }
    const { version } = append(root, rel, manifest, bytes, source, opts);
    atomicWrite(resolve(root, rel), bytes);
    return { version, created: true };
  });
}
export function restoreVersion(root: string, rel: string, n: number, opts: CommitOptions = {}): { version: Version; created: boolean } {
  return commitVersion(root, rel, readFileSync(versionFile(root, rel, n)), { kind: "restore", from: n }, { ...opts, parents: [versionRef(checkedRel(root, rel), n)] });
}
export function pickVersion(root: string, fromRef: string, toRel: string, opts: CommitOptions = {}): { version: Version; created: boolean } {
  const parsed = parseVersionRef(fromRef);
  const rel = checkedRel(root, parsed.path);
  if (!isTrackable(rel)) throw new Error(`Not a trackable project path: ${rel}`);
  if (parsed.version === undefined) syncExternal(root, rel);
  const manifest = readManifest(root, rel);
  if (!manifest) throw new Error(`No versions for ${rel}`);
  const n = parsed.version ?? manifest.current;
  const sourceVersion = manifest.versions.find((v) => v.n === n);
  if (!sourceVersion) throw new Error(`No such version: ${versionRef(rel, n)}`);
  const resolvedRef = versionRef(rel, n);
  const bytes = readFileSync(versionFile(root, rel, n));
  return commitVersion(root, toRel, bytes, { kind: "pick", from: resolvedRef }, { ...opts, parents: [resolvedRef], width: sourceVersion.width, height: sourceVersion.height });
}
export function resolveVersionPath(root: string, ref: string): { rel: string; version?: number; abs: string } {
  const parsed = parseVersionRef(ref), rel = toRel(root, resolve(root, parsed.path));
  if (rel === null) {
    const abs = resolve(root, parsed.path), outside = relative(resolve(root), abs);
    if (parsed.version !== undefined || !(outside === ".." || outside.startsWith(`..${sep}`) || isAbsolute(outside))) throw new Error(`Path must be inside the project and outside .aithing: ${parsed.path}`);
    if (!existsSync(abs) || !statSync(abs).isFile()) throw new Error(`Image not found: ${ref}`);
    return { rel: parsed.path, abs };
  }
  const abs = parsed.version === undefined ? resolve(root, rel) : versionFile(root, rel, parsed.version);
  if (!existsSync(abs) || !statSync(abs).isFile()) throw new Error(`Image not found: ${ref}`);
  return { rel, ...(parsed.version === undefined ? {} : { version: parsed.version }), abs };
}

export function setStarred(root: string, rel: string, starred: boolean): Manifest | null {
  return withLock(root, rel, () => {
    const manifest = readManifest(root, rel) ?? adoptUnderLock(root, rel);
    if (!manifest) return null;
    const next: Manifest = { ...manifest };
    if (starred) next.starred = true; else delete next.starred;
    atomicWrite(join(storeDir(root, rel), "manifest.json"), JSON.stringify(next, null, 2) + "\n");
    return next;
  });
}
export function setParents(root: string, rel: string, n: number, parents: string[]): Manifest {
  return withLock(root, rel, () => {
    const manifest = readManifest(root, rel);
    if (!manifest) throw new Error(`No versions for ${rel}`);
    const nextParents = validateParents(parents);
    let found = false;
    const versions = manifest.versions.map((v) => {
      if (v.n !== n) return v;
      found = true;
      const next: Version = { ...v };
      if (nextParents.length) next.parents = nextParents; else delete next.parents;
      delete next.inferred;
      return next;
    });
    if (!found) throw new Error(`No such version: ${versionRef(rel, n)}`);
    const next: Manifest = { ...manifest, versions };
    atomicWrite(join(storeDir(root, rel), "manifest.json"), JSON.stringify(next, null, 2) + "\n");
    return next;
  });
}
function adoptUnderLock(root: string, rel: string): Manifest | null {
  const bytes = workingBytes(root, rel);
  return bytes === null ? null : append(root, rel, null, bytes, { kind: "adopt" }).manifest;
}

export function readAllManifests(root: string): Manifest[] {
  const base = join(resolve(root), STORE_DIR);
  const out: Manifest[] = [];
  const walk = (dir: string) => {
    let entries: import("node:fs").Dirent[];
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    if (entries.some((e) => e.isFile() && e.name === "manifest.json")) {
      const rel = relative(base, dir).split(sep).join("/");
      try { const m = readManifest(root, rel); if (m) out.push(m); } catch { /* corrupt manifest: skip */ }
      return;
    }
    for (const e of entries) if (e.isDirectory() && e.name !== ".lock" && !e.name.endsWith("-steal")) walk(join(dir, e.name));
  };
  walk(base);
  return out;
}

function isTextPath(rel: string): boolean { return /\.(md|txt)$/i.test(rel); }
function sameKind(a: string, b: string): boolean { return (isImagePath(a) && isImagePath(b)) || (isTextPath(a) && isTextPath(b)); }

export function inferParents(root: string, rel: string, bytes: Buffer): string[] | null {
  const manifests = readAllManifests(root);
  const hash = sha256(bytes);
  const sameSha = manifests.flatMap((m) => m.versions.filter((v) => v.sha256 === hash).map((v) => ({ m, v })));
  if (sameSha.length) {
    sameSha.sort((a, b) => {
      const ac = a.v.n === a.m.current && existsSync(resolve(root, a.m.path)) ? 1 : 0;
      const bc = b.v.n === b.m.current && existsSync(resolve(root, b.m.path)) ? 1 : 0;
      if (ac !== bc) return bc - ac;
      return b.v.createdAt.localeCompare(a.v.createdAt);
    });
    return [versionRef(sameSha[0]!.m.path, sameSha[0]!.v.n)];
  }

  const dir = dirname(rel) === "." ? "" : dirname(rel).split(sep).join("/");
  const ext = extname(rel);
  const stem0 = basename(rel, ext);
  const imageExts = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);
  const candidates: { stem: string; manifest: Manifest }[] = [];
  const checkStem = (stem: string, differentImageExtOnly = false) => {
    for (const m of manifests) {
      if (m.path === rel || !sameKind(rel, m.path) || !existsSync(resolve(root, m.path))) continue;
      const mDir = dirname(m.path) === "." ? "" : dirname(m.path).split(sep).join("/");
      if (mDir !== dir) continue;
      const mExt = extname(m.path).toLowerCase();
      if (differentImageExtOnly && (!isImagePath(rel) || !imageExts.has(mExt) || mExt === ext.toLowerCase())) continue;
      if (basename(m.path, extname(m.path)) === stem) candidates.push({ stem, manifest: m });
    }
  };
  checkStem(stem0, true);
  let stem = stem0;
  const suffix = /[-_ .]?(v\d+|\d+|copy|alt(ernative)?\d*|final|new|edit(ed)?|fixed|revised|variant\d*|option\d*|[a-e])$/i;
  for (;;) {
    const next = stem.replace(suffix, "");
    if (next === stem || !next) break;
    stem = next;
    checkStem(stem);
  }
  if (!candidates.length) return null;
  candidates.sort((a, b) => b.stem.length - a.stem.length || b.manifest.versions[b.manifest.versions.length - 1]!.createdAt.localeCompare(a.manifest.versions[a.manifest.versions.length - 1]!.createdAt));
  const m = candidates[0]!.manifest;
  return [versionRef(m.path, m.current)];
}

export type IndexEntry = {
  path: string; current: number; versions: number; starred: boolean;
  kinds: string[]; threads: string[]; refs: string[]; usedAsRef: boolean;
  lastKind: string; lastCreatedAt: string; width?: number; height?: number; size: number; exists: boolean;
  parents: string[]; children: string[]; familyId: string; familySize: number; inferred: boolean;
};
/** Every tracked file in the project, summarised from the manifests. Cheap enough to run per request for a PoC. */
export function scanIndex(root: string): IndexEntry[] {
  const manifests = readAllManifests(root);
  const paths = new Set(manifests.map((m) => m.path));
  const parentPaths = new Map<string, Set<string>>();
  const childPaths = new Map<string, Set<string>>();
  for (const m of manifests) {
    for (const v of m.versions) for (const p of v.parents ?? []) {
      const parent = parseVersionRef(p).path;
      if (!paths.has(parent)) continue;
      if (!parentPaths.has(m.path)) parentPaths.set(m.path, new Set());
      parentPaths.get(m.path)!.add(parent);
      if (!childPaths.has(parent)) childPaths.set(parent, new Set());
      childPaths.get(parent)!.add(m.path);
    }
  }
  const neighbors = new Map<string, Set<string>>();
  for (const p of paths) neighbors.set(p, new Set());
  for (const [child, parents] of parentPaths) for (const parent of parents) { neighbors.get(child)!.add(parent); neighbors.get(parent)!.add(child); }
  const familyInfo = new Map<string, { id: string; size: number }>();
  const seen = new Set<string>();
  for (const p of [...paths].sort()) {
    if (seen.has(p)) continue;
    const stack = [p], component: string[] = [];
    seen.add(p);
    while (stack.length) {
      const cur = stack.pop()!;
      component.push(cur);
      for (const n of neighbors.get(cur) ?? []) if (!seen.has(n)) { seen.add(n); stack.push(n); }
    }
    const id = [...component].sort()[0]!;
    for (const node of component) familyInfo.set(node, { id, size: component.length });
  }
  const out: IndexEntry[] = manifests.map((m) => {
    const cur = m.versions.find((v) => v.n === m.current) ?? m.versions[m.versions.length - 1]!;
    const info = familyInfo.get(m.path) ?? { id: m.path, size: 1 };
    return {
      path: m.path, current: m.current, versions: m.versions.length, starred: !!m.starred,
      kinds: [...new Set(m.versions.map((v) => v.source.kind))],
      threads: [...new Set(m.versions.map((v) => v.threadId).filter((t): t is string => !!t))],
      refs: [...new Set(m.versions.flatMap((v) => ("references" in v.source && v.source.references) || []))],
      usedAsRef: false, lastKind: cur.source.kind, lastCreatedAt: cur.createdAt, width: cur.width, height: cur.height, size: cur.size,
      exists: existsSync(resolve(root, m.path)),
      parents: [...(parentPaths.get(m.path) ?? new Set())].sort(),
      children: [...(childPaths.get(m.path) ?? new Set())].sort(),
      familyId: info.id,
      familySize: info.size,
      inferred: m.versions.some((v) => v.inferred),
    };
  });
  const refd = new Set(out.flatMap((e) => e.refs.map((r) => parseVersionRef(r).path)));
  for (const e of out) e.usedAsRef = refd.has(e.path);
  return out.sort((a, b) => (a.lastCreatedAt < b.lastCreatedAt ? 1 : -1));
}

export type FamilyNode = { ref: string; path: string; n: number; current: boolean; exists: boolean; starred: boolean; createdAt: string; kind: string; threadId?: string; width?: number; height?: number; size: number; parents: string[]; inferred: boolean; prompt?: string; model?: string };
export type FamilyGraph = { nodes: FamilyNode[]; roots: string[] };
export function family(root: string, rel: string): FamilyGraph {
  const start = checkedRel(root, rel);
  const manifests = readAllManifests(root);
  if (!manifests.some((m) => m.path === start)) throw new Error(`No versions for ${start}`);
  const byRef = new Map<string, { manifest: Manifest; version: Version }>();
  for (const m of manifests) for (const v of m.versions) byRef.set(versionRef(m.path, v.n), { manifest: m, version: v });
  const neighbors = new Map<string, Set<string>>();
  for (const ref of byRef.keys()) neighbors.set(ref, new Set());
  for (const [ref, item] of byRef) for (const parent of item.version.parents ?? []) {
    if (!neighbors.has(parent)) continue;
    neighbors.get(ref)!.add(parent);
    neighbors.get(parent)!.add(ref);
  }
  const startRefs = manifests.find((m) => m.path === start)!.versions.map((v) => versionRef(start, v.n));
  const seen = new Set<string>(startRefs), stack = [...startRefs];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const n of neighbors.get(cur) ?? []) if (!seen.has(n)) { seen.add(n); stack.push(n); }
  }
  const nodes = [...seen].map((ref) => {
    const { manifest, version } = byRef.get(ref)!;
    return {
      ref, path: manifest.path, n: version.n, current: version.n === manifest.current,
      exists: existsSync(resolve(root, manifest.path)), starred: !!manifest.starred, createdAt: version.createdAt,
      kind: version.source.kind, threadId: version.threadId, width: version.width, height: version.height, size: version.size,
      parents: version.parents ?? [], inferred: !!version.inferred,
      ...("prompt" in version.source ? { prompt: version.source.prompt } : {}),
      ...("model" in version.source ? { model: version.source.model } : {}),
    };
  }).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const nodeRefs = new Set(nodes.map((n) => n.ref));
  return { nodes, roots: nodes.filter((n) => !n.parents.some((p) => nodeRefs.has(p))).map((n) => n.ref) };
}
