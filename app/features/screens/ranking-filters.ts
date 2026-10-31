import type { RankingFilters, RankingMetric, RankingOptions } from "../../api";

export type RankingSelection = {
  customerType: string; region: string; productLine: string; varieties: string[] | null; metric: RankingMetric;
};
export const initialRankingSelection: RankingSelection = {
  customerType: "ALL", region: "all", productLine: "all", varieties: null, metric: "AMOUNT",
};
// Prefix values only in the UI; the API uses explicit empty flags to preserve literal names.
export const rankingOptionValue = (value: string | null | undefined) => value == null || value.trim() === "" ? "empty" : `value:${value.trim()}`;
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
export function changeRankingSelection(selection: RankingSelection, patch: Partial<RankingSelection>): RankingSelection {
  const next = { ...selection, ...patch };
  if (next.customerType !== selection.customerType) return { ...next, region: "all", productLine: "all", varieties: null };
  if (next.region !== selection.region) return { ...next, productLine: "all", varieties: null };
  if (next.productLine !== selection.productLine) return { ...next, varieties: null };
  return next;
}
export function rankingChoices(options: RankingOptions | null, selection = initialRankingSelection, productsReady = true) {
  const regions = new Map<string, string>();
  const lines = new Map<string, string>();
  const varieties = new Map<string, string>();
  const label = (value: string, text: string, dimension: string) => value === "empty" ? "未填写"
    : ["全部", "未填写", "全部品种"].includes(text) ? `${text}（${dimension}名称）` : text;
  for (const customer of options?.customers ?? []) {
    if (selection.customerType !== "ALL" && customer.customerType !== selection.customerType) continue;
    const value = rankingOptionValue(customer.regionCode);
    regions.set(value, label(value, customer.regionName, "大区"));
  }
  for (const product of productsReady ? options?.products ?? [] : []) {
    const line = rankingOptionValue(product.productLine), variety = rankingOptionValue(product.varietyName);
    lines.set(line, label(line, rankingOptionText(line), "项目组"));
    if (selection.productLine === "all" || selection.productLine === line)
      varieties.set(variety, label(variety, rankingOptionText(variety), "品种"));
  }
  const sorted = (values: Map<string, string>) => [...values].sort((a, b) => a[1].localeCompare(b[1], "zh-CN"));
  return { regions: sorted(regions), lines: sorted(lines), varieties: sorted(varieties),
    customerTypes: [...new Set((options?.customers ?? []).map(c => c.customerType))].filter(t => t === "GENERAL" || t === "SPECIAL") };
}
export function rankingSelectionKey(selection: RankingSelection) {
  return JSON.stringify({ ...selection, varieties: selection.varieties === null ? null : [...selection.varieties].sort() });
}
