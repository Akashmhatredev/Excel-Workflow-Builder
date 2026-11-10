"use client";

import { ClipboardCopy, Download, ExternalLink, Image as ImageIcon, RefreshCw, Share2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { formatBytes, formatCount, plural } from "@/components/outputs/helpers";
import { useClientValue } from "@/components/outputs/hooks";
import ReportView from "@/components/ReportView";
import { Button, Notice, Segmented, Spinner } from "@/components/ui";
import { downloadBlob } from "@/lib/download";
import { sanitizeFileName } from "@/lib/schema";
import {
  WHATSAPP_WEB_URL,
  canCopyImages,
  canShareFiles,
  copyImageToClipboard,
  getCaptureSize,
  isMobileDevice,
  nodeToPngBlob,
  openWhatsAppWeb,
  pasteShortcut,
  shareImage,
} from "@/lib/share";
import { toast } from "@/lib/toast";
import TextShareForm from "./TextShareForm";

const SCALE_OPTIONS = [
  { value: 1, label: "1x" },
  { value: 2, label: "2x" },
  { value: 3, label: "3x" },
];

const COPY_FAILURES = {
  unsupported: "This browser cannot copy images to the clipboard.",
  denied: "The browser did not allow the copy.",
  unfocused: "The page lost focus before the copy finished. Click this page and try again.",
  failed: "The browser reported an error while copying.",
};

function WhatsAppWebLink({ children = "Open WhatsApp Web" }) {
  return (
    <a
      href={WHATSAPP_WEB_URL}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex min-h-10 items-center gap-1 font-medium text-fg underline underline-offset-2"
    >
      {children}
      <ExternalLink className="size-3.5" aria-hidden="true" />
    </a>
  );
}

/** The persistent result of the last share action. */
function ShareNotice({ notice, paste, onDownload, onRetry }) {
  if (!notice) return null;
  switch (notice.kind) {
    case "copied-opened":
      return (
        <Notice tone="success" title={`Image copied. Paste it into the chat with ${paste}.`}>
          <p>WhatsApp Web opened in a new tab. Choose a chat, click the message box and paste.</p>
          <WhatsAppWebLink>Open WhatsApp Web again</WhatsAppWebLink>
        </Notice>
      );
    case "copied-blocked":
      return (
        <Notice tone="warning" title="Image copied, but your browser blocked the WhatsApp tab">
          <p>Open WhatsApp Web with the link below, choose a chat and paste the image with {paste}.</p>
          <WhatsAppWebLink />
        </Notice>
      );
    case "copy-failed":
      return (
        <Notice tone="error" title="The image could not be copied">
          <p>
            {COPY_FAILURES[notice.reason] || COPY_FAILURES.failed} Download the PNG and attach it in WhatsApp Web
            instead.
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1">
            <Button variant="secondary" size="sm" icon={Download} className="max-sm:h-10" onClick={onDownload}>
              Download PNG
            </Button>
            <WhatsAppWebLink />
          </div>
        </Notice>
      );
    case "shared":
      return (
        <Notice tone="success" title="Image handed to the share sheet">
          If you chose WhatsApp, finish sending it there.
        </Notice>
      );
    case "share-failed":
      return (
        <Notice tone="error" title="The share sheet could not be opened">
          <p>Download the PNG and send it from your gallery or files instead.</p>
          <div className="mt-1">
            <Button variant="secondary" size="sm" icon={Download} className="max-sm:h-10" onClick={onDownload}>
              Download PNG
            </Button>
          </div>
        </Notice>
      );
    case "image-failed":
      return (
        <Notice
          tone="error"
          title="The image could not be created"
          actions={
            <Button variant="secondary" size="sm" icon={RefreshCw} className="max-sm:h-10" onClick={onRetry}>
              Try again
            </Button>
          }
        >
          {notice.message}
        </Notice>
      );
    default:
      return null;
  }
}

/**
 * The image section of an output with `report.enabled`: scale, PNG download and sharing.
 *
 * `snapshot` is the card's useOutputSnapshot() result, read with limit = report.maxRows.
 * A copy of ReportView is rendered off-screen at its natural size and captured with
 * nodeToPngBlob(). The PNG is prepared as soon as the rows arrive (and again when the scale
 * changes), so the click handlers can share or copy it while the user gesture is still valid.
 */
export default function ReportImagePanel({ output, snapshot }) {
  const report = output.report;
  const { data, error: dataError, loading: dataLoading, hasData, generatedAt, retry } = snapshot;

  const [scale, setScale] = useState(2);
  const [attempt, setAttempt] = useState(0);
  const [image, setImage] = useState(null);
  const [busy, setBusy] = useState(null); // "download" | "share" | "copy" | null
  const [notice, setNotice] = useState(null);
  const nodeRef = useRef(null);
  const pendingRef = useRef(null); // Promise<Blob> of the capture that is being prepared

  const canShare = useClientValue(canShareFiles, false);
  const canCopy = useClientValue(canCopyImages, false);
  const mobile = useClientValue(isMobileDevice, false);
  const paste = useClientValue(pasteShortcut, "Ctrl+V");

  useEffect(() => {
    const node = nodeRef.current;
    if (!data || !node) return undefined;
    let cancelled = false;
    let settle = null;
    const promise = new Promise((resolve, reject) => {
      settle = { resolve, reject };
    });
    promise.catch(() => {}); // consumers handle it; an unused preparation must not log
    pendingRef.current = promise;
    const stamp = { data, report, scale, attempt };
    const timer = setTimeout(() => {
      const size = getCaptureSize(node, scale);
      nodeToPngBlob(node, { scale }).then(
        (blob) => {
          settle.resolve(blob);
          if (!cancelled) setImage({ ...stamp, blob, size, url: URL.createObjectURL(blob), error: null });
        },
        (error) => {
          settle.reject(error);
          if (!cancelled) setImage({ ...stamp, blob: null, size, url: null, error: error.message });
        },
      );
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      settle.reject(new Error("The report changed while the image was being prepared. Try again."));
      if (pendingRef.current === promise) pendingRef.current = null;
    };
  }, [data, report, scale, attempt]);

  const imageUrl = image ? image.url : null;
  useEffect(() => {
    if (!imageUrl) return undefined;
    return () => URL.revokeObjectURL(imageUrl);
  }, [imageUrl]);

  const fresh =
    Boolean(image) &&
    image.data === data &&
    image.report === report &&
    image.scale === scale &&
    image.attempt === attempt;
  const ready = fresh && Boolean(image.blob);
  const failed = fresh && Boolean(image.error);
  const preparing = Boolean(data) && !fresh;

  const title = report.title.trim() || output.name.trim() || "Report";
  const fileName = `${sanitizeFileName(output.name, "report")}.png`;
  const showCopy = !(mobile && canShare);

  const textLines = [title];
  if (report.subtitle.trim()) textLines.push(report.subtitle.trim());
  if (data) textLines.push(plural(data.totalRows, "row"));
  const defaultText = textLines.join("\n");

  /** The finished PNG when there is one (so the caller stays inside the user gesture), else its promise. */
  const currentBlob = () => {
    if (ready) return image.blob;
    return pendingRef.current || Promise.reject(new Error("The image is not ready yet. Try again in a moment."));
  };

  const fail = (error) => {
    const message = (error && error.message) || "The image could not be created.";
    setNotice({ kind: "image-failed", message });
    toast.error("Could not create the image", { description: message });
  };

  const handleDownload = async () => {
    setBusy("download");
    setNotice(null);
    try {
      const blob = await currentBlob();
      downloadBlob(blob, fileName);
      toast.success("PNG downloaded", { description: fileName });
    } catch (error) {
      fail(error);
    } finally {
      setBusy(null);
    }
  };

  const handleShare = async () => {
    setBusy("share");
    setNotice(null);
    try {
      const source = currentBlob();
      // No await when the PNG is ready: navigator.share must start inside the click.
      const blob = source instanceof Blob ? source : await source;
      const result = await shareImage(blob, { fileName, title });
      if (result.ok) setNotice({ kind: "shared" });
      else if (result.reason !== "cancelled") setNotice({ kind: "share-failed" });
    } catch (error) {
      fail(error);
    } finally {
      setBusy(null);
    }
  };

  const handleCopy = async () => {
    setBusy("copy");
    setNotice(null);
    // The write starts synchronously inside the click; a pending PNG travels as a promise.
    const copied = await copyImageToClipboard(currentBlob());
    if (copied.ok) {
      // Only now: the new tab takes the focus, and the clipboard needs a focused document.
      const opened = openWhatsAppWeb();
      setNotice({ kind: opened.ok ? "copied-opened" : "copied-blocked" });
    } else {
      setNotice({ kind: "copy-failed", reason: copied.reason });
    }
    setBusy(null);
  };

  const retryImage = () => {
    setNotice(null);
    setAttempt((n) => n + 1);
  };

  let status = "Upload a file to create the image.";
  if (hasData && dataLoading) status = "Reading the rows for the image";
  else if (preparing) status = "Preparing the image";
  else if (ready) {
    status = `PNG ready: ${formatCount(image.size.pixelWidth)} x ${formatCount(image.size.pixelHeight)} px, ${formatBytes(image.blob.size)}`;
  } else if (failed || dataError) status = "The image is not available.";

  const actionsDisabled = !data || failed || busy !== null;

  return (
    <section className="flex min-w-0 flex-col gap-4 border-t border-line pt-4" aria-label={`Report image of ${title}`}>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h4 className="flex items-center gap-2 text-sm font-semibold text-fg">
            <ImageIcon className="size-4 text-muted" aria-hidden="true" />
            Report image
          </h4>
          <p className="mt-0.5 flex items-center gap-2 text-xs text-muted" role="status" aria-live="polite">
            {(hasData && dataLoading) || preparing ? <Spinner className="size-3.5" label="Working" /> : null}
            {status}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted" aria-hidden="true">
            Scale
          </span>
          <Segmented label="Image scale" size="sm" options={SCALE_OPTIONS} value={scale} onChange={setScale} />
        </div>
      </div>

      {dataError ? (
        <Notice
          tone="error"
          title="The rows for the image could not be read"
          actions={
            <Button variant="secondary" size="sm" icon={RefreshCw} className="max-sm:h-10" onClick={retry}>
              Try again
            </Button>
          }
        >
          {dataError}
        </Notice>
      ) : null}

      {failed ? <ShareNotice notice={{ kind: "image-failed", message: image.error }} onRetry={retryImage} /> : null}

      {ready ? (
        <>
          <div
            role="region"
            aria-label="Preview of the PNG"
            tabIndex={0}
            className="max-h-80 overflow-auto rounded-lg border border-line bg-surface-2 p-3"
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- a blob: URL of the generated PNG; next/image cannot optimise it */}
            <img
              src={image.url}
              alt={`${title}: ${plural(Math.min(data.rows.length, report.maxRows), "row")} as an image`}
              width={image.size.pixelWidth}
              height={image.size.pixelHeight}
              className="mx-auto h-auto max-w-full shadow-card"
              style={{ width: image.size.width }}
            />
          </div>
          {image.size.reduced ? (
            <Notice tone="warning" title={`Exported at ${image.size.scale}x instead of ${image.size.requestedScale}x`}>
              This report is {formatCount(image.size.height)} px tall, which is more than a browser can draw at a
              higher scale. Lower &quot;Max rows&quot; in the Outputs step for a sharper image.
            </Notice>
          ) : null}
        </>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {canShare ? (
          <Button
            variant="primary"
            icon={Share2}
            loading={busy === "share"}
            disabled={actionsDisabled}
            onClick={handleShare}
          >
            Share image
          </Button>
        ) : null}
        <Button
          variant={canShare ? "secondary" : "primary"}
          icon={Download}
          loading={busy === "download"}
          disabled={actionsDisabled}
          onClick={handleDownload}
        >
          Download PNG
        </Button>
        {showCopy && canCopy ? (
          <Button
            variant="secondary"
            icon={ClipboardCopy}
            loading={busy === "copy"}
            disabled={actionsDisabled}
            onClick={handleCopy}
            className="h-auto! min-h-10 max-w-full py-2 text-left whitespace-normal!"
          >
            Copy image and open WhatsApp Web
          </Button>
        ) : null}
      </div>

      <div className="flex flex-col gap-1 text-sm text-muted">
        {canShare ? <p>Share image opens your device&apos;s share sheet. Pick WhatsApp there to send the picture.</p> : null}
        {showCopy ? (
          <p>
            WhatsApp Web cannot receive an image automatically.{" "}
            {canCopy
              ? `The copy button puts the image on your clipboard and opens WhatsApp Web: choose a chat, then paste it with ${paste} or attach the downloaded PNG.`
              : "This browser cannot copy images, so download the PNG and attach it in the chat yourself."}
          </p>
        ) : null}
        {showCopy && !canCopy ? <WhatsAppWebLink /> : null}
      </div>

      {/* Always mounted so screen readers announce the result; the negative margin hides its flex gap while empty. */}
      <div aria-live="polite" className="-mt-4 [&:not(:empty)]:mt-0">
        {notice && notice.kind !== "image-failed" ? (
          <ShareNotice notice={notice} paste={paste} onDownload={handleDownload} onRetry={retryImage} />
        ) : null}
        {notice && notice.kind === "image-failed" && !failed ? (
          <ShareNotice notice={notice} onRetry={retryImage} />
        ) : null}
      </div>

      <details className="group rounded-lg border border-line">
        <summary className="flex min-h-11 cursor-pointer items-center px-3 text-sm font-medium text-fg select-none sm:px-4">
          Send a text message instead
        </summary>
        <div className="border-t border-line p-3 sm:p-4">
          <TextShareForm defaultText={defaultText} />
        </div>
      </details>

      {data && typeof document !== "undefined"
        ? createPortal(
            <div aria-hidden="true" style={{ position: "fixed", left: -100000, top: 0, pointerEvents: "none" }}>
              <ReportView
                ref={nodeRef}
                report={report}
                columns={data.columns}
                rows={data.rows}
                totalRows={data.totalRows}
                generatedAt={generatedAt}
              />
            </div>,
            document.body,
          )
        : null}
    </section>
  );
}
