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
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Readable, Writable } from "node:stream";
import { WebSocketServer, type WebSocket } from "ws";
import * as acp from "@agentclientprotocol/sdk";
import {
  appendEvent,
  createThread,
  dbPath,
  deleteThread,
  getThread,
  listEvents,
  listThreads,
  resetInterruptedThreads,
  updateThread,
  type AgentKind,
  type EventType,
  type StoredEvent,
  type ThreadRow,
  type ThreadStatus,
} from "./db.js";
import { loadEnvFile, PROVIDER_KEYS } from "./env.js";

const here = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 4747);
const WORKSPACE = resolve(process.env.WORKSPACE ?? join(here, "workspace"));
mkdirSync(WORKSPACE, { recursive: true });

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
    { name: "AITHING_OUTPUT_DIR", value: join(thread.cwd, "generated") },
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
};

const agents = new Map<AgentKind, Promise<AgentConn>>();
const liveSessions = new Map<string, LiveSession>(); // threadId -> live ACP session
const sessionThreads = new Map<string, string>(); // ACP sessionId -> threadId
const loadingSessions = new Set<string>(); // ACP sessionIds currently replaying history
const pendingSessionEnsures = new Map<string, Promise<LiveSession>>();
const pendingPermissions = new Map<
  string,
  {
    threadId: string;
    sessionId: string;
    options: acp.PermissionOption[];
    resolve: (r: acp.RequestPermissionResponse) => void;
  }
>();
let permSeq = 0;

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

function setThread(threadId: string, patch: Partial<Pick<ThreadRow, "title" | "acp_session_id" | "status" | "updated_at">>) {
  const thread = updateThread(threadId, patch);
  broadcastThread(thread);
  return thread;
}

function persistEvent(threadId: string, type: EventType, payload: unknown): StoredEvent | null {
  const event = appendEvent(threadId, type, payload);
  if (!event) return null;
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
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([k]) => !/^(CLAUDE|AI_AGENT)/.test(k)),
  );
  const proc = spawn(bin, AGENT_ARGS[kind], {
    cwd: WORKSPACE,
    stdio: ["pipe", "pipe", "pipe"],
    env,
  });
  proc.stderr?.on("data", (d) => process.stderr.write(`[${kind}] ${d}`));
  proc.on("exit", (code) => {
    console.log(`[${kind}] exited with ${code}`);
    agents.delete(kind);
    for (const [threadId, live] of liveSessions) {
      if (live.kind === kind) {
        liveSessions.delete(threadId);
        sessionThreads.delete(live.sessionId);
      }
    }
  });

  const stream = acp.ndJsonStream(
    Writable.toWeb(proc.stdin!),
    Readable.toWeb(proc.stdout!) as ReadableStream<Uint8Array>,
  );

  const conn = acp
    .client({ name: "ai-thing-harness" })
    .onRequest(acp.methods.client.session.requestPermission, (ctx) =>
      onRequestPermission(ctx.params),
    )
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
    clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } },
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

  const id = `perm-${++permSeq}`;
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
      const live = { kind: thread.agent, sessionId: thread.acp_session_id };
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
  const live = { kind: thread.agent, sessionId: res.sessionId };
  liveSessions.set(thread.id, live);
  sessionThreads.set(res.sessionId, thread.id);
  setThread(thread.id, { acp_session_id: res.sessionId });
  return live;
}

function resolveWorkspaceCwd(cwd?: string): string {
  const resolved = resolve(WORKSPACE, cwd ?? ".");
  const rel = relative(WORKSPACE, resolved);
  if (rel.startsWith("..") || isAbsolute(rel)) throw new Error("cwd must stay inside the workspace");
  mkdirSync(resolved, { recursive: true });
  return resolved;
}

function titleFromPrompt(text: string): string {
  return text.split(/\r?\n/, 1)[0]!.trim().slice(0, 80);
}

function cancelPendingPermissions(threadId: string) {
  for (const [id, pending] of pendingPermissions) {
    if (pending.threadId !== threadId) continue;
    pending.resolve({ outcome: { outcome: "cancelled" } });
    pendingPermissions.delete(id);
    persistEvent(threadId, "permission_response", { id, optionId: null, name: "cancelled" });
  }
}

// ---------------------------------------------------------------------------
// Browser protocol
// ---------------------------------------------------------------------------

type ClientMsg =
  | { type: "new_thread"; agent: AgentKind; cwd?: string }
  | { type: "open_thread"; threadId: string }
  | { type: "prompt"; threadId: string; text: string }
  | { type: "cancel"; threadId: string }
  | { type: "permission_response"; id: string; optionId?: string }
  | { type: "delete_thread"; threadId: string };

async function handle(ws: WebSocket, msg: ClientMsg) {
  switch (msg.type) {
    case "new_thread": {
      if (msg.agent !== "claude" && msg.agent !== "codex") throw new Error(`unknown agent ${String(msg.agent)}`);
      const now = Date.now();
      const thread = createThread({
        id: randomUUID(),
        agent: msg.agent,
        cwd: resolveWorkspaceCwd(msg.cwd),
        title: "",
        acp_session_id: null,
        status: "idle",
        created_at: now,
        updated_at: now,
      });
      broadcastThread(thread);
      send(ws, { type: "opened", thread, events: [] });
      return;
    }
    case "open_thread": {
      const thread = getThread(msg.threadId);
      if (!thread) throw new Error(`unknown thread ${msg.threadId}`);
      send(ws, { type: "opened", thread, events: listEvents(thread.id).map(clientEvent) });
      return;
    }
    case "prompt": {
      const thread = getThread(msg.threadId);
      if (!thread) throw new Error(`unknown thread ${msg.threadId}`);
      const text = msg.text.trim();
      if (!text) return;
      persistEvent(thread.id, "user_message", { text });
      const title = thread.title || titleFromPrompt(text);
      setThread(thread.id, { title, status: "running" });
      void runPrompt(thread.id, text);
      return;
    }
    case "cancel": {
      const live = liveSessions.get(msg.threadId);
      if (live) {
        const agent = await getAgent(live.kind);
        await agent.conn.agent.notify(acp.methods.agent.session.cancel, { sessionId: live.sessionId });
      }
      cancelPendingPermissions(msg.threadId);
      return;
    }
    case "permission_response": {
      const pending = pendingPermissions.get(msg.id);
      if (!pending) return;
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

async function runPrompt(threadId: string, text: string) {
  try {
    const thread = getThread(threadId);
    if (!thread) return;
    const live = await ensureSession(thread);
    const agent = await getAgent(live.kind);
    const result = await agent.conn.agent.request(acp.methods.agent.session.prompt, {
      sessionId: live.sessionId,
      prompt: [{ type: "text", text }],
    });
    if (!getThread(threadId)) return;
    persistEvent(threadId, "turn_end", { stopReason: result.stopReason });
    setThread(threadId, { status: "idle" });
  } catch (e: any) {
    if (!getThread(threadId)) return;
    persistEvent(threadId, "error", { message: String(e?.message ?? e) });
    setThread(threadId, { status: "idle" });
  }
}

// ---------------------------------------------------------------------------
// HTTP + WS server
// ---------------------------------------------------------------------------

const http = createServer((req, res) => {
  const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
  if (pathname === "/" || pathname === "/index.html") {
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.end(readFileSync(join(here, "public/index.html")));
    return;
  }
  res.statusCode = 404;
  res.end("not found");
});

const wss = new WebSocketServer({ server: http, path: "/ws" });
wss.on("connection", (ws) => {
  send(ws, { type: "hello", workspace: WORKSPACE, agents: Object.keys(AGENT_BIN), threads: listThreads() });
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
  for (const p of agents.values()) p.then((a) => a.proc.kill()).catch(() => {});
  process.exit(0);
});
