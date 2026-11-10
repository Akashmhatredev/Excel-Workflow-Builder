import { useSyncExternalStore } from "react";

/**
 * The location hash as React state, without reading it in an effect.
 *   const hash = useLocationHash();          // "" on the server and during hydration
 *   replaceLocationHash("#column-aliases");  // history.replaceState, no new history entry
 *
 * The hash changes on "hashchange" (a pasted link, a link to #something) and on back/forward;
 * replaceLocationHash notifies subscribers itself because replaceState fires no event.
 */

const listeners = new Set();

function notify() {
  for (const listener of [...listeners]) listener();
}

function subscribe(listener) {
  listeners.add(listener);
  window.addEventListener("hashchange", listener);
  window.addEventListener("popstate", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("hashchange", listener);
    window.removeEventListener("popstate", listener);
  };
}

const getSnapshot = () => window.location.hash;
const getServerSnapshot = () => "";

export function useLocationHash() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** Replace the hash ("" removes it) without adding a history entry or scrolling. */
export function replaceLocationHash(hash) {
  try {
    const { pathname, search } = window.location;
    const next = hash ? (hash.startsWith("#") ? hash : `#${hash}`) : "";
    // Next.js integrates replaceState with its router (see "Native History API" in its docs).
    window.history.replaceState(null, "", `${pathname}${search}${next}`);
  } catch {
    // a sandboxed frame may refuse; the hash just stays
  }
  notify();
}
