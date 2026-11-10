"use client";

import { useEffect } from "react";
import { useToastStore } from "@/store/useToastStore";

/**
 * Toaster (owner: Agent E). Minimal version: restyle freely.
 * Renders the toast queue from useToastStore; mounted once in app/layout.js.
 */
function ToastItem({ toast }) {
  const dismiss = useToastStore((state) => state.dismiss);
  useEffect(() => {
    if (!toast.duration) return undefined;
    const timer = setTimeout(() => dismiss(toast.id), toast.duration);
    return () => clearTimeout(timer);
  }, [toast.id, toast.duration, dismiss]);
  return (
    <div role={toast.type === "error" ? "alert" : "status"} className="rounded-lg border border-line bg-surface px-4 py-3 text-sm shadow-card">
      <p className="font-medium">{toast.message}</p>
      {toast.description ? <p className="text-muted">{toast.description}</p> : null}
    </div>
  );
}

export default function Toaster() {
  const toasts = useToastStore((state) => state.toasts);
  return (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4">
      {toasts.map((toast) => (
        <div key={toast.id} className="pointer-events-auto w-full max-w-sm">
          <ToastItem toast={toast} />
        </div>
      ))}
    </div>
  );
}
