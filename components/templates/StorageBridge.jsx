"use client";

import { useEffect } from "react";
import { notifyStorageError } from "@/components/templates/notify";
import { KEYS, onStorageChange, onStorageError, readJSON, remove, writeJSON } from "@/lib/storage";
import { migrateDefinition } from "@/lib/templates";
import { toast } from "@/lib/toast";
import { useTemplateStore } from "@/store/useTemplateStore";
import { useWorkflowStore } from "@/store/useWorkflowStore";

const AUTOSAVE_DELAY_MS = 500;

let loadErrorAnnounced = false;

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

/** Write the current workflow definition as the draft (or forget the draft when there is nothing in it). */
function saveDraft() {
  const state = useWorkflowStore.getState();
  const { fields, outputs } = state.definition;
  if (!fields.length && !outputs.length) remove(KEYS.draft);
  else writeJSON(KEYS.draft, state.getDraft());
}

/**
 * StorageBridge (owner: Agent D). No props, renders nothing, mounted once in app/layout.js.
 * The one place where the stores meet localStorage:
 *  1. turns storage failures (quota exceeded, storage unavailable) into toasts,
 *  2. rehydrates the template store, and keeps it in sync with other tabs,
 *  3. restores the autosaved workflow draft,
 *  4. autosaves the draft (the definition only, never spreadsheet data) 500 ms after
 *     the last change, and straight away when the page is hidden or closed.
 */
export default function StorageBridge() {
  useEffect(() => {
    // 1. Listen first, so problems during hydration are reported too.
    const offError = onStorageError((detail) => notifyStorageError(detail));

    // 2. Templates.
    useTemplateStore.persist.rehydrate();
    if (useTemplateStore.getState().loadError && !loadErrorAnnounced) {
      loadErrorAnnounced = true;
      toast.warning("Saved templates could not be read", { description: useTemplateStore.getState().loadError, duration: 12000 });
    }
    const offChange = onStorageChange(({ name }) => {
      if (name === KEYS.templates || name === null) useTemplateStore.persist.rehydrate();
    });

    // 3. Draft (before subscribing, so restoring it does not count as a change).
    const draft = readJSON(KEYS.draft);
    if (isObject(draft) && isObject(draft.definition)) {
      useWorkflowStore.getState().restoreDraft({ ...draft, definition: migrateDefinition(draft.definition) });
    }

    // 4. Autosave.
    let timer = null;
    const flush = () => {
      if (timer === null) return;
      clearTimeout(timer);
      timer = null;
      saveDraft();
    };
    const offWorkflow = useWorkflowStore.subscribe((state, previous) => {
      if (
        state.definition === previous.definition &&
        state.templateId === previous.templateId &&
        state.templateName === previous.templateName &&
        state.dirty === previous.dirty
      ) {
        return;
      }
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(flush, AUTOSAVE_DELAY_MS);
    });
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      flush();
      offWorkflow();
      offChange();
      offError();
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  return null;
}
