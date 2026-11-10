"use client";

import { Check, Copy, Download, ShieldCheck } from "lucide-react";
import { useRef, useState } from "react";
import { copyText } from "@/components/templates/clipboard";
import { Button, Field, Modal, Notice, Textarea } from "@/components/ui";
import { SHARE_URL_WARN_LENGTH } from "@/lib/shareLink";

const formatCount = (count) => {
  try {
    return count.toLocaleString();
  } catch {
    return String(count);
  }
};

/**
 * The "Copy share link" dialog.
 *   { open, onClose, templateName, link: { url, length, tooLong } | null, copied: boolean, onExport() }
 * `copied` says whether the card already put the link on the clipboard when it opened the dialog.
 */
export default function ShareLinkDialog({ open, onClose, templateName, link, copied = false, onExport }) {
  const textRef = useRef(null);
  // The result of a copy made from this dialog, for this exact link.
  const [copyState, setCopyState] = useState({ url: null, ok: false });
  const url = link ? link.url : "";
  const status = copyState.url === url && url ? (copyState.ok ? "copied" : "failed") : copied ? "copied" : "idle";

  const copy = async () => {
    const ok = await copyText(url, { fallbackElement: textRef.current });
    setCopyState({ url, ok });
  };

  const statusText =
    status === "copied"
      ? "The link is on your clipboard. Paste it into a message or an e-mail."
      : status === "failed"
        ? "The link could not be copied automatically. Select it above and copy it (Ctrl+C or Cmd+C)."
        : "Copy the link and send it to whoever should get the template.";

  return (
    <Modal
      open={open && Boolean(link)}
      onClose={onClose}
      title="Share template"
      description={`Anyone who opens this link can import a copy of "${templateName}" into their own browser.`}
      footer={
        <>
          <Button onClick={onClose}>Close</Button>
          <Button variant="primary" icon={status === "copied" ? Check : Copy} onClick={copy}>
            {status === "copied" ? "Copy again" : "Copy link"}
          </Button>
        </>
      }
    >
      {link ? (
        <div className="flex flex-col gap-4">
          <Notice tone="info" icon={ShieldCheck} title="Nothing is uploaded">
            The whole template travels inside the link itself, and no server ever stores it. It holds settings only (columns,
            transforms, filters and outputs), never spreadsheet data.
          </Notice>

          <Field label="Share link" hint={`${formatCount(link.length)} characters`}>
            {(props) => (
              <Textarea
                {...props}
                ref={textRef}
                readOnly
                rows={4}
                value={url}
                spellCheck={false}
                className="font-mono text-xs break-all"
                onFocus={(event) => event.target.select()}
              />
            )}
          </Field>

          <p role="status" className="flex items-start gap-2 text-sm text-muted">
            {status === "copied" ? <Check className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden="true" /> : null}
            {statusText}
          </p>

          {link.tooLong ? (
            <Notice
              tone="warning"
              title="This link is long"
              actions={
                onExport ? (
                  <Button size="sm" icon={Download} onClick={onExport}>
                    Export as JSON
                  </Button>
                ) : null
              }
            >
              Some chat and e-mail apps cut off links longer than about {formatCount(SHARE_URL_WARN_LENGTH)} characters. If the
              link does not open, send the template as a JSON file instead.
            </Notice>
          ) : null}
        </div>
      ) : null}
    </Modal>
  );
}
