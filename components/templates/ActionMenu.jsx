"use client";

import { MoreVertical } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { IconButton } from "@/components/ui";
import { cn } from "@/lib/cn";

/**
 * A small "more actions" menu (WAI-ARIA menu button pattern).
 *   items = [{ id, label, icon, onSelect, tone?: 'danger' }]
 * Keyboard: Enter / Space / ArrowDown open it on the first item, ArrowUp on the last;
 * arrows, Home and End move; Escape closes and returns focus to the button.
 * The list opens upwards, so it never makes the page taller when the card is the last one.
 */
export default function ActionMenu({ label = "More actions", items, className }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const buttonRef = useRef(null);
  const itemRefs = useRef([]);
  const focusIndexRef = useRef(0);
  const menuId = useId();

  useEffect(() => {
    if (!open) return undefined;
    const target = itemRefs.current[focusIndexRef.current] || itemRefs.current[0];
    if (target) target.focus();
    const onPointerDown = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const openAt = (index) => {
    focusIndexRef.current = index;
    setOpen(true);
  };

  const close = ({ restoreFocus = true } = {}) => {
    setOpen(false);
    if (restoreFocus && buttonRef.current) buttonRef.current.focus();
  };

  const onButtonKeyDown = (event) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      openAt(event.key === "ArrowDown" ? 0 : items.length - 1);
    }
  };

  const onMenuKeyDown = (event) => {
    const current = itemRefs.current.indexOf(document.activeElement);
    let next = null;
    if (event.key === "ArrowDown") next = (current + 1) % items.length;
    else if (event.key === "ArrowUp") next = (current - 1 + items.length) % items.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = items.length - 1;
    else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    } else if (event.key === "Tab") {
      close({ restoreFocus: false });
      return;
    }
    if (next !== null) {
      event.preventDefault();
      const target = itemRefs.current[next];
      if (target) target.focus();
    }
  };

  const select = (item) => {
    // Focus goes back to the button first, so a dialog opened by the action returns focus there when it closes.
    close();
    item.onSelect();
  };

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <IconButton
        ref={buttonRef}
        label={label}
        icon={MoreVertical}
        variant="secondary"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => (open ? close() : openAt(0))}
        onKeyDown={onButtonKeyDown}
      />
      {open ? (
        <div
          id={menuId}
          role="menu"
          aria-label={label}
          onKeyDown={onMenuKeyDown}
          className="absolute right-0 bottom-full z-20 mb-1 min-w-48 rounded-lg border border-line bg-surface p-1 shadow-card"
        >
          {items.map((item, index) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                ref={(node) => {
                  itemRefs.current[index] = node;
                }}
                type="button"
                role="menuitem"
                tabIndex={-1}
                onClick={() => select(item)}
                className={cn(
                  "flex min-h-10 w-full cursor-pointer items-center gap-2.5 rounded-md px-3 text-left text-sm transition-colors",
                  item.tone === "danger"
                    ? "text-danger hover:bg-danger-soft focus-visible:bg-danger-soft"
                    : "text-fg hover:bg-surface-2 focus-visible:bg-surface-2",
                )}
              >
                {Icon ? <Icon className="size-4 shrink-0" aria-hidden="true" /> : null}
                {item.label}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
