import "server-only";

import { TRPCError } from "@trpc/server";

import { env } from "src/env";

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
  timestamp: string;
  traceId?: string;
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
    | "traceId"
    | "usageId"
    | "userId"
  >
>;

const SECRET_PATTERNS = [
  /\b(?:sk|key|token|secret)[-_][A-Za-z0-9_-]{12,}\b/gi,
  /\bBearer\s+[A-Za-z0-9._~+/=-]+\b/gi,
  /https?:\/\/[^\s]+(?:token|signature|x-amz-signature)=[^\s&]+/gi,
];

function redactMessage(value: string): string {
  let redacted = value.slice(0, 1_000);
  for (const pattern of SECRET_PATTERNS) {
    redacted = redacted.replace(pattern, "[REDACTED]");
  }
  return redacted;
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

async function sendToHoneycomb(event: WideEvent): Promise<void> {
  if (!env.HONEYCOMB_API_KEY || !env.HONEYCOMB_DATASET) {
    if (env.NODE_ENV !== "production") {
      console.info(JSON.stringify(event));
    }
    return;
  }

  try {
    const response = await fetch(
      `${env.HONEYCOMB_API_HOST}/1/events/${encodeURIComponent(env.HONEYCOMB_DATASET)}`,
      {
        body: JSON.stringify(event),
        headers: {
          "Content-Type": "application/json",
          "X-Honeycomb-Team": env.HONEYCOMB_API_KEY,
        },
        method: "POST",
        signal: AbortSignal.timeout(2_000),
      },
    );

    if (!response.ok) {
      console.error("[observability] Honeycomb rejected event", {
        eventId: event.eventId,
        status: response.status,
      });
    }
  } catch (error) {
    console.error("[observability] Failed to emit Honeycomb event", {
      eventId: event.eventId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export class WideEventBuilder {
  readonly #attributes: Record<string, JsonValue> = {};
  readonly #context: EventContext;
  readonly #eventId = crypto.randomUUID();
  readonly #eventName: string;
  readonly #startedAt = Date.now();
  #emitted = false;
  #error: WideEventError | undefined;
  #outcome: EventOutcome = "success";

  constructor(eventName: string, context: EventContext = {}) {
    this.#eventName = eventName;
    this.#context = context;
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

  async emit(): Promise<void> {
    if (this.#emitted) return;
    this.#emitted = true;

    await sendToHoneycomb({
      schemaVersion: 1,
      eventId: this.#eventId,
      eventName: this.#eventName,
      timestamp: new Date().toISOString(),
      service: "ai-thing",
      environment: env.NODE_ENV,
      release: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
      operation: this.#eventName,
      outcome: this.#outcome,
      durationMs: Date.now() - this.#startedAt,
      ...this.#context,
      ...(this.#error && { error: this.#error }),
      attributes: this.#attributes,
    });
  }
}

export function createWideEvent(
  eventName: string,
  context: EventContext = {},
): WideEventBuilder {
  return new WideEventBuilder(eventName, context);
}
