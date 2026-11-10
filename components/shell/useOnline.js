"use client";

import { useSyncExternalStore } from "react";

function subscribe(onChange) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

const getOnline = () => navigator.onLine;
// The server (and the hydration render) assume online, so nothing flashes for most visitors.
const getServerOnline = () => true;

/** true while the browser reports a network connection (navigator.onLine + online/offline events). */
export default function useOnline() {
  return useSyncExternalStore(subscribe, getOnline, getServerOnline);
}
