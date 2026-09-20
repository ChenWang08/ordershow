"use client";

import { useEffect, useState } from "react";
import { loadAdminDashboard, type DashboardData } from "../../api";
import { type WhitelistRow, whitelistCustomerTypeMode } from "../../domain/import-domain";
import { money } from "../shared/utils";

// Keep this hook mounted with the admin shell so tab changes preserve polling state.
export function useActivityOverview(activityId: string, whitelistRows: WhitelistRow[]) {
  const whitelistMode = whitelistCustomerTypeMode(whitelistRows);
  const [overviewDashboard, setOverviewDashboard] = useState<DashboardData | null>(null);
  const [overviewByType, setOverviewByType] = useState<{ GENERAL: DashboardData | null; SPECIAL: DashboardData | null }>({ GENERAL: null, SPECIAL: null });
  useEffect(() => {
    let active = true;
    const refreshOverview = async () => {
      try {
        const [all, general, special] = await Promise.all([
          loadAdminDashboard(Number(activityId)), loadAdminDashboard(Number(activityId), { customerType: "GENERAL" }), loadAdminDashboard(Number(activityId), { customerType: "SPECIAL" }),
        ]);
        if (active) {
          setOverviewDashboard(all);
          setOverviewByType({ GENERAL: general, SPECIAL: special });
        }
      } catch {
        if (active) { setOverviewDashboard(null); setOverviewByType({ GENERAL: null, SPECIAL: null }); }
      }
    };
    void refreshOverview();
    const timer = window.setInterval(refreshOverview, 10_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [activityId]);
  const overviewTotals = overviewDashboard?.totals;
  const submittedCustomers = Number(overviewTotals?.order_count ?? 0);
  const totalActiveCustomers = whitelistRows.filter((row) => row.status === "有效").length;
  const progressRows = ([
    ["全部客户", "ALL"], ["综合客户", "GENERAL"], ["特渠专业客户", "SPECIAL"],
  ] as const).map(([label, type]) => {
    if (type === "ALL") return { label, total: totalActiveCustomers, submitted: submittedCustomers, percentage: totalActiveCustomers > 0 ? Math.min(100, submittedCustomers / totalActiveCustomers * 100) : 0 };
    if (whitelistMode === "UNSPECIFIED") return { label, total: 0, submitted: 0, percentage: 0 };
    const total = whitelistRows.filter((row) => row.status === "有效" && (type === "GENERAL" ? row.customerType === "综合客户" : row.customerType === "特渠专业客户")).length;
    const submitted = Number(overviewByType[type]?.totals.order_count ?? 0);
    return { label, total, submitted, percentage: total > 0 ? Math.min(100, submitted / total * 100) : 0 };
  });
  const adminStats = [
    ["订单总金额", `¥${money(Number(overviewTotals?.total_amount ?? 0))}`, "当前有效已提交订单"],
    ["已提交客户", submittedCustomers.toLocaleString("zh-CN"), totalActiveCustomers > 0 ? `${(submittedCustomers / totalActiveCustomers * 100).toFixed(1)}% 白名单已提交` : "当前提交客户"],
    ["订货总箱数", Number(overviewTotals?.total_quantity ?? 0).toLocaleString("zh-CN"), "当前有效已提交订单"],
    ["订货总吨数", overviewTotals?.total_tons == null ? "—" : Number(overviewTotals.total_tons).toLocaleString("zh-CN", { minimumFractionDigits: 1, maximumFractionDigits: 3 }), overviewTotals?.total_tons == null ? "部分商品缺少吨箱系数" : "当前有效已提交订单"],
  ];
  return { adminStats, progressRows };
}
