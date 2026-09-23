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
  agent: AgentKind;
  cwd: string;
  title: string;
  acp_session_id: string | null;
  status: ThreadStatus;
  created_at: number;
  updated_at: number;
};

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
  CREATE TABLE IF NOT EXISTS threads (
    id TEXT PRIMARY KEY,
    agent TEXT NOT NULL,
    cwd TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    acp_session_id TEXT,
    status TEXT NOT NULL DEFAULT 'idle',
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

  CREATE INDEX IF NOT EXISTS events_thread ON events(thread_id, id);
`);

function readThread(row: SqlThreadRow | undefined): ThreadRow | null {
  return row ?? null;
}

function readEvent(row: SqlEventRow): StoredEvent {
  return { ...row, payload: JSON.parse(row.payload) };
}

export function listThreads(): ThreadRow[] {
  return db.prepare("SELECT * FROM threads ORDER BY updated_at DESC").all() as ThreadRow[];
}

export function getThread(id: string): ThreadRow | null {
  return readThread(db.prepare("SELECT * FROM threads WHERE id = ?").get(id) as SqlThreadRow | undefined);
}

export function createThread(thread: ThreadRow): ThreadRow {
  db.prepare(`
    INSERT INTO threads (id, agent, cwd, title, acp_session_id, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    thread.id,
    thread.agent,
    thread.cwd,
    thread.title,
    thread.acp_session_id,
    thread.status,
    thread.created_at,
    thread.updated_at,
  );
  return thread;
}

export function updateThread(
  id: string,
  patch: Partial<Pick<ThreadRow, "title" | "acp_session_id" | "status" | "updated_at">>,
): ThreadRow | null {
  const current = getThread(id);
  if (!current) return null;
  const next: ThreadRow = { ...current, ...patch, updated_at: patch.updated_at ?? Date.now() };
  db.prepare(`
    UPDATE threads
    SET title = ?, acp_session_id = ?, status = ?, updated_at = ?
    WHERE id = ?
  `).run(next.title, next.acp_session_id, next.status, next.updated_at, id);
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
  db.prepare("DELETE FROM events WHERE thread_id = ?").run(threadId);
  db.prepare("DELETE FROM threads WHERE id = ?").run(threadId);
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
