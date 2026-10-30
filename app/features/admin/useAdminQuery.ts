"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** Explicit reads only. Keep the last successful snapshot; deduplicate and cancel stale reads. */
export function useAdminQuery<T>(key: string | null, loader: (key: string, signal: AbortSignal) => Promise<T>) {
  const [state, setState] = useState<{ key: string; data?: T; loading: boolean; error: string; updatedAt: string | null } | null>(null);
  const sessionRef = useRef<{ key: string; loader: typeof loader; read: (force?: boolean) => Promise<T | undefined> } | null>(null);
  useEffect(() => {
    if (key === null) return;
    let active = true;
    let running: Promise<T | undefined> | null = null;
    let controller: AbortController | null = null;
    const session = { key, loader, read(force = false) {
      if (!active) return Promise.resolve(undefined);
      if (running && !force) return running;
      controller?.abort();
      const request = new AbortController();
      controller = request;
      setState(previous => ({ key, data: previous?.key === key ? previous.data : undefined,
        updatedAt: previous?.key === key ? previous.updatedAt : null, loading: true, error: "" }));
      running = Promise.resolve().then(() => active && !request.signal.aborted ? loader(key, request.signal) : undefined)
        .then(data => {
          if (!active || request.signal.aborted || data === undefined) return undefined;
          setState({ key, data, loading: false, error: "", updatedAt: new Date().toISOString() });
          return data;
        }).catch(error => {
          if (active && !request.signal.aborted) setState(previous => ({ key, data: previous?.key === key ? previous.data : undefined,
            updatedAt: previous?.key === key ? previous.updatedAt : null, loading: false,
            error: error instanceof Error ? error.message : "加载失败，请重试" }));
          request.abort();
          return undefined;
        }).finally(() => { if (controller === request) running = null; });
      return running;
    } };
    sessionRef.current = session;
    return () => { active = false; controller?.abort(); if (sessionRef.current === session) sessionRef.current = null; };
  }, [key, loader]);
  const refresh = useCallback((force = false) => sessionRef.current?.key === key && sessionRef.current.loader === loader
    ? sessionRef.current.read(force) : Promise.resolve(undefined), [key, loader]);
  const current = key !== null && state?.key === key ? state : null;
  return { data: current?.data, loading: current?.loading ?? false, error: current?.error ?? "",
    updatedAt: current?.updatedAt ?? null, refresh };
}
