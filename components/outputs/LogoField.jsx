"use client";

import { ImagePlus, Trash2 } from "lucide-react";
import { useId, useRef, useState } from "react";
import { Button, Field } from "@/components/ui";
import { toast } from "@/lib/toast";
import { formatBytes } from "./helpers";
import { LOGO_ACCEPT, dataUrlBytes, dataUrlFormat, prepareLogo } from "./logo";
import NumberInput from "./NumberInput";

/**
 * Logo of a report image: upload (png, jpeg or webp; resized in the browser so it fits inside a
 * template), its display height in px, and Remove.
 * `onChange(patch)` receives { logo } or { logoHeight } (merged into output.report by the store).
 */
export default function LogoField({ logo, logoHeight, onChange }) {
  const inputRef = useRef(null);
  const titleId = useId();
  const errorId = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const pick = () => {
    if (inputRef.current) inputRef.current.click();
  };

  const handleFile = async (event) => {
    const input = event.target;
    const file = input.files && input.files[0];
    input.value = ""; // choosing the same file again must fire a change
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const prepared = await prepareLogo(file);
      onChange({ logo: prepared.dataUrl });
      toast.success(logo ? "Logo replaced" : "Logo added", {
        description: `Stored at ${prepared.width} x ${prepared.height} px, ${formatBytes(prepared.bytes)}.`,
      });
    } catch (failure) {
      const message =
        failure && failure.code === "LOGO_REJECTED" ? failure.message : "The logo could not be prepared. Try another image.";
      setError(message);
      toast.error("Logo not added", { description: message });
    } finally {
      setBusy(false);
    }
  };

  const remove = () => {
    setError("");
    onChange({ logo: "" });
  };

  return (
    <div role="group" aria-labelledby={titleId} className="flex min-w-0 flex-col gap-3 rounded-lg border border-line p-3 sm:p-4">
      <div className="min-w-0">
        <p id={titleId} className="text-sm font-medium text-fg">
          Logo
        </p>
        <p className="mt-0.5 text-xs text-muted">
          PNG, JPEG or WebP. It is resized in your browser and saved with the workflow, never uploaded. Shown left of the
          title, or above it when it is wide.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {logo ? (
          <div className="flex h-16 max-w-full min-w-16 items-center justify-center rounded-lg border border-line bg-surface-2 p-2">
            {/* eslint-disable-next-line @next/next/no-img-element -- an inline data URL; next/image cannot optimise it */}
            <img src={logo} alt="Current logo" className="block h-full w-auto max-w-56 object-contain" />
          </div>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            icon={ImagePlus}
            loading={busy}
            className="max-sm:h-10"
            aria-describedby={error ? errorId : undefined}
            onClick={pick}
          >
            {busy ? "Preparing the logo" : logo ? "Replace logo" : "Upload logo"}
          </Button>
          {logo ? (
            <Button variant="dangerGhost" size="sm" icon={Trash2} className="max-sm:h-10" disabled={busy} onClick={remove}>
              Remove logo
            </Button>
          ) : null}
        </div>
        <input
          ref={inputRef}
          type="file"
          accept={LOGO_ACCEPT}
          className="hidden"
          tabIndex={-1}
          aria-hidden="true"
          onChange={handleFile}
        />
      </div>

      {logo ? (
        <p className="text-xs text-muted">
          Stored as {dataUrlFormat(logo) || "an image"}, {formatBytes(dataUrlBytes(logo))}.
        </p>
      ) : null}

      <p id={errorId} role="alert" className="text-sm text-danger empty:hidden">
        {error}
      </p>

      {logo ? (
        <Field label="Logo height (px)" hint="16 to 120 px in the image." className="max-w-48">
          {(p) => (
            <NumberInput {...p} value={logoHeight} min={16} max={120} onCommit={(value) => onChange({ logoHeight: value })} />
          )}
        </Field>
      ) : null}
    </div>
  );
}
