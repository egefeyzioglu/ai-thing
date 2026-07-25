"use client";

import {
  createTraceContext,
  formatTraceparent,
  type TraceContext,
} from "./trace";

type BrowserSpan = {
  attributes: Record<string, boolean | number | string | null>;
  durationMs: number;
  name:
    | "browser.javascript.error"
    | "browser.promise.unhandled_rejection"
    | "browser.trpc.request"
    | "browser.workshop.stream";
  outcome: "success" | "expected_error" | "unexpected_error";
  requestId?: string;
  startedAt: string;
  trace: TraceContext;
};

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function emitBrowserSpan(span: BrowserSpan): void {
  const body = JSON.stringify(span);
  if (navigator.sendBeacon) {
    const sent = navigator.sendBeacon(
      "/api/observability/spans",
      new Blob([body], { type: "application/json" }),
    );
    if (sent) return;
  }

  void fetch("/api/observability/spans", {
    body,
    headers: { "Content-Type": "application/json" },
    keepalive: true,
    method: "POST",
  }).catch(() => {
    // Telemetry must never break the user-facing operation.
  });
}

export function recordBrowserEvent(
  name:
    | "browser.javascript.error"
    | "browser.promise.unhandled_rejection",
  options: {
    attributes?: BrowserSpan["attributes"];
    outcome?: BrowserSpan["outcome"];
    parent?: TraceContext;
  } = {},
): void {
  emitBrowserSpan({
    attributes: options.attributes ?? {},
    durationMs: 0,
    name,
    outcome: options.outcome ?? "success",
    startedAt: new Date().toISOString(),
    trace: createTraceContext(options.parent),
  });
}

export async function tracedFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
  options: {
    attributes?: BrowserSpan["attributes"];
    finishOnBody?: boolean;
    name: "browser.trpc.request" | "browser.workshop.stream";
    parent?: TraceContext;
  },
): Promise<Response> {
  const trace = createTraceContext(options.parent);
  const requestInput = input instanceof Request ? input : undefined;
  const headers = new Headers(requestInput?.headers);
  new Headers(init.headers).forEach((value, key) => headers.set(key, value));
  headers.set("traceparent", formatTraceparent(trace));
  const httpMethod = init.method ?? requestInput?.method ?? "GET";
  const startedAt = new Date();
  const startedAtMs = performance.now();

  try {
    const response = await fetch(input, { ...init, headers });
    const finish = (
      outcome: BrowserSpan["outcome"],
      attributes: BrowserSpan["attributes"] = {},
    ) => {
      emitBrowserSpan({
        attributes: {
          ...options.attributes,
          ...attributes,
          httpMethod,
          httpStatusCode: response.status,
        },
        durationMs: performance.now() - startedAtMs,
        name: options.name,
        outcome,
        requestId: response.headers.get("x-request-id") ?? undefined,
        startedAt: startedAt.toISOString(),
        trace,
      });
    };

    if (options.finishOnBody && response.body) {
      const reader = response.body.getReader();
      const body = new ReadableStream<Uint8Array>({
        async pull(controller) {
          try {
            const result = await reader.read();
            if (result.done) {
              finish(response.ok ? "success" : "expected_error");
              controller.close();
            } else {
              controller.enqueue(result.value);
            }
          } catch (error) {
            finish(isAbortError(error) ? "expected_error" : "unexpected_error", {
              errorName: error instanceof Error ? error.name : "UnknownError",
            });
            controller.error(error);
          }
        },
        async cancel(reason) {
          finish("expected_error", { canceled: true });
          await reader.cancel(reason);
        },
      });
      return new Response(body, {
        headers: response.headers,
        status: response.status,
        statusText: response.statusText,
      });
    }

    finish(response.ok ? "success" : "expected_error");
    return response;
  } catch (error) {
    emitBrowserSpan({
      attributes: {
        ...options.attributes,
        errorName: error instanceof Error ? error.name : "UnknownError",
        httpMethod,
      },
      durationMs: performance.now() - startedAtMs,
      name: options.name,
      outcome: isAbortError(error) ? "expected_error" : "unexpected_error",
      startedAt: startedAt.toISOString(),
      trace,
    });
    throw error;
  }
}
