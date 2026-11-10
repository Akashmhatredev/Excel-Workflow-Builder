"use client";

import { useEffect } from "react";
import { useWorkflowStore } from "@/store/useWorkflowStore";

const EDITABLE = "input, textarea, select, [contenteditable]:not([contenteditable='false'])";

function isEditing(target) {
  return typeof Element !== "undefined" && target instanceof Element && Boolean(target.closest(EDITABLE));
}

/**
 * Ctrl/Cmd+Z undoes and Ctrl/Cmd+Shift+Z (or Ctrl+Y) redoes the last workflow change.
 * The keys are left alone while focus is in a text control, so the browser's own
 * undo keeps working there, and while a dialog is open.
 */
export function useUndoShortcuts() {
  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.defaultPrevented || event.altKey || !(event.ctrlKey || event.metaKey)) return;
      const key = String(event.key || "").toLowerCase();
      const undo = key === "z" && !event.shiftKey;
      const redo = (key === "z" && event.shiftKey) || (key === "y" && event.ctrlKey && !event.shiftKey);
      if (!undo && !redo) return;
      if (isEditing(event.target) || document.querySelector("dialog[open]")) return;
      event.preventDefault();
      const state = useWorkflowStore.getState();
      if (undo) state.undo();
      else state.redo();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
