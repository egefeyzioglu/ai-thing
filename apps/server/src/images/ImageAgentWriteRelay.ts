// @effect-diagnostics nodeBuiltinImport:off
/**
 * Attributes agent file writes to the version store.
 *
 * Listens to the provider event stream for completed `file_change` items and
 * records the written file as an `agent_write` version on the thread. The
 * watcher would capture the same bytes as `external` half a second later; this
 * relay only adds who wrote them. Best-effort: a payload we cannot read is
 * skipped, never a reason to fail the stream.
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import { IMAGE_STORE_DIR, type ProviderRuntimeEvent } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import * as ProviderService from "../provider/Services/ProviderService.ts";
import { ImageStore } from "./ImageStore.ts";
import { isVersionable, toRel } from "./VersionStore.ts";

const CLAUDE_WRITE_TOOLS = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);

export interface AgentWrite {
  readonly path: string;
  readonly tool: string;
}

/** Paths written by a completed `file_change` item, for Claude (`data.input.file_path`) and Codex (`data.item.changes[].path`). */
function agentWritesOf(event: ProviderRuntimeEvent): ReadonlyArray<AgentWrite> {
  if (event.type !== "item.completed" || event.payload.itemType !== "file_change") return [];
  if (event.payload.status !== undefined && event.payload.status !== "completed") return [];
  const data = event.payload.data;
  if (typeof data !== "object" || data === null) return [];
  const record = data as Record<string, unknown>;

  const input = record.input;
  if (typeof input === "object" && input !== null) {
    const filePath =
      (input as Record<string, unknown>).file_path ??
      (input as Record<string, unknown>).notebook_path;
    const toolName = typeof record.toolName === "string" ? record.toolName : "Write";
    if (typeof filePath === "string" && filePath.length > 0 && CLAUDE_WRITE_TOOLS.has(toolName)) {
      return [{ path: filePath, tool: toolName }];
    }
  }

  const item = record.item;
  if (typeof item === "object" && item !== null) {
    const changes = (item as Record<string, unknown>).changes;
    if (Array.isArray(changes)) {
      const out: AgentWrite[] = [];
      for (const change of changes) {
        if (typeof change !== "object" || change === null) continue;
        const { path, kind } = change as { path?: unknown; kind?: unknown };
        const kindType =
          typeof kind === "string"
            ? kind
            : typeof kind === "object" && kind !== null
              ? (kind as { type?: unknown }).type
              : undefined;
        if (typeof path !== "string" || !path || (kindType !== "add" && kindType !== "update"))
          continue;
        out.push({ path, tool: "apply_patch" });
      }
      return out;
    }
  }
  return [];
}

const make = Effect.gen(function* () {
  const providers = yield* ProviderService.ProviderService;
  const images = yield* ImageStore;

  const record = (event: ProviderRuntimeEvent) =>
    Effect.gen(function* () {
      const writes = agentWritesOf(event);
      if (writes.length === 0) return;
      const cwd = yield* images.threadCwd(event.threadId);
      // Only projects that already use the image store get attributed writes;
      // otherwise an agent editing a README in a code project would create
      // `.aithing` there.
      if (!NodeFS.existsSync(NodePath.join(cwd, IMAGE_STORE_DIR))) return;
      for (const write of writes) {
        const abs = NodePath.isAbsolute(write.path)
          ? write.path
          : NodePath.resolve(cwd, write.path);
        const rel = toRel(cwd, abs);
        if (rel === null || !isVersionable(rel)) continue;
        yield* images.syncExternal(
          cwd,
          rel,
          { kind: "agent_write", tool: write.tool },
          { threadId: event.threadId },
        );
      }
    }).pipe(Effect.ignoreCause({ log: true }));

  yield* Stream.runForEach(providers.streamEvents, record).pipe(
    Effect.ignoreCause({ log: true }),
    Effect.forkScoped,
  );
});

export const layer = Layer.effectDiscard(make);
