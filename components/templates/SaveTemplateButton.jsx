"use client";

import { BookmarkPlus, Download } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { focusOnOpen, isStorageFailure } from "@/components/templates/notify";
import TemplateMetaFields from "@/components/templates/TemplateMetaFields";
import { Button, Field, Input, Modal, Notice, Textarea } from "@/components/ui";
import { downloadJSON } from "@/lib/download";
import { normalizeName, normalizeTags, uniqueName } from "@/lib/schema";
import {
  DESCRIPTION_MAX_LENGTH,
  NAME_MAX_LENGTH,
  cleanTemplateFolder,
  cleanTemplateName,
  serializeTemplate,
  templateFileName,
} from "@/lib/templates";
import { toast } from "@/lib/toast";
import { useTemplateStore } from "@/store/useTemplateStore";
import { useWorkflowStore } from "@/store/useWorkflowStore";

const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;
const shorten = (text, max = 28) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

/**
 * SaveTemplateButton (owner: Agent D). Props: { size, variant, className }.
 * "Save as template", available at every wizard step. Saves the workflow
 * *definition* only (useWorkflowStore.definition), never spreadsheet data.
 * When the workflow came from a template that still exists it offers
 * "Update '<name>'" next to "Save as new".
 */
export default function SaveTemplateButton({ size = "md", variant = "secondary", className }) {
  const formId = useId();
  const fieldCount = useWorkflowStore((state) => state.definition.fields.length);
  const outputCount = useWorkflowStore((state) => state.definition.outputs.length);
  const templateId = useWorkflowStore((state) => state.templateId);
  const templates = useTemplateStore((state) => state.templates);
  const existing = useMemo(
    () => (templateId ? templates.find((template) => template.id === templateId) || null : null),
    [templates, templateId],
  );

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState([]);
  const [folder, setFolder] = useState("");
  const [nameError, setNameError] = useState("");
  const [failure, setFailure] = useState(null); // { message, code } from the last failed save

  const cleanName = cleanTemplateName(name);
  // The name a brand-new template would get: names are kept unique so the list stays readable.
  const newName = useMemo(
    () => (cleanName ? uniqueName(cleanName, templates.map((template) => template.name)) : ""),
    [cleanName, templates],
  );
  const willBeRenamed = Boolean(cleanName) && normalizeName(newName) !== normalizeName(cleanName);
  const disabled = fieldCount === 0;

  const openDialog = () => {
    const workflow = useWorkflowStore.getState();
    setName(existing ? existing.name : workflow.templateName || "");
    setDescription(existing ? existing.description : "");
    setTags(existing ? existing.tags || [] : []);
    setFolder(existing ? existing.folder || "" : "");
    setNameError("");
    setFailure(null);
    setOpen(true);
  };

  const close = () => setOpen(false);

  const save = (intent) => {
    if (!cleanName) {
      setNameError("Enter a name for the template.");
      return;
    }
    const workflow = useWorkflowStore.getState();
    const { definition } = workflow;
    if (!definition.fields.length) {
      setFailure({ message: "Add at least one field in the Mapping step before saving a template.", code: "invalid" });
      return;
    }
    const store = useTemplateStore.getState();
    const updating = intent === "update" && existing;
    const meta = { tags: normalizeTags(tags), folder: cleanTemplateFolder(folder) };
    const result = updating
      ? store.updateTemplate(existing.id, { name: cleanName, description, ...meta, definition })
      : store.saveTemplate({ name: newName, description, ...meta, definition });
    if (!result.ok) {
      setFailure({ message: result.error || "The template could not be saved.", code: result.code });
      return;
    }
    workflow.markTemplateSaved({ id: result.template.id, name: result.template.name });
    toast.success(updating ? "Template updated" : "Template saved", {
      description: `"${result.template.name}" is on the Templates page.`,
    });
    setOpen(false);
  };

  const onSubmit = (event) => {
    event.preventDefault();
    save(existing ? "update" : "new");
  };

  /** When storage refuses the template, the user can still keep it as a file. */
  const downloadInstead = () => {
    try {
      const template = {
        name: cleanName || "Untitled template",
        description,
        tags,
        folder,
        definition: useWorkflowStore.getState().definition,
      };
      const fileName = templateFileName(template);
      downloadJSON(serializeTemplate(template), fileName);
      toast.success("Template downloaded", { description: `${fileName} can be imported on the Templates page.` });
    } catch {
      toast.error("Could not download the template");
    }
  };

  return (
    <>
      <Button
        size={size}
        variant={variant}
        className={className}
        icon={BookmarkPlus}
        disabled={disabled}
        title={disabled ? "Add at least one field in the Mapping step to save this workflow as a template" : undefined}
        onClick={openDialog}
      >
        Save as template
      </Button>

      <Modal
        open={open}
        onClose={close}
        title="Save as template"
        description="A template keeps your settings (sheet, mapping, transforms, filters and outputs) so you can reuse them on the next file. It never contains your spreadsheet data."
        footer={
          <>
            <Button onClick={close}>Cancel</Button>
            {existing ? <Button onClick={() => save("new")}>Save as new</Button> : null}
            <Button variant="primary" type="submit" form={formId} title={existing ? `Update "${existing.name}"` : undefined}>
              {existing ? `Update "${shorten(existing.name)}"` : "Save template"}
            </Button>
          </>
        }
      >
        <form id={formId} onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
          {failure ? (
            <Notice
              tone="error"
              title="The template was not saved"
              actions={
                isStorageFailure(failure.code) ? (
                  <Button size="sm" icon={Download} onClick={downloadInstead}>
                    Download as JSON
                  </Button>
                ) : null
              }
            >
              {failure.message}
            </Notice>
          ) : null}

          <Field
            label="Template name"
            required
            error={nameError}
            hint={
              willBeRenamed
                ? existing
                  ? `"Save as new" will name the copy "${newName}".`
                  : `You already have a template called "${cleanName}". This one will be saved as "${newName}".`
                : undefined
            }
          >
            {(props) => (
              <Input
                {...props}
                ref={focusOnOpen}
                value={name}
                maxLength={NAME_MAX_LENGTH}
                autoComplete="off"
                placeholder="For example: Monthly sales report"
                onChange={(event) => {
                  setName(event.target.value);
                  if (nameError) setNameError("");
                }}
              />
            )}
          </Field>

          <Field label="Description" hint="Optional. What the template is for, or which file it expects.">
            {(props) => (
              <Textarea
                {...props}
                value={description}
                maxLength={DESCRIPTION_MAX_LENGTH}
                onChange={(event) => setDescription(event.target.value)}
              />
            )}
          </Field>

          <TemplateMetaFields tags={tags} onTagsChange={setTags} folder={folder} onFolderChange={setFolder} />

          <p className="text-sm text-muted">
            {existing ? `This workflow came from "${existing.name}". ` : ""}
            Saving {plural(fieldCount, "field")} and {plural(outputCount, "output")}.
          </p>
        </form>
      </Modal>
    </>
  );
}
