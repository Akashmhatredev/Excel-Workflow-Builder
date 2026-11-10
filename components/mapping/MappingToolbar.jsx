"use client";

import { Plus, Redo2, Undo2, Wand2 } from "lucide-react";
import { Button } from "@/components/ui";
import { selectCanRedo, selectCanUndo, useWorkflowStore } from "@/store/useWorkflowStore";

/** Mapping actions: map every column, add a field, undo and redo. */
export default function MappingToolbar({ canMapAll, onMapAll, onAddField }) {
  const undo = useWorkflowStore((state) => state.undo);
  const redo = useWorkflowStore((state) => state.redo);
  const canUndo = useWorkflowStore(selectCanUndo);
  const canRedo = useWorkflowStore(selectCanRedo);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        variant="soft"
        icon={Wand2}
        onClick={onMapAll}
        disabled={!canMapAll}
        title={canMapAll ? "Add one field for every source column that is not mapped yet" : "Upload a file to map its columns"}
      >
        Map all columns
      </Button>
      <Button variant="secondary" icon={Plus} onClick={onAddField}>
        Add field
      </Button>
      <span className="flex-1" />
      <div role="group" aria-label="History" className="flex items-center gap-2">
        <Button
          variant="secondary"
          icon={Undo2}
          onClick={undo}
          disabled={!canUndo}
          title="Undo (Ctrl/Cmd+Z)"
          aria-keyshortcuts="Control+Z Meta+Z"
        >
          Undo
        </Button>
        <Button
          variant="secondary"
          icon={Redo2}
          onClick={redo}
          disabled={!canRedo}
          title="Redo (Ctrl/Cmd+Shift+Z)"
          aria-keyshortcuts="Control+Shift+Z Meta+Shift+Z"
        >
          Redo
        </Button>
      </div>
    </div>
  );
}
