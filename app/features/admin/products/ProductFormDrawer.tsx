"use client";

import { useEffect, useRef, useState } from "react";
import { releaseLocalImage } from "../../../domain/local-image-preview";
import { useDrawerSave } from "../../../components/useDrawerSave";
import type { DrawerSaveResult } from "../../../components/drawer-save-result";
import { positiveProductNumber, productCompletenessStatus } from "../../../domain/product-completeness";
import { useDrawerClose } from "../../../components/useDrawerClose";
import { createImportRowId, productImportRowsConflict, type ProductImportRow } from "../../../domain/import-domain";
import { ProductImageEditor } from "../products/ProductImageEditor";
import { PriceTierEditor } from "./PriceTierEditor";
import { editablePriceTiers, priceTierInputErrors } from "../../../domain/tier-pricing-form";
import { ProductScopeEditor } from "./ProductScopeEditor";
import type { DealerCandidateCache } from "../dealer-candidate-cache";
import "./product-scope.css";

export function ProductFormDrawer({ rows, initialRow, activityStarted = false, activityId, scopeEnabled, tiersEditable = true, onClose, onSave, candidateCache }: { rows: ProductImportRow[]; initialRow?: ProductImportRow; activityStarted?: boolean; activityId: number; scopeEnabled: boolean; candidateCache?: DealerCandidateCache; tiersEditable?: boolean; onClose: () => void; onSave: (row: ProductImportRow, reason?: string) => Promise<DrawerSaveResult> }) {
  const isEditing = Boolean(initialRow);
  const [form, setForm] = useState<ProductImportRow>(() => {
    const row: ProductImportRow = initialRow ? { ...initialRow, priceTierMinQuantity: initialRow.priceTierMinQuantity ?? "", priceTierCasePrice: initialRow.priceTierCasePrice ?? "", priceTierPricingMode: initialRow.priceTierPricingMode ?? "WHOLE_ORDER" } : { id: createImportRowId("product"), sequence: 0, customerType: "", rebate: "", category: "", line: "", materialCode: "", materialName: "", description: "", brand: "", variety: "", spec: "", casePack: "", unitPrice: "", casePrice: "", priceTierMinQuantity: "", priceTierCasePrice: "", priceTierPricingMode: "WHOLE_ORDER", conversion: "", gift: "否", branchScope: "", status: "有效", source: "manual" };
    const existing = row.priceTiers ?? (row.priceTierMinQuantity || row.priceTierCasePrice ? [{ minQuantity: row.priceTierMinQuantity, casePrice: row.priceTierCasePrice }] : []);
    return { ...row, priceTiers: existing.length ? editablePriceTiers(row.casePrice, existing) : [] };
  });
  const [tierEnabled, setTierEnabled] = useState(() => Boolean(initialRow?.priceTiers?.length || initialRow?.priceTierMinQuantity || initialRow?.priceTierCasePrice));
  const [editReason, setEditReason] = useState("");
  const ownedPreviews = useRef(new Set<string>());
  const initialPreviews = useRef(new Set(initialRow?.images?.map(image => image.url)));
  const transferredPreviews = useRef(false);
  useEffect(() => () => {
    if (!transferredPreviews.current) ownedPreviews.current.forEach(releaseLocalImage);
  }, []);
  const changeImages = (images: ProductImportRow["images"], imageStatus: ProductImportRow["imageStatus"]) => {
    const retained = new Set(images?.map(image => image.url));
    ownedPreviews.current.forEach(url => {
      if (!retained.has(url)) { releaseLocalImage(url); ownedPreviews.current.delete(url); }
    });
    images?.forEach(image => {
      if (image.url.startsWith("local-image:") && !initialPreviews.current.has(image.url)) ownedPreviews.current.add(image.url);
    });
    setForm(current => ({ ...current, images, imageStatus }));
  };
  const { saving, saveError, requiresReload, save } = useDrawerSave(onClose);
  const update = (field: keyof ProductImportRow, value: string | number) => setForm((current) => ({ ...current, [field]: value, ...(field === "customerType" && scopeEnabled ? { dealerScopeEdited: true } : {}) }));
  const nextSequence = isEditing ? form.sequence : Math.max(0, ...rows.filter((row) => row.customerType === form.customerType && row.rebate === form.rebate).map((row) => row.sequence)) + 1;
  const duplicateProductIdentity = form.materialName.trim() !== "" && rows.some((row) => row.id !== form.id && productImportRowsConflict(row, form));
  const conversionValid = positiveProductNumber(form.conversion) !== null;
  const automaticStatus = !form.materialName.trim() || duplicateProductIdentity ? "待核对" : productCompletenessStatus(form.casePrice, form.conversion);
  const basePrice = positiveProductNumber(form.casePrice) ?? 0;
  const tiers = form.priceTiers ?? (form.priceTierMinQuantity || form.priceTierCasePrice ? [{ minQuantity: form.priceTierMinQuantity, casePrice: form.priceTierCasePrice }] : []);
  const tierValid = !tierEnabled || (tiers.length > 0 && tiers.length <= 101 && !priceTierInputErrors(basePrice, tiers).some(Boolean));
  const changeTiers = (next: typeof tiers) => {
    const discount = next.find(tier => Number(tier.minQuantity) > 1);
    setForm(current => ({ ...current, priceTiers: next, priceTierMinQuantity: discount?.minQuantity ?? "", priceTierCasePrice: discount?.casePrice ?? "" }));
    if (!next.length) setTierEnabled(false);
  };
  const scopeValid = !form.dealerScopeEdited || (form.dealerScope ?? []).every(s => s.members.length > 0 && s.members.every(m => m.active && (!form.customerType || m.customerType === (form.customerType === "综合" ? "GENERAL" : "SPECIAL"))));
  const canSave = form.materialName.trim() !== "" && tierValid && !duplicateProductIdentity && scopeValid && (!activityStarted || editReason.trim() !== "");
  const requestClose = useDrawerClose({ form: { ...form, dealerScopeEdited: undefined, dealerScope: form.dealerScope ?? [] }, tierEnabled, editReason }, onClose, saving);
  const submitForm = async () => {
    const result = await onSave({ ...form, priceTiers: tierEnabled ? tiers : [], status: automaticStatus, sequence: nextSequence, manuallyEdited: true }, editReason.trim());
    if (result.ok || result.requiresReload) transferredPreviews.current = true;
    return result;
  };
  return (
    <div className="order-drawer-backdrop">
      <aside className="order-drawer form-drawer" onClick={(event) => event.stopPropagation()}>
        <header><div><span>活动商品</span><h2>{isEditing ? "编辑商品" : "手动添加商品"}</h2></div><button aria-label="关闭" disabled={saving} onClick={requestClose}>×</button></header>
        <div className="auto-sequence-note"><span>{isEditing ? "当前商品" : "序号自动生成"}</span><b>{isEditing ? `原序号：${form.sequence}` : `保存后编号：${nextSequence}`}</b><small>{form.customerType || "未指定客户类型"} · {form.rebate || "未指定返利"}</small></div>
        <div className="drawer-form-body"><div className="drawer-form-grid">
          <label><span>客户类型</span><select value={form.customerType} onChange={(e) => update("customerType", e.target.value)}><option value="">未指定</option><option>特渠</option><option>综合</option></select></label>
          <label><span>是否参与返利</span><select value={form.rebate} onChange={(e) => update("rebate", e.target.value)}><option value="">未指定</option><option>参与</option><option>不参与</option></select></label>
          <label><span>产品大类</span><input value={form.category} onChange={(e) => update("category", e.target.value)} placeholder="例如：特渠定制产品" /></label>
          <label><span>项目组</span><input value={form.line} onChange={(e) => update("line", e.target.value)} placeholder="例如：调味油" /></label>
          <label><span>物料代码</span><input value={form.materialCode} onChange={(e) => update("materialCode", e.target.value)} /><small>同名商品可用不同代码区分；代码为空时按名称判重</small></label>
          <label className="wide-field"><span>物料名称 *</span><input value={form.materialName} onChange={(e) => update("materialName", e.target.value)} /></label>
          <label className="wide-field"><span>产品说明</span><textarea value={form.description ?? ""} onChange={(e) => update("description", e.target.value)} placeholder="填写后可在 H5 商品详情展示" rows={3} /></label>
          {duplicateProductIdentity && <p className="field-error wide-field">同一客户类型、同一返利类型下商品身份重复；物料代码相同或任一代码为空时，同名商品不能重复。</p>}
          <div className="product-form-image-field wide-field"><span>商品图片</span><ProductImageEditor materialName={form.materialName} images={form.images} imageStatus={form.imageStatus} onChange={changeImages} /></div>
          <label><span>品牌</span><input value={form.brand} onChange={(e) => update("brand", e.target.value)} /></label>
          <label><span>品种</span><input value={form.variety} onChange={(e) => update("variety", e.target.value)} /></label>
          <label><span>规格</span><input value={form.spec} onChange={(e) => update("spec", e.target.value)} /></label>
          <label><span>箱规</span><input value={form.casePack} onChange={(e) => update("casePack", e.target.value)} /></label>
          <label><span>元/瓶</span><input inputMode="decimal" value={form.unitPrice} onChange={(e) => update("unitPrice", e.target.value)} /></label>
          <label><span>元/箱</span><input inputMode="decimal" value={form.casePrice} onChange={(e) => update("casePrice", e.target.value)} />{tierEnabled && <small>未开启阶梯价格时使用；已开启时按下方阶梯价格计价。</small>}</label>
          <label className="wide-field price-tier-toggle"><span>阶梯价格（选填）</span><span><input type="checkbox" disabled={!tiersEditable} checked={tierEnabled} onChange={event => {
            setTierEnabled(event.target.checked);
            if (event.target.checked) changeTiers(tiers.length ? tiers : editablePriceTiers(form.casePrice, [{ minQuantity: "", casePrice: "" }]));
            else setForm(current => ({ ...current, priceTiers: [], priceTierMinQuantity: "", priceTierCasePrice: "", priceTierPricingMode: "WHOLE_ORDER" }));
          }} /> 设置阶梯优惠</span><small>{tiersEditable ? "支持多档达量整批优惠和超出部分优惠；起始箱数包含门槛箱。" : "商品导入成功后，可在编辑页面手动设置多级阶梯价格。"}</small></label>
          {tierEnabled && tiersEditable && <PriceTierEditor basePrice={basePrice} tiers={tiers} mode={form.priceTierPricingMode} onChange={changeTiers} onModeChange={mode => update("priceTierPricingMode", mode)} />}
          <label><span>每吨箱数（箱/吨）</span><input inputMode="decimal" value={form.conversion} onChange={(e) => update("conversion", e.target.value)} /><small className={!conversionValid ? "field-error" : ""}>Excel 原列名：吨箱转换系数；统计时按订货箱数 ÷ 每吨箱数计算吨数</small></label>
          <label><span>是否礼盒</span><select value={form.gift} onChange={(e) => update("gift", e.target.value)}><option>否</option><option>是</option></select></label>
          <ProductScopeEditor candidateCache={candidateCache} activityId={activityId} form={form} enabled={scopeEnabled} onChange={(branchScope, dealerScope) => setForm(current => ({ ...current, branchScope, dealerScope, dealerScopeEdited: scopeEnabled }))} />
          <label><span>数据状态（自动判定）</span><output>{automaticStatus}</output><small>仅元/箱或吨箱转换系数缺失、无效时为待完善；项目组、规格、箱规为选填。</small></label>
        </div>
        {activityStarted && <label className="drawer-form-reason"><span>{isEditing ? "修改原因（必填）" : "新增商品原因"}</span><input maxLength={500} value={editReason} onChange={e => setEditReason(e.target.value)} placeholder="请填写本次商品或下单范围修改原因" /></label>}
        <p className="drawer-form-note">带 * 的字段为必填项；{activityStarted ? "价格修改保存后，相关有效订单自动更新。" : "手动新增或修改仅对当前数据版本生效，重新导入 Excel 后以新文件为准。"}</p></div>
        <footer><div className="drawer-save-error">{saveError && <small className="field-error" role="alert">{saveError}</small>}{requiresReload && <button type="button" onClick={() => window.location.reload()}>刷新列表</button>}</div><button disabled={saving} onClick={requestClose}>取消</button><button className="admin-primary" disabled={!canSave || saving || requiresReload} onClick={() => save(submitForm)}>{saving ? "保存中…" : isEditing ? "保存修改" : "添加商品"}</button></footer>
      </aside>
    </div>
  );
}
