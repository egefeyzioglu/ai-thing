export type TraceContext = {
  parentSpanId?: string;
  spanId: string;
  traceFlags: string;
  traceId: string;
};

const TRACEPARENT_PATTERN =
  /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/i;

function randomHex(bytes: number): string {
  while (true) {
    const values = crypto.getRandomValues(new Uint8Array(bytes));
    const value = Array.from(values, (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
    if (!/^0+$/.test(value)) return value;
  }
}

export function createTraceContext(parent?: TraceContext): TraceContext {
  return {
    traceId: parent?.traceId ?? randomHex(16),
    spanId: randomHex(8),
    traceFlags: parent?.traceFlags ?? "01",
    ...(parent && { parentSpanId: parent.spanId }),
  };
}

export function formatTraceparent(context: TraceContext): string {
  return `00-${context.traceId}-${context.spanId}-${context.traceFlags}`;
}

export function parseTraceparent(value: string | null): TraceContext | null {
  if (!value) return null;
  const match = TRACEPARENT_PATTERN.exec(value.trim());
  if (!match?.[1] || !match[2]) return null;
  if (/^0+$/.test(match[1]) || /^0+$/.test(match[2])) return null;

  return {
    traceId: match[1].toLowerCase(),
    spanId: match[2].toLowerCase(),
    traceFlags: match[3]?.toLowerCase() ?? "00",
  };
}
