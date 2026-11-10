/**
 * lib/shareLink.js: put a template's JSON into a URL hash so it can be shared as a link.
 * Nothing is uploaded anywhere: the whole template travels inside the link itself.
 *
 *   const payload = await compressToUrl(JSON.stringify(serializeTemplate(template)));
 *   const url = buildShareUrl(window.location.origin, payload);       // .../templates#template=c.<data>
 *   ...
 *   const payload = readSharePayload(window.location.hash);
 *   const text = await decompressFromUrl(payload);                    // -> parseTemplateJson(text)
 *
 * Payload format: "c.<base64url of deflate-raw bytes>" or, when CompressionStream is missing,
 * "u.<base64url of UTF-8 bytes>".
 *
 * Template helpers (the two steps above in one call each):
 *   createTemplateShareUrl(template, origin) -> Promise<{ url, length, tooLong }>
 *   readSharedTemplate(payload)              -> Promise<parseTemplateJson result>   never rejects
 *   hashWithoutSharePayload(hash)            -> the hash to keep once the payload has been read
 *
 * QR codes are deliberately not offered: a template link is usually thousands of characters,
 * far beyond what a phone camera reads reliably from a screen.
 */

import { parseTemplateJson, serializeTemplate } from "./templates";

export const SHARE_PARAM = "template";
/** Links longer than this are often cut off by chat apps; warn the user. */
export const SHARE_URL_WARN_LENGTH = 6000;
const MAX_DECODED_BYTES = 2_000_000;

function bytesToBase64Url(bytes) {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlToBytes(text) {
  const base64 = text.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function pipeThrough(bytes, stream, limit = Infinity) {
  const writer = stream.writable.getWriter();
  // Errors surface on the reader; swallow them here so they are not reported twice.
  writer.write(bytes).catch(() => {});
  writer.close().catch(() => {});
  const reader = stream.readable.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > limit) {
      await reader.cancel().catch(() => {});
      throw new Error("The shared template is too large.");
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/** Compress text into a URL-safe payload. */
export async function compressToUrl(text) {
  const bytes = new TextEncoder().encode(String(text ?? ""));
  if (typeof CompressionStream === "function") {
    try {
      return `c.${bytesToBase64Url(await pipeThrough(bytes, new CompressionStream("deflate-raw")))}`;
    } catch {
      // fall through to the uncompressed form
    }
  }
  return `u.${bytesToBase64Url(bytes)}`;
}

/**
 * Tidy a payload that went through a chat app or an e-mail: line breaks and spaces inserted when the
 * link was wrapped, and punctuation glued to its end (a full stop, a closing bracket or quote).
 */
function tidyPayload(payload) {
  const value = String(payload ?? "").replace(/\s+/g, "");
  return value.slice(0, 2) + value.slice(2).replace(/[^A-Za-z0-9_-]+$/, "");
}

/** Reverse of compressToUrl. Throws an Error with a user-facing message when the payload is unusable. */
export async function decompressFromUrl(payload) {
  const value = tidyPayload(payload);
  const kind = value.slice(0, 2);
  const data = value.slice(2);
  if ((kind !== "c." && kind !== "u.") || !data || !/^[A-Za-z0-9_-]+$/.test(data)) {
    throw new Error("This share link is not valid.");
  }
  let bytes;
  try {
    bytes = base64UrlToBytes(data);
  } catch {
    throw new Error("This share link is damaged.");
  }
  if (kind === "c.") {
    if (typeof DecompressionStream !== "function") {
      throw new Error("This browser cannot open compressed share links.");
    }
    try {
      bytes = await pipeThrough(bytes, new DecompressionStream("deflate-raw"), MAX_DECODED_BYTES);
    } catch (error) {
      throw new Error(error && /too large/.test(error.message) ? error.message : "This share link is damaged or incomplete.");
    }
  } else if (bytes.length > MAX_DECODED_BYTES) {
    throw new Error("The shared template is too large.");
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("This share link is damaged.");
  }
}

export function buildShareUrl(origin, payload, path = "/templates") {
  return `${String(origin || "").replace(/\/+$/, "")}${path}#${SHARE_PARAM}=${payload}`;
}

/** Extract the payload from a location hash ("#template=..."), or null when there is none. */
export function readSharePayload(hash) {
  let text = String(hash || "").replace(/^#/, "");
  if (text.includes("%")) {
    try {
      text = decodeURIComponent(text); // some apps percent-encode the "=" of the hash
    } catch {
      // keep the raw text
    }
  }
  for (const part of text.split("&")) {
    const index = part.indexOf("=");
    if (index > 0 && part.slice(0, index).trim() === SHARE_PARAM) return part.slice(index + 1).trim() || null;
  }
  return null;
}

/** The location hash without the share payload ("" when nothing else is left), for history.replaceState. */
export function hashWithoutSharePayload(hash) {
  const text = String(hash || "").replace(/^#/, "");
  const rest = text.split("&").filter((part) => {
    const index = part.indexOf("=");
    return part && !(index > 0 && part.slice(0, index).trim() === SHARE_PARAM);
  });
  return rest.length ? `#${rest.join("&")}` : "";
}

/**
 * The share link for one template: its export JSON, compressed into the hash of a /templates URL.
 * @returns {Promise<{ url: string, length: number, tooLong: boolean }>}
 */
export async function createTemplateShareUrl(template, origin) {
  const payload = await compressToUrl(JSON.stringify(serializeTemplate(template)));
  const url = buildShareUrl(origin, payload);
  return { url, length: url.length, tooLong: url.length > SHARE_URL_WARN_LENGTH };
}

/**
 * Decode a share payload and validate it like an imported file. Never rejects.
 * @returns {Promise<{ ok: true, templates: object[], warnings: string[], skipped: number } | { ok: false, errors: string[] }>}
 */
export async function readSharedTemplate(payload) {
  let text;
  try {
    text = await decompressFromUrl(payload);
  } catch (error) {
    return { ok: false, errors: [(error && error.message) || "This share link could not be read."] };
  }
  return parseTemplateJson(text);
}
