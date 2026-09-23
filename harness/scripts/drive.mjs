import WebSocket from "ws";

const agent = process.argv[2];
const prompt = process.argv[3];
const existingThreadId = process.argv[4];
if (!["claude", "codex"].includes(agent) || !prompt) {
  console.error('usage: node scripts/drive.mjs <claude|codex> "<prompt>" [threadId]');
  process.exit(64);
}

const port = process.env.PORT ?? "4747";
const ws = new WebSocket(`ws://localhost:${port}/ws`);
let threadId = existingThreadId ?? null;
const t0 = Date.now();
const ts = () => ((Date.now() - t0) / 1000).toFixed(1) + "s";

function send(msg) {
  ws.send(JSON.stringify(msg));
}

function startPrompt(thread) {
  threadId = thread.id;
  console.log(ts(), "thread", threadId);
  send({ type: "prompt", threadId, text: prompt });
}

ws.on("open", () => {
  if (threadId) send({ type: "open_thread", threadId });
  else send({ type: "new_thread", agent });
});

ws.on("message", (data) => {
  const msg = JSON.parse(data);
  if (msg.type === "hello" || msg.type === "thread") return;
  if (msg.type === "opened") {
    startPrompt(msg.thread);
    return;
  }
  if (msg.type !== "event" || msg.threadId !== threadId) {
    if (msg.type === "error") {
      console.log("\n" + ts(), "ERROR", msg.message);
      process.exit(1);
    }
    return;
  }

  const { type, payload } = msg.event;
  if (type === "user_message") return;
  if (type === "sys") {
    console.log("\n" + ts(), "SYS", payload.message);
    return;
  }
  if (type === "update") {
    const u = payload.update;
    if (u.sessionUpdate === "agent_message_chunk") process.stdout.write(u.content.text ?? "");
    else if (u.sessionUpdate === "agent_thought_chunk") process.stdout.write("\x1b[2m" + (u.content.text ?? "") + "\x1b[0m");
    else if (u.sessionUpdate === "tool_call") console.log("\n" + ts(), "TOOL", u.title, u.kind, u.status);
    else if (u.sessionUpdate === "tool_call_update") console.log(ts(), "TOOL_UPDATE", u.toolCallId, u.status ?? "");
    else console.log("\n" + ts(), "UPDATE", u.sessionUpdate);
    return;
  }
  if (type === "permission_request") {
    console.log("\n" + ts(), "PERMISSION", payload.toolCall.title, payload.options.map((o) => o.kind + ":" + o.name));
    const allow = payload.options.find((o) => o.kind.startsWith("allow")) ?? payload.options[0];
    send({ type: "permission_response", id: payload.id, optionId: allow?.optionId });
    return;
  }
  if (type === "permission_response") {
    console.log("\n" + ts(), "PERMISSION_RESPONSE", payload.name);
    return;
  }
  if (type === "turn_end") {
    console.log("\n" + ts(), "TURN_END", payload.stopReason);
    ws.close();
    process.exit(0);
  }
  if (type === "error") {
    console.log("\n" + ts(), "ERROR", payload.message);
    process.exit(1);
  }
});

setTimeout(() => {
  console.log("timeout");
  process.exit(2);
}, 240000);
