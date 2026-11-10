"use client";

import { FileOutput, Plus } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import OutputEditor from "@/components/outputs/OutputEditor";
import OutputList from "@/components/outputs/OutputList";
import { useRestoreFocus } from "@/components/outputs/hooks";
import { Button, Card, ConfirmDialog, EmptyState, Notice } from "@/components/ui";
import { validateDefinition } from "@/lib/validate";
import { selectAvailableColumns, useWorkflowStore } from "@/store/useWorkflowStore";

/**
 * OutputsStep (owner: Agent C). Step 3 of the wizard: define the files this workflow produces.
 * No props; reads and writes `definition.outputs` through useWorkflowStore.
 *
 * Master/detail: the list of outputs on the left, the editor of the selected one on the right
 * (stacked below 1024px). The wizard chrome (title, stepper, Back/Next) belongs to the Wizard.
 */
export default function OutputsStep() {
  const definition = useWorkflowStore((state) => state.definition);
  const availableColumns = useWorkflowStore(selectAvailableColumns);
  const outputs = definition.outputs;
  const fieldCount = definition.fields.length;
  const addOutput = useWorkflowStore((state) => state.addOutput);
  const removeOutput = useWorkflowStore((state) => state.removeOutput);
  const duplicateOutput = useWorkflowStore((state) => state.duplicateOutput);
  const moveOutput = useWorkflowStore((state) => state.moveOutput);
  const setStep = useWorkflowStore((state) => state.setStep);

  const [selectedId, setSelectedId] = useState(null);
  const [deleteId, setDeleteId] = useState(null);
  const editorRef = useRef(null);
  const restoreFocus = useRestoreFocus();

  // Worst validation level per output, for the badges in the list (cheap and pure: no file needed).
  const issueLevels = useMemo(() => {
    const found = validateDefinition(definition, availableColumns);
    const levels = {};
    for (const issue of Array.isArray(found) ? found : []) {
      const id = issue && (issue.outputId || (issue.scope === "output" ? issue.id : null));
      if (!id || levels[id] === "error") continue;
      levels[id] = issue.level === "error" ? "error" : "warning";
    }
    return levels;
  }, [definition, availableColumns]);

  // Derived, so the selection survives undo/redo and deletions without an effect.
  const selected = outputs.find((output) => output.id === selectedId) || outputs[0] || null;
  const pendingDelete = outputs.find((output) => output.id === deleteId) || null;

  /** On narrow screens the editor sits below the list: bring it into view after choosing an output. */
  const revealEditor = () => {
    if (typeof window === "undefined" || !window.matchMedia("(max-width: 1023px)").matches) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    requestAnimationFrame(() => {
      if (editorRef.current) editorRef.current.scrollIntoView({ block: "start", behavior: reduced ? "auto" : "smooth" });
    });
  };

  const handleAdd = () => {
    setSelectedId(addOutput());
    revealEditor();
  };

  const handleSelect = (id) => {
    setSelectedId(id);
    revealEditor();
  };

  const handleMove = (id, direction) => {
    restoreFocus(`output:${id}:${direction < 0 ? "up" : "down"}`, `output:${id}:${direction < 0 ? "down" : "up"}`);
    moveOutput(id, direction);
  };

  const handleDuplicate = () => {
    if (selected) setSelectedId(duplicateOutput(selected.id));
  };

  const confirmDelete = () => {
    if (pendingDelete) {
      const index = outputs.findIndex((output) => output.id === pendingDelete.id);
      const neighbour = outputs[index + 1] || outputs[index - 1] || null;
      if (selected && selected.id === pendingDelete.id) setSelectedId(neighbour ? neighbour.id : null);
      removeOutput(pendingDelete.id);
    }
    setDeleteId(null);
  };

  if (!outputs.length) {
    return (
      <div className="flex flex-col gap-4">
        {!fieldCount ? (
          <Notice
            tone="warning"
            title="No fields yet"
            actions={
              <Button size="sm" variant="secondary" className="max-sm:h-10" onClick={() => setStep(1)}>
                Go to Mapping
              </Button>
            }
          >
            Outputs are built from the fields of the Mapping step. Add at least one field there first.
          </Notice>
        ) : null}
        <Card>
          <EmptyState
            icon={FileOutput}
            title="No outputs yet"
            description="An output is one file this workflow produces: an Excel sheet or a CSV, with its own fields, filters and an optional report image to share."
            action={
              <Button variant="primary" icon={Plus} onClick={handleAdd}>
                Add output
              </Button>
            }
          />
        </Card>
      </div>
    );
  }

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,19rem)_minmax(0,1fr)]">
      <div className="min-w-0 lg:sticky lg:top-4">
        <OutputList
          outputs={outputs}
          selectedId={selected ? selected.id : null}
          issueLevels={issueLevels}
          onSelect={handleSelect}
          onAdd={handleAdd}
          onMove={handleMove}
        />
      </div>

      <div ref={editorRef} className="min-w-0 scroll-mt-4">
        {selected ? (
          <OutputEditor
            key={selected.id}
            output={selected}
            onDuplicate={handleDuplicate}
            onDelete={() => setDeleteId(selected.id)}
          />
        ) : null}
      </div>

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="Delete this output?"
        message={
          pendingDelete
            ? `"${pendingDelete.name.trim() || "Untitled output"}" and its report settings will be removed from this workflow.`
            : ""
        }
        confirmLabel="Delete output"
        tone="danger"
        onConfirm={confirmDelete}
        onCancel={() => setDeleteId(null)}
      />
    </div>
  );
}
