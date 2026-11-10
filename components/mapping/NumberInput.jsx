"use client";

import { useState } from "react";
import { Input } from "@/components/ui";

/**
 * Number field that can be cleared while typing. Every valid number is passed to
 * onCommit straight away (clamped to min / max); on blur the box shows the stored value again.
 */
export default function NumberInput({ value, onCommit, min, max, integer = true, ...props }) {
  const [draft, setDraft] = useState(null);
  const shown = draft === null ? (value == null ? "" : String(value)) : draft;
  return (
    <Input
      type="number"
      inputMode={integer ? "numeric" : "decimal"}
      min={min}
      max={max}
      step={integer ? 1 : "any"}
      {...props}
      value={shown}
      onChange={(event) => {
        const text = event.target.value;
        setDraft(text);
        let number = Number(text);
        if (text.trim() === "" || !Number.isFinite(number)) return;
        if (integer) number = Math.round(number);
        if (typeof min === "number") number = Math.max(min, number);
        if (typeof max === "number") number = Math.min(max, number);
        if (number !== value) onCommit(number);
      }}
      onBlur={() => setDraft(null)}
    />
  );
}
