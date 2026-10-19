"use client";

import { useState } from "react";
import { useDrawerSave } from "../../../components/useDrawerSave";
import type { DrawerSaveResult } from "../../../components/drawer-save-result";
import { useDrawerClose } from "../../../components/useDrawerClose";
import { attendanceCustomerType, createImportRowId, type AttendanceFieldKey, type AttendanceRow } from "../../../domain/import-domain";

export function AttendanceFormDrawer({ rows, initialRow, onClose, onSave }: { rows: AttendanceRow[]; initialRow?: AttendanceRow; onClose: () => void; onSave: (row: AttendanceRow) => Promise<DrawerSaveResult> }) {
  const isEditing = Boolean(initialRow);
  const [form, setForm] = useState<AttendanceRow>(() => initialRow ? { ...initialRow } : { id: createImportRowId("attendance-manual"), sequence: 0, dealerName: "", gender: "", contactPhone: "", branch: "", dealerCompany: "", participantType: "", customerType: "" });
  const { saving, saveError, requiresReload, save } = useDrawerSave(onClose);
  const nextSequence = isEditing ? form.sequence : Math.max(0, ...rows.map((row) => row.sequence)) + 1;
  const update = (field: AttendanceFieldKey, value: string) => setForm((current) => ({ ...current, [field]: value, ...(field === "participantType" ? { customerType: attendanceCustomerType(value) } : {}) }));
  const requestClose = useDrawerClose(form, onClose, saving);
  return (
    <div className="order-drawer-backdrop">
      <aside className="order-drawer form-drawer attendance-form-drawer" onClick={(event) => event.stopPropagation()}>
        <header><div><span>现场到场客户</span><h2>{isEditing ? "编辑到场客户" : "手动添加到场客户"}</h2></div><button type="button" aria-label="关闭" disabled={saving} onClick={requestClose}>×</button></header>
        <div className="auto-sequence-note"><span>{isEditing ? "当前记录" : "序号自动生成"}</span><b>{isEditing ? `原序号：${form.sequence}` : `保存后编号：${nextSequence}`}</b><small>当前仅用于到场名单页面展示</small></div>
        <div className="drawer-form-body"><div className="drawer-form-grid">
          <label><span>分公司</span><input value={form.branch} onChange={(event) => update("branch", event.target.value)} placeholder="请输入分公司" /></label>
          <label><span>参会人姓名</span><input value={form.dealerName} onChange={(event) => update("dealerName", event.target.value)} placeholder="请输入参会人姓名" /></label>
          <label><span>性别</span><select value={form.gender} onChange={(event) => update("gender", event.target.value)}><option value="">请选择</option><option>男</option><option>女</option></select></label>
          <label><span>参会人电话</span><input inputMode="tel" value={form.contactPhone} onChange={(event) => update("contactPhone", event.target.value)} placeholder="请输入参会人电话" /></label>
          <label className="wide-field"><span>经销商名称</span><input value={form.dealerCompany} onChange={(event) => update("dealerCompany", event.target.value)} placeholder="请输入经销商名称" /></label>
          <label className="wide-field"><span>参会人员类型</span><input value={form.participantType} onChange={(event) => update("participantType", event.target.value)} placeholder="例如：综合经销商 / 特渠专业经销商" /></label>
        </div><p className="drawer-form-note">抽奖大屏只显示经销商名称；客户类型由参会人员类型自动识别。</p></div>
        <footer><div className="drawer-save-error">{saveError && <small className="field-error" role="alert">{saveError}</small>}{requiresReload && <button type="button" onClick={() => window.location.reload()}>刷新列表</button>}</div><button type="button" disabled={saving} onClick={requestClose}>取消</button><button type="button" className="admin-primary" disabled={saving || requiresReload} onClick={() => save(() => onSave({ ...form, sequence: nextSequence, manuallyEdited: true }))}>{saving ? "保存中…" : isEditing ? "保存修改" : "保存到场客户"}</button></footer>
      </aside>
    </div>
  );
}
