"use client";

import { Check, Monitor, Moon, Sun } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { IconButton } from "@/components/ui";
import { cn } from "@/lib/cn";
import { useTheme } from "./theme";

const OPTIONS = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
];

/**
 * Theme control for the header: one button that opens a three-item menu
 * (Light / Dark / System). The button shows the saved choice, so "System" is
 * visibly different from an explicit light or dark.
 *
 * Keyboard: Enter / Space / ArrowDown open it, arrows + Home / End move,
 * Enter / Space choose, Escape closes and returns focus to the button.
 */
export default function ThemeMenu({ className }) {
  const { theme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const buttonRef = useRef(null);
  const menuRef = useRef(null);
  const menuId = useId();

  const current = OPTIONS.find((option) => option.value === theme) || OPTIONS[2];

  // While open: start on the selected item and close on a press outside.
  useEffect(() => {
    if (!open) return undefined;
    const menu = menuRef.current;
    const selected = menu ? menu.querySelector('[aria-checked="true"]') || menu.querySelector('[role="menuitemradio"]') : null;
    if (selected) selected.focus();
    const onPointerDown = (event) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const close = ({ refocus = true } = {}) => {
    setOpen(false);
    if (refocus && buttonRef.current) buttonRef.current.focus();
  };

  const choose = (value) => {
    setTheme(value);
    close();
  };

  const onMenuKeyDown = (event) => {
    const items = menuRef.current ? Array.from(menuRef.current.querySelectorAll('[role="menuitemradio"]')) : [];
    const index = items.indexOf(document.activeElement);
    let next = -1;
    if (event.key === "ArrowDown") next = index < 0 || index === items.length - 1 ? 0 : index + 1;
    else if (event.key === "ArrowUp") next = index <= 0 ? items.length - 1 : index - 1;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = items.length - 1;
    else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    } else if (event.key === "Tab") {
      // Let focus move on, just do not leave an open menu behind.
      close({ refocus: false });
      return;
    }
    if (next >= 0 && items[next]) {
      event.preventDefault();
      items[next].focus();
    }
  };

  return (
    <div ref={wrapRef} className={cn("relative", className)}>
      <IconButton
        ref={buttonRef}
        label={`Theme: ${current.label}`}
        icon={current.icon}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" && !open) {
            event.preventDefault();
            setOpen(true);
          }
        }}
        className={cn("text-muted usable-hover:text-fg", open && "bg-surface-2 text-fg")}
      />
      {open ? (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label="Theme"
          onKeyDown={onMenuKeyDown}
          className="absolute top-full right-0 z-50 mt-2 w-44 origin-top-right animate-pop-in rounded-xl border border-line bg-surface p-1 shadow-raised"
        >
          {OPTIONS.map((option) => {
            const selected = option.value === theme;
            const Icon = option.icon;
            return (
              <button
                key={option.value}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                tabIndex={-1}
                onClick={() => choose(option.value)}
                className={cn(
                  "flex h-10 w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 text-left text-sm transition-colors duration-150",
                  "usable-hover:bg-surface-2 focus-visible:bg-surface-2",
                  selected ? "font-medium text-fg" : "text-muted usable-hover:text-fg",
                )}
              >
                <Icon className="size-4 shrink-0" aria-hidden="true" />
                <span className="flex-1">{option.label}</span>
                {selected ? <Check className="size-4 shrink-0 text-brand" aria-hidden="true" /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
