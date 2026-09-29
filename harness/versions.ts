import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";

export const STORE_DIR = ".aithing/versions";
export const SCHEMA_VERSION = 1;
export type GenerationInfo = { prompt: string; model: string; provider: string; providerModel?: string; providerRequestId?: string | null; aspectRatio?: string; resolution?: string; references?: string[]; durationMs?: number };
export type VersionSource =
  | ({ kind: "generate" } & GenerationInfo)
  | ({ kind: "edit" } & GenerationInfo)
  | { kind: "upload"; originalName?: string }
  | { kind: "external" }
  | { kind: "restore"; from: number }
  | { kind: "adopt" };
export type Version = { n: number; file: string; sha256: string; size: number; width?: number; height?: number; createdAt: string; threadId?: string; source: VersionSource };
export type Manifest = { schemaVersion: number; path: string; current: number; versions: Version[] };
export type CommitOptions = { threadId?: string; width?: number; height?: number };

export function isVersionable(rel: string): boolean {
  return toRel("/", resolve("/", rel)) !== null && !isAbsolute(rel) && !rel.split("/").includes("..") && /\.(png|jpe?g|webp|gif)$/i.test(rel);
}

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
  if (!isVersionable(rel)) throw new Error(`Not a versionable image path: ${rel}`);
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
function append(root: string, rel: string, manifest: Manifest | null, bytes: Buffer, source: VersionSource, opts: CommitOptions = {}): { manifest: Manifest; version: Version } {
  const n = manifest ? Math.max(...manifest.versions.map(v => v.n)) + 1 : 1;
  const version: Version = { n, file: `v${n}${extname(rel)}`, sha256: sha256(bytes), size: bytes.length, ...opts, createdAt: new Date().toISOString(), source };
  const next: Manifest = { schemaVersion: SCHEMA_VERSION, path: checkedRel(root, rel), current: n, versions: [...(manifest?.versions ?? []), version] };
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
  return commitVersion(root, rel, readFileSync(versionFile(root, rel, n)), { kind: "restore", from: n }, opts);
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
