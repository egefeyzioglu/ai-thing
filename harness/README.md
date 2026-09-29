# AI thing harness (proof of concept)

A local process that drives **Claude Code** and **Codex** over the
[Agent Client Protocol](https://agentclientprotocol.com) and exposes them to a
browser UI. Agents run under your existing local logins (Claude Code login,
ChatGPT login), so nothing is billed at API token prices.

```
browser  <-- WebSocket -->  server.ts  <-- ACP over stdio -->  claude-code-acp / codex-acp
                                                                       |
                                                              MCP over stdio
                                                                       v
                                                            mcp/image-tools.ts
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

## Projects and the files panel

Every thread belongs to a **project**, which is just a named folder. The
thread's working directory (and the image tools' `generated/` output folder)
is that project's folder. On first start a project called "Workspace" is
created for `WORKSPACE`, and any older threads are attached to it.

"＋ project" in the header creates a project; leave the path empty to get
`WORKSPACE/<slug>`, or give an absolute path to any existing folder. Deleting
a project is only allowed once it has no threads and never touches files.

The right-hand panel shows the open thread's project folder (or the header's
selected project when no thread is open): folders, image thumbnails (click to
open), other files with sizes. Generation `.json` sidecars next to an image are
hidden. It refreshes live from an `fs.watch` on each project folder.

HTTP endpoints behind it (read-only, confined to the project folder):

- `GET /api/projects/:id/files?path=<relative dir>` → `{path, entries:[{name,type,size,mtime,mime?}]}`
- `GET /api/projects/:id/raw?path=<relative file>` → the file bytes

## Queue and interrupt

The composer is never disabled while a thread is open. When the agent is
working, Enter (or "Queue") appends the message to the thread's queue and
"Send now" cancels the current turn and runs the message next. Queued
messages are listed above the composer with their own "Send now" and remove
buttons. "Stop" cancels the turn and leaves the queue paused. The queue is
stored in SQLite; after a server restart nothing auto-runs, queued messages
just reappear with their buttons.

## Image generation tools

Every ACP session gets an MCP server (`mcp/image-tools.ts`, name
`aithing-images`) attached via `mcpServers`. It talks to the same provider APIs
as the main app but is standalone: no database, no UploadThing, no Next.js.

Tools:

- `list_image_models` — models, availability, resolutions, aspect ratios.
- `generate_image { prompt, model?, aspect_ratio?, resolution?, reference_images?, filename? }`
  — writes `<thread cwd>/generated/<slug>.png` plus a `<slug>.json` sidecar
  (prompt, model, provider request id, size, timing). Returns the path and a
  ≤768px preview so the agent can look at the result.
- `view_image { path, max_side? }` — downscaled view of any image file.

Models: `gemini-2.5-flash-image` (default), `gemini-3.1-flash-image-preview`,
`gemini-3-pro-image-preview`, `gpt-image-2`, `dola-seedream-5-0-lite`,
`dola-seedream-5-0-pro`. All accept reference images (local paths).

Keys: `GEMINI_API_KEY`, `OPENAI_API_KEY`, `ARK_API_KEY`. `process.env` wins;
otherwise they are read from the repo-root `.env`. Missing keys just mark that
provider unavailable.

```sh
pnpm imagegen-test gemini-2.5-flash-image "a red circle"            # direct MCP call, no agent
pnpm imagegen-test gpt-image-2 "make it blue" generated/a-red-circle-xxxxx.png
```

## What works

- One long-lived ACP process per agent kind, one ACP session per harness thread.
- SQLite-backed thread list and append-only event logs that survive browser
  reloads and server restarts.
- Streaming agent text, thoughts, tool calls (with diffs / output), plans.
- Permission requests forwarded to every browser and answerable after reload
  while the server process is still alive.
- Cancel mid-turn, then keep prompting on the same session.
- Agents generate, edit, and inspect images through MCP tools; results land as
  files in the thread folder and render inline in the tool card.
- Projects (one folder each) with a live file browser and image thumbnails.
- Message queue per thread: queue while the agent works, or interrupt and send now.
- Best-effort ACP session resume after server restart when the adapter supports
  `session/load`; otherwise a fresh ACP session is started and the persisted log
  remains visible.

## Scripted checks

```sh
node scripts/drive.mjs claude "Create hello.txt with one line: hi"
node scripts/drive.mjs codex  "Create hello.txt with one line: hi"
node scripts/drive.mjs claude "What did you just write?" <threadId>
node scripts/drive.mjs codex  "..." "" <projectId>     # new thread in a specific project
node scripts/cancel-test.mjs
```

## Not done (on purpose)

Auth flow (assumes you are already logged in to both CLIs), image
attachments in prompts, settled/unread thread states, and durable permission
prompts across a server restart. ACP turn execution still lives only in the current server process.
