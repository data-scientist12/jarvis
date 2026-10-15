"use client";

/** Thrown by `api()` for non-2xx responses. */
export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, message: string, body?: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

function goToLogin() {
  if (typeof window === "undefined") return;
  const here = window.location.pathname + window.location.search;
  if (window.location.pathname.startsWith("/login")) return;
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- full reload clears client caches
  window.location.href = `/login?next=${encodeURIComponent(here)}`;
}

/** JSON fetch with session handling: a 401 redirects to /login. */
export async function api<T = unknown>(url: string, init?: Omit<RequestInit, "body"> & { json?: unknown; body?: BodyInit | null }): Promise<T> {
  const { json, headers, ...rest } = init ?? {};
  const res = await fetch(url, {
    credentials: "same-origin",
    ...rest,
    headers: { ...(json !== undefined ? { "content-type": "application/json" } : {}), ...headers },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  if (res.status === 401) {
    goToLogin();
    throw new ApiError(401, "Please sign in again.");
  }
  let data: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!res.ok) {
    const obj = (data ?? {}) as { error?: string; message?: string; retryAfter?: number };
    const msg =
      res.status === 429
        ? "Jarvis needs a breather. Try again in a minute."
        : obj.message || (typeof obj.error === "string" ? obj.error.replace(/_/g, " ") : "") || `Request failed (${res.status})`;
    throw new ApiError(res.status, msg, data);
  }
  return data as T;
}
