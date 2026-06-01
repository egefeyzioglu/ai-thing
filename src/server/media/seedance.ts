import "server-only";

import { env } from "src/env";

const ARK_BASE_URL = "https://ark.ap-southeast.bytepluses.com/api/v3";
const ARK_TASKS_ENDPOINT = `${ARK_BASE_URL}/contents/generations/tasks`;

// Our internal slug → Modelark versioned model ID. The version suffix
// (e.g. 260128) is the model snapshot date; the indirection keeps the
// internal/user-facing slug stable across Modelark snapshot bumps.
const SLUG_TO_MODELARK_ID = {
  "dreamina-seedance-2-0": "dreamina-seedance-2-0-260128",
  "dreamina-seedance-2-0-fast": "dreamina-seedance-2-0-fast-260128",
} as const;

export type SeedanceSlug = keyof typeof SLUG_TO_MODELARK_ID;

export function isSeedanceSlug(slug: string): slug is SeedanceSlug {
  return slug in SLUG_TO_MODELARK_ID;
}

export function modelarkModelIdForSlug(slug: SeedanceSlug): string {
  return SLUG_TO_MODELARK_ID[slug];
}

export type SeedanceTaskStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled";

export type SeedanceTaskResult = {
  taskId: string;
  providerModel: string;
  status: SeedanceTaskStatus;
  videoUrl?: string;
  error?: { code?: string; message?: string };
  usageRaw: unknown;
  raw: unknown;
};

type ModelarkSubmitResponse = {
  id?: string;
};

type ModelarkTaskResponse = {
  id?: string;
  model?: string;
  status?: string;
  content?: { video_url?: string; audio_url?: string };
  error?: { code?: string; message?: string };
  usage?: unknown;
  // Echoed back by the poll endpoint; we record them via cost event metadata
  // but don't act on them yet.
  resolution?: string;
  ratio?: string;
  duration?: number;
  framespersecond?: number;
  seed?: number;
};

function authHeaders() {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${env.ARK_API_KEY}`,
  };
}

// Status strings observed/expected from Modelark. We accept a generous set of
// variants so a docs drift doesn't immediately strand polling.
function parseStatus(status: string | undefined): SeedanceTaskStatus {
  switch (status?.toLowerCase()) {
    case "queued":
    case "pending":
    case "in_queue":
      return "queued";
    case "running":
    case "processing":
    case "in_progress":
      return "running";
    case "succeeded":
    case "success":
    case "completed":
    case "done":
      return "succeeded";
    case "failed":
    case "fail":
    case "error":
      return "failed";
    case "cancelled":
    case "canceled":
      return "cancelled";
    default:
      // Unknown — keep polling. If this repeats, the warning shows it.
      console.warn(`[seedance] unknown task status from Modelark: ${status}`);
      return "running";
  }
}

function normalize(data: ModelarkTaskResponse): SeedanceTaskResult {
  return {
    taskId: data.id ?? "",
    providerModel: data.model ?? "",
    status: parseStatus(data.status),
    videoUrl: data.content?.video_url,
    error: data.error,
    usageRaw: data.usage ?? null,
    raw: data,
  };
}

export type SubmitSeedanceTaskInput = {
  slug: SeedanceSlug;
  prompt: string;
  duration: number;
  aspectRatio: string;
  resolution?: string;
  generateAudio?: boolean;
  firstFrameImageUrl?: string;
};

export async function submitSeedanceTask(
  args: SubmitSeedanceTaskInput,
): Promise<SeedanceTaskResult> {
  const content: unknown[] = [{ type: "text", text: args.prompt }];
  if (args.firstFrameImageUrl) {
    content.push({
      type: "image_url",
      image_url: { url: args.firstFrameImageUrl },
      role: "reference_image",
    });
  }

  const body = JSON.stringify({
    model: modelarkModelIdForSlug(args.slug),
    content,
    ratio: args.aspectRatio,
    duration: args.duration,
    ...(args.resolution !== undefined && { resolution: args.resolution }),
    generate_audio: args.generateAudio ?? true,
    watermark: false,
  });

  const res = await fetch(ARK_TASKS_ENDPOINT, {
    method: "POST",
    headers: authHeaders(),
    body,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `Modelark submit failed (${res.status}): ${text.slice(0, 500)}`,
    );
  }

  const data = (await res.json()) as ModelarkSubmitResponse;
  if (!data.id) {
    throw new Error(
      `Modelark submit returned no task id: ${JSON.stringify(data).slice(0, 500)}`,
    );
  }
  // Submit only returns the task id; treat as queued without going through
  // parseStatus (which would warn on the missing status field).
  return {
    taskId: data.id,
    providerModel: "",
    status: "queued",
    videoUrl: undefined,
    error: undefined,
    usageRaw: null,
    raw: data,
  };
}

export async function pollSeedanceTask(
  taskId: string,
): Promise<SeedanceTaskResult> {
  const res = await fetch(`${ARK_TASKS_ENDPOINT}/${taskId}`, {
    method: "GET",
    headers: authHeaders(),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `Modelark poll failed (${res.status}): ${text.slice(0, 500)}`,
    );
  }
  const data = (await res.json()) as ModelarkTaskResponse;
  return normalize(data);
}

export async function cancelSeedanceTask(taskId: string): Promise<void> {
  const res = await fetch(`${ARK_TASKS_ENDPOINT}/${taskId}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (!res.ok) {
    const text = await res.text();
    console.error(
      `Modelark cancel failed (${res.status}): ${text.slice(0, 500)}`,
    );
  }
}
