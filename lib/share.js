/**
 * lib/share.js (owner: Agent C): PNG capture, Web Share, clipboard and WhatsApp helpers.
 *
 * Browser only, but safe to import anywhere: nothing touches the DOM at module load and
 * every function feature-detects. `nodeToPngBlob` is the only function that rejects (with a
 * user-facing message). Everything else resolves to `{ ok: true }` or `{ ok: false, reason }`.
 *
 * Contract (CONTRACTS.md section 10):
 *   nodeToPngBlob(node, { scale = 2, backgroundColor? }) -> Promise<Blob>
 *   canShareFiles() -> boolean
 *   shareImage(blob, { fileName, title, text }) -> Promise<{ ok, reason?: 'unsupported'|'cancelled'|'failed' }>
 *   copyImageToClipboard(blob | Promise<Blob>) -> Promise<{ ok, reason?: 'unsupported'|'denied'|'unfocused'|'failed' }>
 *   buildWhatsAppTextUrl(text, phone) -> string
 *   openWhatsAppWeb() -> { ok, reason?: 'unsupported'|'blocked' }
 *
 * Extra helpers: getCaptureSize, canCopyImages, blobToFile, openInNewTab, normalizePhone,
 * isMacPlatform, isMobileDevice, pasteShortcut, WHATSAPP_WEB_URL.
 */

export const WHATSAPP_WEB_URL = "https://web.whatsapp.com/";

const PNG = "image/png";

/* Canvas limits. Browsers silently return an empty image above these. */
const MAX_CANVAS_SIDE = 16384;
const MAX_CANVAS_AREA = 64_000_000; // ~256 MB of RGBA, well inside desktop limits
const MAX_CANVAS_AREA_APPLE_TOUCH = 16_000_000; // iOS / iPadOS cap the canvas at 16.7 million pixels

/**
 * The computed-style properties html-to-image copies onto each cloned element. Its default is
 * every property the browser knows (about 400), which makes a 500-row table take several seconds
 * and tens of megabytes. This list covers box, table, flex, text and paint properties: everything
 * a static poster such as ReportView uses. Longhand names only (computed styles have no shorthands).
 */
const SIDES = ["top", "right", "bottom", "left"];
const CORNERS = ["top-left", "top-right", "bottom-right", "bottom-left"];
const CAPTURE_STYLE_PROPERTIES = [
  "display", "position", "float", "clear", "z-index", "box-sizing", "visibility", "opacity",
  ...SIDES,
  "width", "height", "min-width", "min-height", "max-width", "max-height", "aspect-ratio",
  ...SIDES.map((side) => `margin-${side}`),
  ...SIDES.map((side) => `padding-${side}`),
  ...SIDES.flatMap((side) => [`border-${side}-width`, `border-${side}-style`, `border-${side}-color`]),
  ...CORNERS.map((corner) => `border-${corner}-radius`),
  "overflow-x", "overflow-y", "box-shadow", "transform", "transform-origin",
  "background-color", "background-image", "background-size", "background-repeat", "background-clip",
  "background-origin", "background-position-x", "background-position-y",
  "color", "font-family", "font-size", "font-style", "font-weight", "font-stretch", "font-kerning",
  "font-variant-numeric", "font-variant-caps", "font-feature-settings", "font-variation-settings",
  "font-optical-sizing", "line-height", "letter-spacing", "word-spacing", "text-align", "text-indent",
  "text-transform", "text-overflow", "text-shadow", "text-decoration-line", "text-decoration-style",
  "text-decoration-color", "text-decoration-thickness", "text-underline-offset", "text-rendering",
  "white-space", "word-break", "overflow-wrap", "hyphens", "tab-size", "vertical-align", "direction",
  "unicode-bidi", "writing-mode", "-webkit-font-smoothing", "-moz-osx-font-smoothing",
  "table-layout", "border-collapse", "border-spacing", "caption-side", "empty-cells",
  "flex-direction", "flex-wrap", "flex-grow", "flex-shrink", "flex-basis", "justify-content",
  "justify-items", "justify-self", "align-items", "align-self", "align-content", "row-gap", "column-gap",
  "order", "grid-template-columns", "grid-template-rows", "grid-auto-flow", "grid-auto-columns",
  "grid-auto-rows", "grid-column-start", "grid-column-end", "grid-row-start", "grid-row-end",
  "list-style-type", "list-style-position", "object-fit", "object-position",
  "fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin",
];

/* ------------------------------------------------------------------ */
/* platform detection                                                   */
/* ------------------------------------------------------------------ */

function nav() {
  return typeof navigator === "undefined" ? null : navigator;
}

function platformName() {
  const n = nav();
  if (!n) return "";
  return String((n.userAgentData && n.userAgentData.platform) || n.platform || "");
}

/** iPhone, iPod and iPad (iPadOS reports itself as a Mac with a touch screen). */
function isAppleTouchDevice() {
  const n = nav();
  if (!n) return false;
  if (/iPhone|iPad|iPod/i.test(n.userAgent || "")) return true;
  return /Mac/i.test(platformName()) && Number(n.maxTouchPoints) > 1;
}

/** WebKit (Safari, and every browser on iOS) needs a warm-up capture: see nodeToPngBlob. */
function isWebKit() {
  const n = nav();
  if (!n) return false;
  const ua = n.userAgent || "";
  if (isAppleTouchDevice()) return true;
  return /Safari\//.test(ua) && !/Chrome\/|Chromium\/|Edg\/|OPR\/|Android/.test(ua);
}

/** True on macOS, iOS and iPadOS: the paste shortcut is Cmd+V there. */
export function isMacPlatform() {
  return /mac|iphone|ipad|ipod/i.test(platformName()) || isAppleTouchDevice();
}

/** "Cmd+V" on Apple platforms, otherwise "Ctrl+V". */
export function pasteShortcut() {
  return isMacPlatform() ? "Cmd+V" : "Ctrl+V";
}

/** Phones and tablets, where WhatsApp is an app and the system share sheet is the right path. */
export function isMobileDevice() {
  const n = nav();
  if (!n) return false;
  if (n.userAgentData && typeof n.userAgentData.mobile === "boolean" && n.userAgentData.mobile) return true;
  return /Android|iPhone|iPod|iPad/i.test(n.userAgent || "") || isAppleTouchDevice();
}

/* ------------------------------------------------------------------ */
/* PNG capture                                                          */
/* ------------------------------------------------------------------ */

function clampScale(scale) {
  const value = Number(scale);
  if (!Number.isFinite(value) || value <= 0) return 2;
  return Math.min(Math.max(value, 0.25), 4);
}

/**
 * The pixel size a capture of `node` will have, after keeping the canvas inside browser limits.
 * A very tall report cannot always be rendered at 2x or 3x: `reduced` is true when the scale was lowered.
 *
 * @returns {{ width: number, height: number, scale: number, requestedScale: number, reduced: boolean,
 *   pixelWidth: number, pixelHeight: number }}
 */
export function getCaptureSize(node, scale = 2) {
  const requestedScale = clampScale(scale);
  const width = node && Number(node.offsetWidth) > 0 ? Number(node.offsetWidth) : 0;
  const height = node && Number(node.offsetHeight) > 0 ? Number(node.offsetHeight) : 0;
  if (!width || !height) {
    return { width, height, scale: requestedScale, requestedScale, reduced: false, pixelWidth: 0, pixelHeight: 0 };
  }
  const maxArea = isAppleTouchDevice() ? MAX_CANVAS_AREA_APPLE_TOUCH : MAX_CANVAS_AREA;
  const limit = Math.min(MAX_CANVAS_SIDE / width, MAX_CANVAS_SIDE / height, Math.sqrt(maxArea / (width * height)));
  const effective = Math.min(requestedScale, Math.floor(limit * 100) / 100);
  return {
    width,
    height,
    scale: effective,
    requestedScale,
    reduced: effective < requestedScale,
    pixelWidth: Math.floor(width * effective),
    pixelHeight: Math.floor(height * effective),
  };
}

function captureError(message, cause) {
  const error = new Error(message);
  error.code = "CAPTURE_FAILED";
  if (cause) error.cause = cause;
  return error;
}

/** Wait for web fonts (bounded), so the capture is not drawn with a fallback font. */
async function fontsReady(doc) {
  if (!doc || !doc.fonts || !doc.fonts.ready) return;
  let timer = null;
  try {
    await Promise.race([
      doc.fonts.ready,
      new Promise((resolve) => {
        timer = setTimeout(resolve, 1500);
      }),
    ]);
  } catch {
    // fonts.ready never rejects in practice; a fallback font is still a usable image
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Render a DOM node to a PNG blob with html-to-image.
 * The node must be attached to the document and laid out at its natural size
 * (it may sit off-screen or inside a CSS-transformed ancestor).
 *
 * @param {HTMLElement} node
 * @param {{ scale?: number, backgroundColor?: string }} [options]  scale = device-independent pixel ratio (1, 2, 3)
 * @returns {Promise<Blob>} image/png. Rejects with an Error whose message can be shown to the user.
 */
export async function nodeToPngBlob(node, { scale = 2, backgroundColor } = {}) {
  if (typeof window === "undefined" || typeof document === "undefined") {
    throw captureError("Images can only be created in the browser.");
  }
  if (!node || !node.ownerDocument || !node.isConnected) {
    throw captureError("The report is not ready yet. Try again in a moment.");
  }
  const size = getCaptureSize(node, scale);
  if (!size.width || !size.height) {
    throw captureError("The report has no size yet. Try again in a moment.");
  }

  let toBlob;
  try {
    ({ toBlob } = await import("html-to-image"));
  } catch (error) {
    throw captureError("The image library could not be loaded. Check your connection and try again.", error);
  }

  await fontsReady(node.ownerDocument);

  const options = { pixelRatio: size.scale, cacheBust: false, includeStyleProperties: CAPTURE_STYLE_PROPERTIES };
  if (backgroundColor) options.backgroundColor = backgroundColor;

  // WebKit decodes fonts embedded in the intermediate SVG lazily, so the first capture can come
  // out with fallback fonts. A cheap throw-away pass makes the real one reliable.
  if (isWebKit()) {
    try {
      await toBlob(node, { ...options, pixelRatio: Math.min(size.scale, 1) });
    } catch {
      // the real attempt below reports the failure
    }
  }

  let blob = null;
  try {
    blob = await toBlob(node, options);
  } catch (error) {
    throw captureError("The browser could not create the image. Try a smaller scale or fewer rows.", error);
  }
  if (!blob || !blob.size) {
    throw captureError("The browser could not create the image. Try a smaller scale or fewer rows.");
  }
  return blob.type === PNG ? blob : new Blob([blob], { type: PNG });
}

/* ------------------------------------------------------------------ */
/* Web Share API                                                        */
/* ------------------------------------------------------------------ */

/** Wrap a blob in a File (the Web Share API only accepts File objects). Returns null when File is missing. */
export function blobToFile(blob, fileName = "report.png") {
  if (!blob || typeof File === "undefined") return null;
  try {
    return new File([blob], fileName || "report.png", { type: blob.type || PNG, lastModified: Date.now() });
  } catch {
    return null;
  }
}

let shareFilesSupport = null;

/** True when the browser can hand a PNG file to the system share sheet (phones, and some desktops). */
export function canShareFiles() {
  const n = nav();
  if (!n || typeof n.share !== "function" || typeof n.canShare !== "function") return false;
  if (shareFilesSupport === null) {
    try {
      const probe = blobToFile(new Blob([new Uint8Array([137, 80, 78, 71])], { type: PNG }), "probe.png");
      shareFilesSupport = Boolean(probe && n.canShare({ files: [probe] }));
    } catch {
      shareFilesSupport = false;
    }
  }
  return shareFilesSupport;
}

/**
 * Open the system share sheet with the image attached (the user picks WhatsApp there).
 * Must be called from a user gesture. Cancelling is reported as reason "cancelled", not as a failure.
 *
 * @returns {Promise<{ ok: boolean, reason?: 'unsupported'|'cancelled'|'failed', message?: string }>}
 */
export async function shareImage(blob, { fileName = "report.png", title = "", text = "" } = {}) {
  if (!blob || !canShareFiles()) return { ok: false, reason: "unsupported" };
  const file = blobToFile(blob, fileName);
  if (!file) return { ok: false, reason: "unsupported" };
  const n = nav();
  let data = { files: [file] };
  if (title) data.title = String(title);
  if (text) data.text = String(text);
  try {
    if (!n.canShare(data)) data = { files: [file] };
    if (!n.canShare(data)) return { ok: false, reason: "unsupported" };
    await n.share(data);
    return { ok: true };
  } catch (error) {
    if (error && error.name === "AbortError") return { ok: false, reason: "cancelled" };
    return { ok: false, reason: "failed", message: (error && error.message) || "" };
  }
}

/* ------------------------------------------------------------------ */
/* clipboard                                                            */
/* ------------------------------------------------------------------ */

/** True when the browser can put an image on the clipboard. */
export function canCopyImages() {
  const n = nav();
  return Boolean(
    n && n.clipboard && typeof n.clipboard.write === "function" && typeof ClipboardItem !== "undefined",
  );
}

function asPng(blob) {
  if (!blob) throw new Error("There is no image to copy.");
  return blob.type === PNG ? blob : new Blob([blob], { type: PNG });
}

function clipboardFailure(error) {
  const name = (error && error.name) || "";
  const message = (error && error.message) || "";
  if (typeof document !== "undefined" && typeof document.hasFocus === "function" && !document.hasFocus()) {
    return { ok: false, reason: "unfocused", message };
  }
  if (name === "NotAllowedError" || name === "SecurityError") return { ok: false, reason: "denied", message };
  return { ok: false, reason: "failed", message };
}

/**
 * Copy a PNG to the clipboard. Call it from a user gesture, with the document focused.
 *
 * `source` may be a Blob or a Promise<Blob>. Pass the promise when the image is still being
 * produced: Safari only accepts the write if it starts inside the click handler, and it takes the
 * pending blob through `new ClipboardItem({ "image/png": promise })`.
 *
 * @returns {Promise<{ ok: boolean, reason?: 'unsupported'|'denied'|'unfocused'|'failed', message?: string }>}
 */
export async function copyImageToClipboard(source) {
  if (!canCopyImages()) return { ok: false, reason: "unsupported" };
  const n = nav();
  const pending = Promise.resolve(source).then(asPng);
  pending.catch(() => {}); // surfaced below; never an unhandled rejection

  let item = null;
  try {
    item = new ClipboardItem({ [PNG]: pending });
  } catch {
    item = null; // older Chromium only takes resolved blobs
  }

  try {
    if (item) {
      await n.clipboard.write([item]);
      return { ok: true };
    }
  } catch (error) {
    // Promise-valued items are rejected with a TypeError by engines that lack them: retry below.
    if (!error || error.name !== "TypeError") return clipboardFailure(error);
  }

  try {
    const blob = await pending;
    await n.clipboard.write([new ClipboardItem({ [PNG]: blob })]);
    return { ok: true };
  } catch (error) {
    return clipboardFailure(error);
  }
}

/* ------------------------------------------------------------------ */
/* WhatsApp                                                             */
/* ------------------------------------------------------------------ */

/**
 * Light validation of an optional phone number for wa.me links.
 * Accepts digits with spaces, dashes, dots, brackets and a leading "+" or "00".
 *
 * @returns {{ digits: string, valid: boolean, empty: boolean, error: string }}
 */
export function normalizePhone(input) {
  const raw = String(input ?? "").trim();
  if (!raw) return { digits: "", valid: true, empty: true, error: "" };
  if (/[^\d\s().+-]/.test(raw)) {
    return { digits: "", valid: false, empty: false, error: "Use digits only, starting with the country code." };
  }
  let digits = raw.replace(/\D/g, "");
  if (/^\s*00/.test(raw)) digits = digits.slice(2);
  if (digits.startsWith("0")) {
    return { digits, valid: false, empty: false, error: "Start with the country code, without a leading 0." };
  }
  if (digits.length < 8 || digits.length > 15) {
    return { digits, valid: false, empty: false, error: "Enter 8 to 15 digits, including the country code." };
  }
  return { digits, valid: true, empty: false, error: "" };
}

/**
 * Click-to-chat link with a prefilled text message. `phone` is optional: without it WhatsApp
 * asks which chat to use. Images cannot be attached through a link.
 */
export function buildWhatsAppTextUrl(text = "", phone = "") {
  const digits = String(phone ?? "").replace(/\D/g, "");
  const message = String(text ?? "");
  const query = message ? `?text=${encodeURIComponent(message)}` : "";
  return `https://wa.me/${digits}${query}`;
}

/**
 * Open a URL in a new tab and report whether the browser allowed it.
 * (`noopener` in the features string would make window.open return null even on success,
 * so the opener is cut manually instead.)
 *
 * @returns {{ ok: boolean, reason?: 'unsupported'|'blocked' }}
 */
export function openInNewTab(url) {
  if (typeof window === "undefined" || typeof window.open !== "function") return { ok: false, reason: "unsupported" };
  let opened = null;
  try {
    opened = window.open(url, "_blank");
  } catch {
    opened = null;
  }
  if (!opened) return { ok: false, reason: "blocked" };
  try {
    opened.opener = null;
  } catch {
    // cross-origin already: nothing to cut
  }
  return { ok: true };
}

/**
 * Open WhatsApp Web in a new tab. It cannot receive an image automatically: the user pastes or
 * attaches it. Call it only after the clipboard write resolved (the new tab takes the focus).
 *
 * @returns {{ ok: boolean, reason?: 'unsupported'|'blocked' }}
 */
export function openWhatsAppWeb() {
  return openInNewTab(WHATSAPP_WEB_URL);
}
