"use client";
import { useEffect, useMemo, useState } from "react";
import type { Product, RebateFilter } from "./h5-domain";
import { accessibleCatalog, normalizeCatalogQuery, searchCatalog, type CatalogSelection } from "./h5-catalog-search";

function initialSearch(scope: string) {
  return { scope, input: "", settled: "", composing: false,
    browse: { rebate: "PARTICIPATING", line: "全部" } as CatalogSelection,
    manual: null as CatalogSelection | null };
}

export function useH5CatalogSearch(catalog: Product[], customerType: string, unspecified: boolean, branch: string, scope: string, enabled: boolean) {
  const [state, setState] = useState(() => initialSearch(scope));
  if (state.scope !== scope) setState(initialSearch(scope));
  const current = state.scope === scope ? state : initialSearch(scope);
  const products = useMemo(() => accessibleCatalog(catalog, customerType, unspecified, branch), [catalog, customerType, unspecified, branch]);
  useEffect(() => {
    if (!enabled || state.scope !== scope || state.composing || state.input === state.settled) return;
    const timer = setTimeout(() => setState(previous => previous.scope === scope && previous.input === state.input && !previous.composing
      ? { ...previous, settled: previous.input, manual: null } : previous), 300);
    return () => clearTimeout(timer);
  }, [enabled, scope, state.scope, state.input, state.settled, state.composing]);
  const result = useMemo(() => searchCatalog(products, current.settled, current.browse, current.manual),
    [products, current.settled, current.browse, current.manual]);
  const setSearch = (input: string) => setState(previous => ({ ...previous, input,
    ...(normalizeCatalogQuery(input) ? {} : { settled: "", manual: null }) }));
  const choose = (patch: Partial<CatalogSelection>) => setState(previous => result.searching
    ? { ...previous, manual: { ...result.selection, ...patch } }
    : { ...previous, browse: { ...result.selection, ...patch } });
  return {
    ...result, scope, search: current.input, searchPending: current.composing || normalizeCatalogQuery(current.input) !== normalizeCatalogQuery(current.settled),
    searchResultKey: `${scope}:${normalizeCatalogQuery(current.settled)}`,
    setSearch, setLine: (line: string) => choose({ line }),
    setRebateFilter: (rebate: RebateFilter) => choose({ rebate }),
    showAllSearchResults: () => choose({ rebate: "ALL", line: "全部" }),
    startSearchComposition: () => setState(previous => ({ ...previous, composing: true })),
    endSearchComposition: (input: string) => setState(previous => ({ ...previous, composing: false, input,
      ...(normalizeCatalogQuery(input) ? {} : { settled: "", manual: null }) })),
    submitSearch: () => setState(previous => previous.composing ? previous : { ...previous, settled: previous.input, manual: null }),
  };
}
