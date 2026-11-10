import { create } from "zustand";

let counter = 0;

/**
 * Toast queue. Push through lib/toast.js; components/shell/Toaster.jsx renders it.
 * toast = { id, type: 'success'|'error'|'info'|'warning', message, description, duration }
 */
export const useToastStore = create((set) => ({
  toasts: [],
  push: (toast) => {
    counter += 1;
    const id = `toast_${counter}`;
    set((state) => ({ toasts: [...state.toasts.slice(-4), { id, type: "info", duration: 5000, ...toast }] }));
    return id;
  },
  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
  clear: () => set({ toasts: [] }),
}));
