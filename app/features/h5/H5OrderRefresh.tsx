"use client";

import type { H5OrderModel } from "./useH5OrderFlow";
import { formatBeijingTime } from "../shared/time";

export function H5OrderRefresh({ model }: { model: H5OrderModel }) {
  const disabled = model.runtimeBusy || model.orderSyncBusy || model.cooldownSeconds > 0
    || model.pendingSubmission || model.orderNeedsRefresh;
  return <div className="h5-order-refresh">
    <button type="button" className="ghost-btn" disabled={disabled} onClick={() => void model.refreshOrderStatus()}>
      {model.orderSyncBusy ? "刷新中…" : model.cooldownSeconds > 0 ? `刷新状态（${model.cooldownSeconds}秒）` : "刷新状态"}
    </button>
    <p>订单和审核结果不会自动更新，请刷新状态或重新进入页面查看。</p>
    <small>最后同步：{model.lastSuccessAt ? formatBeijingTime(new Date(model.lastSuccessAt).toISOString()) : "尚未同步"}</small>
  </div>;
}
