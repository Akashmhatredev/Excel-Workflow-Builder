/** Browser download helpers (client only). */

export function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.rel = "noopener";
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/** bytes: Uint8Array | ArrayBuffer */
export function downloadBytes(bytes, fileName, mime = "application/octet-stream") {
  downloadBlob(new Blob([bytes], { type: mime }), fileName);
}

export function downloadText(text, fileName, mime = "text/plain;charset=utf-8") {
  downloadBlob(new Blob([text], { type: mime }), fileName);
}

export function downloadJSON(value, fileName) {
  downloadText(JSON.stringify(value, null, 2), fileName, "application/json");
}
