"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** Limits explicit clicks; automatic loads and mutation readbacks keep their own lifecycle. */
export function useManualRefresh(scope: string | null, blocked: boolean, action: () => unknown) {
  const [state, setState] = useState({ scope, coolingDown: false });
  if (state.scope !== scope) setState({ scope, coolingDown: false });
  const sessionRef = useRef<{ scope: string; coolingDown: boolean; timer?: number } | null>(null);

  useEffect(() => {
    if (scope === null) return;
    const session = { scope, coolingDown: false, timer: undefined as number | undefined };
    sessionRef.current = session;
    return () => {
      window.clearTimeout(session.timer);
      if (sessionRef.current === session) sessionRef.current = null;
    };
  }, [scope]);

  const refresh = useCallback(() => {
    const session = sessionRef.current;
    if (!session || session.scope !== scope || blocked || session.coolingDown) return;
    session.coolingDown = true;
    setState({ scope, coolingDown: true });
    session.timer = window.setTimeout(() => {
      if (sessionRef.current !== session) return;
      session.coolingDown = false;
      setState({ scope, coolingDown: false });
    }, 10_000);
    return action();
  }, [scope, blocked, action]);

  return { coolingDown: state.scope === scope && state.coolingDown, refresh };
}
