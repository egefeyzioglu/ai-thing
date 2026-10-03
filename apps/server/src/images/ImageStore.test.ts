// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Stream from "effect/Stream";

import { makeImageStoreLayer, THREAD_ID } from "../testUtils/imageStore.ts";
import * as ImageStore from "./ImageStore.ts";

let root: string;
beforeEach(() => {
  root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "aithing-image-store-"));
});
afterEach(() => {
  NodeFS.rmSync(root, { recursive: true, force: true });
});

const withStore = <A, E>(
  body: (store: ImageStore.ImageStore["Service"]) => Effect.Effect<A, E, never>,
) => Effect.flatMap(ImageStore.ImageStore, body).pipe(Effect.provide(makeImageStoreLayer(root)));

describe("ImageStore", () => {
  it.live("indexes adopted files and emits one coalesced index after a burst of changes", () =>
    Effect.gen(function* () {
      NodeFS.writeFileSync(NodePath.join(root, "a.png"), "one");
      NodeFS.writeFileSync(NodePath.join(root, "brief.md"), "# brief");

      const emitted = yield* withStore((store) =>
        Effect.gen(function* () {
          const first = yield* Deferred.make<void>();
          const collector = yield* store.subscribe(root).pipe(
            Stream.tap(() => Deferred.succeed(first, undefined)),
            // The publish debounce may group the writes into one or several
            // emissions; stop once the final state has arrived.
            Stream.takeUntil((index) => {
              const entry = index.entries.find((e) => e.path === "a.png");
              return entry?.starred === true && entry.versions === 2 && entry.rejected;
            }),
            Stream.runCollect,
            Effect.forkScoped,
          );
          yield* Deferred.await(first);
          yield* store.star(root, "a.png", true);
          yield* store.commit(root, "a.png", Buffer.from("two"), { kind: "upload" });
          yield* store.reject(root, "a.png", 2, true);
          return yield* Fiber.join(collector);
        }).pipe(Effect.scoped),
      );

      expect(emitted.length).toBeGreaterThanOrEqual(2);
      const initial = emitted[0]!;
      expect(initial.cwd).toBe(root);
      expect(initial.briefFiles).toEqual(["brief.md"]);
      // The initial index goes out before the background walk adopts files.
      const final = emitted[emitted.length - 1]!;
      expect(final.entries.map((e) => e.path).sort()).toEqual(["a.png", "brief.md"]);
      expect(final.entries.find((e) => e.path === "a.png")).toMatchObject({
        starred: true,
        versions: 2,
        rejected: true,
      });
    }),
  );

  it.live("adopts an untracked file on versions() and reports its manifest", () =>
    Effect.gen(function* () {
      NodeFS.writeFileSync(NodePath.join(root, "b.png"), "bytes");
      const manifest = yield* withStore((store) => store.versions(root, "b.png"));
      expect(manifest).toMatchObject({ path: "b.png", current: 1 });
      expect(manifest.versions[0]!.source.kind).toBe("adopt");
    }),
  );

  it.live("maps store failures to ImagesError", () =>
    Effect.gen(function* () {
      const error = yield* withStore((store) =>
        store.versions(root, "../outside.png").pipe(Effect.flip),
      );
      expect(error._tag).toBe("ImagesError");
      expect(error.message).toMatch(/Not a trackable project path/);
    }),
  );

  it.live("derives the thread output folder from the thread's date and title", () =>
    Effect.gen(function* () {
      const [folder, cwd] = yield* withStore((store) =>
        Effect.all([store.threadOutputFolder(THREAD_ID), store.threadCwd(THREAD_ID)]),
      );
      expect(folder).toBe("threads/2026-09-30-poster-drafts-spring-launch");
      expect(cwd).toBe(root);
      expect(ImageStore.slugify("")).toBe("");
    }),
  );

  it("reads provider keys from env files without overriding the process environment", () => {
    const file = NodePath.join(root, "aithing.env");
    NodeFS.writeFileSync(
      file,
      '# keys\nGEMINI_API_KEY="from-file"\nOPENAI_API_KEY=file-openai\nOTHER=ignored\n',
    );
    const env = ImageStore.loadProviderEnv([file, NodePath.join(root, "missing.env")], {
      GEMINI_API_KEY: "from-process",
    });
    expect(env.GEMINI_API_KEY).toBe("from-process");
    expect(env.OPENAI_API_KEY).toBe("file-openai");
    expect(env.OTHER).toBeUndefined();
  });
});
