"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** One retained module per mounted activity. Hidden modules neither start nor finish reads. */
export function useLazyAdminQuery<T>(key: string, enabled: boolean,
  loader: (signal: AbortSignal) => Promise<T>, onLoaded?: (value: T) => void, preserveEdits = false) {
  const callbacks = useRef({ loader, onLoaded, preserveEdits });
  const session = useRef<{ key: string; enabled: boolean; loaded: boolean; dirty: boolean;
    controller?: AbortController; running?: Promise<T | undefined> } | null>(null);
  const [state, setState] = useState<{ key: string; data?: T; loaded: boolean; loading: boolean;
    stale: boolean; error: string; updatedAt: string | null } | null>(null);
  useEffect(() => { callbacks.current = { loader, onLoaded, preserveEdits }; }, [loader, onLoaded, preserveEdits]);
  const refresh = useCallback((): Promise<T | undefined> => {
    const current = session.current;
    if (!current || current.key !== key || !current.enabled) return Promise.resolve(undefined);
    if (current.running) return current.running;
    const controller = new AbortController();
    current.controller = controller;
    setState(previous => ({ key, data: previous?.key === key ? previous.data : undefined,
      loaded: current.loaded, loading: true, stale: current.dirty, error: "",
      updatedAt: previous?.key === key ? previous.updatedAt : null }));
    current.running = Promise.resolve().then(() => {
      if (!controller.signal.aborted) return callbacks.current.loader(controller.signal);
    }).then(data => {
      if (controller.signal.aborted || session.current !== current || data === undefined) return undefined;
      callbacks.current.onLoaded?.(data);
      current.loaded = true; current.dirty = false;
      setState({ key, data, loaded: true, loading: false, stale: false, error: "", updatedAt: new Date().toISOString() });
      return data;
    }).catch(error => {
      if (!controller.signal.aborted && session.current === current) {
        setState(previous => ({ key, data: previous?.key === key ? previous.data : undefined,
          loaded: current.loaded, loading: false, stale: current.dirty,
          error: error instanceof Error ? error.message : "加载失败，请重试",
          updatedAt: previous?.key === key ? previous.updatedAt : null }));
      }
      return undefined;
    }).finally(() => {
      if (current.controller === controller) { current.running = undefined; current.controller = undefined; }
    });
    return current.running;
  }, [key]);
  useEffect(() => {
    if (!session.current || session.current.key !== key) {
      session.current = { key, enabled, loaded: false, dirty: false };
    }
    session.current.enabled = enabled;
    const current = session.current;
    if (enabled && (!current.loaded || (current.dirty && !callbacks.current.preserveEdits))) void refresh();
    return () => {
      current.enabled = false;
      if (current.running) {
        if (current.loaded) current.dirty = true;
        setState(previous => previous?.key === key
          ? { ...previous, loading: false, stale: current.dirty } : previous);
      }
      current.controller?.abort(); current.controller = undefined; current.running = undefined;
    };
  }, [key, enabled, refresh]);
  const invalidate = useCallback(() => {
    const current = session.current;
    if (!current || current.key !== key) return;
    current.dirty = true;
    current.controller?.abort(); current.controller = undefined; current.running = undefined;
    setState(previous => previous?.key === key ? { ...previous, stale: true, loading: false } : previous);
  }, [key]);
  const current = state?.key === key ? state : null;
  return { data: current?.data, loaded: current?.loaded ?? false, loading: current?.loading ?? false,
    stale: current?.stale ?? false, error: current?.error ?? "", updatedAt: current?.updatedAt ?? null,
    refresh, invalidate };
}
