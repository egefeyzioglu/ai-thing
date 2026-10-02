// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "@effect/vitest";
import { EnvironmentId, ProviderInstanceId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import sharp from "sharp";

import { makeImageStoreLayer, THREAD_ID } from "../../../testUtils/imageStore.ts";
import * as VersionStore from "../../../images/VersionStore.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import { type ImagesToolHandlers, make as makeHandlers } from "./handlers.ts";

const OUTPUT_FOLDER = "threads/2026-09-30-poster-drafts-spring-launch";

const invocation = (
  capabilities: ReadonlyArray<McpInvocationContext.McpCapability>,
): McpInvocationContext.McpInvocationScope => ({
  environmentId: EnvironmentId.make("environment-1"),
  threadId: THREAD_ID,
  providerSessionId: "provider-session-1",
  providerInstanceId: ProviderInstanceId.make("codex"),
  capabilities: new Set(capabilities),
  issuedAt: 1,
});

let root: string;
beforeEach(() => {
  root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "aithing-image-tools-"));
});
afterEach(() => {
  NodeFS.rmSync(root, { recursive: true, force: true });
});

const png = (width: number, height: number) =>
  Effect.promise(() =>
    sharp({ create: { width, height, channels: 3, background: "#3366cc" } })
      .png()
      .toBuffer(),
  );

const call = <K extends keyof ImagesToolHandlers>(
  tool: K,
  input: Parameters<ImagesToolHandlers[K]>[0],
  capabilities: ReadonlyArray<McpInvocationContext.McpCapability> = ["images"],
) =>
  Effect.flatMap(makeHandlers, (handlers) =>
    (handlers[tool] as (input: unknown) => ReturnType<ImagesToolHandlers[K]>)(input),
  ).pipe(
    Effect.provideService(McpInvocationContext.McpInvocationContext, invocation(capabilities)),
    Effect.provide(makeImageStoreLayer(root)),
  );

describe("image tool handlers", () => {
  it.live("lists models with availability, cost, and where this thread's images go", () =>
    Effect.gen(function* () {
      const result = yield* call("list_image_models", {});
      expect(result.text).toContain("gemini-2.5-flash-image (default)");
      expect(result.text).toMatch(/provider: gemini/);
      expect(result.text).toMatch(/available|unavailable \(GEMINI_API_KEY not set\)/);
      expect(result.text).toContain("$0.039");
      expect(result.text).toContain(`saved under ${OUTPUT_FOLDER}/`);
      expect(result.text).toContain("path@N");
      expect(result.text).toContain("aithing.env");
      expect(result.images).toHaveLength(0);
      expect(result.structured).toMatchObject({ outputFolder: OUTPUT_FOLDER });
    }),
  );

  it.live("refuses without the images capability", () =>
    Effect.gen(function* () {
      const error = yield* call("list_image_models", {}, ["preview"]).pipe(Effect.flip);
      expect(error._tag).toBe("McpCapabilityUnavailableError");
    }),
  );

  it.live("views a project image, a specific version, and a bare name from the thread folder", () =>
    Effect.gen(function* () {
      NodeFS.writeFileSync(NodePath.join(root, "hero.png"), yield* png(40, 20));
      const current = yield* call("view_image", { path: "hero.png", max_side: 16 });
      expect(current.images).toHaveLength(1);
      expect(current.images[0]!.mimeType).toBe("image/jpeg");
      expect(current.text).toBe(`${NodePath.join(root, "hero.png")} (40x20)`);

      // commitVersion adopts the untracked 40x20 file as v1 before appending.
      VersionStore.commitVersion(root, "hero.png", yield* png(10, 10), { kind: "upload" });
      VersionStore.commitVersion(root, "hero.png", yield* png(30, 30), { kind: "upload" });
      const old = yield* call("view_image", { path: "hero.png@2" });
      expect(old.text).toBe(
        `${VersionStore.versionFile(root, "hero.png", 2)} (10x10) — version 2 of 3`,
      );
      expect(old.structured).toMatchObject({ version: 2, versions: 3, width: 10, height: 10 });
      const latest = yield* call("view_image", { path: "hero.png" });
      expect(latest.text).toContain("version 3 of 3 (current)");

      NodeFS.mkdirSync(NodePath.join(root, OUTPUT_FOLDER), { recursive: true });
      NodeFS.writeFileSync(NodePath.join(root, OUTPUT_FOLDER, "draft.png"), yield* png(8, 8));
      const inFolder = yield* call("view_image", { path: "draft.png" });
      expect(inFolder.structured).toMatchObject({
        path: NodePath.join(root, OUTPUT_FOLDER, "draft.png"),
      });

      const missing = yield* call("view_image", { path: "nope.png" }).pipe(Effect.flip);
      expect(missing.message).toMatch(/Image not found/);
    }),
  );

  it.live("reports history with derivations and alternatives", () =>
    Effect.gen(function* () {
      VersionStore.commitVersion(root, "hero.png", yield* png(10, 10), { kind: "upload" });
      VersionStore.commitVersion(
        root,
        "hero.png",
        yield* png(12, 12),
        { kind: "edit", prompt: "make it bluer than the sky" },
        { parents: ["hero.png@1"] },
      );
      VersionStore.commitVersion(
        root,
        "hero-alt1.png",
        yield* png(12, 12),
        { kind: "edit" },
        { parents: ["hero.png@1"] },
      );
      const history = yield* call("image_history", { path: "hero.png" });
      expect(history.text).toContain("hero.png — 2 versions, current v2");
      expect(history.text).toContain("* v2");
      expect(history.text).toContain("make it bluer");
      expect(history.text).toContain("Derived from: hero.png@1");
      expect(history.text).toContain("hero-alt1.png@1 (alternative)");
      expect(history.images).toHaveLength(1);
      expect(history.structured).toMatchObject({ current: 2, derivedFrom: ["hero.png@1"] });
    }),
  );

  it.live("restores an older version as a new one", () =>
    Effect.gen(function* () {
      VersionStore.commitVersion(root, "hero.png", yield* png(10, 10), { kind: "upload" });
      VersionStore.commitVersion(root, "hero.png", yield* png(20, 20), { kind: "upload" });
      const restored = yield* call("restore_image_version", { path: "hero.png", version: 1 });
      expect(restored.text).toMatch(/^Restored hero.png@1 as version 3\. Saved /);
      expect(restored.structured).toMatchObject({ version: 3, ref: "hero.png@3" });
      expect(VersionStore.readManifest(root, "hero.png")?.versions[2]).toMatchObject({
        threadId: THREAD_ID,
        parents: ["hero.png@1"],
      });
    }),
  );

  // An unknown model fails before any provider is called, so this never spends a key.
  it.live("fails generation with a readable message for an unknown model", () =>
    Effect.gen(function* () {
      const error = yield* call("generate_image", {
        prompt: "a red square",
        model: "no-such-model",
      }).pipe(Effect.flip);
      expect(error.message).toMatch(/Unknown model "no-such-model"/);
    }),
  );
});
