"use client";

import { Copy, Download, Folder, Layers, Link2, PencilLine, Play, SquarePen, Tag, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import ActionMenu from "@/components/templates/ActionMenu";
import { copyText } from "@/components/templates/clipboard";
import EditDetailsDialog from "@/components/templates/EditDetailsDialog";
import { reportFailure } from "@/components/templates/notify";
import ShareLinkDialog from "@/components/templates/ShareLinkDialog";
import { Badge, Button, Card, ConfirmDialog, IconButton } from "@/components/ui";
import { downloadJSON } from "@/lib/download";
import { createTemplateShareUrl } from "@/lib/shareLink";
import { serializeTemplate, templateFileName } from "@/lib/templates";
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
 * TemplateCard (owner: Agent D / X4). Props: { template, showFolder = true }.
 * One saved template: folder, name, description, tags, last update, size, and the actions
 * Use, Edit, Duplicate, Edit details, Copy share link, Export as JSON, Run on several files
 * and Delete. On a narrow card the secondary actions collapse into a "More actions" menu.
 * `showFolder={false}` hides the folder line (the Templates page already groups by folder).
 */
export default function TemplateCard({ template, showFolder = true }) {
  const router = useRouter();
  const titleId = useId();
  const isOpenInWorkflow = useWorkflowStore((state) => state.templateId === template.id);

  const [pendingMode, setPendingMode] = useState(null); // 'use' | 'edit' while asking to replace unsaved work
  const [editingDetails, setEditingDetails] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [sharing, setSharing] = useState(false); // building the share link
  const [share, setShare] = useState(null); // { link, copied } while the share dialog is open

  const definition = template.definition || {};
  const fieldCount = Array.isArray(definition.fields) ? definition.fields.length : 0;
  const outputCount = Array.isArray(definition.outputs) ? definition.outputs.length : 0;
  const updated = formatDate(template.updatedAt);
  const tags = Array.isArray(template.tags) ? template.tags : [];
  const folder = typeof template.folder === "string" ? template.folder : "";

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

  /** Build the link, try to put it on the clipboard straight away, then show it in a dialog. */
  const openShare = async () => {
    if (sharing) return;
    setSharing(true);
    try {
      const link = await createTemplateShareUrl(template, window.location.origin);
      const copied = await copyText(link.url);
      setShare({ link, copied });
    } catch {
      toast.error("Could not create the share link", { description: "Please try again, or export the template as JSON." });
    } finally {
      setSharing(false);
    }
  };

  const runInBatch = () => router.push(`/batch?template=${encodeURIComponent(template.id)}`);

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
      useWorkflowStore.getState().setTemplateLink({ id: null, name: "" });
    }
    toast.success("Template deleted", { description: `"${template.name}" was removed from this browser.` });
  };

  const secondaryActions = [
    { id: "duplicate", label: "Duplicate", icon: Copy, onSelect: duplicate },
    { id: "details", label: "Edit details", icon: PencilLine, onSelect: () => setEditingDetails(true) },
    { id: "share", label: sharing ? "Creating share link" : "Copy share link", icon: Link2, onSelect: openShare },
    { id: "export", label: "Export as JSON", icon: Download, onSelect: exportJson },
    { id: "batch", label: "Run on several files", icon: Layers, onSelect: runInBatch },
    { id: "delete", label: "Delete", icon: Trash2, tone: "danger", onSelect: () => setConfirmingDelete(true) },
  ];

  return (
    <Card as="article" aria-labelledby={titleId} className="flex min-w-0 flex-col gap-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {showFolder && folder ? (
            <p className="mb-0.5 flex min-w-0 items-center gap-1 text-xs text-muted">
              <Folder className="size-3.5 shrink-0" aria-hidden="true" />
              <span className="sr-only">Folder: </span>
              <span className="truncate">{folder}</span>
            </p>
          ) : null}
          <h3 id={titleId} title={template.name} className="line-clamp-2 min-w-0 text-base font-semibold break-words text-fg">
            {template.name}
          </h3>
        </div>
        {isOpenInWorkflow ? (
          <Badge tone="brand" className="mt-0.5 shrink-0" title="The workflow you are building came from this template">
            In your workflow
          </Badge>
        ) : null}
      </div>

      <p className={`line-clamp-3 text-sm break-words ${template.description ? "text-fg" : "text-muted"}`}>
        {template.description || "No description."}
      </p>

      {tags.length ? (
        <ul aria-label="Tags" className="flex flex-wrap gap-1.5">
          {tags.map((tag) => (
            <li key={tag} className="min-w-0">
              <Badge tone="brand" className="max-w-full">
                <Tag className="size-3 shrink-0" aria-hidden="true" />
                <span className="truncate">{tag}</span>
              </Badge>
            </li>
          ))}
        </ul>
      ) : null}

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
          <div className="hidden items-center gap-0.5 @[28rem]:flex">
            {secondaryActions.map((action) => (
              <IconButton
                key={action.id}
                label={action.label}
                icon={action.icon}
                variant={action.tone === "danger" ? "dangerGhost" : "ghost"}
                aria-busy={action.id === "share" && sharing ? true : undefined}
                onClick={action.onSelect}
              />
            ))}
          </div>
          <ActionMenu label={`More actions for ${template.name}`} items={secondaryActions} className="@[28rem]:hidden" />
        </div>
      </div>

      <EditDetailsDialog template={template} open={editingDetails} onClose={() => setEditingDetails(false)} />

      <ShareLinkDialog
        open={share !== null}
        onClose={() => setShare(null)}
        templateName={template.name}
        link={share ? share.link : null}
        copied={share ? share.copied : false}
        onExport={exportJson}
      />

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
