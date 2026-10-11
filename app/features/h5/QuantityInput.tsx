"use client";

import { useState } from "react";

/** Preserve the user's text while editing, including a temporarily empty field. */
export function QuantityInput({ value, onChange, label, disabled }: {
  value: number;
  onChange: (value: number) => void;
  label: string;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return <input aria-label={label} disabled={disabled} type="text" inputMode="numeric" pattern="[0-9]*" enterKeyHint="done"
    value={draft ?? String(value)}
    onFocus={(event) => { setDraft(String(value)); event.currentTarget.select(); }}
    onChange={(event) => {
      const text = event.target.value;
      if (!/^\d*$/.test(text)) return;
      const quantity = Math.min(999999, Number(text));
      setDraft(Number(text) > 999999 ? String(quantity) : text);
      // Clearing a cart field must not remove its row before replacement digits can be typed.
      if (text !== "") onChange(quantity);
    }}
    onBlur={() => { if (draft !== null) onChange(Math.min(999999, Number(draft))); setDraft(null); }}
    onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} />;
}
