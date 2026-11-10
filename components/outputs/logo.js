/**
 * Report logo preparation (owner: X3). Browser only: called from an event handler.
 *
 * A logo is stored inside the definition (and so in templates and localStorage) as a data URL,
 * so it has to be small: it must fit REPORT_LOGO_MAX_CHARS. The image is checked (png, jpeg or
 * webp by content, never SVG, which can carry script), drawn onto a canvas at about 3x the largest
 * display height (crisp 3x exports), re-encoded as WebP or PNG and shrunk until it fits.
 */

import { REPORT_LOGO_MAX_CHARS } from "@/lib/schema";

export const LOGO_TYPES = ["image/png", "image/jpeg", "image/webp"];
export const LOGO_ACCEPT = ".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp";
/** Largest display height (report.logoHeight is clamped to 16..120) times the 3x export scale. */
export const LOGO_TARGET_HEIGHT = 360;
const LOGO_MAX_WIDTH = 1440;
const LOGO_MIN_HEIGHT = 16;
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const DATA_URL_PATTERN = /^data:image\/(png|jpeg|webp);base64,[a-z0-9+/=]+$/i;

const SVG_MESSAGE =
  "SVG logos are not supported, because an SVG file can contain scripts. Save the logo as a PNG (or JPEG / WebP) and upload that.";
const TYPE_MESSAGE = "Choose a PNG, JPEG or WebP image for the logo.";

function logoError(message) {
  const error = new Error(message);
  error.code = "LOGO_REJECTED";
  return error;
}

/** The real image type from the first bytes of a file, or null. */
export function sniffImageType(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(0);
  const at = (i) => (i < b.length ? b[i] : -1);
  if (at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47 && at(4) === 0x0d && at(5) === 0x0a) {
    return "image/png";
  }
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return "image/jpeg";
  const text = (from, to) => String.fromCharCode(...b.slice(from, to));
  if (b.length >= 12 && text(0, 4) === "RIFF" && text(8, 12) === "WEBP") return "image/webp";
  // SVG (or any XML / HTML): text that starts with "<" after an optional BOM and whitespace.
  const head = new TextDecoder("utf-8", { fatal: false }).decode(b).replace(/^﻿/, "").trimStart().toLowerCase();
  if (head.startsWith("<svg") || head.startsWith("<?xml") || head.startsWith("<!doctype svg")) return "image/svg+xml";
  return null;
}

/** Quick check from the name and the declared type, before reading the file. */
export function checkLogoFile(file) {
  if (!file) return { ok: false, message: TYPE_MESSAGE };
  const name = String(file.name || "").toLowerCase();
  const type = String(file.type || "").toLowerCase();
  if (type === "image/svg+xml" || name.endsWith(".svg") || name.endsWith(".svgz")) return { ok: false, message: SVG_MESSAGE };
  const knownType = LOGO_TYPES.includes(type);
  const knownName = /\.(png|jpe?g|webp)$/.test(name);
  if (!knownType && !(type === "" && knownName)) return { ok: false, message: TYPE_MESSAGE };
  if (file.size > MAX_FILE_BYTES) {
    return { ok: false, message: "That image is larger than 20 MB. Choose a smaller logo file." };
  }
  if (!file.size) return { ok: false, message: "That file is empty." };
  return { ok: true, message: "" };
}

/** Pixel size to draw at: at most LOGO_TARGET_HEIGHT tall and LOGO_MAX_WIDTH wide, never enlarged. */
export function logoDrawSize(width, height) {
  const scale = Math.min(1, LOGO_TARGET_HEIGHT / height, LOGO_MAX_WIDTH / width);
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** Approximate stored size of a data URL in bytes. */
export function dataUrlBytes(dataUrl) {
  const comma = String(dataUrl || "").indexOf(",");
  return comma < 0 ? 0 : Math.floor(((dataUrl.length - comma - 1) * 3) / 4);
}

/** "WebP" / "PNG" / "JPEG" from a data URL. */
export function dataUrlFormat(dataUrl) {
  const match = /^data:image\/(png|jpeg|webp);/i.exec(String(dataUrl || ""));
  if (!match) return "";
  const type = match[1].toLowerCase();
  return type === "webp" ? "WebP" : type.toUpperCase();
}

async function decode(file) {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file);
    } catch {
      // fall through to <img>, which some browsers decode more leniently
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function sizeOf(source) {
  return {
    width: source.naturalWidth || source.width || 0,
    height: source.naturalHeight || source.height || 0,
  };
}

/** Draw `source` at width x height, halving in steps for big reductions (smoother than one jump). */
function drawScaled(source, width, height) {
  let current = source;
  let { width: w, height: h } = sizeOf(source);
  while (w / 2 >= width * 1.5 && h / 2 >= height * 1.5) {
    w = Math.round(w / 2);
    h = Math.round(h / 2);
    const step = document.createElement("canvas");
    step.width = w;
    step.height = h;
    const context = step.getContext("2d");
    context.imageSmoothingQuality = "high";
    context.drawImage(current, 0, 0, w, h);
    current = step;
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw logoError("This browser could not prepare the logo.");
  context.imageSmoothingQuality = "high";
  context.drawImage(current, 0, 0, width, height);
  return canvas;
}

function encode(canvas, type, quality) {
  try {
    const url = canvas.toDataURL(type, quality);
    // Browsers that cannot write WebP silently return a PNG: only accept what was asked for.
    return url.startsWith(`data:${type};base64,`) && DATA_URL_PATTERN.test(url) ? url : "";
  } catch {
    return "";
  }
}

/**
 * Turn an uploaded file into a logo data URL that fits the template limit.
 * Rejects with a user-facing message (error.code 'LOGO_REJECTED') when the file is not usable.
 *
 * @param {File} file
 * @returns {Promise<{ dataUrl: string, width: number, height: number, bytes: number }>}
 */
export async function prepareLogo(file, { maxChars = REPORT_LOGO_MAX_CHARS } = {}) {
  const check = checkLogoFile(file);
  if (!check.ok) throw logoError(check.message);

  const head = new Uint8Array(await file.slice(0, 64).arrayBuffer());
  const sniffed = sniffImageType(head);
  if (sniffed === "image/svg+xml") throw logoError(SVG_MESSAGE);
  if (!LOGO_TYPES.includes(sniffed)) {
    throw logoError("This file is not a PNG, JPEG or WebP image, even though its name says so. Choose another file.");
  }

  let source;
  try {
    source = await decode(file);
  } catch {
    throw logoError("The image could not be read. It may be damaged; try saving it again as a PNG.");
  }

  try {
    const natural = sizeOf(source);
    if (!natural.width || !natural.height) throw logoError("The image could not be read. Try another file.");
    let { width, height } = logoDrawSize(natural.width, natural.height);

    for (let attempt = 0; attempt < 14; attempt += 1) {
      const canvas = drawScaled(source, width, height);
      // Best quality first: WebP (small, keeps transparency), lossless PNG, then a lighter WebP.
      const candidates = [encode(canvas, "image/webp", 0.92), encode(canvas, "image/png"), encode(canvas, "image/webp", 0.8)];
      const fitting = candidates.find((url) => url && url.length <= maxChars);
      if (fitting) return { dataUrl: fitting, width, height, bytes: dataUrlBytes(fitting) };

      const shortest = candidates.filter(Boolean).sort((a, b) => a.length - b.length)[0];
      if (!shortest) throw logoError("This browser could not encode the logo. Try another browser.");
      // Area scales roughly with the encoded size: shrink by the square root of the overshoot.
      const factor = Math.min(0.9, Math.max(0.5, Math.sqrt(maxChars / shortest.length) * 0.95));
      width = Math.max(1, Math.round(width * factor));
      height = Math.max(1, Math.round(height * factor));
      if (height < LOGO_MIN_HEIGHT) break;
    }
    throw logoError("This image is too detailed to store as a logo. Try a simpler or smaller image.");
  } finally {
    if (source && typeof source.close === "function") source.close();
  }
}
