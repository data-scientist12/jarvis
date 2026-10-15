"use client";

import { useCallback, useEffect, useEffectEvent, useState } from "react";
import { api } from "@/components/utils/api";

/**
 * Tiny stale-while-revalidate GET hook (no extra dependency).
 *  - module-level cache so navigating back shows data instantly
 *  - `mutate(key)` revalidates every mounted hook watching that url
 *  - optional polling via `interval` (ms, or a function of the latest data; return false to stop)
 *  - a 401 anywhere redirects to /login (see components/utils/api.ts)
 */
const cache = new Map<string, unknown>();
const listeners = new Set<{ url: string; run: () => void }>();

/** Revalidate every mounted hook watching `key` (exact match, or the same path with a query string). */
export function mutate(key: string) {
  for (const l of listeners) if (l.url === key || l.url.startsWith(`${key}?`)) l.run();
}

export function setCached<T>(url: string, data: T) {
  cache.set(url, data);
}

type Options<T> = {
  interval?: number | false | ((data: T | undefined) => number | false);
  enabled?: boolean;
};

type State<T> = { key: string | null; data?: T; error?: Error };

export function useApi<T>(url: string | null, options: Options<T> = {}) {
  const { enabled = true } = options;
  const [state, setState] = useState<State<T>>(() => ({
    key: url,
    data: url ? (cache.get(url) as T | undefined) : undefined,
  }));

  const nextDelay = useEffectEvent((data: T | undefined): number | false => {
    const i = options.interval;
    if (typeof i === "function") return i(data);
    return i ?? false;
  });

  useEffect(() => {
    if (!url || !enabled) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let inflight = false;

    const schedule = (data: T | undefined) => {
      if (cancelled) return;
      const d = nextDelay(data);
      if (d) timer = setTimeout(run, d);
    };

    async function run() {
      if (inflight || cancelled) return;
      inflight = true;
      clearTimeout(timer);
      try {
        const data = await api<T>(url as string);
        if (cancelled) return;
        cache.set(url as string, data);
        setState({ key: url, data });
        schedule(data);
      } catch (e) {
        if (cancelled) return;
        setState((s) => ({ key: url, data: s.key === url ? s.data : undefined, error: e as Error }));
        schedule(undefined);
      } finally {
        inflight = false;
      }
    }

    const entry = { url, run: () => void run() };
    listeners.add(entry);
    void run();
    return () => {
      cancelled = true;
      clearTimeout(timer);
      listeners.delete(entry);
    };
  }, [url, enabled]);

  const current = state.key === url ? state : { key: url, data: url ? (cache.get(url) as T | undefined) : undefined, error: undefined };

  const update = useCallback(
    (fn: (prev: T | undefined) => T | undefined) => {
      if (!url) return;
      setState((s) => {
        const next = fn(s.key === url ? s.data : (cache.get(url) as T | undefined));
        if (next !== undefined) cache.set(url, next);
        return { key: url, data: next, error: s.error };
      });
    },
    [url],
  );

  return {
    data: current.data,
    error: current.error,
    loading: Boolean(url && enabled) && current.data === undefined && !current.error,
    update,
    refresh: useCallback(() => {
      if (url) mutate(url);
    }, [url]),
  };
}
