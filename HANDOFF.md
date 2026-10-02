# HANDOFF — from the harness PoC to the real product

Written 2026-10-02 at the end of the PoC thread. Read this first in a new thread.

## What we are building

"AI thing": a local harness that drives Claude Code and Codex over ACP under the
user's own subscription logins, specialised for image generation. The general
harness (threads, projects, queueing, permissions, restart durability, UI shell)
will come from a fork of T3 Code (https://github.com/pingdotgg/t3code, MIT).
Our work is the image-generation tools and the image-specific review UX. The PoC
in `harness/` exists to exercise exactly those two things; its README documents
what was built and how.

## Design principles the user has confirmed

- Get in the way of the agent as little as possible. Agents read files
  directly; the harness tracks what happened rather than imposing structure.
- Plain folders. A project is a folder. Nothing is required on disk. Views are
  derived from metadata, not folder names.
- Agentic workflow is the centre. Manual controls exist but live in the side
  panel, never as the primary way in.
- Filenames are free-form. Lineage comes from the derivation graph, not names.
- Everything is a version. Overwrite in place makes v(N+1); a new name makes a
  sibling; picks copy a version onto a path as a new version. History is never
  rewritten.

## What the PoC validated (carries over as design, mostly rewrite as code)

- **Version store** (`harness/versions.ts`): working file stays plain; history
  under `<project>/.aithing/versions/<rel>/manifest.json` + `v<N>.<ext>`;
  immutable refs `path@N`; sources generate/edit/upload/restore/pick/adopt/
  agent_write/external; `parents` refs; inference of parents for untracked
  arrivals (identical sha, or same-folder stem stripping of -v2/alt1/final/...);
  `family()` as connected component; `setParents` to relink or detach. This API
  is what carries over. The cross-process mkdir lock should become a single
  writer service in the real product.
- **MCP image tools** (`harness/mcp/image-tools.ts`): `list_image_models`,
  `generate_image`, `edit_image` (in place, `output` to branch, `variants` for
  N siblings), `image_history`, `restore_image_version`, `view_image`. Tools
  return path, version and a <=768px preview so the agent sees its result.
  Reference images become parents. Keys never reach the agent process.
- **Attributed writes**: ACP client fs capability makes Claude's Write/Edit land
  as attributed versions. Codex writes to disk itself, so its writes arrive via
  the per-directory watcher as unattributed `external`. Recursive fs.watch is
  unreliable on Linux; use per-directory watchers.
- **Per-thread output folder** `threads/<date>-<slug>/`, cwd stays project root.
- **Derived Browse views**: This thread, Outputs, Refs, Picks, Brief, computed
  from the version index.
- **Lineage UI**: family tree in the inspector, siblings under the version they
  came from, dashed twig for inferred links with unlink, "use" to pick.
- Mockups: `mockups/agent-workspace.html` (overall layout, manual composer),
  `mockups/workspace-organization.html`, `mockups/triage-options.html` (three
  triage options, interactive; screenshots `triage-a/b/c.png`).

## Decisions made in the final design pass

**Review loop**

1. Spatial feedback. In the full-screen viewer, click-drag draws a rectangle;
   a comment popover appears, dismissed by X or Esc (Esc closes the popover
   first, fullscreen on a second press; Enter saves). Drags under a threshold
   are clicks. Multiple numbered regions per message. Annotations are
   attachments on the next message keyed by `path@N`, not versions. The agent
   receives: the comment with normalised coordinates, a crop of the region as
   an image block, and the full image with the box drawn on. Skip freehand,
   arrows and resize handles. Design `edit_image` to accept a `region`/`mask`
   later so inpainting slots in without a contract change.
2. Rerun without the agent lives in the right sidebar, collapsed by default:
   prompt prefilled from the selected version, model and resolution, Run. The
   result is a child version; a short system event is appended to the thread
   so the agent knows the file changed.
3. Triage of alternatives: option B (lightbox cull) is the primary flow,
   opened ONLY by user click on a tile or a "Review N" button, never
   automatically. Filmstrip with source on the left; arrows move, Space keep,
   Backspace drop, Enter pick as current, C compare with source, Esc close.
   Option A's hover keep/drop on the tool card is the quick-win shortcut.
   Option C (Needs-review Browse view) is deferred; it needs the full centre
   column, not the side panel. Store needs a per-version `rejected` flag that
   views hide and lineage keeps. Side-by-side compare is part of this work.

**Agent-facing tool ergonomics**: build a best attempt and measure. Start with
smaller previews for `variants` plus `view_image` for detail; tools return
cost; cheap sharp utilities (crop, resize, upscale placeholder, background
removal via provider, convert) as tools; variants across models as an axis
(`models: []` on edit/generate); scripted runs to check the agent's
self-critique against its own output.

**References and style**: a reference carries an optional role (`character`,
`style`, `layout`, `product`), stored on the attachment and on the version's
parent edge, passed to providers and described to the agent. The project brief
is root markdown; the harness injects a one-line pointer at the start of each
turn and we check in scripted runs whether the agent honours it.

**Cost**: every generation records provider, model, resolution and an estimated
cost on the version; the permission layer gates by cost and count (4K, >4
variants), not by tool name.

**Storage**: content-addressed version files with dedupe by sha; deletes and
renames become first-class store operations rather than watcher side effects.

## T3 Code findings relevant to the fork (shallow clone, 2026-10-02)

- Monorepo: `apps/{server,web,desktop,mobile,marketing}`,
  `packages/{effect-acp,effect-codex-app-server,contracts,client-runtime,shared,ssh,tailscale}`.
  Effect-based server, Vite web app, shadcn + Tailwind 4, Electron desktop.
- `packages/effect-acp/src/client.ts` exposes `readTextFile`/`writeTextFile`
  client handlers, so attributed agent writes via ACP fs are available.
- `apps/server/src/provider/Layers/ClaudeAdapter.ts` already passes
  `mcpServers` to sessions, and `apps/server/src/mcp/` has an in-process MCP
  HTTP server with `McpSessionRegistry` and `McpInvocationContext` (per-thread
  context). Our image tools should become a toolkit there instead of a separate
  stdio process; this also solves "secrets reaching the MCP process" and the
  thread-id/output-folder plumbing.
- `apps/server/src/checkpointing/` (CheckpointStore, Diffs) and
  `apps/server/src/workspace/` (WorkspaceFileSystem, Entries, SearchIndex) are
  the natural homes for the version store and index.
- `apps/web/src/components/RightPanelTabs.tsx` is the right-panel host; the
  inspector, lightbox and Browse views plug in there. `ChatMarkdown` already
  renders workspace images in chat.
- Docs worth reading before coding: `docs/internals/overview.md`,
  `providers.md`, `connection-runtime.md`.

## Proposed first milestones

1. Fork T3 Code; strip providers we do not need; get Claude and Codex threads
   running against a project folder.
2. Port the version store into the server as a single-writer service with a
   SQLite index; manifests stay the on-disk source of truth. Wire ACP fs
   writes and per-directory watchers into it.
3. Port the image tools as an in-process MCP toolkit with per-thread context;
   add cost on results and the `rejected` flag.
4. Right panel: inspector (versions, generation, lineage), Browse views, tile
   hover keep/drop, lightbox cull with compare.
5. Spatial feedback in the viewer and the annotation attachment contract.
6. Sidebar rerun; reference roles; measurement scripts for tool ergonomics.

## Working conventions from this thread

- Commit unsigned: `git -c commit.gpgsign=false commit --no-gpg-sign`. HTTPS
  remote. The user connects remotely and cannot approve 1Password prompts.
- Never add `Co-Authored-By` trailers.
- Do not run `pnpm build`; verify with `pnpm typecheck` and `pnpm lint`.
- Never print API keys or hosting tokens; `.env` at repo root holds provider
  keys.
- Delegate well-specified implementation to Codex with a self-contained spec,
  then review and verify. Background recipe:
  `(nohup codex exec -s workspace-write --skip-git-repo-check -c model="gpt-5.5" "$(cat spec)" < /dev/null > log 2>&1; echo "exit=$?" >> log) &`
  then poll for `^exit=`. Codex's sandbox cannot run `npx tsx` (IPC EPERM);
  it uses `node --import tsx`.
- Screenshots: `google-chrome --headless=new --disable-gpu --no-sandbox --hide-scrollbars --window-size=1500,1000 --virtual-time-budget=10000 --screenshot=out.png <url>`.
- Harness dev server: from `harness/`, `PORT=4747 npx tsx server.ts`.
