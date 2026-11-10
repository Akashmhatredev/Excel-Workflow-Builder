"use client";

import { useEffect } from "react";
import { useTemplateStore } from "@/store/useTemplateStore";

/**
 * StorageBridge (owner: Agent D). Minimal version: replace with the real component.
 * Contract: no props, renders nothing, mounted once in app/layout.js. It
 *  1. rehydrates the template store from localStorage,
 *  2. restores the autosaved workflow draft,
 *  3. autosaves the draft (definition only) whenever it changes,
 *  4. turns storage errors (quota exceeded, storage unavailable) into toasts.
 */
export default function StorageBridge() {
  useEffect(() => {
    useTemplateStore.persist.rehydrate();
  }, []);
  return null;
}
