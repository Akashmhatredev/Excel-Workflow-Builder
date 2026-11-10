"use client";

import { ExternalLink, Send } from "lucide-react";
import { useState } from "react";
import { Button, Field, Input, Notice, Textarea } from "@/components/ui";
import { buildWhatsAppTextUrl, normalizePhone, openInNewTab } from "@/lib/share";

const MAX_MESSAGE = 2000;

/**
 * Text-only WhatsApp share: a message (prefilled from the report) and an optional phone number,
 * opened as a wa.me link in a new tab. A link can carry text only, never the image.
 */
export default function TextShareForm({ defaultText }) {
  const [draft, setDraft] = useState(null); // null = still showing the suggested text
  const [phone, setPhone] = useState("");
  const [phoneTouched, setPhoneTouched] = useState(false);
  const [blockedUrl, setBlockedUrl] = useState(null);

  const text = draft !== null ? draft : defaultText;
  const parsed = normalizePhone(phone);
  const message = text.trim();
  const url = buildWhatsAppTextUrl(message, parsed.valid ? parsed.digits : "");
  const phoneError = phoneTouched && !parsed.valid ? parsed.error : undefined;

  const send = () => {
    setPhoneTouched(true);
    if (!message || !parsed.valid) return;
    const opened = openInNewTab(url);
    setBlockedUrl(opened.ok ? null : url);
  };

  return (
    <div className="flex flex-col gap-4">
      <Field
        label="Message"
        hint={`${text.length} of ${MAX_MESSAGE} characters. WhatsApp opens with this text ready to send.`}
        error={!message ? "Write a message to send." : undefined}
      >
        {(p) => (
          <Textarea
            {...p}
            rows={4}
            maxLength={MAX_MESSAGE}
            value={text}
            onChange={(event) => {
              setDraft(event.target.value);
              setBlockedUrl(null);
            }}
          />
        )}
      </Field>
      <Field
        label="Phone number (optional)"
        hint="Digits with the country code, for example 919876543210. Leave it empty to choose the chat in WhatsApp."
        error={phoneError}
      >
        {(p) => (
          <Input
            {...p}
            type="tel"
            inputMode="tel"
            autoComplete="off"
            maxLength={24}
            placeholder="919876543210"
            value={phone}
            onChange={(event) => {
              setPhone(event.target.value);
              setBlockedUrl(null);
            }}
            onBlur={() => setPhoneTouched(true)}
          />
        )}
      </Field>
      <div>
        <Button variant="secondary" icon={Send} disabled={!message || (phoneTouched && !parsed.valid)} onClick={send}>
          Send text on WhatsApp
        </Button>
      </div>
      <div aria-live="polite">
        {blockedUrl ? (
          <Notice tone="warning" title="Your browser blocked the new tab">
            <a
              href={blockedUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-10 items-center gap-1 font-medium text-fg underline underline-offset-2"
            >
              Open WhatsApp with this message
              <ExternalLink className="size-3.5" aria-hidden="true" />
            </a>
          </Notice>
        ) : null}
      </div>
    </div>
  );
}
