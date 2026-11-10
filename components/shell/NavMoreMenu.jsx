"use client";

import { ChevronDown } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { cn } from "@/lib/cn";

/**
 * "More" for the phone header: a disclosure button that opens a short list of links
 * (the destinations that do not fit in the bar). Navigation links, so it is a disclosure
 * (button + list), not an ARIA menu.
 *
 * Keyboard: Enter / Space / ArrowDown open it and focus the first link, ArrowUp opens it on
 * the last; arrows + Home / End move between links; Escape closes and returns focus to the
 * button; Tab moves on and closes it. A press outside closes it too.
 *
 * items: [{ href, label, icon }], activeHref: the href of the current page or null.
 */
export default function NavMoreMenu({ items, activeHref, className }) {
  const [open, setOpen] = useState(false);
  const [focusOn, setFocusOn] = useState("first");
  const wrapRef = useRef(null);
  const buttonRef = useRef(null);
  const listRef = useRef(null);
  const listId = useId();

  const activeItem = items.find((item) => item.href === activeHref) || null;

  useEffect(() => {
    if (!open) return undefined;
    const links = listRef.current ? Array.from(listRef.current.querySelectorAll("a")) : [];
    const target = focusOn === "last" ? links[links.length - 1] : links[0];
    if (target) target.focus();
    const onPointerDown = (event) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open, focusOn]);

  const openAt = (where) => {
    setFocusOn(where);
    setOpen(true);
  };

  const close = ({ refocus = true } = {}) => {
    setOpen(false);
    if (refocus && buttonRef.current) buttonRef.current.focus();
  };

  const onListKeyDown = (event) => {
    const links = listRef.current ? Array.from(listRef.current.querySelectorAll("a")) : [];
    const index = links.indexOf(document.activeElement);
    let next = -1;
    if (event.key === "ArrowDown") next = index < 0 || index === links.length - 1 ? 0 : index + 1;
    else if (event.key === "ArrowUp") next = index <= 0 ? links.length - 1 : index - 1;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = links.length - 1;
    else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    } else if (event.key === "Tab") {
      close({ refocus: false });
      return;
    }
    if (next >= 0 && links[next]) {
      event.preventDefault();
      links[next].focus();
    }
  };

  return (
    <div ref={wrapRef} className={cn("relative", className)}>
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={activeItem ? `More pages, current page: ${activeItem.label}` : "More pages"}
        onClick={() => (open ? close({ refocus: false }) : openAt("first"))}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            openAt(event.key === "ArrowUp" ? "last" : "first");
          }
        }}
        className={cn(
          "flex h-10 cursor-pointer items-center gap-1 rounded-lg px-2 text-sm font-medium transition-colors duration-150",
          activeItem || open ? "bg-surface-2 text-fg" : "text-muted hover:bg-surface-2 hover:text-fg",
        )}
      >
        More
        <ChevronDown
          className={cn("size-4 transition-transform duration-150", open && "rotate-180")}
          aria-hidden="true"
        />
      </button>
      {open ? (
        <div
          id={listId}
          ref={listRef}
          onKeyDown={onListKeyDown}
          className="absolute top-full right-0 z-50 mt-2 w-48 origin-top-right animate-pop-in rounded-xl border border-line bg-surface p-1 shadow-raised"
        >
          <ul className="flex flex-col">
            {items.map((item) => {
              const active = item.href === activeHref;
              const Icon = item.icon;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    onClick={() => setOpen(false)}
                    className={cn(
                      "flex h-10 items-center gap-2.5 rounded-lg px-2.5 text-sm transition-colors duration-150",
                      "hover:bg-surface-2 focus-visible:bg-surface-2",
                      active ? "bg-surface-2 font-medium text-fg" : "text-muted hover:text-fg",
                    )}
                  >
                    {Icon ? <Icon className="size-4 shrink-0" aria-hidden="true" /> : null}
                    <span className="flex-1">{item.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
