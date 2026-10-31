"use client";

import { loadActivityOverview } from "../../api";
import { money } from "../shared/utils";
import { useLazyAdminQuery } from "./useLazyAdminQuery";

// Keep the snapshot between visits, but read current statistics on every entry.
export function useActivityOverview(activityId: string, enabled = true) {
  const query = useLazyAdminQuery(activityId, enabled, signal => loadActivityOverview(Number(activityId), signal));
  const { data } = query;
  const context = data;
  const overviewTotals = data?.totals;
  const submittedCustomers = Number(overviewTotals?.order_count ?? 0);
  const totalActiveCustomers = context?.customerCount ?? 0;
  const progressRows = ([
    ["全部客户", "ALL"], ["综合客户", "GENERAL"], ["特渠专业客户", "SPECIAL"],
  ] as const).map(([label, type]) => {
    if (type === "ALL") return { label, total: totalActiveCustomers, submitted: submittedCustomers, percentage: totalActiveCustomers > 0 ? Math.min(100, submittedCustomers / totalActiveCustomers * 100) : 0 };
    if (context?.customerTypeMode === "UNSPECIFIED") return { label, total: 0, submitted: 0, percentage: 0 };
    const total = context?.customersByType[type] ?? 0;
    const submitted = Number(data?.submittedByType[type] ?? 0);
    return { label, total, submitted, percentage: total > 0 ? Math.min(100, submitted / total * 100) : 0 };
  });
  const adminStats = [
    ["订单总金额", `¥${money(Number(overviewTotals?.total_amount ?? 0))}`, "当前有效已提交订单"],
    ["已提交客户", submittedCustomers.toLocaleString("zh-CN"), totalActiveCustomers > 0 ? `${(submittedCustomers / totalActiveCustomers * 100).toFixed(1)}% 白名单已提交` : "当前提交客户"],
    ["订货总箱数", Number(overviewTotals?.total_quantity ?? 0).toLocaleString("zh-CN"), "当前有效已提交订单"],
    ["订货总吨数", overviewTotals?.total_tons == null ? "—" : Number(overviewTotals.total_tons).toLocaleString("zh-CN", { minimumFractionDigits: 1, maximumFractionDigits: 3 }), overviewTotals?.total_tons == null ? "部分商品缺少吨箱系数" : "当前有效已提交订单"],
  ].map(([label, value, hint]) => [label, data ? value : "—", data ? hint : "尚未加载"]);
  return { ...query, loaded: Boolean(data), adminStats, progressRows };
}
