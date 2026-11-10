import { useToastStore } from "../store/useToastStore";

/**
 * Fire a toast from anywhere (components, stores, plain modules).
 *   toast.success("Template saved")
 *   toast.error("Could not read the file", { description: "The file looks corrupt." })
 * Options: { description?: string, duration?: number (ms, 0 = sticky) }
 */
function push(type, message, options = {}) {
  return useToastStore.getState().push({ type, message: String(message ?? ""), ...options });
}

export const toast = {
  success: (message, options) => push("success", message, options),
  error: (message, options) => push("error", message, { duration: 8000, ...options }),
  info: (message, options) => push("info", message, options),
  warning: (message, options) => push("warning", message, { duration: 7000, ...options }),
  dismiss: (id) => useToastStore.getState().dismiss(id),
};
