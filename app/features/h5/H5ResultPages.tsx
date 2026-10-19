"use client";

import type { H5OrderModel } from "./useH5OrderFlow";
import { money } from "../shared/utils";

export function H5ResultPages({ model }: { model: H5OrderModel }) {
  const { runtimeOrder, runtimeBusy, runtimeMessage, setStep, resetEntry, submitMode, cancelConfirmOpen, setCancelConfirmOpen, visibleStep, selected, totalBoxes, totalAmount, withdrawOrder } = model;
  return <>
          {visibleStep === "success" && (
            <section className="h5-page success-page">
              <div className="success-mark">✓</div>
              <span>{submitMode === "first" ? "提交成功" : submitMode === "restore" ? "恢复成功" : "修改成功"}</span>
              <h2>{submitMode === "first" ? "您的订货已成功提交" : submitMode === "restore" ? "订单已恢复，订单号不变" : "订单已更新并生效"}</h2>
              <p>订单编号：{runtimeOrder?.orderNo || "ZYORDER280018"}</p>
              <div className="success-amount"><span>订单总金额</span><b>¥{money(runtimeOrder?.totalAmount ?? totalAmount)}</b><small>{totalBoxes} 箱 · {selected.length} 种商品</small></div>
              <div className="success-note">订单已生效。截止前增加数量或新增商品直接生效；减少、删除商品或取消订货需后台审核。</div>
              <button className="primary-btn" onClick={() => setStep("submitted")}>查看订单</button>
              <button className="ghost-btn" disabled={runtimeBusy} onClick={() => void resetEntry()}>返回活动首页</button>
            </section>
          )}
          {cancelConfirmOpen && (
            <div className="h5-modal-layer" role="dialog" aria-modal="true" aria-label="取消本次订货确认">
              <div className="h5-modal">
                <h3>确认取消本次订货？</h3>
                <p>不会生成空订单；系统会提交撤回申请，审核通过后保留最近一次非空提交的商品、金额和订单号，并将当前订单标记为已撤回。</p>
                {runtimeMessage && <div className="verify-error" role="alert">{runtimeMessage}</div>}
                <div><button className="ghost-btn" onClick={() => setCancelConfirmOpen(false)}>继续修改</button><button className="primary-btn" disabled={runtimeBusy} onClick={() => void withdrawOrder()}>{runtimeBusy ? "正在处理…" : "确认取消"}</button></div>
              </div>
            </div>
          )}
  </>;
}
