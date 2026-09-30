/**
 * AI thing harness - proof of concept.
 *
 * One local process that:
 *  - spawns Claude Code and Codex as ACP agents (stdio, ndjson JSON-RPC),
 *  - persists browser-visible threads and event logs in SQLite,
 *  - exposes a tiny WebSocket API for the browser UI.
 *
 * Both agents run under the user's local login (Claude Code / ChatGPT), so no
 * API-priced tokens are involved.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync, watch, writeFileSync, type FSWatcher } from "node:fs";
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { Readable, Writable } from "node:stream";
import { WebSocketServer, type WebSocket } from "ws";
import * as acp from "@agentclientprotocol/sdk";
import {
  appendEvent,
  createProject,
  createThread,
  dbPath,
  deleteProject,
  deleteThread,
  dequeueNext,
  enqueue,
  findOpenPermissionRequest,
  ensureDefaultProject,
  getProject,
  getProjectByPath,
  getQueued,
  getThread,
  listEvents,
  listProjects,
  listQueued,
  listThreads,
  moveQueuedToFront,
  removeQueued,
  resetInterruptedThreads,
  updateProject,
  updateThread,
  type AgentKind,
  type EventType,
  type StoredEvent,
  type ThreadRow,
  type ThreadStatus,
} from "./db.js";
import { loadEnvFile, PROVIDER_KEYS } from "./env.js";
import sharp from "sharp";
import {
  commitVersion,
  family,
  isImagePath,
  isTrackable,
  isVersionable,
  pickVersion,
  scanIndex,
  setParents,
  setStarred,
  readManifest,
  resolveVersionPath,
  restoreVersion,
  syncExternal,
  toRel,
  versionFile,
  type Manifest,
} from "./versions.js";

const here = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 4747);
const WORKSPACE = resolve(process.env.WORKSPACE ?? join(here, "workspace"));
mkdirSync(WORKSPACE, { recursive: true });
ensureDefaultProject(WORKSPACE, "Workspace");

const AGENT_BIN: Record<AgentKind, string> = {
  claude: join(here, "node_modules/.bin/claude-code-acp"),
  codex: join(here, "node_modules/.bin/codex-acp"),
};
// codex-acp bundles its own Codex core, which may lag the user's CLI. Pin a
// model it understands instead of inheriting ~/.codex/config.toml's default.
const CODEX_MODEL = process.env.CODEX_MODEL ?? "gpt-5.5";
const AGENT_ARGS: Record<AgentKind, string[]> = {
  claude: [],
  codex: ["-c", `model="${CODEX_MODEL}"`],
};

// Image provider keys: process.env wins, then the app's root .env.
loadEnvFile(join(here, "..", ".env"));
const configuredProviders = PROVIDER_KEYS.filter((k) => process.env[k]);
console.log("image providers configured:", configuredProviders.length ? configuredProviders.join(", ") : "none");

const TSX_BIN = join(here, "node_modules/.bin/tsx");
const IMAGE_TOOLS = join(here, "mcp/image-tools.ts");

/** MCP servers attached to every ACP session: the image tools, writing into <thread cwd>/generated. */
function mcpServersFor(thread: ThreadRow): acp.McpServer[] {
  const env = [
    { name: "PATH", value: process.env.PATH ?? "" },
    { name: "AITHING_PROJECT_DIR", value: thread.cwd },
    { name: "AITHING_OUTPUT_DIR", value: join(thread.cwd, thread.out_dir ?? "generated") },
    { name: "AITHING_THREAD_ID", value: thread.id },
    ...configuredProviders.map((k) => ({ name: k, value: process.env[k]! })),
  ];
  return [{ name: "aithing-images", command: TSX_BIN, args: [IMAGE_TOOLS], env }];
}

// On restart there is no live request or permission resolver left in memory.
resetInterruptedThreads();

// ---------------------------------------------------------------------------
// ACP agent connections (one process per agent kind, lazily started)
// ---------------------------------------------------------------------------

type AgentConn = {
  kind: AgentKind;
  proc: ChildProcess;
  conn: acp.ClientConnection;
  init: acp.InitializeResponse;
};

type LiveSession = {
  kind: AgentKind;
  sessionId: string;
  proc: ChildProcess; // the adapter process that owns this session
};

const agents = new Map<AgentKind, Promise<AgentConn>>();
const agentProcs = new Map<AgentKind, ChildProcess>();
const liveSessions = new Map<string, LiveSession>(); // threadId -> live ACP session
const sessionThreads = new Map<string, string>(); // ACP sessionId -> threadId
const loadingSessions = new Set<string>(); // ACP sessionIds currently replaying history
const pendingSessionEnsures = new Map<string, Promise<LiveSession>>();
const pumping = new Set<string>();
const stopRequested = new Set<string>();
const pendingPermissions = new Map<
  string,
  {
    threadId: string;
    sessionId: string;
    options: acp.PermissionOption[];
    resolve: (r: acp.RequestPermissionResponse) => void;
  }
>();
const authFailed = new Set<AgentKind>(); // adapters that reported "Authentication required"; respawned on retry
const authRetry = new Set<AgentKind>(); // first turn after such a respawn: a logged-out adapter then fails with a generic error
const AGENT_LABEL: Record<AgentKind, string> = { claude: "Claude Code", codex: "Codex" };
const isAuthError = (e: any) => e?.code === -32000 || /authentication required/i.test(String(e?.message ?? ""));

function send(ws: WebSocket, msg: unknown) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function broadcast(msg: unknown) {
  const data = JSON.stringify(msg);
  for (const client of wss.clients) {
    if (client.readyState === client.OPEN) client.send(data);
  }
}

function broadcastThread(thread: ThreadRow | null) {
  if (thread) broadcast({ type: "thread", thread });
}

function clientQueue(threadId: string) {
  return listQueued(threadId).map(({ id, text, attachments, synthetic, created_at }) => ({ id, text, attachments, synthetic, created_at }));
}

function broadcastQueue(threadId: string) {
  broadcast({ type: "queue", threadId, items: clientQueue(threadId) });
}

function setThread(threadId: string, patch: Partial<Pick<ThreadRow, "title" | "acp_session_id" | "status" | "unread" | "updated_at">>) {
  const thread = updateThread(threadId, patch);
  broadcastThread(thread);
  return thread;
}

const ATTENTION_EVENTS = new Set<EventType>(["turn_end", "error", "permission_request"]);
function persistEvent(threadId: string, type: EventType, payload: unknown): StoredEvent | null {
  const event = appendEvent(threadId, type, payload);
  if (!event) return null;
  if (ATTENTION_EVENTS.has(type)) updateThread(threadId, { unread: 1 });
  broadcast({ type: "event", threadId, event: clientEvent(event) });
  broadcastThread(getThread(threadId));
  return event;
}

/**
 * Tool results that carry images arrive three times over: in `content` (which
 * the UI renders), in `rawOutput`, and in adapter `_meta`. Keep `content`
 * intact and truncate long strings elsewhere before persisting/broadcasting.
 */
const MAX_RAW_STRING = 16_000;
function truncateStrings(value: unknown): unknown {
  if (typeof value === "string") return value.length > MAX_RAW_STRING ? `${value.slice(0, 200)}… [${value.length} chars truncated]` : value;
  if (Array.isArray(value)) return value.map(truncateStrings);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, truncateStrings(v)]));
  return value;
}
function compactUpdate(update: acp.SessionUpdate): acp.SessionUpdate {
  const u = update as Record<string, unknown>;
  if (!("rawOutput" in u) && !("rawInput" in u) && !("_meta" in u)) return update;
  const out: Record<string, unknown> = { ...u };
  for (const key of ["rawOutput", "rawInput", "_meta"]) if (key in out) out[key] = truncateStrings(out[key]);
  return out as unknown as acp.SessionUpdate;
}

function clientEvent(event: StoredEvent) {
  return {
    id: event.id,
    ts: event.ts,
    type: event.type,
    payload: event.payload,
  };
}

async function getAgent(kind: AgentKind): Promise<AgentConn> {
  let p = agents.get(kind);
  if (!p) {
    p = startAgent(kind);
    agents.set(kind, p);
    p.catch(() => agents.delete(kind));
  }
  return p;
}

async function startAgent(kind: AgentKind): Promise<AgentConn> {
  const bin = AGENT_BIN[kind];
  if (!existsSync(bin)) throw new Error(`missing adapter binary: ${bin}`);
  console.log(`[${kind}] spawning ${bin}`);
  // Drop any inherited Claude Code session vars; the adapter refuses to start
  // "inside another Claude Code session" otherwise.
  // Also keep image-provider API keys away from the agents: a logged-out Codex
  // would otherwise quietly bill OPENAI_API_KEY instead of using the ChatGPT login.
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([k]) => (!/^(CLAUDE|AI_AGENT)/.test(k) || k === "CLAUDE_CONFIG_DIR") && !(PROVIDER_KEYS as readonly string[]).includes(k)),
  );
  const proc = spawn(bin, AGENT_ARGS[kind], {
    cwd: WORKSPACE,
    stdio: ["pipe", "pipe", "pipe"],
    env,
  });
  proc.stderr?.on("data", (d) => process.stderr.write(`[${kind}] ${d}`));
  proc.on("exit", (code) => {
    console.log(`[${kind}] exited with ${code}`);
    // Only forget what belonged to this process: a replacement may already be registered.
    if (agentProcs.get(kind) === proc) { agents.delete(kind); agentProcs.delete(kind); }
    for (const [threadId, live] of liveSessions) {
      if (live.proc === proc) {
        liveSessions.delete(threadId);
        sessionThreads.delete(live.sessionId);
      }
    }
  });
  agentProcs.set(kind, proc);

  const stream = acp.ndJsonStream(
    Writable.toWeb(proc.stdin!),
    Readable.toWeb(proc.stdout!) as ReadableStream<Uint8Array>,
  );

  const conn = acp
    .client({ name: "ai-thing-harness" })
    .onRequest(acp.methods.client.session.requestPermission, (ctx) =>
      onRequestPermission(ctx.params),
    )
    // Agents that honour the client filesystem (Claude Code does) read and write through here,
    // so every write becomes an attributed version. Codex writes to disk itself; the watcher catches those.
    .onRequest(acp.methods.client.fs.readTextFile, async (ctx) => {
      const { path, line, limit } = ctx.params;
      let text = readFileSync(path, "utf8");
      if (line != null || limit != null) {
        const lines = text.split(/\r?\n/);
        const start = Math.max(0, (line ?? 1) - 1);
        text = lines.slice(start, limit != null ? start + limit : undefined).join("\n");
      }
      return { content: text };
    })
    .onRequest(acp.methods.client.fs.writeTextFile, async (ctx) => {
      const { path, content } = ctx.params;
      const threadId = sessionThreads.get(ctx.params.sessionId);
      const thread = threadId ? getThread(threadId) : null;
      const rel = thread ? toRel(thread.cwd, path) : null;
      if (thread && rel && isTrackable(rel)) {
        commitVersion(thread.cwd, rel, Buffer.from(content, "utf8"), { kind: "agent_write" }, { threadId: thread.id });
      } else {
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, content);
      }
      return {};
    })
    .onNotification(acp.methods.client.session.update, (ctx) => {
      const sessionId = ctx.params.sessionId;
      if (loadingSessions.has(sessionId)) return;
      const threadId = sessionThreads.get(sessionId);
      if (!threadId) return;
      persistEvent(threadId, "update", { update: compactUpdate(ctx.params.update) });
    })
    .connect(stream);

  const init = await conn.agent.request(acp.methods.agent.initialize, {
    protocolVersion: acp.PROTOCOL_VERSION,
    clientCapabilities: { fs: { readTextFile: true, writeTextFile: true } },
    clientInfo: { name: "ai-thing-harness", version: "0.0.1" },
  });
  console.log(`[${kind}] initialized`, JSON.stringify(init.agentInfo ?? {}), "auth:", init.authMethods?.map((m) => m.id));
  return { kind, proc, conn, init };
}

async function onRequestPermission(
  params: acp.RequestPermissionRequest,
): Promise<acp.RequestPermissionResponse> {
  const sessionId = params.sessionId;
  const threadId = sessionThreads.get(sessionId);
  if (!threadId || !getThread(threadId)) return { outcome: { outcome: "cancelled" } };

  const id = `perm-${randomUUID()}`;
  persistEvent(threadId, "permission_request", {
    id,
    toolCall: params.toolCall,
    options: params.options,
  });
  setThread(threadId, { status: "needs_you" });

  return new Promise((resolve) => {
    pendingPermissions.set(id, { threadId, sessionId, options: params.options, resolve });
  });
}

async function ensureSession(thread: ThreadRow): Promise<LiveSession> {
  const live = liveSessions.get(thread.id);
  if (live) return live;

  const pending = pendingSessionEnsures.get(thread.id);
  if (pending) return pending;

  const promise = createOrLoadSession(thread).finally(() => pendingSessionEnsures.delete(thread.id));
  pendingSessionEnsures.set(thread.id, promise);
  return promise;
}

async function createOrLoadSession(thread: ThreadRow): Promise<LiveSession> {
  const agent = await getAgent(thread.agent);
  if (thread.acp_session_id && agent.init.agentCapabilities?.loadSession === true) {
    loadingSessions.add(thread.acp_session_id);
    sessionThreads.set(thread.acp_session_id, thread.id);
    try {
      await agent.conn.agent.request(acp.methods.agent.session.load, {
        sessionId: thread.acp_session_id,
        cwd: thread.cwd,
        mcpServers: mcpServersFor(thread),
      });
      const live = { kind: thread.agent, sessionId: thread.acp_session_id, proc: agent.proc };
      liveSessions.set(thread.id, live);
      persistEvent(thread.id, "sys", { message: "session resumed" });
      return live;
    } catch (e: any) {
      sessionThreads.delete(thread.acp_session_id);
      persistEvent(thread.id, "sys", {
        message: `could not resume; started a fresh session, the agent does not see earlier messages (${String(e?.message ?? e)})`,
      });
    } finally {
      loadingSessions.delete(thread.acp_session_id);
    }
  } else if (thread.acp_session_id) {
    persistEvent(thread.id, "sys", {
      message: "could not resume; started a fresh session, the agent does not see earlier messages",
    });
  }

  const res = await agent.conn.agent.request(acp.methods.agent.session.new, {
    cwd: thread.cwd,
    mcpServers: mcpServersFor(thread),
  });
  const live = { kind: thread.agent, sessionId: res.sessionId, proc: agent.proc };
  liveSessions.set(thread.id, live);
  sessionThreads.set(res.sessionId, thread.id);
  setThread(thread.id, { acp_session_id: res.sessionId });
  return live;
}

/** threads/<date>-<slug> under the project: each thread gets its own output folder, but reads the whole project. */
function threadOutDir(thread: ThreadRow, title: string): string {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").split("-").slice(0, 6).join("-") || "thread";
  const date = new Date(thread.created_at).toISOString().slice(0, 10);
  let rel = `threads/${date}-${slug}`;
  for (let i = 2; existsSync(join(thread.cwd, rel)); i++) rel = `threads/${date}-${slug}-${i}`;
  return rel;
}

function titleFromPrompt(text: string): string {
  return text.split(/\r?\n/, 1)[0]!.trim().slice(0, 80);
}

async function interruptThread(threadId: string) {
  try {
    const live = liveSessions.get(threadId);
    if (live) {
      const agent = await getAgent(live.kind);
      await agent.conn.agent.notify(acp.methods.agent.session.cancel, { sessionId: live.sessionId });
    }
  } finally {
    cancelPendingPermissions(threadId);
  }
}

function cancelPendingPermissions(threadId: string) {
  for (const [id, pending] of pendingPermissions) {
    if (pending.threadId !== threadId) continue;
    pending.resolve({ outcome: { outcome: "cancelled" } });
    pendingPermissions.delete(id);
    persistEvent(threadId, "permission_response", { id, optionId: null, name: "cancelled" });
  }
}

/**
 * A permission prompt whose turn died with a server restart. The original tool
 * call is gone, so the answer is delivered to the resumed session as a
 * follow-up prompt telling the agent what was decided.
 */
function answerLatePermission(id: string, optionId: string | undefined) {
  const request = findOpenPermissionRequest(id);
  if (!request) return;
  const p = request.payload as { toolCall?: { title?: string }; options?: acp.PermissionOption[] };
  const option = optionId ? p.options?.find((o) => o.optionId === optionId) : undefined;
  const allowed = !!option && option.kind.startsWith("allow");
  persistEvent(request.thread_id, "permission_response", { id, optionId: optionId ?? null, name: option?.name ?? "cancelled", late: true });
  const title = p.toolCall?.title ?? "that tool call";
  const text = allowed
    ? `The harness restarted while you were waiting for permission to run "${title}". Permission is now granted ("${option!.name}"): continue from where you left off and run it.`
    : `The harness restarted while you were waiting for permission to run "${title}". Permission was denied: do not run it. Continue without it, or stop if it was required.`;
  enqueue(request.thread_id, text, { front: true, synthetic: true });
  broadcastQueue(request.thread_id);
  void pump(request.thread_id);
}

// ---------------------------------------------------------------------------
// Browser protocol
// ---------------------------------------------------------------------------

type ClientMsg =
  | { type: "new_project"; name: string; path?: string }
  | { type: "rename_project"; projectId: string; name: string }
  | { type: "delete_project"; projectId: string }
  | { type: "new_thread"; agent: AgentKind; projectId: string }
  | { type: "open_thread"; threadId: string }
  | { type: "prompt"; threadId: string; text: string; mode?: "auto" | "queue" | "now"; attachments?: string[] }
  | { type: "seen"; threadId: string }
  | { type: "retry"; threadId: string }
  | { type: "restore_version"; projectId: string; path: string; version: number; threadId?: string }
  | { type: "relink"; projectId: string; path: string; version: number; parents: string[] }
  | { type: "pick"; projectId: string; from: string; to: string; threadId?: string }
  | { type: "star"; projectId: string; path: string; starred: boolean }
  | { type: "upload"; projectId: string; name: string; data: string; mimeType?: string }
  | { type: "queue_send_now"; id: string }
  | { type: "queue_remove"; id: string }
  | { type: "cancel"; threadId: string }
  | { type: "permission_response"; id: string; optionId?: string; threadId?: string }
  | { type: "delete_thread"; threadId: string };

async function handle(ws: WebSocket, msg: ClientMsg) {
  switch (msg.type) {
    case "new_project": {
      const name = msg.name.trim();
      if (!name) throw new Error("project name is required");
      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "project";
      if (msg.path && !isAbsolute(msg.path)) throw new Error("project path must be absolute");
      const path = resolve(msg.path || join(WORKSPACE, slug));
      if (getProjectByPath(path)) throw new Error("a project with that path already exists");
      if (existsSync(path) && !statSync(path).isDirectory()) throw new Error("project path is not a directory");
      mkdirSync(path, { recursive: true });
      const project = createProject({ id: randomUUID(), name, path });
      watchProject(project.id, project.path);
      broadcast({ type: "project", project });
      send(ws, { type: "project_created", project });
      return;
    }
    case "rename_project": {
      const name = msg.name.trim();
      if (!name) throw new Error("project name is required");
      const project = updateProject(msg.projectId, { name });
      if (!project) throw new Error(`unknown project ${msg.projectId}`);
      broadcast({ type: "project", project });
      return;
    }
    case "delete_project": {
      if (!getProject(msg.projectId)) throw new Error(`unknown project ${msg.projectId}`);
      deleteProject(msg.projectId);
      unwatchProject(msg.projectId);
      broadcast({ type: "project_deleted", projectId: msg.projectId });
      return;
    }
    case "new_thread": {
      if (msg.agent !== "claude" && msg.agent !== "codex") throw new Error(`unknown agent ${String(msg.agent)}`);
      const project = getProject(msg.projectId);
      if (!project) throw new Error(`unknown project ${msg.projectId}`);
      const now = Date.now();
      const thread = createThread({
        id: randomUUID(),
        project_id: project.id,
        agent: msg.agent,
        cwd: project.path,
        out_dir: null,
        title: "",
        acp_session_id: null,
        status: "idle",
        unread: 0,
        created_at: now,
        updated_at: now,
      });
      broadcastThread(thread);
      send(ws, { type: "opened", thread, events: [], queue: [] });
      return;
    }
    case "open_thread": {
      const thread = getThread(msg.threadId);
      if (!thread) throw new Error(`unknown thread ${msg.threadId}`);
      send(ws, { type: "opened", thread, events: listEvents(thread.id).map(clientEvent), queue: clientQueue(thread.id) });
      return;
    }
    case "prompt": {
      const thread = getThread(msg.threadId);
      if (!thread) throw new Error(`unknown thread ${msg.threadId}`);
      const text = msg.text.trim();
      if (!text) return;
      const busy = pumping.has(thread.id) || thread.status !== "idle";
      const attachments = (msg.attachments ?? []).map((ref) => resolveVersionPath(thread.cwd, ref)).map((r) => (r.version ? `${r.rel}@${r.version}` : r.rel));
      enqueue(thread.id, text, { front: msg.mode === "now" && busy, attachments });
      broadcastQueue(thread.id);
      if (msg.mode === "now" && busy) await interruptThread(thread.id);
      void pump(thread.id);
      return;
    }
    case "queue_send_now": {
      const item = moveQueuedToFront(msg.id);
      if (!item) return;
      broadcastQueue(item.thread_id);
      if (pumping.has(item.thread_id) || getThread(item.thread_id)?.status !== "idle") await interruptThread(item.thread_id);
      void pump(item.thread_id);
      return;
    }
    case "queue_remove": {
      const item = getQueued(msg.id);
      if (!item) return;
      removeQueued(item.id);
      broadcastQueue(item.thread_id);
      return;
    }
    case "retry": {
      const thread = getThread(msg.threadId);
      if (!thread) throw new Error(`unknown thread ${msg.threadId}`);
      if (authFailed.has(thread.agent)) {
        // The adapter caches its auth state; start a fresh process now that the user may have logged in.
        authFailed.delete(thread.agent);
        authRetry.add(thread.agent);
        const running = agents.get(thread.agent);
        agents.delete(thread.agent);
        agentProcs.delete(thread.agent);
        running?.then((a) => a.proc.kill()).catch(() => {});
      }
      void pump(thread.id);
      return;
    }
    case "seen": {
      const thread = getThread(msg.threadId);
      if (thread?.unread) setThread(thread.id, { unread: 0, updated_at: thread.updated_at });
      return;
    }
    case "restore_version": {
      const project = getProject(msg.projectId);
      if (!project) throw new Error(`unknown project ${msg.projectId}`);
      const rel = toRel(project.path, resolve(project.path, msg.path));
      if (!rel || !isTrackable(rel)) throw new Error("not a versioned file");
      const { version, created } = restoreVersion(project.path, rel, msg.version, { threadId: msg.threadId });
      broadcast({ type: "files_changed", projectId: project.id });
      send(ws, { type: "restored", projectId: project.id, path: rel, version: version.n, created });
      return;
    }
    case "relink": {
      const project = getProject(msg.projectId);
      if (!project) throw new Error(`unknown project ${msg.projectId}`);
      const rel = toRel(project.path, resolve(project.path, msg.path));
      if (!rel || !isTrackable(rel)) throw new Error("not a versioned file");
      setParents(project.path, rel, msg.version, msg.parents);
      broadcast({ type: "files_changed", projectId: project.id });
      return;
    }
    case "pick": {
      const project = getProject(msg.projectId);
      if (!project) throw new Error(`unknown project ${msg.projectId}`);
      const to = toRel(project.path, resolve(project.path, msg.to));
      if (!to || !isTrackable(to)) throw new Error("not a project file");
      const { version } = pickVersion(project.path, msg.from, to, { threadId: msg.threadId });
      broadcast({ type: "files_changed", projectId: project.id });
      send(ws, { type: "picked", projectId: project.id, path: to, version: version.n });
      return;
    }
    case "star": {
      const project = getProject(msg.projectId);
      if (!project) throw new Error(`unknown project ${msg.projectId}`);
      const rel = toRel(project.path, resolve(project.path, msg.path));
      if (!rel || !isTrackable(rel)) throw new Error("not a project file");
      const manifest = setStarred(project.path, rel, !!msg.starred);
      if (!manifest) throw new Error("file not found");
      broadcast({ type: "files_changed", projectId: project.id });
      return;
    }
    case "upload": {
      const project = getProject(msg.projectId);
      if (!project) throw new Error(`unknown project ${msg.projectId}`);
      const bytes = Buffer.from(msg.data, "base64");
      if (!bytes.length || bytes.length > 50 * 1024 * 1024) throw new Error("upload is empty or over 50 MB");
      const original = msg.name.replace(/^.*[\\/]/, "");
      const ext = extname(original).toLowerCase();
      const stem = original.slice(0, original.length - ext.length).replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "upload";
      const base = stem + ext;
      if (![".png", ".jpg", ".jpeg", ".webp", ".gif"].includes(ext)) throw new Error("only png, jpg, webp and gif uploads are supported");
      const meta = await sharp(bytes).metadata().catch(() => ({}) as { width?: number; height?: number });
      // Pick the filename after the await so two concurrent uploads cannot claim the same name.
      const uploads = join(project.path, "uploads");
      mkdirSync(uploads, { recursive: true });
      let target = join(uploads, base);
      for (let i = 2; existsSync(target); i++) target = join(uploads, `${base.slice(0, -ext.length)}-${i}${ext}`);
      const rel = toRel(project.path, target)!;
      const { version } = commitVersion(project.path, rel, bytes, { kind: "upload", originalName: msg.name }, { width: meta.width, height: meta.height });
      broadcast({ type: "files_changed", projectId: project.id });
      send(ws, { type: "uploaded", projectId: project.id, path: rel, version: version.n });
      return;
    }
    case "cancel": {
      if (pumping.has(msg.threadId) || getThread(msg.threadId)?.status !== "idle") stopRequested.add(msg.threadId);
      await interruptThread(msg.threadId);
      return;
    }
    case "permission_response": {
      const pending = pendingPermissions.get(msg.id);
      if (!pending) { answerLatePermission(msg.id, msg.optionId); return; }
      pendingPermissions.delete(msg.id);
      const option = msg.optionId ? pending.options.find((o) => o.optionId === msg.optionId) : undefined;
      pending.resolve(
        msg.optionId
          ? { outcome: { outcome: "selected", optionId: msg.optionId } }
          : { outcome: { outcome: "cancelled" } },
      );
      persistEvent(pending.threadId, "permission_response", {
        id: msg.id,
        optionId: msg.optionId ?? null,
        name: option?.name ?? "cancelled",
      });
      setThread(pending.threadId, { status: "running" });
      return;
    }
    case "delete_thread": {
      if (pumping.has(msg.threadId)) stopRequested.add(msg.threadId);
      await interruptThread(msg.threadId);
      cancelPendingPermissions(msg.threadId);
      const live = liveSessions.get(msg.threadId);
      if (live) sessionThreads.delete(live.sessionId);
      liveSessions.delete(msg.threadId);
      deleteThread(msg.threadId);
      broadcast({ type: "thread_deleted", threadId: msg.threadId });
      return;
    }
  }
}

const MIME_BY_EXT: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif" };

/** Prompt blocks for attached images: a text pointer the agent can use as a path, plus the pixels when the agent accepts image blocks. */
function attachmentBlocks(thread: ThreadRow, refs: string[], acceptsImages: boolean): acp.ContentBlock[] {
  const blocks: acp.ContentBlock[] = [];
  for (const ref of refs) {
    try {
      const r = resolveVersionPath(thread.cwd, ref);
      const label = r.version ? `${r.rel}@${r.version}` : r.rel;
      const mimeType = MIME_BY_EXT[extname(r.abs).toLowerCase()] ?? "application/octet-stream";
      blocks.push({ type: "text", text: `[attached image ${label}: ${r.abs}]` });
      if (acceptsImages && mimeType.startsWith("image/")) blocks.push({ type: "image", data: readFileSync(r.abs).toString("base64"), mimeType, uri: `file://${r.abs}` });
      else blocks.push({ type: "resource_link", uri: `file://${r.abs}`, name: label, mimeType });
    } catch (e: any) {
      blocks.push({ type: "text", text: `[attachment ${ref} could not be read: ${String(e?.message ?? e)}]` });
    }
  }
  return blocks;
}

async function runTurn(threadId: string, text: string, attachments: string[] = []): Promise<"ok" | "auth"> {
  try {
    const thread = getThread(threadId);
    if (!thread) return "ok";
    const live = await ensureSession(thread);
    if (stopRequested.has(threadId) || !getThread(threadId)) return "ok";
    const agent = await getAgent(live.kind);
    const acceptsImages = agent.init.agentCapabilities?.promptCapabilities?.image === true;
    const result = await agent.conn.agent.request(acp.methods.agent.session.prompt, {
      sessionId: live.sessionId,
      prompt: [{ type: "text", text }, ...attachmentBlocks(thread, attachments, acceptsImages)],
    });
    if (!getThread(threadId)) return "ok";
    authRetry.delete(thread.agent);
    persistEvent(threadId, "turn_end", { stopReason: result.stopReason });
    return "ok";
  } catch (e: any) {
    const thread = getThread(threadId);
    if (!thread) return "ok";
    if (isAuthError(e) || authRetry.has(thread.agent)) {
      authRetry.delete(thread.agent);
      authFailed.add(thread.agent);
      const methods = await getAgent(thread.agent).then((a) => a.init.authMethods ?? []).catch(() => []);
      persistEvent(threadId, "error", {
        message: `${AGENT_LABEL[thread.agent]} is not logged in`,
        authRequired: true,
        agent: thread.agent,
        methods: methods.map((m) => ({ id: m.id, name: m.name, description: m.description ?? "" })),
      });
      return "auth";
    }
    persistEvent(threadId, "error", { message: String(e?.message ?? e) });
    return "ok";
  }
}

async function pump(threadId: string) {
  if (pumping.has(threadId)) return;
  pumping.add(threadId);
  stopRequested.delete(threadId); // a Stop on an idle thread must not eat the next prompt
  try {
    while (getThread(threadId)) {
      const item = dequeueNext(threadId);
      if (!item) break;
      broadcastQueue(threadId);
      const thread = getThread(threadId)!;
      const title = thread.title || titleFromPrompt(item.text);
      setThread(threadId, { title, status: "running", ...(thread.out_dir ? {} : { out_dir: threadOutDir(thread, title) }) });
      persistEvent(threadId, "user_message", { text: item.text, attachments: item.attachments, ...(item.synthetic ? { synthetic: true } : {}) });
      const outcome = await runTurn(threadId, item.text, item.attachments);
      if (outcome === "auth") {
        // Put the message back so Retry (after logging in) sends it again.
        enqueue(threadId, item.text, { front: true, attachments: item.attachments, synthetic: item.synthetic });
        broadcastQueue(threadId);
        break;
      }
      if (stopRequested.delete(threadId)) break;
    }
  } finally {
    pumping.delete(threadId);
    stopRequested.delete(threadId);
    if (getThread(threadId)) setThread(threadId, { status: "idle" });
  }
}

// ---------------------------------------------------------------------------
// HTTP + WS server
// ---------------------------------------------------------------------------

const MIME: Record<string, string> = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
  ".gif": "image/gif", ".svg": "image/svg+xml", ".mp4": "video/mp4", ".webm": "video/webm",
  ".json": "application/json", ".txt": "text/plain; charset=utf-8", ".md": "text/markdown; charset=utf-8",
};
type ProjectWatch = { root: string; dirs: Map<string, FSWatcher>; timer?: NodeJS.Timeout; closed: boolean };
const watchers = new Map<string, ProjectWatch>();

function unwatchProject(projectId: string) {
  const active = watchers.get(projectId);
  if (!active) return;
  active.closed = true;
  if (active.timer) clearTimeout(active.timer);
  for (const w of active.dirs.values()) w.close();
  watchers.delete(projectId);
}

// External edits (agent shell commands, the user's editor) become versions too. Debounced per file.
const pendingSyncs = new Map<string, NodeJS.Timeout>();
function scheduleSync(root: string, rel: string) {
  const key = `${root}\0${rel}`;
  clearTimeout(pendingSyncs.get(key));
  pendingSyncs.set(key, setTimeout(() => {
    pendingSyncs.delete(key);
    try {
      const v = syncExternal(root, rel);
      if (v) console.log(`[versions] ${rel} -> v${v.n} (${v.source.kind})`);
    } catch (e: any) {
      console.warn(`[versions] sync failed for ${rel}:`, e?.message ?? e);
    }
  }, 400));
}

const SKIP_DIR = (name: string) => name.startsWith(".") || name === "node_modules";

/**
 * One non-recursive inotify watch per directory. Node's `recursive: true` on
 * Linux is a JS emulation that silently drops a directory's watch after
 * tmp-file renames, which is exactly how the version store writes files.
 */
function watchProject(projectId: string, root: string) {
  unwatchProject(projectId);
  const active: ProjectWatch = { root, dirs: new Map(), closed: false };
  watchers.set(projectId, active);

  const notify = () => {
    if (active.timer) clearTimeout(active.timer);
    active.timer = setTimeout(() => {
      if (watchers.get(projectId) === active) broadcast({ type: "files_changed", projectId });
    }, 300);
  };

  const watchDir = (dir: string) => {
    if (active.closed || active.dirs.has(dir)) return;
    let w: FSWatcher;
    try {
      w = watch(dir, (_event, filename) => {
        if (active.closed || !filename) return;
        const name = String(filename);
        if (name.startsWith(".tmp-")) return;
        const abs = join(dir, name);
        const rel = relative(root, abs).split(sep).join("/");
        let isDir = false;
        try { isDir = statSync(abs).isDirectory(); } catch { /* gone */ }
        if (isDir) { if (!SKIP_DIR(name)) walk(abs); }
        else if (active.dirs.has(abs)) { active.dirs.get(abs)!.close(); for (const sub of [...active.dirs.keys()]) if (sub.startsWith(abs + sep)) { active.dirs.get(sub)!.close(); active.dirs.delete(sub); } active.dirs.delete(abs); }
        else if (isVersionable(rel)) scheduleSync(root, rel);
        if (!name.startsWith(".")) notify();
      });
    } catch (e: any) {
      console.warn(`could not watch ${dir}:`, e?.message ?? e);
      return;
    }
    w.on("error", (e) => { console.warn(`watcher error on ${dir}:`, e.message); active.dirs.delete(dir); w.close(); });
    active.dirs.set(dir, w);
  };

  const walk = (dir: string) => {
    watchDir(dir);
    let entries: import("node:fs").Dirent[] = [];
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) if (e.isDirectory() && !SKIP_DIR(e.name)) walk(join(dir, e.name));
  };

  try { walk(root); } catch (e: any) { console.warn(`could not watch project (${root}):`, e?.message ?? e); }
}

function containedPath(projectPath: string, requested: string): string {
  if (isAbsolute(requested)) throw new Error("path must be relative");
  const root = realpathSync(projectPath);
  const target = resolve(root, requested || ".");
  const lexical = relative(root, target);
  if (lexical === ".." || lexical.startsWith(`..${sep}`) || isAbsolute(lexical)) throw new Error("path escapes project");
  const real = realpathSync(target);
  const actual = relative(root, real);
  if (actual === ".." || actual.startsWith(`..${sep}`) || isAbsolute(actual)) throw new Error("path escapes project");
  return real;
}

function json(res: import("node:http").ServerResponse, status: number, value: unknown) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(value));
}

const http = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const pathname = url.pathname;
  if (pathname === "/" || pathname === "/index.html") {
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.end(readFileSync(join(here, "public/index.html")));
    return;
  }
  const match = pathname.match(/^\/api\/projects\/([^/]+)\/(files|raw|versions|family|index)$/);
  if (req.method === "GET" && match) {
    const project = getProject(decodeURIComponent(match[1]!));
    if (!project) return json(res, 404, { error: "unknown project" });
    const requested = url.searchParams.get("path") ?? "";
    try {
      if (match[2] === "index") {
        const files = scanIndex(project.path).map((e) => ({ ...e, image: isImagePath(e.path) }));
        const briefs = readdirSync(project.path, { withFileTypes: true })
          .filter((e) => e.isFile() && /\.(md|txt)$/i.test(e.name))
          .map((e) => { const st = statSync(join(project.path, e.name)); return { name: e.name, size: st.size, mtime: st.mtimeMs }; })
          .sort((a, b) => a.name.localeCompare(b.name));
        return json(res, 200, { files, briefs });
      }
      if (match[2] === "versions") {
        const rel = toRel(project.path, resolve(project.path, requested));
        const manifest: Manifest | null = rel && isTrackable(rel) ? readManifest(project.path, rel) : null;
        return manifest ? json(res, 200, manifest) : json(res, 404, { error: "no versions" });
      }
      if (match[2] === "family") {
        const rel = toRel(project.path, resolve(project.path, requested));
        if (!rel || !isTrackable(rel)) return json(res, 400, { error: "bad path" });
        if (isVersionable(rel)) syncExternal(project.path, rel);
        if (!readManifest(project.path, rel)) return json(res, 404, { error: "no versions" });
        return json(res, 200, family(project.path, rel));
      }
      const versionParam = url.searchParams.get("version");
      if (match[2] === "raw" && versionParam) {
        const rel = toRel(project.path, resolve(project.path, requested));
        const n = Number(versionParam);
        if (!rel || !Number.isInteger(n) || n < 1) return json(res, 400, { error: "bad version" });
        const file = versionFile(project.path, rel, n);
        if (!existsSync(file)) return json(res, 404, { error: "no such version" });
        res.setHeader("content-type", MIME[extname(rel).toLowerCase()] ?? "application/octet-stream");
        res.setHeader("cache-control", "private, max-age=31536000, immutable");
        createReadStream(file).pipe(res);
        return;
      }
      const target = containedPath(project.path, requested);
      const info = statSync(target);
      if (match[2] === "files") {
        if (!info.isDirectory()) return json(res, 400, { error: "path is not a directory" });
        const entries = readdirSync(target, { withFileTypes: true })
          .filter((entry) => !entry.name.startsWith(".") && entry.name !== "node_modules" && (entry.isDirectory() || entry.isFile()))
          .map((entry) => {
            const stat = statSync(join(target, entry.name));
            const mime = entry.isFile() ? MIME[extname(entry.name).toLowerCase()] : undefined;
            const rel = requested ? `${requested.replace(/\/+$/, "")}/${entry.name}` : entry.name;
            let versions: { versions: number; current: number } | undefined;
            if (entry.isFile() && isTrackable(rel)) {
              // Belt and braces for edits the watcher missed: reconcile the working file with its history on every listing.
              try { if (isVersionable(rel)) syncExternal(project.path, rel); const m = readManifest(project.path, rel); if (m) versions = { versions: m.versions.length, current: m.current }; } catch { /* corrupt manifest: show as unversioned */ }
            }
            return { name: entry.name, type: entry.isDirectory() ? "dir" : "file", size: stat.size, mtime: stat.mtimeMs, ...(mime ? { mime } : {}), ...(versions ?? {}) };
          })
          .sort((a, b) => a.type === b.type ? a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) : a.type === "dir" ? -1 : 1);
        return json(res, 200, { path: requested, entries });
      }
      if (!info.isFile()) return json(res, 404, { error: "file not found" });
      res.setHeader("content-type", MIME[extname(target).toLowerCase()] ?? "application/octet-stream");
      res.setHeader("cache-control", "no-cache");
      createReadStream(target).on("error", () => { if (!res.headersSent) json(res, 404, { error: "file not found" }); else res.destroy(); }).pipe(res);
      return;
    } catch (error: any) {
      const traversal = String(error?.message ?? error).includes("path ");
      return json(res, traversal ? 400 : 404, { error: traversal ? String(error.message) : "not found" });
    }
  }
  res.statusCode = 404;
  res.end("not found");
});

const wss = new WebSocketServer({ server: http, path: "/ws" });
for (const project of listProjects()) watchProject(project.id, project.path);
wss.on("connection", (ws) => {
  send(ws, { type: "hello", workspace: WORKSPACE, agents: Object.keys(AGENT_BIN), projects: listProjects(), threads: listThreads() });
  ws.on("message", async (raw) => {
    let msg: ClientMsg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    try {
      await handle(ws, msg);
    } catch (e: any) {
      console.error("handle error", e);
      send(ws, { type: "error", message: String(e?.message ?? e) });
    }
  });
});

http.listen(PORT, () => {
  console.log(`harness listening on http://localhost:${PORT}  workspace=${WORKSPACE}  db=${dbPath}`);
});

process.on("SIGINT", () => {
  for (const projectId of [...watchers.keys()]) unwatchProject(projectId);
  for (const p of agents.values()) p.then((a) => a.proc.kill()).catch(() => {});
  process.exit(0);
});
