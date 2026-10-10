/** Keep in sync with backend ProductCompleteness: only price and conversion determine completeness. */
export function positiveProductNumber(value: unknown): number | null {
  const text = String(value ?? "").trim().replaceAll(",", "");
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(text)) return null;
  const number = Number(text);
  return Number.isFinite(number) && number > 0 ? number : null;
}
export function productCompletenessStatus(casePrice: unknown, conversion: unknown): "有效" | "待完善" {
  return positiveProductNumber(casePrice) === null || positiveProductNumber(conversion) === null ? "待完善" : "有效";
}
