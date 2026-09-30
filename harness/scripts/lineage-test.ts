import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { adopt, commitVersion, family, pickVersion, readManifest, restoreVersion, scanIndex, setParents } from "../versions.js";

type Step = { name: string; fn: () => void | Promise<void> };

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

async function png(color: string): Promise<Buffer> {
  return sharp({ create: { width: 8, height: 8, channels: 4, background: color } }).png().toBuffer();
}

const root = mkdtempSync(join(tmpdir(), "aithing-lineage-"));
const red = await png("#ff0000");
const blue = await png("#0000ff");
const green = await png("#00ff00");
const yellow = await png("#ffff00");

const steps: Step[] = [
  {
    name: "name inference",
    fn: () => {
      commitVersion(root, "a.png", red, { kind: "generate", prompt: "red", model: "test", provider: "test" }, { width: 8, height: 8 });
      writeFileSync(join(root, "a-v2.png"), blue);
      const m = adopt(root, "a-v2.png");
      const v = m?.versions.find((x) => x.n === 1);
      assert(v?.parents?.[0] === "a.png@1", `expected a.png@1, got ${JSON.stringify(v?.parents)}`);
      assert(v.inferred === true, "expected inferred parent");
    },
  },
  {
    name: "sha inference",
    fn: () => {
      mkdirSync(join(root, "copy"), { recursive: true });
      writeFileSync(join(root, "copy", "b.png"), red);
      const m = adopt(root, "copy/b.png");
      const v = m?.versions.find((x) => x.n === 1);
      assert(v?.parents?.[0] === "a.png@1", `expected a.png@1, got ${JSON.stringify(v?.parents)}`);
    },
  },
  {
    name: "explicit branch and restore",
    fn: () => {
      commitVersion(root, "a-alt1.png", yellow, { kind: "generate", prompt: "alt", model: "test", provider: "test" }, { width: 8, height: 8, parents: ["a.png@1"] });
      commitVersion(root, "a.png", green, { kind: "edit", prompt: "green", model: "test", provider: "test" }, { width: 8, height: 8, parents: ["a.png@1"] });
      const restored = restoreVersion(root, "a.png", 1, { width: 8, height: 8 });
      assert(restored.created, "expected restore to create a new version");
      assert(JSON.stringify(restored.version.parents) === JSON.stringify(["a.png@1"]), `bad restore parents ${JSON.stringify(restored.version.parents)}`);
    },
  },
  {
    name: "pick",
    fn: () => {
      const picked = pickVersion(root, "a-alt1.png@1", "a.png");
      assert(picked.version.source.kind === "pick", `expected pick, got ${picked.version.source.kind}`);
      assert(picked.version.parents?.[0] === "a-alt1.png@1", `bad pick parents ${JSON.stringify(picked.version.parents)}`);
    },
  },
  {
    name: "family and index",
    fn: () => {
      const graph = family(root, "a.png");
      const paths = new Set(graph.nodes.map((n) => n.path));
      for (const path of ["a.png", "a-v2.png", "copy/b.png", "a-alt1.png"]) assert(paths.has(path), `family missing ${path}`);
      assert(JSON.stringify(graph.roots) === JSON.stringify(["a.png@1"]), `bad roots ${JSON.stringify(graph.roots)}`);
      const index = scanIndex(root);
      const familyIds = new Set(index.filter((e) => ["a.png", "a-v2.png", "copy/b.png", "a-alt1.png"].includes(e.path)).map((e) => e.familyId));
      assert(familyIds.size === 1, `expected one familyId, got ${[...familyIds].join(", ")}`);
      const a = index.find((e) => e.path === "a.png");
      assert(a?.children.includes("a-v2.png"), `a.png children missing a-v2.png: ${JSON.stringify(a?.children)}`);
    },
  },
  {
    name: "detach",
    fn: () => {
      setParents(root, "a-v2.png", 1, []);
      const m = readManifest(root, "a-v2.png");
      assert(!m?.versions[0]?.parents?.length && !m?.versions[0]?.inferred, "expected detached a-v2.png");
      const graph = family(root, "a-v2.png");
      assert(graph.nodes.length === 1, `expected 1 detached node, got ${graph.nodes.length}`);
    },
  },
];

let failed = false;
for (const step of steps) {
  try {
    await step.fn();
    console.log(`PASS ${step.name}`);
  } catch (e: any) {
    failed = true;
    console.error(`FAIL ${step.name}: ${String(e?.message ?? e)}`);
  }
}

if (failed) process.exit(1);
