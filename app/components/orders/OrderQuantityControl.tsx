"use client";
import { useState } from "react";

export function OrderQuantityControl({ name, quantity, disabled, onChange, onEditing }: {
  name: string; quantity: number; disabled: boolean;
  onChange: (quantity: number) => void; onEditing: (editing: boolean) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return <div className="order-quantity-control">
    <button type="button" aria-label={"减少" + name + "箱数"} disabled={disabled || quantity <= 0} onClick={() => onChange(quantity - 1)}>−</button>
    <input aria-label={name + "箱数"} type="text" inputMode="numeric" pattern="[0-9]*" maxLength={6} disabled={disabled}
      value={draft ?? (quantity || "")} onFocus={() => { setDraft(quantity ? String(quantity) : ""); if (quantity > 0) onEditing(true); }}
      onChange={(event) => {
        const value = event.target.value;
        if (!/^\d{0,6}$/.test(value)) return;
        setDraft(value);
        if (Number(value) > 0 || quantity > 0) onEditing(true);
        onChange(Number(value));
      }} onBlur={() => { setDraft(null); onEditing(false); }} />
    <button type="button" aria-label={"增加" + name + "箱数"} disabled={disabled || quantity >= 999999} onClick={() => onChange(quantity + 1)}>＋</button>
  </div>;
}
