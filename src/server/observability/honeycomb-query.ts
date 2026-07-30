import "server-only";

import { env } from "src/env";

type QueryFilter = {
  column: string;
  op: string;
  value?: boolean | number | string | string[];
};

export type HoneycombQuerySpec = {
  breakdowns: string[];
  filters?: QueryFilter[];
  filter_combination?: "AND" | "OR";
  limit?: number;
  orders?: Array<{
    column?: string;
    op?: string;
    order?: "ascending" | "descending";
  }>;
  time_range: number;
};

type QueryResult = {
  complete: boolean;
  data?: {
    results?: Array<{ data?: Record<string, unknown> }>;
  };
  id: string;
  links?: { query_url?: string };
};

const REQUEST_TIMEOUT_MS = 10_000;
const RESULT_TIMEOUT_MS = 8_000;
const POLL_INTERVAL_MS = 250;

export class HoneycombQueryError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "HoneycombQueryError";
  }
}

function apiUrl(path: string): string {
  return `${env.HONEYCOMB_API_HOST}${path}`;
}

async function honeycombRequest<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const apiKey = env.HONEYCOMB_QUERY_API_KEY;
  if (!apiKey) {
    throw new HoneycombQueryError(
      "HONEYCOMB_QUERY_API_KEY is not configured",
      503,
    );
  }

  const response = await fetch(apiUrl(path), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "X-Honeycomb-Team": apiKey,
      ...init.headers,
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    const body = await response.text();
    console.error("[telemetry] Honeycomb query request failed", {
      path,
      status: response.status,
      body: body.slice(0, 500),
    });
    throw new HoneycombQueryError(
      response.status === 401 || response.status === 403
        ? "Honeycomb query key is missing the required permissions"
        : "Honeycomb query failed",
      response.status,
    );
  }

  return (await response.json()) as T;
}

function datasetPath(resource: string): string {
  return `/1/${resource}/${encodeURIComponent(env.HONEYCOMB_DATASET)}`;
}

export async function runHoneycombQuery(spec: HoneycombQuerySpec): Promise<{
  queryUrl: string | null;
  rows: Record<string, unknown>[];
}> {
  const query = await honeycombRequest<{ id: string }>(datasetPath("queries"), {
    body: JSON.stringify(spec),
    method: "POST",
  });
  const result = await honeycombRequest<QueryResult>(
    datasetPath("query_results"),
    {
      body: JSON.stringify({
        query_id: query.id,
        disable_series: true,
        limit: spec.limit ?? 100,
      }),
      method: "POST",
    },
  );

  let current = result;
  const deadline = Date.now() + RESULT_TIMEOUT_MS;
  while (!current.complete && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    current = await honeycombRequest<QueryResult>(
      `${datasetPath("query_results")}/${encodeURIComponent(result.id)}`,
    );
  }

  if (!current.complete) {
    throw new HoneycombQueryError("Honeycomb query timed out", 504);
  }

  return {
    rows:
      current.data?.results?.flatMap((resultRow) =>
        resultRow.data ? [resultRow.data] : [],
      ) ?? [],
    queryUrl: current.links?.query_url ?? null,
  };
}
