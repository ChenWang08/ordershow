"use client";
import { useCallback, useState } from "react";
import type { RosterPage, RosterQuery } from "../../api";

export const initialRosterQuery = (): RosterQuery => ({ page: 1, size: 50, customerType: "", branch: "", status: "", matchStatus: "", keyword: "" });
export function useRosterState<T>(scope: string) {
  const [state, setState] = useState(() => ({ scope, query: initialRosterQuery(), revision: 0,
    response: null as RosterPage<T> | null, loadedQuery: "" }));
  if (state.scope !== scope) setState({ scope, query: initialRosterQuery(), revision: 0, response: null, loadedQuery: "" });
  const current = state.scope === scope ? state : { scope, query: initialRosterQuery(), revision: 0, response: null, loadedQuery: "" };
  const change = useCallback((patch: Partial<RosterQuery>) => setState(previous => {
    const query = { ...previous.query, ...patch };
    return JSON.stringify(query) === JSON.stringify(previous.query) ? previous : { ...previous, query, loadedQuery: "" };
  }), []);
  const reload = useCallback((reset = false) => setState(previous => ({ ...previous, revision: previous.revision + 1,
    query: reset ? { ...previous.query, page: 1 } : previous.query, loadedQuery: "" })), []);
  const apply = useCallback((response: RosterPage<T>, query: RosterQuery) => setState(previous => {
    if (previous.scope !== scope || JSON.stringify(previous.query) !== JSON.stringify(query)) return previous;
    const nextQuery = { ...query, page: response.page.number };
    return { ...previous, query: nextQuery, response, loadedQuery: JSON.stringify(nextQuery) };
  }), [scope]);
  return { query: current.query, response: current.response,
    page: current.loadedQuery === JSON.stringify(current.query) ? current.response : null,
    entryKey: JSON.stringify([current.query, current.revision]), change, reload, apply };
}
export type RosterState<T> = ReturnType<typeof useRosterState<T>>;
