"use client";

import { Check } from "lucide-react";
import { HIGHLIGHT_STYLES } from "@/lib/schema";
import { cn } from "@/lib/cn";

const STYLES = Object.entries(HIGHLIGHT_STYLES).map(([value, spec]) => ({ value, ...spec }));

/**
 * Radio group of the HIGHLIGHT_STYLES presets. Each option shows a sample cell in its colours and
 * its name, and the chosen one also gets a check mark, so the choice never relies on colour alone.
 * Keyboard: like a native radio group (Tab reaches the selected option, arrows / Home / End move).
 */
export default function HighlightPicker({ label, value, onChange, bold = false, className }) {
  const selectedIndex = STYLES.findIndex((style) => style.value === value);

  const onKeyDown = (event, index) => {
    const last = STYLES.length - 1;
    let next = -1;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") next = index === last ? 0 : index + 1;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = index === 0 ? last : index - 1;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = last;
    if (next < 0 || next === index) return;
    event.preventDefault();
    const group = event.currentTarget.parentElement;
    const target = group ? group.children[next] : null;
    if (target && typeof target.focus === "function") target.focus();
    onChange(STYLES[next].value);
  };

  return (
    <div role="radiogroup" aria-label={label} className={cn("flex flex-wrap gap-1.5", className)}>
      {STYLES.map((style, index) => {
        const selected = style.value === value;
        return (
          <button
            key={style.value}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected || (selectedIndex < 0 && index === 0) ? 0 : -1}
            onClick={() => onChange(style.value)}
            onKeyDown={(event) => onKeyDown(event, index)}
            className={cn(
              "inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-lg border py-1 pr-2.5 pl-1 text-sm transition-colors duration-150 sm:min-h-9",
              selected
                ? "border-brand bg-brand-soft font-medium text-brand-soft-fg"
                : "border-line bg-surface text-fg usable-hover:border-line-strong",
            )}
          >
            <span
              aria-hidden="true"
              className="inline-flex h-7 min-w-9 items-center justify-center rounded-md border border-line px-1.5 text-xs"
              style={{ backgroundColor: style.fill, color: style.color, fontWeight: bold ? 700 : 500 }}
            >
              Aa
            </span>
            {style.label}
            {selected ? <Check className="size-3.5" aria-hidden="true" /> : null}
          </button>
        );
      })}
    </div>
  );
}
