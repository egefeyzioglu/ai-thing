// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import * as VersionStore from "./VersionStore.ts";

let root: string;

const write = (rel: string, content: string) => {
  NodeFS.mkdirSync(NodePath.join(root, rel, ".."), { recursive: true });
  NodeFS.writeFileSync(NodePath.join(root, rel), content);
};

beforeEach(() => {
  root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "aithing-version-store-"));
});
afterEach(() => {
  NodeFS.rmSync(root, { recursive: true, force: true });
});

describe("VersionStore", () => {
  it("commits consecutive versions and restores an older one as a new version", () => {
    const first = VersionStore.commitVersion(root, "a.png", Buffer.from("one"), { kind: "upload" });
    expect(first).toMatchObject({ created: true, version: { n: 1, file: "v1.png" } });
    const second = VersionStore.commitVersion(root, "a.png", Buffer.from("two"), {
      kind: "generate",
      prompt: "p",
    });
    expect(second.version.n).toBe(2);
    expect(NodeFS.readFileSync(NodePath.join(root, "a.png"), "utf8")).toBe("two");

    const restored = VersionStore.restoreVersion(root, "a.png", 1);
    expect(restored.created).toBe(true);
    expect(restored.version.n).toBe(3);
    expect(restored.version.parents).toEqual(["a.png@1"]);
    expect(restored.version.source).toEqual({ kind: "restore", restoredFrom: 1 });
    expect(NodeFS.readFileSync(NodePath.join(root, "a.png"), "utf8")).toBe("one");
    expect(VersionStore.readManifest(root, "a.png")?.current).toBe(3);
  });

  it("does not add a version when the bytes already match the current one", () => {
    VersionStore.commitVersion(root, "a.png", Buffer.from("one"), { kind: "upload" });
    const again = VersionStore.commitVersion(root, "a.png", Buffer.from("one"), { kind: "upload" });
    expect(again.created).toBe(false);
    expect(VersionStore.readManifest(root, "a.png")?.versions).toHaveLength(1);
  });

  it("picks a version onto another path and links the parent", () => {
    VersionStore.commitVersion(root, "a.png", Buffer.from("one"), { kind: "upload" });
    VersionStore.commitVersion(root, "a.png", Buffer.from("two"), { kind: "upload" });
    const picked = VersionStore.pickVersion(root, "a.png@1", "out/final.png");
    expect(picked.version.parents).toEqual(["a.png@1"]);
    expect(picked.version.source).toEqual({ kind: "pick", pickedFrom: "a.png@1" });
    expect(NodeFS.readFileSync(NodePath.join(root, "out/final.png"), "utf8")).toBe("one");
    const latest = VersionStore.pickVersion(root, "a.png", "out/latest.png");
    expect(latest.version.parents).toEqual(["a.png@2"]);
  });

  it("infers parents for adopted files by identical bytes and by -alt stems", () => {
    VersionStore.commitVersion(root, "hero.png", Buffer.from("bytes"), { kind: "upload" });
    write("copy.png", "bytes");
    const copy = VersionStore.adopt(root, "copy.png")!;
    expect(copy.versions[0]).toMatchObject({ parents: ["hero.png@1"], inferred: true });

    write("hero-alt1.png", "different");
    const alt = VersionStore.adopt(root, "hero-alt1.png")!;
    expect(alt.versions[0]).toMatchObject({ parents: ["hero.png@1"], inferred: true });

    write("unrelated.png", "nothing like it");
    expect(VersionStore.adopt(root, "unrelated.png")!.versions[0]!.parents).toBeUndefined();
  });

  it("captures external edits and marks rejected versions", () => {
    VersionStore.commitVersion(root, "a.png", Buffer.from("one"), { kind: "upload" });
    write("a.png", "edited outside");
    const external = VersionStore.syncExternal(root, "a.png");
    expect(external).toMatchObject({ n: 2, source: { kind: "external" } });
    expect(VersionStore.syncExternal(root, "a.png")).toBeNull();

    const rejected = VersionStore.setRejected(root, "a.png", 2, true);
    expect(rejected.versions[1]!.rejected).toBe(true);
    expect(VersionStore.setRejected(root, "a.png", 2, false).versions[1]!.rejected).toBeUndefined();
    expect(() => VersionStore.setRejected(root, "a.png", 9, true)).toThrow(/No such version/);
  });

  it("replaces parents and clears the inferred flag", () => {
    VersionStore.commitVersion(root, "a.png", Buffer.from("a"), { kind: "upload" });
    VersionStore.commitVersion(root, "b.png", Buffer.from("b"), { kind: "upload" });
    write("a-alt1.png", "c");
    VersionStore.adopt(root, "a-alt1.png");
    const relinked = VersionStore.setParents(root, "a-alt1.png", 1, ["b.png@1"]);
    expect(relinked.versions[0]!.parents).toEqual(["b.png@1"]);
    expect(relinked.versions[0]!.inferred).toBeUndefined();
    expect(() => VersionStore.setParents(root, "a-alt1.png", 1, ["b.png"])).toThrow(/immutable/);
  });

  it("groups the index into families and builds the family graph", () => {
    VersionStore.commitVersion(root, "a.png", Buffer.from("a"), { kind: "upload" });
    VersionStore.commitVersion(
      root,
      "b.png",
      Buffer.from("b"),
      { kind: "generate" },
      { parents: ["a.png@1"] },
    );
    VersionStore.commitVersion(
      root,
      "c.png",
      Buffer.from("c"),
      { kind: "generate" },
      { parents: ["b.png@1"] },
    );
    VersionStore.commitVersion(root, "lone.png", Buffer.from("l"), { kind: "upload" });
    VersionStore.setStarred(root, "lone.png", true);

    const index = VersionStore.scanIndex(root);
    const byPath = Object.fromEntries(index.map((e) => [e.path, e]));
    expect(byPath["a.png"]).toMatchObject({
      familyId: "a.png",
      familySize: 3,
      children: ["b.png"],
      parents: [],
    });
    expect(byPath["c.png"]).toMatchObject({ familyId: "a.png", familySize: 3, parents: ["b.png"] });
    expect(byPath["lone.png"]).toMatchObject({ familySize: 1, starred: true, exists: true });

    const family = VersionStore.family(root, "c.png");
    expect(family.nodes.map((n) => n.ref).sort()).toEqual(["a.png@1", "b.png@1", "c.png@1"]);
    expect(family.roots).toEqual(["a.png@1"]);
    expect(() => VersionStore.family(root, "lone-missing.png")).toThrow(/No versions/);
  });

  it("refuses paths outside the project or inside the store", () => {
    expect(() =>
      VersionStore.commitVersion(root, "../escape.png", Buffer.from("x"), { kind: "upload" }),
    ).toThrow(/trackable/);
    expect(() =>
      VersionStore.commitVersion(root, "/abs/escape.png", Buffer.from("x"), { kind: "upload" }),
    ).toThrow(/trackable/);
    expect(() =>
      VersionStore.commitVersion(root, ".aithing/versions/x.png", Buffer.from("x"), {
        kind: "upload",
      }),
    ).toThrow(/trackable/);
    expect(() => VersionStore.readManifest(root, "../x.png")).toThrow(/inside the project/);
    expect(() => VersionStore.resolveVersionPath(root, "../x.png@1")).toThrow(/inside the project/);
    expect(VersionStore.toRel(root, NodePath.join(root, ".aithing", "versions"))).toBeNull();
    expect(VersionStore.toRel(root, NodePath.join(root, "sub", "x.png"))).toBe("sub/x.png");
  });

  it("resolves bare paths, version refs, and absolute files outside the project", () => {
    VersionStore.commitVersion(root, "a.png", Buffer.from("one"), { kind: "upload" });
    VersionStore.commitVersion(root, "a.png", Buffer.from("two"), { kind: "upload" });
    expect(VersionStore.resolveVersionPath(root, "a.png")).toMatchObject({
      rel: "a.png",
      abs: NodePath.join(root, "a.png"),
    });
    const v1 = VersionStore.resolveVersionPath(root, "a.png@1");
    expect(v1.version).toBe(1);
    expect(NodeFS.readFileSync(v1.abs, "utf8")).toBe("one");
    const outside = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "aithing-outside-"));
    try {
      NodeFS.writeFileSync(NodePath.join(outside, "ref.png"), "ref");
      expect(VersionStore.resolveVersionPath(root, NodePath.join(outside, "ref.png")).abs).toBe(
        NodePath.join(outside, "ref.png"),
      );
    } finally {
      NodeFS.rmSync(outside, { recursive: true, force: true });
    }
  });
});
