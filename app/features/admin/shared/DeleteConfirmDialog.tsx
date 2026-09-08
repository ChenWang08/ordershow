"use client";

import { type DeleteTarget } from "../../../domain/import-domain";

export function DeleteConfirmDialog({ target, onCancel, onConfirm }: { target: DeleteTarget; onCancel: () => void; onConfirm: () => void }) {
  const labelPreview = target.labels.slice(0, 3).join("、");
  const extraCount = target.labels.length - 3;
  const countLabel = target.label ?? (target.ids.length === 1 ? target.kind : `${target.ids.length} 条${target.kind}`);
  return (
    <div className="delete-confirm" role="dialog" aria-modal="true" aria-label={`删除${target.kind}确认`} onClick={onCancel}>
      <div onClick={(event) => event.stopPropagation()}>
        <span className="delete-confirm-eyebrow">删除{target.kind}</span>
        <h3>确认删除{countLabel}？</h3>
        <p>{target.description ?? "删除后将从当前活动的可下单或身份验证列表中移除，已有订单不会被删除，订单明细和金额保持不变。"}</p>
        <div className="delete-confirm-items">
          <b>{labelPreview || countLabel}{extraCount > 0 ? ` 等 ${extraCount} 条` : ""}</b>
          <small>{target.summary ?? `已选择 ${target.ids.length} 条`}</small>
        </div>
        <div className="delete-confirm-actions">
          <button type="button" onClick={onCancel}>取消</button>
          <button type="button" className="delete-confirm-danger" onClick={onConfirm}>确认删除</button>
        </div>
      </div>
    </div>
  );
}
