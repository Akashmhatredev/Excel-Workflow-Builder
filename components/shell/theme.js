"use client";

import { useLayoutEffect, useSyncExternalStore } from "react";
import { KEYS, readRaw, storageKey, writeRaw } from "@/lib/storage";

/**
 * Theme: "light" | "dark" | "system".
 *
 * - The choice is the raw string under ewb:v1:theme (lib/storage KEYS.theme).
 * - The class `dark` on <html> switches the tokens in app/globals.css.
 * - The inline script in app/layout.js applies the same rule before first
 *   paint. KEEP THE TWO IN SYNC: "dark" is dark, "light" is light, anything
 *   else (missing, "system", garbage) follows the OS.
 *
 * This is a tiny external store read with useSyncExternalStore, so the server
 * render and the hydration render agree ("system" / "light") and the real
 * value arrives right after, without setState-in-effect.
 */

export const THEME_OPTIONS = ["light", "dark", "system"];

const DARK_QUERY = "(prefers-color-scheme: dark)";
const listeners = new Set();

let preference = null; // cached choice; null = not read from storage yet
let media = null;
let unbind = null;

function normalize(value) {
  return value === "light" || value === "dark" ? value : "system";
}

function getMedia() {
  if (media || typeof window === "undefined" || typeof window.matchMedia !== "function") return media;
  media = window.matchMedia(DARK_QUERY);
  return media;
}

function systemPrefersDark() {
  const query = getMedia();
  return Boolean(query && query.matches);
}

function getPreference() {
  if (preference === null) preference = normalize(readRaw(KEYS.theme));
  return preference;
}

function resolve(choice) {
  if (choice === "system") return systemPrefersDark() ? "dark" : "light";
  return choice;
}

function getResolved() {
  return resolve(getPreference());
}

/** Put the resolved theme on <html>. Safe to call at any time on the client. */
export function applyTheme() {
  if (typeof document === "undefined") return;
  const dark = getResolved() === "dark";
  const root = document.documentElement;
  if (root.classList.contains("dark") !== dark) root.classList.toggle("dark", dark);
}

function emit() {
  for (const listener of listeners) listener();
}

/** Repaint in one go: colour transitions are switched off for the frame in which the tokens change. */
function applyWithoutTransitions() {
  const root = document.documentElement;
  const changes = root.classList.contains("dark") !== (getResolved() === "dark");
  if (!changes) return;
  root.setAttribute("data-theme-switching", "");
  applyTheme();
  const clear = () => root.removeAttribute("data-theme-switching");
  if (typeof window.requestAnimationFrame === "function") {
    window.requestAnimationFrame(() => window.requestAnimationFrame(clear));
  } else {
    clear();
  }
}

function bind() {
  const onStorage = (event) => {
    // Another tab changed the theme (key === null means storage was cleared).
    if (event.key !== null && event.key !== storageKey(KEYS.theme)) return;
    preference = normalize(readRaw(KEYS.theme));
    applyWithoutTransitions();
    emit();
  };
  const onSystemChange = () => {
    // Only matters while following the OS, but the resolved snapshot may still change.
    applyWithoutTransitions();
    emit();
  };
  const query = getMedia();
  window.addEventListener("storage", onStorage);
  if (query) query.addEventListener("change", onSystemChange);
  return () => {
    window.removeEventListener("storage", onStorage);
    if (query) query.removeEventListener("change", onSystemChange);
  };
}

function subscribe(listener) {
  listeners.add(listener);
  if (listeners.size === 1) unbind = bind();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && unbind) {
      unbind();
      unbind = null;
    }
  };
}

/** Save and apply a theme choice. A failed write (storage blocked) still applies for this visit. */
export function setTheme(choice) {
  const next = normalize(choice);
  preference = next;
  writeRaw(KEYS.theme, next);
  applyWithoutTransitions();
  emit();
}

const serverPreference = () => "system";
const serverResolved = () => "light";

/**
 * const { theme, resolvedTheme, setTheme } = useTheme();
 * theme: the saved choice ("light" | "dark" | "system"); resolvedTheme: what is on screen ("light" | "dark").
 * Also keeps <html class="dark"> in step (React resets <html> attributes it does not own on a dev remount).
 */
export function useTheme() {
  const theme = useSyncExternalStore(subscribe, getPreference, serverPreference);
  const resolvedTheme = useSyncExternalStore(subscribe, getResolved, serverResolved);
  useLayoutEffect(() => {
    applyTheme();
  }, [resolvedTheme]);
  return { theme, resolvedTheme, setTheme };
}
