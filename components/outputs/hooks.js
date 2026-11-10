"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";

const subscribeNever = () => () => {};

/**
 * A value that only exists in the browser (feature detection, platform).
 * Renders `serverValue` on the server and during hydration, then `getValue()`.
 * `getValue` must return a primitive (or a cached reference).
 */
export function useClientValue(getValue, serverValue) {
  return useSyncExternalStore(subscribeNever, getValue, () => serverValue);
}

/**
 * Keep keyboard focus on a control that moves when its list is reordered.
 *
 * React moves DOM nodes to reorder a keyed list, and a moved node loses focus. Call the returned
 * function in the event handler with the `data-focus-key` values to try, in order: after the next
 * render the first one that exists and is enabled gets the focus back.
 */
export function useRestoreFocus() {
  const wanted = useRef(null);
  useEffect(() => {
    const keys = wanted.current;
    if (!keys) return;
    wanted.current = null;
    for (const key of keys) {
      const element = document.querySelector(`[data-focus-key="${CSS.escape(key)}"]`);
      if (element && !element.disabled) {
        if (document.activeElement !== element) element.focus();
        return;
      }
    }
  });
  return (...keys) => {
    wanted.current = keys;
  };
}
