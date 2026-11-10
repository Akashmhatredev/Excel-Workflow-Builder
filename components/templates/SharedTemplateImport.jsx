"use client";

import { Download, Folder, Link2, Tag } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { replaceLocationHash, useLocationHash } from "@/components/templates/locationHash";
import { focusOnOpen, reportFailure } from "@/components/templates/notify";
import { Badge, Button, Modal, Notice } from "@/components/ui";
import { normalizeName, uniqueName } from "@/lib/schema";
import { hashWithoutSharePayload, readSharePayload, readSharedTemplate } from "@/lib/shareLink";
import { toast } from "@/lib/toast";
import { useTemplateStore } from "@/store/useTemplateStore";

const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;

/** Take the payload out of the address bar (any other part of the hash stays). */
function clearPayload() {
  replaceLocationHash(hashWithoutSharePayload(window.location.hash));
}

function SharedSummary({ template, existingNames }) {
  const definition = template.definition || {};
  const fields = Array.isArray(definition.fields) ? definition.fields.length : 0;
  const outputs = Array.isArray(definition.outputs) ? definition.outputs : [];
  const finalName = uniqueName(template.name, existingNames);
  const renamed = normalizeName(finalName) !== normalizeName(template.name);
  return (
    <section className="flex min-w-0 flex-col gap-2 rounded-lg border border-line bg-surface-2 p-3.5">
      {template.folder ? (
        <p className="flex items-center gap-1 text-xs text-muted">
          <Folder className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="sr-only">Folder: </span>
          {template.folder}
        </p>
      ) : null}
      <h3 className="text-base font-semibold break-words text-fg">{template.name}</h3>
      {template.description ? <p className="text-sm break-words text-fg">{template.description}</p> : null}
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge>{plural(fields, "field")}</Badge>
        <Badge>{plural(outputs.length, "output")}</Badge>
        {(template.tags || []).map((tag) => (
          <Badge key={tag} tone="brand">
            <Tag className="size-3" aria-hidden="true" />
            {tag}
          </Badge>
        ))}
      </div>
      {outputs.length ? (
        <p className="text-sm text-muted">
          Outputs: {outputs.map((output) => `${output.name} (.${output.fileType})`).join(", ")}
        </p>
      ) : null}
      {renamed ? (
        <p className="text-sm text-muted">
          You already have a template called &ldquo;{template.name}&rdquo;, so this one will be added as &ldquo;{finalName}&rdquo;.
        </p>
      ) : null}
    </section>
  );
}

/**
 * Opens when the page URL carries a shared template ("/templates#template=c.<data>", made by
 * "Copy share link" on a template card). The payload is decoded and validated in the browser,
 * then the user decides whether to import it.
 *
 * As soon as the link has been read, its payload is taken out of the address bar (so a reload or
 * a bookmark does not offer it again) and the dialog works from the decoded result kept in state.
 * It must not depend on the hash staying put: Next.js applies history.replaceState through its
 * router a moment later, and a hash that changes in between can be overwritten.
 * No props; render it once on the Templates page.
 */
export default function SharedTemplateImport() {
  const hash = useLocationHash();
  const payload = readSharePayload(hash);
  const templates = useTemplateStore((state) => state.templates);
  const existingNames = useMemo(() => templates.map((template) => template.name), [templates]);
  const [decoded, setDecoded] = useState(null); // { result } of the last link read, until the dialog closes

  useEffect(() => {
    if (!payload) return undefined;
    let cancelled = false;
    readSharedTemplate(payload).then((result) => {
      if (cancelled) return;
      setDecoded({ result });
      clearPayload();
    });
    return () => {
      cancelled = true;
    };
  }, [payload]);

  const result = decoded ? decoded.result : null;
  const open = Boolean(result);
  const shared = result && result.ok ? result.templates : [];
  const close = () => setDecoded(null);

  const importShared = () => {
    if (!shared.length) return;
    const outcome = useTemplateStore.getState().importTemplates(shared);
    if (!outcome.ok) {
      reportFailure(outcome, "Could not import the shared template");
      return;
    }
    const names = outcome.added.map((template) => `"${template.name}"`).join(", ");
    toast.success(outcome.added.length === 1 ? "Shared template imported" : `Imported ${outcome.added.length} shared templates`, {
      description: `${names} ${outcome.added.length === 1 ? "is" : "are"} now saved in this browser.`,
    });
    close();
  };

  if (result && !result.ok) {
    return (
      <Modal
        open={open}
        onClose={close}
        title="This share link could not be opened"
        description="The link may have been cut off when it was sent. Ask for it again, or for the template as a JSON file."
        footer={
          <Button variant="primary" onClick={close}>
            Close
          </Button>
        }
      >
        <Notice tone="error" title="What went wrong">
          <ul className="mt-1 flex list-disc flex-col gap-1 pl-5 break-words">
            {result.errors.map((message, index) => (
              <li key={index}>{message}</li>
            ))}
          </ul>
        </Notice>
      </Modal>
    );
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title={shared.length > 1 ? `Import ${shared.length} shared templates?` : "Import shared template?"}
      description="Someone shared this with you as a link. The template came inside the link itself: nothing was downloaded from a server, and importing saves it in this browser only."
      footer={
        <>
          <Button onClick={close}>Not now</Button>
          <Button variant="primary" icon={Download} ref={focusOnOpen} onClick={importShared}>
            {shared.length > 1 ? "Import all" : "Import"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {shared.map((template, index) => (
          <SharedSummary key={`${template.id}-${index}`} template={template} existingNames={existingNames} />
        ))}
        {result && result.warnings.length ? (
          <ul className="flex list-disc flex-col gap-1 pl-5 text-sm break-words text-muted">
            {result.warnings.map((message, index) => (
              <li key={index}>{message}</li>
            ))}
          </ul>
        ) : null}
        <p className="flex items-start gap-2 text-xs text-muted">
          <Link2 className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          A template holds settings only (columns, transforms, filters and outputs), never spreadsheet data.
        </p>
      </div>
    </Modal>
  );
}
