import { WS_METHODS } from "@t3tools/contracts";
import { Atom } from "effect/unstable/reactivity";

import {
  createAtomCommandScheduler,
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "./runtime.ts";
import type { EnvironmentRegistry } from "../connection/registry.ts";

/**
 * Versioned project images. The live index for a workspace root is a stream;
 * everything else is a query or a command keyed by `cwd` plus a path.
 */
export function createImagesEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  const scheduler = createAtomCommandScheduler();
  const perPath = {
    mode: "serial" as const,
    key: ({
      environmentId,
      input,
    }: {
      environmentId: string;
      input: { cwd: string; path?: string };
    }) => JSON.stringify([environmentId, input.cwd, input.path ?? ""]),
  };
  return {
    index: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "environment-data:images:index",
      tag: WS_METHODS.subscribeImages,
      idleTtlMs: 60_000,
    }),
    versions: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:images:versions",
      tag: WS_METHODS.imagesVersions,
      staleTimeMs: 5_000,
    }),
    family: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:images:family",
      tag: WS_METHODS.imagesFamily,
      staleTimeMs: 5_000,
    }),
    models: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:images:models",
      tag: WS_METHODS.imagesListModels,
      staleTimeMs: 60_000,
    }),
    star: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:images:star",
      tag: WS_METHODS.imagesStar,
      scheduler,
      concurrency: perPath,
    }),
    reject: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:images:reject",
      tag: WS_METHODS.imagesReject,
      scheduler,
      concurrency: perPath,
    }),
    relink: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:images:relink",
      tag: WS_METHODS.imagesRelink,
      scheduler,
      concurrency: perPath,
    }),
    pick: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:images:pick",
      tag: WS_METHODS.imagesPick,
      scheduler,
      concurrency: { mode: "serial", key: ({ environmentId }) => environmentId },
    }),
    restore: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:images:restore",
      tag: WS_METHODS.imagesRestore,
      scheduler,
      concurrency: perPath,
    }),
    generate: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:images:generate",
      tag: WS_METHODS.imagesGenerate,
      scheduler,
      concurrency: { mode: "parallel" },
    }),
  };
}
