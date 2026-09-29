import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { DatabaseSync } from "node:sqlite";

export type AgentKind = "claude" | "codex";
export type ThreadStatus = "idle" | "running" | "needs_you";
export type EventType =
  | "user_message"
  | "update"
  | "permission_request"
  | "permission_response"
  | "turn_end"
  | "error"
  | "sys";

export type ThreadRow = {
  id: string;
  project_id: string;
  agent: AgentKind;
  cwd: string;
  title: string;
  acp_session_id: string | null;
  status: ThreadStatus;
  unread: number;
  created_at: number;
  updated_at: number;
};

export type ProjectRow = {
  id: string;
  name: string;
  path: string;
  created_at: number;
  updated_at: number;
};

export type QueuedMessageRow = {
  id: string;
  thread_id: string;
  text: string;
  attachments: string[]; // immutable refs like "generated/a.png@2", relative to the project
  synthetic: boolean; // written by the harness (e.g. a late permission answer), not typed by the user
  position: number;
  created_at: number;
};
type SqlQueuedRow = Omit<QueuedMessageRow, "attachments" | "synthetic"> & { attachments: string; synthetic: number };

export type StoredEvent = {
  id: number;
  thread_id: string;
  ts: number;
  type: EventType;
  payload: unknown;
};

type SqlThreadRow = ThreadRow;
type SqlEventRow = {
  id: number;
  thread_id: string;
  ts: number;
  type: EventType;
  payload: string;
};

function defaultDbPath(): string {
  if (process.env.AITHING_HOME) return join(process.env.AITHING_HOME, "harness.db");
  if (process.platform === "win32") {
    const base = process.env.LOCALAPPDATA ?? process.env.APPDATA ?? join(homedir(), "AppData", "Local");
    return join(base, "aithing", "harness.db");
  }
  return join(homedir(), ".aithing", "harness.db");
}

export const dbPath = defaultDbPath();
mkdirSync(dirname(dbPath), { recursive: true });

const db = new DatabaseSync(dbPath);
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");
db.exec(`
  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    path TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS threads (
    id TEXT PRIMARY KEY,
    project_id TEXT REFERENCES projects(id),
    agent TEXT NOT NULL,
    cwd TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    acp_session_id TEXT,
    status TEXT NOT NULL DEFAULT 'idle',
    unread INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    thread_id TEXT NOT NULL REFERENCES threads(id),
    ts INTEGER NOT NULL,
    type TEXT NOT NULL,
    payload TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS queued_messages (
    id TEXT PRIMARY KEY,
    thread_id TEXT NOT NULL REFERENCES threads(id),
    text TEXT NOT NULL,
    attachments TEXT NOT NULL DEFAULT '[]',
    synthetic INTEGER NOT NULL DEFAULT 0,
    position INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS events_thread ON events(thread_id, id);
  CREATE INDEX IF NOT EXISTS queued_thread ON queued_messages(thread_id, position, created_at);
`);

const threadColumns = db.prepare("PRAGMA table_info(threads)").all() as { name: string }[];
if (!threadColumns.some((column) => column.name === "project_id")) {
  db.exec("ALTER TABLE threads ADD COLUMN project_id TEXT REFERENCES projects(id)");
}
const queuedColumns = db.prepare("PRAGMA table_info(queued_messages)").all() as { name: string }[];
if (!queuedColumns.some((column) => column.name === "attachments")) {
  db.exec("ALTER TABLE queued_messages ADD COLUMN attachments TEXT NOT NULL DEFAULT '[]'");
}
if (!queuedColumns.some((column) => column.name === "synthetic")) {
  db.exec("ALTER TABLE queued_messages ADD COLUMN synthetic INTEGER NOT NULL DEFAULT 0");
}
if (!threadColumns.some((column) => column.name === "unread")) {
  db.exec("ALTER TABLE threads ADD COLUMN unread INTEGER NOT NULL DEFAULT 0");
}

function readThread(row: SqlThreadRow | undefined): ThreadRow | null {
  return row ?? null;
}

function readEvent(row: SqlEventRow): StoredEvent {
  return { ...row, payload: JSON.parse(row.payload) };
}

export function listProjects(): ProjectRow[] {
  return db.prepare("SELECT * FROM projects ORDER BY updated_at DESC, name COLLATE NOCASE").all() as ProjectRow[];
}

export function getProject(id: string): ProjectRow | null {
  return (db.prepare("SELECT * FROM projects WHERE id = ?").get(id) as ProjectRow | undefined) ?? null;
}

export function getProjectByPath(path: string): ProjectRow | null {
  return (db.prepare("SELECT * FROM projects WHERE path = ?").get(path) as ProjectRow | undefined) ?? null;
}

export function createProject(project: Pick<ProjectRow, "id" | "name" | "path">): ProjectRow {
  const now = Date.now();
  db.prepare("INSERT INTO projects (id, name, path, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run(
    project.id, project.name, project.path, now, now,
  );
  return getProject(project.id)!;
}

export function updateProject(id: string, patch: { name?: string }): ProjectRow | null {
  const current = getProject(id);
  if (!current) return null;
  db.prepare("UPDATE projects SET name = ?, updated_at = ? WHERE id = ?").run(patch.name ?? current.name, Date.now(), id);
  return getProject(id);
}

export function deleteProject(id: string): void {
  const count = db.prepare("SELECT count(*) AS count FROM threads WHERE project_id = ?").get(id) as { count: number };
  if (count.count) throw new Error("project still has threads");
  db.prepare("DELETE FROM projects WHERE id = ?").run(id);
}

export function ensureDefaultProject(path: string, name: string): ProjectRow {
  const project = getProjectByPath(path) ?? createProject({ id: crypto.randomUUID(), name, path });
  db.prepare("UPDATE threads SET project_id = ?, cwd = ? WHERE project_id IS NULL").run(project.id, project.path);
  return project;
}

export function listThreads(projectId?: string): ThreadRow[] {
  if (projectId) return db.prepare("SELECT * FROM threads WHERE project_id = ? ORDER BY updated_at DESC").all(projectId) as ThreadRow[];
  return db.prepare("SELECT * FROM threads ORDER BY updated_at DESC").all() as ThreadRow[];
}

export function getThread(id: string): ThreadRow | null {
  return readThread(db.prepare("SELECT * FROM threads WHERE id = ?").get(id) as SqlThreadRow | undefined);
}

export function createThread(thread: ThreadRow): ThreadRow {
  db.prepare(`
    INSERT INTO threads (id, project_id, agent, cwd, title, acp_session_id, status, unread, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    thread.id,
    thread.project_id,
    thread.agent,
    thread.cwd,
    thread.title,
    thread.acp_session_id,
    thread.status,
    thread.unread,
    thread.created_at,
    thread.updated_at,
  );
  return thread;
}

export function updateThread(
  id: string,
  patch: Partial<Pick<ThreadRow, "project_id" | "title" | "acp_session_id" | "status" | "unread" | "updated_at">>,
): ThreadRow | null {
  const current = getThread(id);
  if (!current) return null;
  const next: ThreadRow = { ...current, ...patch, updated_at: patch.updated_at ?? Date.now() };
  db.prepare(`
    UPDATE threads
    SET project_id = ?, title = ?, acp_session_id = ?, status = ?, unread = ?, updated_at = ?
    WHERE id = ?
  `).run(next.project_id, next.title, next.acp_session_id, next.status, next.unread, next.updated_at, id);
  return next;
}

export function appendEvent(threadId: string, type: EventType, payload: unknown, ts = Date.now()): StoredEvent | null {
  if (!getThread(threadId)) return null;
  const result = db.prepare("INSERT INTO events (thread_id, ts, type, payload) VALUES (?, ?, ?, ?)").run(
    threadId,
    ts,
    type,
    JSON.stringify(payload),
  );
  updateThread(threadId, { updated_at: ts });
  const id = Number(result.lastInsertRowid);
  const row = db.prepare("SELECT * FROM events WHERE id = ?").get(id) as SqlEventRow;
  return readEvent(row);
}

export function listEvents(threadId: string): StoredEvent[] {
  const rows = db.prepare("SELECT * FROM events WHERE thread_id = ? ORDER BY id").all(threadId) as SqlEventRow[];
  return rows.map(readEvent);
}

export function deleteThread(threadId: string): void {
  db.prepare("DELETE FROM queued_messages WHERE thread_id = ?").run(threadId);
  db.prepare("DELETE FROM events WHERE thread_id = ?").run(threadId);
  db.prepare("DELETE FROM threads WHERE id = ?").run(threadId);
}

function readQueued(row: SqlQueuedRow | undefined): QueuedMessageRow | null {
  if (!row) return null;
  let attachments: string[] = [];
  try { attachments = JSON.parse(row.attachments); } catch { /* ignore */ }
  return { ...row, attachments, synthetic: !!row.synthetic };
}

export function listQueued(threadId: string): QueuedMessageRow[] {
  const rows = db.prepare("SELECT * FROM queued_messages WHERE thread_id = ? ORDER BY position, created_at").all(threadId) as SqlQueuedRow[];
  return rows.map((row) => readQueued(row)!);
}

export function enqueue(threadId: string, text: string, options: { front?: boolean; attachments?: string[]; synthetic?: boolean } = {}): QueuedMessageRow {
  const edge = db.prepare(`SELECT ${options.front ? "min" : "max"}(position) AS position FROM queued_messages WHERE thread_id = ?`).get(threadId) as { position: number | null };
  const position = edge.position == null ? 0 : edge.position + (options.front ? -1 : 1);
  const item: QueuedMessageRow = { id: crypto.randomUUID(), thread_id: threadId, text, attachments: options.attachments ?? [], synthetic: !!options.synthetic, position, created_at: Date.now() };
  db.prepare("INSERT INTO queued_messages (id, thread_id, text, attachments, synthetic, position, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
    item.id, item.thread_id, item.text, JSON.stringify(item.attachments), item.synthetic ? 1 : 0, item.position, item.created_at,
  );
  return item;
}

/** A permission request that has no response event yet (survives restarts because both are plain events). */
export function findOpenPermissionRequest(permissionId: string): StoredEvent | null {
  const needle = `%"id":${JSON.stringify(permissionId)}%`;
  const request = db.prepare("SELECT * FROM events WHERE type = 'permission_request' AND payload LIKE ? ORDER BY id DESC LIMIT 1").get(needle) as SqlEventRow | undefined;
  if (!request) return null;
  const answered = db.prepare("SELECT 1 FROM events WHERE thread_id = ? AND type = 'permission_response' AND id > ? AND payload LIKE ? LIMIT 1").get(request.thread_id, request.id, needle);
  return answered ? null : readEvent(request);
}

export function dequeueNext(threadId: string): QueuedMessageRow | null {
  const item = listQueued(threadId)[0] ?? null;
  if (item) db.prepare("DELETE FROM queued_messages WHERE id = ?").run(item.id);
  return item;
}

export function getQueued(id: string): QueuedMessageRow | null {
  return readQueued(db.prepare("SELECT * FROM queued_messages WHERE id = ?").get(id) as SqlQueuedRow | undefined);
}

export function removeQueued(id: string): void {
  db.prepare("DELETE FROM queued_messages WHERE id = ?").run(id);
}

export function moveQueuedToFront(id: string): QueuedMessageRow | null {
  const item = getQueued(id);
  if (!item) return null;
  const edge = db.prepare("SELECT min(position) AS position FROM queued_messages WHERE thread_id = ?").get(item.thread_id) as { position: number | null };
  db.prepare("UPDATE queued_messages SET position = ? WHERE id = ?").run((edge.position ?? 0) - 1, id);
  return getQueued(id);
}

export function resetInterruptedThreads(): ThreadRow[] {
  const interrupted = db
    .prepare("SELECT * FROM threads WHERE status IN ('running', 'needs_you')")
    .all() as ThreadRow[];
  for (const thread of interrupted) {
    updateThread(thread.id, { status: "idle" });
    appendEvent(thread.id, "sys", { message: "server restarted; turn interrupted" });
  }
  return interrupted.map((thread) => getThread(thread.id)).filter((thread): thread is ThreadRow => !!thread);
}
