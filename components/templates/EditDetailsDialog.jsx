"use client";

import { useId, useState } from "react";
import { focusOnOpen, isStorageFailure, reportFailure } from "@/components/templates/notify";
import TemplateMetaFields from "@/components/templates/TemplateMetaFields";
import { Button, Field, Input, Modal, Notice, Textarea } from "@/components/ui";
import { normalizeTags } from "@/lib/schema";
import { DESCRIPTION_MAX_LENGTH, NAME_MAX_LENGTH, cleanTemplateFolder, cleanTemplateName } from "@/lib/templates";
import { toast } from "@/lib/toast";
import { useTemplateStore } from "@/store/useTemplateStore";
import { useWorkflowStore } from "@/store/useWorkflowStore";

const sameList = (a, b) => a.length === b.length && a.every((item, index) => item === b[index]);

/**
 * The form inside the dialog. Mounted fresh every time the dialog opens (the Modal renders its
 * children only while open), so it always starts from the template as it is now.
 */
function EditDetailsForm({ formId, template, onDone }) {
  const [name, setName] = useState(template.name);
  const [description, setDescription] = useState(template.description || "");
  const [tags, setTags] = useState(template.tags || []);
  const [folder, setFolder] = useState(template.folder || "");
  const [nameError, setNameError] = useState("");
  const [failure, setFailure] = useState("");

  const onSubmit = (event) => {
    event.preventDefault();
    const cleanName = cleanTemplateName(name);
    if (!cleanName) {
      setNameError("Enter a name for the template.");
      return;
    }
    const patch = {
      name: cleanName,
      description: description.trim(),
      tags: normalizeTags(tags),
      folder: cleanTemplateFolder(folder),
    };
    const unchanged =
      patch.name === template.name &&
      patch.description === (template.description || "") &&
      sameList(patch.tags, template.tags || []) &&
      patch.folder === (template.folder || "");
    if (unchanged) {
      onDone();
      return;
    }
    const result = useTemplateStore.getState().updateTemplate(template.id, patch);
    if (!result.ok) {
      if (isStorageFailure(result.code)) reportFailure(result, "Could not save the details");
      setFailure(result.error || "The details could not be saved.");
      return;
    }
    // The workflow store remembers the name of the template it came from: keep it in step.
    const workflow = useWorkflowStore.getState();
    if (workflow.templateId === template.id && workflow.templateName !== result.template.name) {
      workflow.setTemplateLink({ id: template.id, name: result.template.name });
    }
    toast.success("Template details saved", { description: `"${result.template.name}" is up to date.` });
    onDone();
  };

  return (
    <form id={formId} onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      {failure ? (
        <Notice tone="error" title="The details were not saved">
          {failure}
        </Notice>
      ) : null}

      <Field label="Template name" required error={nameError}>
        {(props) => (
          <Input
            {...props}
            ref={focusOnOpen}
            value={name}
            maxLength={NAME_MAX_LENGTH}
            autoComplete="off"
            onFocus={(event) => event.target.select()}
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
    </form>
  );
}

/**
 * "Edit details" for a saved template: name, description, tags and folder (replaces "Rename").
 *   { template, open, onClose }
 * The workflow definition is not touched; use "Edit" on the card for that.
 */
export default function EditDetailsDialog({ template, open, onClose }) {
  const formId = useId();
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Edit details"
      description="Name, description, tags and folder. The workflow itself stays as it is."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form={formId}>
            Save details
          </Button>
        </>
      }
    >
      <EditDetailsForm formId={formId} template={template} onDone={onClose} />
    </Modal>
  );
}
