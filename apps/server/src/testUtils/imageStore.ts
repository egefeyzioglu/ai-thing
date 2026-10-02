// @effect-diagnostics nodeBuiltinImport:off
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  type OrchestrationThreadShell,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as ServerConfig from "../config.ts";
import * as ImageStore from "../images/ImageStore.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as WorkspacePaths from "../workspace/WorkspacePaths.ts";

export const THREAD_ID = ThreadId.make("thread-images-1");

export const threadShell = (
  overrides: Partial<OrchestrationThreadShell> = {},
): OrchestrationThreadShell => ({
  id: THREAD_ID,
  projectId: ProjectId.make("project-1"),
  title: "Poster drafts: Spring launch!",
  modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5" },
  runtimeMode: "full-access",
  interactionMode: "default",
  branch: null,
  worktreePath: null,
  pullRequests: [],
  latestTurn: null,
  createdAt: "2026-09-30T10:00:00.000Z",
  updatedAt: "2026-09-30T10:00:00.000Z",
  archivedAt: null,
  settledOverride: null,
  settledAt: null,
  session: null,
  latestUserMessageAt: null,
  hasPendingApprovals: false,
  hasPendingUserInput: false,
  hasActionableProposedPlan: false,
  ...overrides,
});

/** An ImageStore over a temp project whose one thread has that project as its worktree. */
export const makeImageStoreLayer = (cwd: string) =>
  ImageStore.layer.pipe(
    Layer.provide(WorkspacePaths.layer),
    Layer.provide(
      Layer.mock(ProjectionSnapshotQuery)({
        getThreadShellById: (id) =>
          Effect.succeed(
            id === THREAD_ID ? Option.some(threadShell({ worktreePath: cwd })) : Option.none(),
          ),
        getProjectShellById: () => Effect.succeedNone,
      }),
    ),
    Layer.provideMerge(ServerConfig.layerTest(cwd, { prefix: "aithing-image-store-home-" })),
    Layer.provideMerge(NodeServices.layer),
  );
