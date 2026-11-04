"use client";

import { useState } from "react";
import { useDrawerClose } from "../../components/useDrawerClose";
import { useAdminIdentity } from "../../admin-context";
import { copySelectionValid } from "./useActivityCopy";
import type { useAdminActivities } from "./useAdminActivities";

const statusLabels: Record<string, string> = { DRAFT: "草稿", SCHEDULED: "待开始", ACTIVE: "订货中", CLOSED: "订货已截止", FINISHED: "已结束", ARCHIVED: "已归档" };
export function NewActivityDrawer({ activities }: { activities: ReturnType<typeof useAdminActivities> }) {
  const identity = useAdminIdentity();
  const { creatingActivity, setNewActivityOpen, newActivity, setNewActivity, departments, minimumFutureAt, submitNewActivity, copy } = activities;
  const [initialActivity] = useState(newActivity);
  const requestClose = useDrawerClose(newActivity, () => { setNewActivity(initialActivity); setNewActivityOpen(false); }, creatingActivity);
  const locked = creatingActivity || Boolean(copy.task || copy.pending);
  const preview = copy.preview;
  const canCopy = copySelectionValid(preview, copy.sourceId, copy.selection);
  return <div className="drawer-backdrop"><aside className="form-drawer compact-drawer" onClick={event => event.stopPropagation()}>
    <header><div><span>多活动管理</span><h2>新建活动</h2></div><button type="button" disabled={creatingActivity} onClick={requestClose}>×</button></header>
    <div className="drawer-body">
      <div className="new-activity-note"><b>创建后为草稿状态</b><span>订货截止后仍可现场抽奖；整场活动结束后冻结看板与战报。</span></div>
      {identity?.roleCode === "SUPER_ADMIN" && <label><span>所属部门 *</span><select disabled={locked} value={newActivity.departmentId} onChange={event => {
        copy.setSourceId(""); setNewActivity(value => ({ ...value, departmentId: event.target.value }));
      }}><option value="">请选择部门</option>{departments.filter(item => item.status === "ACTIVE").map(item => <option key={item.id} value={item.id}>{item.name}（{item.code}）</option>)}</select></label>}
      <label><span>活动名称 *</span><input disabled={locked} value={newActivity.name} onChange={event => setNewActivity(value => ({ ...value, name: event.target.value }))} placeholder="例如：2027 年春节订货会" /></label>
      <div className="generated-activity-no"><span>活动编号</span><b>创建后自动生成</b><small>用于后台识别、报表和数据关联，创建后不可修改</small></div>
      <label><span>订货开始时间（北京时间） *</span><input disabled={locked} type="datetime-local" min={minimumFutureAt} value={newActivity.startsAt} onChange={event => setNewActivity(value => ({ ...value, startsAt: event.target.value }))} /></label>
      <label><span>订货截止时间（北京时间） *</span><input disabled={locked} type="datetime-local" min={newActivity.startsAt || minimumFutureAt} value={newActivity.endsAt} onChange={event => setNewActivity(value => ({ ...value, endsAt: event.target.value }))} /></label>
      <label><span>整场活动结束时间（北京时间） *</span><input disabled={locked} type="datetime-local" min={newActivity.endsAt || minimumFutureAt} value={newActivity.eventEndsAt} onChange={event => setNewActivity(value => ({ ...value, eventEndsAt: event.target.value }))} /></label>
      <section className="activity-copy-panel" aria-label="复用历史活动配置">
        <label className="activity-copy-option"><input type="checkbox" checked={copy.enabled} disabled={locked || !newActivity.departmentId} onChange={event => copy.setEnabled(event.target.checked)} /><span>复用历史活动配置</span></label>
        {!newActivity.departmentId && <small>请先选择所属部门。</small>}
        {copy.enabled && <>
          <label><span>来源活动 *</span><select aria-label="来源活动" disabled={locked || copy.loading} value={copy.sourceId} onChange={event => copy.setSourceId(event.target.value)}>
            <option value="">{copy.loading && !copy.sourceId ? "正在读取历史活动…" : "请选择同部门的历史活动"}</option>
            {copy.sources.map(source => <option key={source.id} value={source.id}>{source.name} · {source.code}（{statusLabels[source.status] || source.status}）</option>)}
          </select></label>
          {!copy.loading && !copy.sourceError && copy.sources.length === 0 && <p>该部门暂无可复用的历史活动。</p>}
          {copy.loading && copy.sourceId && <p role="status">正在读取配置数量…</p>}
          {copy.sourceError && <p role="alert" className="activity-copy-error">{copy.sourceError}</p>}
          {preview && String(preview.sourceId) === copy.sourceId && <fieldset disabled={locked || copy.loading}>
            <legend>复制内容</legend>
            {([{ key: "products", label: "商品配置", count: preview.products, unit: "个商品" },
              { key: "whitelist", label: "白名单", count: preview.customers, unit: "个客户" },
              { key: "lottery", label: "抽奖配置", count: preview.rounds, unit: "个轮次" }] as const).map(item => <label className="activity-copy-option" key={item.key}>
              <input type="checkbox" checked={copy.selection[item.key]} disabled={item.count === 0} onChange={event => copy.setSelection(value => ({ ...value, [item.key]: event.target.checked }))} />
              <span>{item.label}</span><small>{item.count ? item.count + " " + item.unit : "暂无配置"}</small>
            </label>)}
          </fieldset>}
          <p className="activity-copy-hint">复制已保存的配置和图片，创建后可独立修改。现场到场名单需重新导入；订单和中奖记录不复制。</p>
        </>}
      </section>
      {copy.pending && <div className="activity-copy-progress" role="status"><b>正在确认新活动的创建结果</b><p>{copy.taskError || "提交正在处理，请稍候…"}</p><small>活动：{copy.pending.input.name}。刷新或重新提交会继续确认同一次创建。</small></div>}
      {copy.task && <div className="activity-copy-progress" role="status" aria-live="polite">
        <b>{copy.task.status === "COMPLETED" ? "配置复用已完成" : copy.task.status === "CANCELLED" ? "已放弃本次复制" : copy.task.status === "FAILED" ? "配置复用暂未完成" : copy.task.stage === "CONFIGURATION" ? "正在保存活动配置…" : copy.task.status === "QUEUED" ? "配置复用正在排队…" : "正在复制活动配置及图片…"}</b>
        {copy.task.totalFiles > 0 && <span>图片 {copy.task.copiedFiles} / {copy.task.totalFiles}</span>}
        {copy.task.failureMessage && <p className="activity-copy-error">{copy.task.failureMessage}</p>}
        {copy.taskError && <><p className="activity-copy-error">{copy.taskError}</p>{!["COMPLETED", "CANCELLED"].includes(copy.task.status) && <button type="button" onClick={copy.queryProgress}>查询进度</button>}</>}
        {!["COMPLETED", "CANCELLED"].includes(copy.task.status) && <small>准备完成后自动进入新活动。刷新或关闭页面不会取消后台任务。</small>}
      </div>}
    </div>
    <footer>{copy.pending ? <><button type="button" disabled={creatingActivity} onClick={requestClose}>关闭</button><button type="button" className="admin-primary" disabled={creatingActivity} onClick={() => void copy.retrySubmission()}>确认创建结果</button></> : copy.task?.status === "FAILED" ? <><button type="button" disabled={creatingActivity} onClick={() => void copy.discard()}>放弃本次复制</button><button type="button" className="admin-primary" disabled={creatingActivity} onClick={() => void copy.retry()}>重试复制</button></> : <>
      <button type="button" disabled={creatingActivity} onClick={requestClose}>取消</button>
      <button type="button" className="admin-primary" disabled={locked || (copy.enabled && (copy.loading || !canCopy))} onClick={() => void submitNewActivity()}>{creatingActivity ? copy.enabled || copy.task ? "正在创建并复制…" : "正在创建…" : "创建草稿活动"}</button>
    </>}</footer>
  </aside></div>;
}
