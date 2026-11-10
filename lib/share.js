/**
 * lib/share.js (owner: Agent C). STUB: see CONTRACTS.md for the contract.
 * PNG export, Web Share, clipboard and WhatsApp helpers (browser only).
 */

export async function nodeToPngBlob() {
  throw new Error("nodeToPngBlob is not implemented yet.");
}

export function canShareFiles() {
  return false;
}

export async function shareImage() {
  return { ok: false, reason: "unsupported" };
}

export async function copyImageToClipboard() {
  return { ok: false, reason: "unsupported" };
}

export function buildWhatsAppTextUrl(text = "", phone = "") {
  const digits = String(phone).replace(/\D/g, "");
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

export function openWhatsAppWeb() {
  if (typeof window !== "undefined") window.open("https://web.whatsapp.com", "_blank", "noopener,noreferrer");
}
