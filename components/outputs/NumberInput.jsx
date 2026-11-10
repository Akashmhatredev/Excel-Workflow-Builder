"use client";

import { useState } from "react";
import { Input } from "@/components/ui";

/**
 * Whole-number input that keeps a text draft while the user types.
 *
 * Valid values are committed on every keystroke; half-typed or out-of-range text stays local
 * (and is marked invalid) until blur, where it is clamped into range.
 * `allowEmpty` commits `null` for an empty box (used for "auto" column widths).
 */
export default function NumberInput({ value, onCommit, min = 0, max = 9999, allowEmpty = false, invalid, ...props }) {
  const [draft, setDraft] = useState(null);
  const text = draft !== null ? draft : value === null || value === undefined ? "" : String(value);

  const parse = (raw) => {
    const trimmed = String(raw).trim();
    if (trimmed === "") return allowEmpty ? { ok: true, value: null } : { ok: false, value: null };
    if (!/^\d+$/.test(trimmed)) return { ok: false, value: null };
    const n = Number(trimmed);
    return { ok: n >= min && n <= max, value: Math.min(max, Math.max(min, n)) };
  };

  const draftInvalid = draft !== null && !parse(draft).ok;

  return (
    <Input
      {...props}
      type="number"
      inputMode="numeric"
      min={min}
      max={max}
      step={1}
      value={text}
      invalid={invalid || draftInvalid}
      onChange={(event) => {
        const raw = event.target.value;
        setDraft(raw);
        const parsed = parse(raw);
        if (parsed.ok && parsed.value !== value) onCommit(parsed.value);
      }}
      onBlur={() => {
        if (draft !== null) {
          const parsed = parse(draft);
          // Out of range: keep the nearest allowed number. Unreadable: fall back to the stored value.
          if (!parsed.ok && parsed.value !== null && parsed.value !== value) onCommit(parsed.value);
        }
        setDraft(null);
      }}
    />
  );
}
