"use client";

import { useState } from "react";
import { calculateTierPrice, type PricingMode } from "../../../domain/tier-pricing";
import { priceTierInputErrors, type PriceTierInput } from "../../../domain/tier-pricing-form";
import "./price-tiers.css";

export function PriceTierEditor({ basePrice, tiers, mode, onChange, onModeChange }: {
  basePrice: number; tiers: PriceTierInput[]; mode: PricingMode;
  onChange: (tiers: PriceTierInput[]) => void; onModeChange: (mode: PricingMode) => void;
}) {
  const [trialQuantity, setTrialQuantity] = useState("1200");
  const errors = priceTierInputErrors(basePrice, tiers);
  const quantity = Number(trialQuantity);
  const valid = tiers.length > 0 && !errors.some(Boolean);
  const trial = valid && trialQuantity.trim() && Number.isInteger(quantity) && quantity >= 0 && quantity <= 999999
    ? calculateTierPrice(basePrice, tiers.map(tier => ({ minQuantity: Number(tier.minQuantity), casePrice: Number(tier.casePrice) })), mode, quantity) : null;
  const change = (index: number, field: keyof PriceTierInput, value: string) => onChange(tiers.map((tier, at) => at === index ? { ...tier, [field]: value } : tier));
  return <section className="price-tiers wide-field" aria-label="多级阶梯价格">
    <div className="price-tier-head"><span>起始箱数（包含）</span><span>结束箱数（自动）</span><span>元/箱</span><span>操作</span></div>
    {tiers.map((tier, index) => <div className="price-tier-entry" key={index}>
      <div className={`price-tier-row${index === 0 ? " price-tier-base" : ""}`}>
        {index === 0 ? <span>1 箱起 · 第一档</span> : <input aria-label={`第 ${index + 1} 档起始箱数`} type="number" min="2" max="999999" step="1" inputMode="numeric" placeholder="例如：500" value={tier.minQuantity} onChange={event => change(index, "minQuantity", event.target.value)} />}
        <span>{index + 1 < tiers.length ? tiers[index + 1].minQuantity && Number(tiers[index + 1].minQuantity) > Number(tier.minQuantity) ? `${Number(tiers[index + 1].minQuantity) - 1} 箱` : "待填写下一档" : "不限"}</span>
        <input aria-label={`第 ${index + 1} 档箱价`} inputMode="decimal" placeholder={index === 0 ? "填写第一档价格" : "例如：290"} value={tier.casePrice} onChange={event => change(index, "casePrice", event.target.value)} />
        {index === 0 ? <small>起始档</small> : <button type="button" onClick={() => onChange(tiers.filter((_, at) => at !== index))}>删除</button>}
      </div>
      {errors[index] && <small className="field-error" role="alert">第 {index + 1} 档：{errors[index]}</small>}
    </div>)}
    <button className="price-tier-add" type="button" disabled={tiers.length >= 101} onClick={() => onChange([...tiers, { minQuantity: "", casePrice: "" }])}>＋ 添加价格阶梯</button>
    <label><span>计价模式 *</span><select value={mode} onChange={event => onModeChange(event.target.value as PricingMode)}>
      <option value="WHOLE_ORDER">达量整批优惠（全部箱数按命中档位价格）</option>
      <option value="INCREMENTAL">按阶梯分段计价（从门槛箱起，超出部分优惠）</option>
    </select></label>
    <small>{mode === "INCREMENTAL" ? "各段分别计价。例如 500 箱起：前 499 箱按第一档价格，第 500 箱开始按下一档价格。" : "按本张订单中该商品的总箱数确定档位，全部箱数使用命中档位价格。"}</small>
    <div className="price-tier-trial"><label><span>金额试算 · 订购箱数</span><input aria-label="试算箱数" type="number" min="0" max="999999" step="1" value={trialQuantity} onChange={event => setTrialQuantity(event.target.value)} /></label>
      {trial ? <div aria-live="polite"><strong>合计 ¥{trial.amount.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong><small>{trial.segments.map(segment => `${segment.quantity} 箱 × ¥${segment.casePrice}`).join(" ＋ ") || "0 箱，金额为 0"}</small></div> : <small>完整填写有效阶梯和整数箱数后显示试算结果</small>}
    </div>
  </section>;
}
