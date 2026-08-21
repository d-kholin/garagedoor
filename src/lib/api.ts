"use client";

import useSWR from "swr";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function parseError(res: Response): Promise<never> {
  let message = `${res.status} ${res.statusText}`;
  try {
    const data = await res.json();
    if (data?.error) message = typeof data.error === "string" ? data.error : JSON.stringify(data.error);
  } catch {
    // keep default message
  }
  throw new ApiError(res.status, message);
}

export async function getFetcher<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) await parseError(res);
  return res.json();
}

/** POST to a Garage admin endpoint through the server-side proxy. */
export async function garagePost<T = unknown>(
  endpoint: string,
  opts: { params?: Record<string, string>; body?: unknown } = {},
): Promise<T> {
  const qs = new URLSearchParams(opts.params ?? {}).toString();
  const res = await fetch(`/api/garage/${endpoint}${qs ? `?${qs}` : ""}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(opts.body ?? {}),
  });
  if (!res.ok) await parseError(res);
  return res.json();
}

/** Subscribe to a GET Garage admin endpoint through the server-side proxy. */
export function useGarage<T>(
  endpoint: string | null,
  opts: { params?: Record<string, string>; refreshInterval?: number } = {},
) {
  const qs = opts.params ? new URLSearchParams(opts.params).toString() : "";
  const key = endpoint ? `/api/garage/${endpoint}${qs ? `?${qs}` : ""}` : null;
  return useSWR<T>(key, getFetcher, {
    refreshInterval: opts.refreshInterval,
    keepPreviousData: true,
  });
}

/**
 * Subscribe to a POST-based Garage admin endpoint (e.g. ListWorkers).
 * SWR key includes the body so distinct queries don't collide.
 */
export function useGaragePost<T>(
  endpoint: string | null,
  opts: {
    params?: Record<string, string>;
    body?: unknown;
    refreshInterval?: number;
  } = {},
) {
  const key = endpoint
    ? ["post", endpoint, JSON.stringify(opts.params ?? {}), JSON.stringify(opts.body ?? {})]
    : null;
  return useSWR<T>(
    key,
    () => garagePost<T>(endpoint!, { params: opts.params, body: opts.body }),
    { refreshInterval: opts.refreshInterval, keepPreviousData: true },
  );
}
