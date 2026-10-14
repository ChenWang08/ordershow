import type { Product, RebateFilter } from "./h5-domain";

export type CatalogSelection = { rebate: RebateFilter; line: string };
export const normalizeCatalogQuery = (value: string) => value.trim().toLocaleLowerCase("zh-CN");
export const catalogLine = (product: Product) => product.line.trim() || "未分类";

export function accessibleCatalog(products: Product[], customerType: string, unspecified: boolean, branch: string) {
  const unique = new Map<string, Product>();
  for (const product of products) {
    if ((product.status === "有效" || product.status === "待完善")
      && (unspecified || product.customerType === "全部" || product.customerType === customerType)
      && (product.branchScope.length === 0 || product.branchScope.includes(branch))) unique.set(product.id, product);
  }
  return [...unique.values()];
}

export function searchCatalog(products: Product[], query: string, browse: CatalogSelection, manual: CatalogSelection | null) {
  const keyword = normalizeCatalogQuery(query);
  const lineOptions = ["全部", ...new Set(products.map(catalogLine))];
  const hasRebateSplit = products.some(p => p.rebate === true) && products.some(p => p.rebate === false);
  const matches = keyword ? products.filter(p => [p.name, p.materialCode ?? "", catalogLine(p)]
    .some(value => value.toLocaleLowerCase("zh-CN").includes(keyword))) : products;
  const lines = new Set(matches.map(catalogLine));
  const rebates = new Set(matches.map(p => p.rebate));
  const automatic: CatalogSelection = {
    rebate: rebates.size === 1 && rebates.has(true) ? "PARTICIPATING"
      : rebates.size === 1 && rebates.has(false) ? "NOT_PARTICIPATING" : "ALL",
    line: lines.size === 1 ? [...lines][0] : "全部",
  };
  const chosen = keyword ? manual ?? automatic : browse;
  const selection: CatalogSelection = {
    rebate: !hasRebateSplit ? "ALL" : !keyword && chosen.rebate === "ALL" ? "PARTICIPATING" : chosen.rebate,
    line: lineOptions.includes(chosen.line) ? chosen.line : "全部",
  };
  const visibleProducts = matches.filter(p => (selection.line === "全部" || catalogLine(p) === selection.line)
    && (selection.rebate === "ALL" || p.rebate === "全部" || p.rebate === (selection.rebate === "PARTICIPATING")));
  return { lineOptions, hasRebateSplit, selection, visibleProducts, totalMatches: matches.length, searching: Boolean(keyword) };
}
