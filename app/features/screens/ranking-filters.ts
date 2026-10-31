import type { RankingFilters, RankingMetric, RankingOptions } from "../../api";

export type RankingSelection = {
  customerType: string; region: string; productLine: string; varieties: string[] | null; metric: RankingMetric;
};
export const initialRankingSelection: RankingSelection = {
  customerType: "ALL", region: "all", productLine: "all", varieties: null, metric: "AMOUNT",
};
// Prefix values only in the UI; the API uses explicit empty flags to preserve literal names.
export const rankingOptionValue = (value: string | null) => value === null ? "empty" : `value:${value}`;
export const rankingOptionText = (value: string) => value === "all" ? "全部" : value === "empty" ? "未填写" : value.slice(6);
export function rankingFilters(selection: RankingSelection): RankingFilters {
  return {
    customerType: selection.customerType, metric: selection.metric,
    ...(selection.region === "empty" ? { regionUnassigned: true } : selection.region === "all" ? {} : { regionCode: selection.region.slice(6) }),
    ...(selection.productLine === "empty" ? { productLineUnassigned: true } : selection.productLine === "all" ? {} : { productLine: selection.productLine.slice(6) }),
    ...(selection.varieties === null ? {} : {
      varieties: selection.varieties.filter(v => v !== "empty").map(v => v.slice(6)),
      includeUnspecifiedVariety: selection.varieties.includes("empty"),
    }),
  };
}
export function rankingChoices(options: RankingOptions | null) {
  const regions = new Map<string, string>();
  const lines = new Map<string, string>();
  const varieties = new Map<string, string>();
  for (const customer of options?.customers ?? []) regions.set(rankingOptionValue(customer.regionCode), customer.regionName);
  for (const product of options?.products ?? []) {
    lines.set(rankingOptionValue(product.productLine), product.productLine ?? "未填写");
    varieties.set(rankingOptionValue(product.varietyName), product.varietyName ?? "未填写");
  }
  const sorted = (values: Map<string, string>) => [...values].sort((a, b) => a[1].localeCompare(b[1], "zh-CN"));
  return { regions: sorted(regions), lines: sorted(lines), varieties: sorted(varieties),
    customerTypes: [...new Set((options?.customers ?? []).map(c => c.customerType))].filter(t => t === "GENERAL" || t === "SPECIAL") };
}
export function rankingSelectionKey(selection: RankingSelection) {
  return JSON.stringify({ ...selection, varieties: selection.varieties === null ? null : [...selection.varieties].sort() });
}
