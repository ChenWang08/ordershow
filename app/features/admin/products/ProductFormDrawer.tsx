"use client";

import { useState } from "react";
import { createImportRowId, productImportRowsConflict, type ProductImportRow } from "../../../domain/import-domain";
import { ProductImageEditor } from "../products/ProductImageEditor";

export function ProductFormDrawer({ rows, initialRow, activityStarted = false, onClose, onSave }: { rows: ProductImportRow[]; initialRow?: ProductImportRow; activityStarted?: boolean; onClose: () => void; onSave: (row: ProductImportRow, reason?: string) => Promise<boolean> }) {
  const isEditing = Boolean(initialRow);
  const [form, setForm] = useState<ProductImportRow>(() => initialRow ? { ...initialRow, priceTierMinQuantity: initialRow.priceTierMinQuantity ?? "", priceTierCasePrice: initialRow.priceTierCasePrice ?? "", priceTierPricingMode: initialRow.priceTierPricingMode ?? "WHOLE_ORDER" } : { id: createImportRowId("product"), sequence: 0, customerType: "", rebate: "", category: "", line: "", materialCode: "", materialName: "", description: "", brand: "", variety: "", spec: "", casePack: "", unitPrice: "", casePrice: "", priceTierMinQuantity: "", priceTierCasePrice: "", priceTierPricingMode: "WHOLE_ORDER", conversion: "", gift: "否", branchScope: "", status: "有效", source: "manual" });
  const [tierEnabled, setTierEnabled] = useState(() => Boolean(initialRow?.priceTierMinQuantity || initialRow?.priceTierCasePrice));
  const [editReason, setEditReason] = useState("");
  const [saving, setSaving] = useState(false);
  const update = (field: keyof ProductImportRow, value: string | number) => setForm((current) => ({ ...current, [field]: value }));
  const nextSequence = isEditing ? form.sequence : Math.max(0, ...rows.filter((row) => row.customerType === form.customerType && row.rebate === form.rebate).map((row) => row.sequence)) + 1;
  const duplicateProductIdentity = form.materialName.trim() !== "" && rows.some((row) => row.id !== form.id && productImportRowsConflict(row, form));
  const conversionValue = Number(form.conversion);
  const conversionValid = form.conversion.trim() !== "" && Number.isFinite(conversionValue) && conversionValue > 0;
  const basePrice = Number(form.casePrice);
  const tierMinQuantity = Number(form.priceTierMinQuantity);
  const tierCasePrice = Number(form.priceTierCasePrice);
  const tierValid = !tierEnabled || (Number.isInteger(tierMinQuantity) && tierMinQuantity >= 2 && tierMinQuantity <= 999999
    && Number.isFinite(tierCasePrice) && tierCasePrice > 0 && tierCasePrice < basePrice);
  const canSave = form.materialName.trim() !== "" && form.casePrice.trim() !== "" && (conversionValid || form.status === "待完善") && tierValid && !duplicateProductIdentity && (isEditing || !activityStarted || editReason.trim() !== "");
  return (
    <div className="order-drawer-backdrop" onClick={() => { if (!saving) onClose(); }}>
      <aside className="order-drawer form-drawer" onClick={(event) => event.stopPropagation()}>
        <header><div><span>活动商品</span><h2>{isEditing ? "编辑商品" : "手动添加商品"}</h2></div><button aria-label="关闭" onClick={onClose}>×</button></header>
        <div className="auto-sequence-note"><span>{isEditing ? "当前商品" : "序号自动生成"}</span><b>{isEditing ? `原序号：${form.sequence}` : `保存后编号：${nextSequence}`}</b><small>{form.customerType || "未指定客户类型"} · {form.rebate || "未指定返利"}</small></div>
        <div className="drawer-form-body"><div className="drawer-form-grid">
          <label><span>客户类型</span><select value={form.customerType} onChange={(e) => update("customerType", e.target.value)}><option value="">未指定</option><option>特渠</option><option>综合</option></select></label>
          <label><span>是否参与返利</span><select value={form.rebate} onChange={(e) => update("rebate", e.target.value)}><option value="">未指定</option><option>参与</option><option>不参与</option></select></label>
          <label><span>产品大类</span><input value={form.category} onChange={(e) => update("category", e.target.value)} placeholder="例如：特渠定制产品" /></label>
          <label><span>产品线</span><input value={form.line} onChange={(e) => update("line", e.target.value)} placeholder="例如：调味油" /></label>
          <label><span>物料代码</span><input value={form.materialCode} onChange={(e) => update("materialCode", e.target.value)} /><small>同名商品可用不同代码区分；代码为空时按名称判重</small></label>
          <label className="wide-field"><span>物料名称 *</span><input value={form.materialName} onChange={(e) => update("materialName", e.target.value)} /></label>
          <label className="wide-field"><span>产品说明</span><textarea value={form.description ?? ""} onChange={(e) => update("description", e.target.value)} placeholder="填写后可在 H5 商品详情展示" rows={3} /></label>
          {duplicateProductIdentity && <p className="field-error wide-field">同一客户类型、同一返利类型下商品身份重复；物料代码相同或任一代码为空时，同名商品不能重复。</p>}
          <div className="product-form-image-field wide-field"><span>商品图片</span><ProductImageEditor materialName={form.materialName} images={form.images} imageStatus={form.imageStatus} onChange={(images, status) => setForm((current) => ({ ...current, images, imageStatus: status }))} /></div>
          <label><span>品牌</span><input value={form.brand} onChange={(e) => update("brand", e.target.value)} /></label>
          <label><span>品种</span><input value={form.variety} onChange={(e) => update("variety", e.target.value)} /></label>
          <label><span>规格</span><input value={form.spec} onChange={(e) => update("spec", e.target.value)} /></label>
          <label><span>箱规</span><input value={form.casePack} onChange={(e) => update("casePack", e.target.value)} /></label>
          <label><span>元/瓶</span><input inputMode="decimal" value={form.unitPrice} onChange={(e) => update("unitPrice", e.target.value)} /></label>
          <label><span>元/箱 *</span><input inputMode="decimal" value={form.casePrice} onChange={(e) => update("casePrice", e.target.value)} /></label>
          <label className="wide-field price-tier-toggle"><span>阶梯价格（选填）</span><span><input type="checkbox" checked={tierEnabled} onChange={(e) => { setTierEnabled(e.target.checked); if (!e.target.checked) setForm((current) => ({ ...current, priceTierMinQuantity: "", priceTierCasePrice: "", priceTierPricingMode: "WHOLE_ORDER" })); }} /> 设置阶梯优惠</span><small>可选择达到门槛后整批降价，或仅从门槛箱开始对超出部分降价</small></label>
          {tierEnabled && <><label><span>优惠起订箱数 *</span><input inputMode="numeric" type="number" min="2" max="999999" value={form.priceTierMinQuantity} onChange={(e) => update("priceTierMinQuantity", e.target.value)} placeholder="例如：1500" /><small className={!Number.isInteger(tierMinQuantity) || tierMinQuantity < 2 || tierMinQuantity > 999999 ? "field-error" : ""}>请输入 2～999999 的整数箱数</small></label><label><span>阶梯优惠箱价 *</span><input inputMode="decimal" value={form.priceTierCasePrice} onChange={(e) => update("priceTierCasePrice", e.target.value)} placeholder="例如：134" /><small className={!Number.isFinite(tierCasePrice) || tierCasePrice <= 0 || tierCasePrice >= basePrice ? "field-error" : ""}>必须大于 0 且低于基础箱价 {Number.isFinite(basePrice) ? basePrice : "—"} 元</small></label><label className="wide-field"><span>计价模式 *</span><select value={form.priceTierPricingMode} onChange={(e) => update("priceTierPricingMode", e.target.value)}><option value="WHOLE_ORDER">达量整批优惠（达到门槛后全部箱数按优惠价）</option><option value="INCREMENTAL">超出部分优惠（从门槛箱开始按优惠价）</option></select><small>{form.priceTierPricingMode === "INCREMENTAL" ? `例如满 ${form.priceTierMinQuantity || "1500"} 箱：前 ${Math.max(1, (tierMinQuantity || 1500) - 1)} 箱按基础价，第 ${form.priceTierMinQuantity || "1500"} 箱起按优惠价` : "达到门槛后，本商品本次订购的全部箱数按优惠价"}</small></label></>}
          <label><span>每吨箱数（箱/吨） *</span><input inputMode="decimal" value={form.conversion} onChange={(e) => update("conversion", e.target.value)} /><small className={!conversionValid && form.status !== "待完善" ? "field-error" : ""}>Excel 原列名：吨箱转换系数；统计时按订货箱数 ÷ 每吨箱数计算吨数</small></label>
          <label><span>是否礼盒</span><select value={form.gift} onChange={(e) => update("gift", e.target.value)}><option>否</option><option>是</option></select></label>
          <label><span>分公司限制</span><input value={form.branchScope} onChange={(e) => update("branchScope", e.target.value)} placeholder="留空表示全部分公司" /><small>多个分公司用顿号或逗号分隔</small></label>
          <label><span>数据状态</span><select value={form.status} onChange={(e) => update("status", e.target.value)}><option>有效</option><option>待完善</option></select></label>
        </div>
        {activityStarted && !isEditing && <label>新增商品原因<input value={editReason} onChange={e => setEditReason(e.target.value)} /></label>}
        <p className="drawer-form-note">带 * 的字段为必填项；{activityStarted ? "价格修改保存后，相关有效订单自动更新。" : "手动新增或修改仅对当前数据版本生效，重新导入 Excel 后以新文件为准。"}</p></div>
        <footer><button disabled={saving} onClick={onClose}>取消</button><button className="admin-primary" disabled={!canSave || saving} onClick={async () => {
          setSaving(true);
          const saved = await onSave({ ...form, sequence: nextSequence, manuallyEdited: true }, editReason.trim());
          setSaving(false);
          if (saved) onClose();
        }}>{saving ? "保存中…" : isEditing ? "保存修改" : "添加商品"}</button></footer>
      </aside>
    </div>
  );
}
