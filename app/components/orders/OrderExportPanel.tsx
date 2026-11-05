"use client";

import { orderExportDownloadUrl, type OrderExportTask } from "../../api";
import { formatBeijingTime } from "../../features/shared/time";
import type { OrderManagementModel } from "./OrderManagement";

const statusNames: Record<string, string> = { PENDING: "排队中", RUNNING: "处理中", COMPLETED: "已完成", FAILED: "失败", EXPIRED: "已过期" };
const stageNames: Record<string, string> = { READING: "读取订单", COMPRESSING: "压缩文件", UPLOADING: "保存文件" };
export function exportFilterLabel(task: OrderExportTask) {
  const status = ({ SUBMITTED: "已提交", WITHDRAWN: "已撤回", VOIDED: "已作废" } as Record<string, string>)[task.filters.status || ""] || "全部状态";
  const customer = ({ GENERAL: "综合", SPECIAL: "特渠", ALL: "不区分客户类型" } as Record<string, string>)[task.filters.customerType || ""] || "全部客户类型";
  return `${status} / ${customer}${task.filters.keyword ? ` / 搜索：${task.filters.keyword}` : ""}`;
}
export function OrderExportPanel({ model }: { model: OrderManagementModel }) {
  if (!model.canExport || !model.activityFinished) return null;
  const exports = model.exports;
  return <section className="order-export-panel" aria-label="订单导出任务">
    <div className="order-export-title"><div><h3>订单导出任务</h3><p>生成包含四份 CSV 的 ZIP 包。可以关闭页面，完成后再回来下载；文件保留 24 小时。</p></div><button type="button" disabled={exports.loading} onClick={exports.refresh}>刷新导出记录</button></div>
    <p className="order-export-help">订单汇总和商品明细使用当前筛选条件；有效商品、有效分公司汇总始终仅统计已提交订单，并使用客户类型和搜索条件。数据以任务开始读取时的快照为准。</p>
    <details className="order-export-help"><summary>用 Excel 打开 CSV 的提示</summary><p>CSV 使用 UTF-8 编码。手机号、物料代码、长订单号等字段，请通过 Excel「数据 → 从文本/CSV」导入，并将这些列设为文本，以保留前导零和完整编号。</p></details>
    {exports.error && <div className="warning-box" role="alert">{exports.error}</div>}
    {exports.tasks.length === 0 ? <p className="order-export-help">{exports.loading ? "正在读取导出记录…" : "暂无导出任务，点击“导出订单”开始生成。"}</p> : <ul className="order-export-list">
      {exports.tasks.map(task => {
        const working = task.status === "PENDING" || task.status === "RUNNING";
        const downloadable = task.status === "COMPLETED" && Boolean(task.expiresAt && Date.parse(task.expiresAt) > exports.checkedAt);
        return <li key={task.id}>
          <div className="order-export-record"><b>#{task.id} · {task.cancelRequested && working ? "正在取消" : statusNames[task.status]}{task.status === "RUNNING" && !task.cancelRequested ? ` · ${stageNames[task.stage] || "生成文件"}` : ""}</b><span>{formatBeijingTime(task.createdAt)}</span></div>
          <p>{exportFilterLabel(task)}</p>
          <p>订单 {task.orderCount} 单 · 商品明细 {task.detailCount} 行{task.sheetCounts.length === 4 ? ` · 有效商品 ${task.sheetCounts[2]} 行 · 有效分公司 ${task.sheetCounts[3]} 行` : ""}</p>
          {task.snapshotAt && <p>数据快照：{formatBeijingTime(task.snapshotAt)}</p>}
          {task.failureMessage && <p className="order-export-failure">{task.failureMessage}</p>}
          <div className="order-export-record"><span>{task.expiresAt ? `保留至 ${formatBeijingTime(task.expiresAt)}` : ""}</span>
            {working && <button type="button" disabled={exports.busy || task.cancelRequested} onClick={() => void exports.cancel(task.id)}>{task.cancelRequested ? "正在取消…" : "取消任务"}</button>}
            {downloadable && <a className="order-export-download" href={orderExportDownloadUrl(model.activityId, task.id)} target="_blank" rel="noopener">下载 ZIP</a>}
          </div>
        </li>;
      })}
    </ul>}
  </section>;
}
