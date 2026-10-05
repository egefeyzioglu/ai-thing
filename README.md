# AI Thing

AI Thing is a local harness that drives **Claude Code** and **Codex** under your own
subscription logins, specialised for image generation. It wraps the provider CLIs in a
local server and serves a web UI (and an Electron desktop app) on top.

## What it does

- **Projects are plain folders.** Point AI Thing at a directory and work there.
- **Every image is versioned.** Each generated or edited image keeps its history under
  `.aithing/versions`, with lineage so you can see what was derived from what.
- **Image tools are exposed to the agent over MCP:**
  `list_image_models`, `generate_image`, `edit_image`, `image_history`,
  `restore_image_version`, `view_image`.
- **Right-panel Images tab:** Browse views over a project's images, an inspector with
  version lineage, a lightbox for quick culling, and manual rerun of a generation.
- **Providers:** only Codex and Claude are supported in this fork.

## Running it

```bash
pnpm install
PATH=$PWD/node_modules/.bin:$PATH node scripts/dev-runner.ts dev
```

The log prints a pairing URL; open it in your browser to connect to the local server.
Development state lives under `~/.ai-thing` (pass `--home-dir <dir>` to use another
directory), so it never touches an installed T3 Code's `~/.t3`.

Install and sign in to at least one provider first:

- Codex: install [Codex CLI](https://developers.openai.com/codex/cli) and run `codex login`
- Claude: install [Claude Code](https://claude.com/product/claude-code) and run `claude auth login`

## Provider keys for image generation

Image models are called with API keys read from a gitignored `.env` at the repo root
(see `.env.example`):

```
GEMINI_API_KEY=...
OPENAI_API_KEY=...
ARK_API_KEY=...
ANTHROPIC_API_KEY=...
```

Only the keys for the models you want to use are required.

## Verifying changes

```bash
PATH=$PWD/node_modules/.bin:$PATH vp run --filter @t3tools/web --filter t3 typecheck
vp lint <files>
```

## Attribution

AI Thing is a fork of T3 Code by T3 Tools Inc. It is used under the MIT License; see
[LICENSE](./LICENSE). Package names (`@t3tools/*`, `t3`), environment variables (`T3CODE_*`),
and third-party licence notices are kept from upstream.
