"use client";

import { loadAdminDashboard, loadModuleContext } from "../../api";
import { money } from "../shared/utils";
import { useAdminQuery } from "./useAdminQuery";

async function readOverview(activityId: string, signal: AbortSignal) {
  const [all, general, special, context] = await Promise.all([
    loadAdminDashboard(Number(activityId), {}, signal),
    loadAdminDashboard(Number(activityId), { customerType: "GENERAL" }, signal),
    loadAdminDashboard(Number(activityId), { customerType: "SPECIAL" }, signal),
    loadModuleContext(Number(activityId), signal),
  ]);
  return { all, general, special, context };
}

// Keep the snapshot mounted with the shell; returning to the tab never starts a read.
export function useActivityOverview(activityId: string, enabled = true) {
  const query = useAdminQuery(enabled ? activityId : null, readOverview);
  const { data } = query;
  const context = data?.context;
  const overviewTotals = data?.all.totals;
  const submittedCustomers = Number(overviewTotals?.order_count ?? 0);
  const totalActiveCustomers = context?.customerCount ?? 0;
  const progressRows = ([
    ["全部客户", "ALL"], ["综合客户", "GENERAL"], ["特渠专业客户", "SPECIAL"],
  ] as const).map(([label, type]) => {
    if (type === "ALL") return { label, total: totalActiveCustomers, submitted: submittedCustomers, percentage: totalActiveCustomers > 0 ? Math.min(100, submittedCustomers / totalActiveCustomers * 100) : 0 };
    if (context?.customerTypeMode === "UNSPECIFIED") return { label, total: 0, submitted: 0, percentage: 0 };
    const total = context?.customersByType[type] ?? 0;
    const submitted = Number((type === "GENERAL" ? data?.general : data?.special)?.totals.order_count ?? 0);
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
