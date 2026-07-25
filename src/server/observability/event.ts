import "server-only";

import { TRPCError } from "@trpc/server";
import { after } from "next/server";

import { env } from "src/env";
import { type TraceContext } from "src/lib/observability/trace";

type JsonPrimitive = boolean | number | string | null;
export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { [key: string]: JsonValue };

export type EventOutcome = "success" | "expected_error" | "unexpected_error";

type ErrorCategory =
  | "application"
  | "authentication"
  | "dependency"
  | "invariant"
  | "rate_limit"
  | "user";

type WideEventError = {
  category: ErrorCategory;
  code: string | null;
  message: string;
  name: string;
  retryable: boolean | null;
  stack?: string;
  stage: string | null;
};

export type WideEvent = {
  attributes: Record<string, JsonValue>;
  durationMs: number;
  environment: string;
  error?: WideEventError;
  eventId: string;
  eventName: string;
  mediaId?: string;
  operation: string;
  outcome: EventOutcome;
  provider?: string;
  providerRequestId?: string;
  release: string | null;
  requestId?: string;
  schemaVersion: 1;
  service: "ai-thing";
  spanId?: string;
  timestamp: string;
  traceId?: string;
  parentSpanId?: string;
  usageId?: string;
  userId?: string;
};

type EventContext = Partial<
  Pick<
    WideEvent,
    | "mediaId"
    | "provider"
    | "providerRequestId"
    | "requestId"
    | "usageId"
    | "userId"
  >
>;

type EventOptions = {
  durationMs?: number;
  startedAt?: Date;
  trace?: TraceContext;
};

const SECRET_PATTERNS = [
  /\b(?:sk|key|token|secret)[-_][A-Za-z0-9_-]{12,}\b/gi,
  /\bBearer\s+[A-Za-z0-9._~+/=-]+\b/gi,
  /https?:\/\/[^\s]+(?:token|signature|x-amz-signature)=[^\s&]+/gi,
];
const ASSIGNMENT_SECRET_PATTERN =
  /\b(?:api[_-]?key|access[_-]?token|password)\s*[=:]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi;
const URL_USERINFO_PATTERN = /\b([a-z][a-z0-9+.-]*:\/\/)[^/\s:@]+:[^@\s/]+@/gi;
const HONEYCOMB_BATCH_SIZE = 50;
const HONEYCOMB_MAX_QUEUED_EVENTS = 1_000;
const HONEYCOMB_REQUEST_TIMEOUT_MS = 5_000;
const pendingEvents: WideEvent[] = [];
let flushScheduled = false;

function redactMessage(value: string): string {
  let redacted = value
    .slice(0, 2_000)
    .replace(URL_USERINFO_PATTERN, "$1[REDACTED]@")
    .replace(ASSIGNMENT_SECRET_PATTERN, "[REDACTED]");
  for (const pattern of SECRET_PATTERNS) {
    redacted = redacted.replace(pattern, "[REDACTED]");
  }
  return redacted.slice(0, 1_000);
}

function classifyError(
  error: unknown,
  stage: string | null,
): {
  error: WideEventError;
  outcome: EventOutcome;
} {
  if (error instanceof TRPCError) {
    const expected = new Set([
      "BAD_REQUEST",
      "CONFLICT",
      "FORBIDDEN",
      "NOT_FOUND",
      "PARSE_ERROR",
      "PRECONDITION_FAILED",
      "TOO_MANY_REQUESTS",
      "UNAUTHORIZED",
    ]).has(error.code);
    const category: ErrorCategory =
      error.code === "UNAUTHORIZED" || error.code === "FORBIDDEN"
        ? "authentication"
        : error.code === "TOO_MANY_REQUESTS"
          ? "rate_limit"
          : expected
            ? "user"
            : "application";

    return {
      error: {
        category,
        code: error.code,
        message: redactMessage(error.message),
        name: error.name,
        retryable: error.code === "TOO_MANY_REQUESTS",
        stack:
          expected || !error.stack ? undefined : redactMessage(error.stack),
        stage,
      },
      outcome: expected ? "expected_error" : "unexpected_error",
    };
  }

  const normalized =
    error instanceof Error
      ? error
      : new Error(
          typeof error === "string"
            ? error
            : error === null || error === undefined
              ? "Unknown error"
              : "Non-Error value thrown",
        );
  const isAbort =
    normalized.name === "AbortError" ||
    (normalized instanceof DOMException && normalized.name === "AbortError");

  return {
    error: {
      category: isAbort ? "user" : "application",
      code: null,
      message: redactMessage(normalized.message),
      name: normalized.name,
      retryable: isAbort ? false : null,
      stack:
        isAbort || !normalized.stack
          ? undefined
          : redactMessage(normalized.stack),
      stage,
    },
    outcome: isAbort ? "expected_error" : "unexpected_error",
  };
}

async function sendBatchToHoneycomb(events: WideEvent[]): Promise<void> {
  const apiKey = env.HONEYCOMB_API_KEY;
  const dataset = env.HONEYCOMB_DATASET;
  if (!apiKey || !dataset) return;

  try {
    const response = await fetch(
      `${env.HONEYCOMB_API_HOST}/1/batch/${encodeURIComponent(dataset)}`,
      {
        body: JSON.stringify(
          events.map((event) => ({
            data: {
              ...event,
              duration_ms: event.durationMs,
              name: event.eventName,
              ...(event.traceId && {
                "trace.trace_id": event.traceId,
                "trace.span_id": event.spanId,
                ...(event.parentSpanId && {
                  "trace.parent_id": event.parentSpanId,
                }),
              }),
            },
            time: event.timestamp,
          })),
        ),
        headers: {
          "Content-Type": "application/json",
          "X-Honeycomb-Team": apiKey,
        },
        method: "POST",
        signal: AbortSignal.timeout(HONEYCOMB_REQUEST_TIMEOUT_MS),
      },
    );

    if (!response.ok) {
      console.error("[observability] Honeycomb rejected event", {
        eventIds: events.map((event) => event.eventId),
        status: response.status,
      });
    }
  } catch (error) {
    console.error("[observability] Failed to emit Honeycomb event", {
      eventIds: events.map((event) => event.eventId),
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function flushHoneycombQueue(): Promise<void> {
  while (pendingEvents.length > 0) {
    const batch = pendingEvents.splice(0, HONEYCOMB_BATCH_SIZE);
    await sendBatchToHoneycomb(batch);
  }
}

function scheduleHoneycombEvent(event: WideEvent): void {
  if (!env.HONEYCOMB_API_KEY || !env.HONEYCOMB_DATASET) {
    if (env.NODE_ENV !== "production") console.info(JSON.stringify(event));
    return;
  }

  if (pendingEvents.length >= HONEYCOMB_MAX_QUEUED_EVENTS) {
    const dropped = pendingEvents.shift();
    console.error("[observability] Honeycomb event queue overflow", {
      droppedEventId: dropped?.eventId,
    });
  }
  pendingEvents.push(event);
  if (flushScheduled) return;

  flushScheduled = true;
  after(async () => {
    try {
      await flushHoneycombQueue();
    } finally {
      flushScheduled = false;
    }
  });
}

export class WideEventBuilder {
  readonly #attributes: Record<string, JsonValue> = {};
  readonly #context: EventContext;
  readonly #eventId = crypto.randomUUID();
  readonly #eventName: string;
  readonly #durationMs: number | undefined;
  readonly #startedAt: number;
  readonly #trace: TraceContext | undefined;
  #emitted = false;
  #error: WideEventError | undefined;
  #outcome: EventOutcome = "success";

  constructor(
    eventName: string,
    context: EventContext = {},
    options: EventOptions = {},
  ) {
    this.#eventName = eventName;
    this.#context = context;
    this.#durationMs = options.durationMs;
    this.#startedAt = options.startedAt?.getTime() ?? Date.now();
    this.#trace = options.trace;
  }

  set(attributes: Record<string, JsonValue | undefined>): this {
    for (const [key, value] of Object.entries(attributes)) {
      if (value !== undefined) this.#attributes[key] = value;
    }
    return this;
  }

  fail(error: unknown, stage: string | null = null): this {
    const classified = classifyError(error, stage);
    this.#error = classified.error;
    this.#outcome = classified.outcome;
    return this;
  }

  outcome(outcome: EventOutcome): this {
    this.#outcome = outcome;
    return this;
  }

  async emit(): Promise<void> {
    if (this.#emitted) return;
    this.#emitted = true;

    scheduleHoneycombEvent({
      schemaVersion: 1,
      eventId: this.#eventId,
      eventName: this.#eventName,
      timestamp: new Date(this.#startedAt).toISOString(),
      service: "ai-thing",
      environment: env.NODE_ENV,
      release: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
      operation: this.#eventName,
      outcome: this.#outcome,
      durationMs: this.#durationMs ?? Date.now() - this.#startedAt,
      ...this.#context,
      ...(this.#trace && {
        traceId: this.#trace.traceId,
        spanId: this.#trace.spanId,
        ...(this.#trace.parentSpanId && {
          parentSpanId: this.#trace.parentSpanId,
        }),
      }),
      ...(this.#error && { error: this.#error }),
      attributes: this.#attributes,
    });
  }
}

export function createWideEvent(
  eventName: string,
  context: EventContext = {},
  options: EventOptions = {},
): WideEventBuilder {
  return new WideEventBuilder(eventName, context, options);
}
