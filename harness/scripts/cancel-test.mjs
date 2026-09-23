import WebSocket from "ws";

const port = process.env.PORT ?? "4747";
const ws = new WebSocket(`ws://localhost:${port}/ws`);
let threadId;
let promptedAgain = false;
const t0 = Date.now();
const ts = () => ((Date.now() - t0) / 1000).toFixed(1) + "s";

function send(msg) {
  ws.send(JSON.stringify(msg));
}

ws.on("open", () => send({ type: "new_thread", agent: "claude" }));
ws.on("message", (data) => {
  const msg = JSON.parse(data);
  if (msg.type === "hello" || msg.type === "thread") return;
  if (msg.type === "opened") {
    threadId = msg.thread.id;
    console.log(ts(), "thread", threadId);
    send({
      type: "prompt",
      threadId,
      text: "Write a 2000 word essay about the history of typography. Do not use any tools.",
    });
    setTimeout(() => {
      console.log(ts(), "sending cancel");
      send({ type: "cancel", threadId });
    }, 6000);
    return;
  }
  if (msg.type === "error") {
    console.log("ERROR", msg.message);
    process.exit(1);
  }
  if (msg.type !== "event" || msg.threadId !== threadId) return;

  const { type, payload } = msg.event;
  if (type === "update" && payload.update.sessionUpdate === "agent_message_chunk") {
    process.stdout.write(".");
    return;
  }
  if (type === "turn_end") {
    console.log("\n" + ts(), "TURN_END", payload.stopReason);
    if (payload.stopReason === "cancelled" && !promptedAgain) {
      promptedAgain = true;
      send({ type: "prompt", threadId, text: "Reply with exactly: still here" });
      return;
    }
    ws.close();
    process.exit(0);
  }
  if (type === "error") {
    console.log("ERROR", payload.message);
    process.exit(1);
  }
});

setTimeout(() => {
  console.log("timeout");
  process.exit(2);
}, 120000);
