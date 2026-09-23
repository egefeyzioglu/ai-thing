# AI thing harness (proof of concept)

A local process that drives **Claude Code** and **Codex** over the
[Agent Client Protocol](https://agentclientprotocol.com) and exposes them to a
browser UI. Agents run under your existing local logins (Claude Code login,
ChatGPT login), so nothing is billed at API token prices.

```
browser  <-- WebSocket -->  server.ts  <-- ACP over stdio -->  claude-code-acp / codex-acp
```

## Run

```sh
pnpm install
pnpm dev            # http://localhost:4747
```

Env: `PORT` (default 4747), `WORKSPACE` (default `./workspace`, the shared
folder agents work in), `AITHING_HOME` (where `harness.db` is stored),
`CODEX_MODEL` (default `gpt-5.5`; codex-acp bundles an older Codex core than
the CLI and rejects newer model slugs from `~/.codex/config.toml`).

SQLite persistence uses Node's built-in `node:sqlite`. The database lives at
`$AITHING_HOME/harness.db` when `AITHING_HOME` is set. Otherwise it uses
`%LOCALAPPDATA%\aithing\harness.db` on Windows (falling back to `%APPDATA%`) and
`~/.aithing/harness.db` on other platforms.

## What works

- One long-lived ACP process per agent kind, one ACP session per harness thread.
- SQLite-backed thread list and append-only event logs that survive browser
  reloads and server restarts.
- Streaming agent text, thoughts, tool calls (with diffs / output), plans.
- Permission requests forwarded to every browser and answerable after reload
  while the server process is still alive.
- Cancel mid-turn, then keep prompting on the same session.
- Best-effort ACP session resume after server restart when the adapter supports
  `session/load`; otherwise a fresh ACP session is started and the persisted log
  remains visible.

## Scripted checks

```sh
node scripts/drive.mjs claude "Create hello.txt with one line: hi"
node scripts/drive.mjs codex  "Create hello.txt with one line: hi"
node scripts/drive.mjs claude "What did you just write?" <threadId>
node scripts/cancel-test.mjs
```

## Not done (on purpose)

Projects, file browser, image-generation MCP tools, auth flow (assumes you are
already logged in to both CLIs), and durable permission prompts across a server
restart. ACP turn execution still lives only in the current server process.
