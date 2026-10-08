"use client";

import { useState } from "react";
import { useDrawerClose } from "../../../components/useDrawerClose";
import { createImportRowId, normalizeWhitelistName, whitelistIdentityKey, whitelistPhoneIsValid, type WhitelistCustomerTypeMode, type WhitelistRow } from "../../../domain/import-domain";
import { normalizePhone } from "../../shared/utils";

export function WhitelistFormDrawer({ rows, initialRow, customerTypeMode = "TYPED", activityStarted = false, onClose, onSave }: { rows: WhitelistRow[]; initialRow?: WhitelistRow; customerTypeMode?: WhitelistCustomerTypeMode; activityStarted?: boolean; onClose: () => void; onSave: (row: WhitelistRow, reason?: string) => Promise<boolean> }) {
  const isEditing = Boolean(initialRow);
  const [form, setForm] = useState<WhitelistRow>(() => initialRow ? { ...initialRow } : { id: createImportRowId("whitelist"), sequence: 0, customerType: customerTypeMode === "UNSPECIFIED" ? "" : "综合客户", region: "", branch: "", dealerShort: "", dealerFull: "", dealerType: "", dealerName: "", dealerPhone: "", confirmerName: "", confirmerPhone: "", status: "有效", source: "manual" });
  const [editReason, setEditReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const update = (field: keyof WhitelistRow, value: string | number) => setForm((current) => ({ ...current, [field]: value }));
  const nextSequence = isEditing ? form.sequence : Math.max(0, ...rows.filter((row) => row.customerType === form.customerType).map((row) => row.sequence)) + 1;
  const phoneValid = (isEditing && form.dealerPhone.includes("*")) || whitelistPhoneIsValid(form.dealerPhone);
  const duplicateDealerName = normalizeWhitelistName(form.dealerFull) !== "" && rows.some((row) => row.id !== form.id && row.customerType === form.customerType && whitelistIdentityKey(row) === whitelistIdentityKey(form));
  const duplicateDealerPhone = whitelistPhoneIsValid(form.dealerPhone) && rows.some((row) => row.id !== form.id && row.customerType === form.customerType && normalizePhone(row.dealerPhone) === normalizePhone(form.dealerPhone));
  const canSave = (customerTypeMode === "UNSPECIFIED" ? form.customerType === "" : form.customerType !== "") && form.branch.trim() !== "" && form.dealerShort.trim() !== "" && form.dealerFull.trim() !== "" && phoneValid && !duplicateDealerName && !duplicateDealerPhone && (!activityStarted || editReason.trim() !== "");
  const requestClose = useDrawerClose({ form, editReason }, onClose, saving);
  return (
    <div className="order-drawer-backdrop">
      <aside className="order-drawer form-drawer" onClick={(event) => event.stopPropagation()}>
        <header><div><span>客户身份</span><h2>{isEditing ? "编辑白名单" : "手动添加白名单客户"}</h2></div><button aria-label="关闭" disabled={saving} onClick={requestClose}>×</button></header>
        <div className="auto-sequence-note"><span>{isEditing ? "当前客户" : "序号自动生成"}</span><b>{isEditing ? `原序号：${form.sequence}` : `保存后编号：${nextSequence}`}</b><small>{form.customerType || "不区分客户类型"}分组</small></div>
        <div className="drawer-form-body"><div className="drawer-form-grid">
          <label><span>客户类型</span><select value={form.customerType} disabled={customerTypeMode === "UNSPECIFIED"} onChange={(e) => { const type = e.target.value as WhitelistRow["customerType"]; setForm((current) => ({ ...current, customerType: type })); }}>
            {customerTypeMode === "UNSPECIFIED" ? <option value="">不区分客户类型</option> : <><option>综合客户</option><option>特渠专业客户</option></>}
          </select></label>
          <label><span>大区（选填）</span><input value={form.region} onChange={(e) => update("region", e.target.value)} placeholder="可自行填写；不分大区请留空" /></label>
          <label><span>分公司名称 *</span><input value={form.branch} onChange={(e) => update("branch", e.target.value)} placeholder="例如：长沙分" /></label>
          <label><span>经销商名称（简）*</span><input value={form.dealerShort} onChange={(e) => update("dealerShort", e.target.value)} /><small>{form.dealerShort.length}/10 字</small></label>
          <label className="wide-field"><span>经销商名称（全）*</span><input value={form.dealerFull} onChange={(e) => update("dealerFull", e.target.value)} /><small className={duplicateDealerName ? "field-error" : ""}>{duplicateDealerName ? "同客户类型、同一分公司下已存在，请直接编辑原客户" : "客户身份匹配使用客户类型 + 名称全称 + 分公司；电话变化时会更新原客户"}</small></label>
          <label><span>经销商姓名</span><input value={form.dealerName} onChange={(e) => update("dealerName", e.target.value)} /></label>
          <label><span>经销商电话 *</span><input inputMode="tel" maxLength={11} value={form.dealerPhone} onChange={(e) => update("dealerPhone", e.target.value.replace(/\D/g, ""))} placeholder="11 位手机号" /><small className={duplicateDealerPhone || (form.dealerPhone !== "" && !phoneValid) ? "field-error" : ""}>{duplicateDealerPhone ? "同客户类型内手机号已存在；综合和特渠可以同号" : form.dealerPhone && !phoneValid ? "请输入正确的 11 位手机号" : "用于 H5 身份验证；请输入完整的 11 位手机号"}</small></label>
          <label><span>分公司确认人姓名</span><input value={form.confirmerName} onChange={(e) => update("confirmerName", e.target.value)} /></label>
          <label><span>分公司确认人电话</span><input inputMode="tel" maxLength={11} value={form.confirmerPhone} onChange={(e) => update("confirmerPhone", e.target.value.replace(/\D/g, ""))} /></label>
          {activityStarted && <label className="wide-field"><span>紧急修改原因 *</span><input value={editReason} onChange={(e) => setEditReason(e.target.value)} placeholder="请填写本次改单原因，保存后写入操作日志" /></label>}
        </div>
        <p className="drawer-form-note">{customerTypeMode === "UNSPECIFIED" ? "当前白名单不区分客户类型，H5 将直接验证手机号。" : "当前白名单按客户类型区分，综合客户进入 H5 后还需选择大区。"} {activityStarted ? "活动已开始，本次手动调整会记录操作日志。" : "手动新增或修改仅对当前数据版本生效，重新导入 Excel 后以新文件为准。"}</p></div>
        <footer><div className="drawer-save-error">{saveError && <small className="field-error">{saveError}</small>}</div><button disabled={saving} onClick={requestClose}>取消</button><button className="admin-primary" disabled={!canSave || saving} onClick={async () => {
          setSaving(true); setSaveError("");
          try {
            const saved = await onSave({ ...form, sequence: nextSequence, status: "有效", source: isEditing ? form.source ?? "excel" : "manual", identityKey: whitelistIdentityKey(form), manuallyEdited: true }, editReason.trim());
            if (saved) onClose(); else setSaveError("保存失败，请根据页面提示检查后重试。");
          } catch { setSaveError("保存请求异常，请稍后重试。"); }
          finally { setSaving(false); }
        }}>{saving ? "保存中…" : isEditing ? "保存修改" : "添加客户"}</button></footer>
      </aside>
    </div>
  );
}
