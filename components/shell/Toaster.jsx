"use client";

import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { IconButton } from "@/components/ui";
import { cn } from "@/lib/cn";
import { useToastStore } from "@/store/useToastStore";

/**
 * Toaster (owner: Agent E). Renders the queue from useToastStore; mounted once
 * in app/layout.js. Fire toasts with `toast.*` from "@/lib/toast".
 *
 * - bottom-right on desktop, full width at the bottom on phones (above the
 *   wizard's sticky Back / Next bar: see --toast-bottom in globals.css)
 * - one polite live region that is always in the page; errors are
 *   role="alert" so they interrupt
 * - auto-dismiss after `duration` ms (0 = sticky); the countdown pauses while
 *   the pointer or keyboard focus is on the stack
 * - Escape dismisses the focused toast
 */

const TYPES = {
  success: { icon: CircleCheck, tone: "text-brand", label: "Success" },
  error: { icon: CircleAlert, tone: "text-danger", label: "Error" },
  warning: { icon: TriangleAlert, tone: "text-warning", label: "Warning" },
  info: { icon: Info, tone: "text-info", label: "Notice" },
};

const EXIT_MS = 150;
/** After a pause a toast stays at least this long, so it never vanishes the moment the pointer leaves. */
const MIN_RESUME_MS = 1500;

function prefersReducedMotion() {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
    : false;
}

function ToastItem({ toast, paused, onClosing }) {
  const dismiss = useToastStore((state) => state.dismiss);
  const [leaving, setLeaving] = useState(false);
  const remaining = useRef(toast.duration);
  const wasPaused = useRef(false);
  const type = TYPES[toast.type] || TYPES.info;
  const Icon = type.icon;

  // Countdown. A pause keeps the time that was left; resuming after a real
  // pause grants at least MIN_RESUME_MS. (A cleanup without a pause, such as
  // Strict Mode's mount / unmount / mount in development, changes nothing.)
  useEffect(() => {
    if (!toast.duration || leaving) return undefined;
    if (paused) {
      wasPaused.current = true;
      return undefined;
    }
    const delay = wasPaused.current ? Math.max(MIN_RESUME_MS, remaining.current) : remaining.current;
    wasPaused.current = false;
    const startedAt = Date.now();
    const timer = setTimeout(() => setLeaving(true), delay);
    return () => {
      clearTimeout(timer);
      remaining.current = Math.max(0, delay - (Date.now() - startedAt));
    };
  }, [toast.duration, paused, leaving]);

  // Leave: play the exit transition, then drop the toast from the store.
  useEffect(() => {
    if (!leaving) return undefined;
    const timer = setTimeout(() => dismiss(toast.id), prefersReducedMotion() ? 0 : EXIT_MS);
    return () => clearTimeout(timer);
  }, [leaving, toast.id, dismiss]);

  const close = () => {
    // The element under the pointer / holding focus is about to disappear, and
    // browsers do not reliably send pointerleave or blur for removed nodes.
    onClosing();
    setLeaving(true);
  };

  return (
    <div
      data-toast={toast.type}
      role={toast.type === "error" ? "alert" : undefined}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          close();
        }
      }}
      className={cn(
        "flex w-full items-start gap-3 rounded-xl border border-line bg-surface py-3 pr-2 pl-3.5 text-sm shadow-raised",
        // A toast on its way out no longer counts as hovered.
        leaving ? "pointer-events-none animate-toast-out" : "pointer-events-auto animate-toast-in",
      )}
    >
      <Icon className={cn("mt-0.5 size-5 shrink-0", type.tone)} aria-hidden="true" />
      <div className="min-w-0 flex-1 py-0.5">
        <p className="font-medium break-words text-fg">
          <span className="sr-only">{type.label}: </span>
          {toast.message}
        </p>
        {toast.description ? <p className="mt-0.5 break-words text-muted">{toast.description}</p> : null}
      </div>
      <IconButton
        label="Dismiss notification"
        icon={X}
        size="sm"
        onClick={close}
        className="tap-target -my-0.5 text-muted usable-hover:text-fg"
      />
    </div>
  );
}

/**
 * The visible stack. It unmounts whenever the queue is empty, so its pause
 * state (hover / focus) starts fresh with the next toast and can never stay
 * stuck after the element under the pointer was removed.
 */
function ToastStack({ toasts }) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const paused = hovered || focused;

  const resetPause = () => {
    setHovered(false);
    setFocused(false);
  };

  return (
    <div
      onPointerEnter={() => setHovered(true)}
      onPointerMove={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
      }}
      // While paused the gaps between toasts count as "on the stack" too.
      className={cn("flex flex-col gap-2", paused && "pointer-events-auto")}
    >
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} paused={paused} onClosing={resetPause} />
      ))}
    </div>
  );
}

export default function Toaster() {
  const toasts = useToastStore((state) => state.toasts);
  return (
    <section
      aria-label="Notifications"
      className="pointer-events-none fixed inset-x-0 bottom-[var(--toast-bottom,0px)] z-[60] flex justify-center p-3 sm:inset-x-auto sm:right-0 sm:bottom-0 sm:p-4"
    >
      {/* The live region stays mounted so screen readers announce every toast added to it. */}
      <div aria-live="polite" className="w-full sm:w-96">
        {toasts.length ? <ToastStack toasts={toasts} /> : null}
      </div>
    </section>
  );
}
