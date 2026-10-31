"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "../../api";

type ScreenState<T, P> = {
  activityId: number | null;
  data: T | null;
  parameters: P | null;
  error: string;
  refreshing: boolean;
  refreshedAt: string | null;
};

/** Optional first load; subsequent reads are explicit and share any in-flight request. */
export function useManualScreenData<T, P>(
  activityId: number | null,
  loader: (parameters: P, signal: AbortSignal) => Promise<T>,
  initialParameters: P,
  failureMessage: string,
  enabled = true,
  autoLoad = true,
) {
  const [state, setState] = useState<ScreenState<T, P>>({
    activityId: null, data: null, parameters: null, error: "", refreshing: false, refreshedAt: null,
  });
  const sessionRef = useRef<{ activityId: number; read: (parameters: P) => Promise<void> } | null>(null);

  useEffect(() => {
    if (activityId === null || !enabled) return;
    let active = true;
    let running: Promise<void> | null = null;
    const controller = new AbortController();
    const session = {
      activityId,
      read(parameters: P): Promise<void> {
        if (!active) return Promise.resolve();
        if (running) return running;
        setState(previous => ({
          ...(previous.activityId === activityId ? previous : {
            activityId, data: null, parameters: null, refreshedAt: null,
          }),
          error: "", refreshing: true,
        }));
        running = Promise.resolve()
          .then(() => active ? loader(parameters, controller.signal) : undefined)
          .then(data => {
            if (active && data !== undefined) {
              setState({ activityId, data, parameters, error: "", refreshing: false, refreshedAt: new Date().toISOString() });
            }
          })
          .catch(reason => {
            if (active) setState(previous => ({
              ...previous, error: reason instanceof ApiError ? reason.message : failureMessage, refreshing: false,
            }));
          })
          .finally(() => { running = null; });
        return running;
      },
    };
    sessionRef.current = session;
    // Defer the initial read so a discarded mount cannot start a redundant request.
    if (autoLoad) void Promise.resolve().then(() => session.read(initialParameters));
    else void Promise.resolve().then(() => {
      if (active && !running) setState({ activityId, data: null, parameters: null, error: "", refreshing: false, refreshedAt: null });
    });
    return () => {
      active = false;
      controller.abort();
      if (sessionRef.current === session) sessionRef.current = null;
    };
  }, [activityId, enabled, loader, initialParameters, failureMessage, autoLoad]);

  const refresh = useCallback((parameters: P = initialParameters) => {
    const session = sessionRef.current;
    return enabled && session?.activityId === activityId ? session.read(parameters) : Promise.resolve();
  }, [activityId, enabled, initialParameters]);
  const current = enabled && state.activityId === activityId;
  return {
    data: current ? state.data : null,
    parameters: current ? state.parameters : null,
    error: current ? state.error : "",
    refreshing: enabled && activityId !== null && (current ? state.refreshing : autoLoad),
    refreshedAt: current ? state.refreshedAt : null,
    refresh,
  };
}
