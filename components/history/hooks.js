"use client";

import { useSyncExternalStore } from "react";
import { getHistorySnapshot, getServerHistorySnapshot, subscribeHistory } from "@/lib/history";

/** The run log, newest first. Empty on the server and during hydration. */
export function useHistory() {
  return useSyncExternalStore(subscribeHistory, getHistorySnapshot, getServerHistorySnapshot);
}

const noopSubscribe = () => () => {};

/** false on the server and in the hydration render, true afterwards (tells "empty" from "not read yet"). */
export function useHydrated() {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}

/*
 * A shared clock for relative times ("5 minutes ago"): one interval for every subscriber,
 * ticking every 30 s. Reading Date.now() here, outside render, keeps components pure.
 */
const TICK_MS = 30_000;
const clockListeners = new Set();
let now = 0;
let timer = null;

function subscribeClock(listener) {
  clockListeners.add(listener);
  if (!timer) {
    now = Date.now();
    timer = setInterval(() => {
      now = Date.now();
      for (const notify of [...clockListeners]) notify();
    }, TICK_MS);
  }
  return () => {
    clockListeners.delete(listener);
    if (clockListeners.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

function getNow() {
  if (!now) now = Date.now();
  return now;
}

const getServerNow = () => 0;

/** Current time in ms, refreshed every 30 s; 0 on the server. */
export function useNow() {
  return useSyncExternalStore(subscribeClock, getNow, getServerNow);
}
