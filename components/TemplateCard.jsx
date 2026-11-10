"use client";

import { Copy, Download, PencilLine, Play, SquarePen, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import ActionMenu from "@/components/templates/ActionMenu";
import { focusOnOpen, reportFailure } from "@/components/templates/notify";
import { Badge, Button, Card, ConfirmDialog, Field, IconButton, Input, Modal } from "@/components/ui";
import { downloadJSON } from "@/lib/download";
import { NAME_MAX_LENGTH, cleanTemplateName, serializeTemplate, templateFileName } from "@/lib/templates";
import { toast } from "@/lib/toast";
import { useTemplateStore } from "@/store/useTemplateStore";
import { useWorkflowStore } from "@/store/useWorkflowStore";

const DATE_FORMAT = { dateStyle: "medium", timeStyle: "short" };

function formatDate(iso) {
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return "";
  try {
    return new Intl.DateTimeFormat(undefined, DATE_FORMAT).format(new Date(time));
  } catch {
    return new Date(time).toISOString().slice(0, 10);
  }
}

const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;

/**
 * TemplateCard (owner: Agent D). Props: { template }.
 * One saved template: name, description, last update, size, and the actions
 * Use, Edit, Duplicate, Rename, Export as JSON and Delete. On a narrow card the
 * secondary actions collapse into a "More actions" menu.
 */
export default function TemplateCard({ template }) {
  const router = useRouter();
  const titleId = useId();
  const renameFormId = useId();
  const isOpenInWorkflow = useWorkflowStore((state) => state.templateId === template.id);

  const [pendingMode, setPendingMode] = useState(null); // 'use' | 'edit' while asking to replace unsaved work
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [renameError, setRenameError] = useState("");
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const definition = template.definition || {};
  const fieldCount = Array.isArray(definition.fields) ? definition.fields.length : 0;
  const outputCount = Array.isArray(definition.outputs) ? definition.outputs.length : 0;
  const updated = formatDate(template.updatedAt);

  const openInWorkflow = (mode) => {
    useWorkflowStore.getState().applyTemplate(template, { mode });
    router.push("/workflow");
  };

  const start = (mode) => {
    const workflow = useWorkflowStore.getState();
    const hasUnsavedWork = workflow.dirty && workflow.definition.fields.length > 0;
    if (hasUnsavedWork) setPendingMode(mode);
    else openInWorkflow(mode);
  };

  const duplicate = () => {
    const result = useTemplateStore.getState().duplicateTemplate(template.id);
    if (result.ok) toast.success("Template duplicated", { description: `Created "${result.template.name}".` });
    else reportFailure(result, "Could not duplicate the template");
  };

  const openRename = () => {
    setRenameValue(template.name);
    setRenameError("");
    setRenaming(true);
  };

  const submitRename = (event) => {
    event.preventDefault();
    const name = cleanTemplateName(renameValue);
    if (!name) {
      setRenameError("Enter a name for the template.");
      return;
    }
    if (name === template.name) {
      setRenaming(false);
      return;
    }
    const result = useTemplateStore.getState().renameTemplate(template.id, name);
    if (!result.ok) {
      setRenameError(result.error || "The template could not be renamed.");
      return;
    }
    // The workflow store remembers the name of the template it came from: keep it in step.
    if (useWorkflowStore.getState().templateId === template.id) useWorkflowStore.setState({ templateName: name });
    setRenaming(false);
    toast.success("Template renamed", { description: `It is now called "${name}".` });
  };

  const exportJson = () => {
    try {
      const fileName = templateFileName(template);
      downloadJSON(serializeTemplate(template), fileName);
      toast.success("Template exported", { description: fileName });
    } catch {
      toast.error("Could not export the template", { description: "The download could not be started. Please try again." });
    }
  };

  const confirmDelete = () => {
    setConfirmingDelete(false);
    const result = useTemplateStore.getState().deleteTemplate(template.id);
    if (!result.ok) {
      reportFailure(result, "Could not delete the template");
      return;
    }
    // A workflow that came from this template keeps its definition but no longer points at a template.
    if (useWorkflowStore.getState().templateId === template.id) {
      useWorkflowStore.setState({ templateId: null, templateName: "" });
    }
    toast.success("Template deleted", { description: `"${template.name}" was removed from this browser.` });
  };

  const secondaryActions = [
    { id: "duplicate", label: "Duplicate", icon: Copy, onSelect: duplicate },
    { id: "rename", label: "Rename", icon: PencilLine, onSelect: openRename },
    { id: "export", label: "Export as JSON", icon: Download, onSelect: exportJson },
    { id: "delete", label: "Delete", icon: Trash2, tone: "danger", onSelect: () => setConfirmingDelete(true) },
  ];

  return (
    <Card as="article" aria-labelledby={titleId} className="flex min-w-0 flex-col gap-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <h3 id={titleId} title={template.name} className="line-clamp-2 min-w-0 text-base font-semibold break-words text-fg">
          {template.name}
        </h3>
        {isOpenInWorkflow ? (
          <Badge tone="brand" className="mt-0.5 shrink-0" title="The workflow you are building came from this template">
            In your workflow
          </Badge>
        ) : null}
      </div>

      <p className={`line-clamp-3 text-sm break-words ${template.description ? "text-fg" : "text-muted"}`}>
        {template.description || "No description."}
      </p>

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-xs text-muted">
        <Badge>{plural(fieldCount, "field")}</Badge>
        <Badge>{plural(outputCount, "output")}</Badge>
        {updated ? (
          <span>
            Updated <time dateTime={template.updatedAt}>{updated}</time>
          </span>
        ) : null}
      </div>

      {/* The action row is its own size container: icon buttons when they fit, a menu when they do not. */}
      <div className="@container mt-auto pt-1">
        <div className="flex items-center gap-2">
          <Button variant="primary" icon={Play} onClick={() => start("use")} aria-label={`Use template ${template.name}`}>
            Use
          </Button>
          <Button icon={SquarePen} onClick={() => start("edit")} aria-label={`Edit template ${template.name}`}>
            Edit
          </Button>
          <span className="flex-1" />
          <div className="hidden items-center gap-0.5 @[23rem]:flex">
            {secondaryActions.map((action) => (
              <IconButton
                key={action.id}
                label={action.label}
                icon={action.icon}
                variant={action.tone === "danger" ? "dangerGhost" : "ghost"}
                onClick={action.onSelect}
              />
            ))}
          </div>
          <ActionMenu label={`More actions for ${template.name}`} items={secondaryActions} className="@[23rem]:hidden" />
        </div>
      </div>

      <ConfirmDialog
        open={pendingMode !== null}
        title="Replace your current workflow?"
        message={`The workflow you are building has changes that are not saved as a template. Opening "${template.name}" replaces it.`}
        confirmLabel="Replace it"
        cancelLabel="Keep my workflow"
        onConfirm={() => {
          const mode = pendingMode;
          setPendingMode(null);
          if (mode) openInWorkflow(mode);
        }}
        onCancel={() => setPendingMode(null)}
      />

      <Modal
        open={renaming}
        onClose={() => setRenaming(false)}
        title="Rename template"
        size="sm"
        footer={
          <>
            <Button onClick={() => setRenaming(false)}>Cancel</Button>
            <Button variant="primary" type="submit" form={renameFormId}>
              Rename
            </Button>
          </>
        }
      >
        <form id={renameFormId} onSubmit={submitRename} noValidate>
          <Field label="Template name" required error={renameError}>
            {(props) => (
              <Input
                {...props}
                ref={focusOnOpen}
                value={renameValue}
                maxLength={NAME_MAX_LENGTH}
                autoComplete="off"
                onFocus={(event) => event.target.select()}
                onChange={(event) => {
                  setRenameValue(event.target.value);
                  if (renameError) setRenameError("");
                }}
              />
            )}
          </Field>
        </form>
      </Modal>

      <ConfirmDialog
        open={confirmingDelete}
        tone="danger"
        title="Delete this template?"
        message={`"${template.name}" will be removed from this browser. This cannot be undone. Export it as JSON first if you may need it again.`}
        confirmLabel="Delete"
        onConfirm={confirmDelete}
        onCancel={() => setConfirmingDelete(false)}
      />
    </Card>
  );
}
