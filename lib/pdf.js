/**
 * lib/pdf.js: write a one-page PDF that contains a single JPEG image. No dependencies.
 * Used to export a report view as PDF: render the report to PNG, convert to JPEG, wrap it here.
 */

const A4 = { width: 595.28, height: 841.89 }; // points

function ascii(text) {
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) bytes[i] = text.charCodeAt(i) & 0xff;
  return bytes;
}

/**
 * A PDF text string. Printable ASCII stays a literal string; anything else (₹, accents, Devanagari)
 * becomes a UTF-16BE hex string with a byte-order mark, which every PDF reader shows correctly.
 */
export function pdfString(text) {
  const value = String(text ?? "").replace(/[\u0000-\u001f\u007f]/g, " ");
  if (/^[\x20-\x7e]*$/.test(value)) return `(${value.replace(/([\\()])/g, "\\$1")})`;
  let hex = "FEFF";
  for (let i = 0; i < value.length; i += 1) hex += value.charCodeAt(i).toString(16).toUpperCase().padStart(4, "0");
  return `<${hex}>`;
}

const round = (n) => Math.round(n * 100) / 100;

/**
 * @param {{ jpeg: Uint8Array, width: number, height: number, title?: string,
 *           page?: 'fit' | 'a4', margin?: number, pixelRatio?: number }} options
 *   width/height: pixel size of the JPEG. pixelRatio: how many image pixels make one CSS pixel
 *   (the PNG export scale), used to size the 'fit' page. 'a4' scales the image to fit one A4 page.
 * @returns {Uint8Array} the PDF file
 */
export function imageToPdf({ jpeg, width, height, title = "Report", page = "fit", margin = 24, pixelRatio = 1 }) {
  if (!(jpeg instanceof Uint8Array) || !jpeg.length) throw new Error("imageToPdf needs JPEG bytes.");
  if (!(width > 0) || !(height > 0)) throw new Error("imageToPdf needs the image size.");

  // 1 CSS pixel = 0.75 pt
  const naturalWidth = (width / (pixelRatio || 1)) * 0.75;
  const naturalHeight = (height / (pixelRatio || 1)) * 0.75;
  let pageWidth;
  let pageHeight;
  let drawWidth;
  let drawHeight;
  if (page === "a4") {
    const landscape = naturalWidth > naturalHeight;
    pageWidth = landscape ? A4.height : A4.width;
    pageHeight = landscape ? A4.width : A4.height;
    const scale = Math.min((pageWidth - margin * 2) / naturalWidth, (pageHeight - margin * 2) / naturalHeight, 1);
    drawWidth = naturalWidth * scale;
    drawHeight = naturalHeight * scale;
  } else {
    drawWidth = naturalWidth;
    drawHeight = naturalHeight;
    pageWidth = drawWidth + margin * 2;
    pageHeight = drawHeight + margin * 2;
  }
  const x = (pageWidth - drawWidth) / 2;
  const y = page === "a4" ? pageHeight - margin - drawHeight : margin;
  const content = `q ${round(drawWidth)} 0 0 ${round(drawHeight)} ${round(x)} ${round(y)} cm /Im0 Do Q`;

  const objects = [
    ascii("<< /Type /Catalog /Pages 2 0 R >>"),
    ascii("<< /Type /Pages /Kids [3 0 R] /Count 1 >>"),
    ascii(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${round(pageWidth)} ${round(pageHeight)}] ` +
        "/Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>",
    ),
    [
      ascii(
        `<< /Type /XObject /Subtype /Image /Width ${Math.round(width)} /Height ${Math.round(height)} ` +
          `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`,
      ),
      jpeg,
      ascii("\nendstream"),
    ],
    ascii(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`),
    ascii(`<< /Title ${pdfString(title)} /Producer (Excel Workflow Builder) >>`),
  ];

  const parts = [ascii("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")];
  const offsets = [];
  let length = parts[0].length;
  const push = (bytes) => {
    parts.push(bytes);
    length += bytes.length;
  };
  objects.forEach((body, index) => {
    offsets.push(length);
    push(ascii(`${index + 1} 0 obj\n`));
    for (const piece of Array.isArray(body) ? body : [body]) push(piece);
    push(ascii("\nendobj\n"));
  });
  const xrefOffset = length;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) xref += `${String(offset).padStart(10, "0")} 00000 n \n`;
  push(ascii(xref));
  push(ascii(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 6 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`));

  const out = new Uint8Array(length);
  let position = 0;
  for (const part of parts) {
    out.set(part, position);
    position += part.length;
  }
  return out;
}

/**
 * Browser helper: flatten a PNG blob onto a background colour and re-encode it as JPEG
 * (PDF can embed JPEG directly; JPEG has no transparency).
 * @returns {Promise<{ jpeg: Uint8Array, width: number, height: number }>}
 */
export async function pngBlobToJpeg(blob, { background = "#ffffff", quality = 0.92 } = {}) {
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d");
    context.fillStyle = background;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0);
    const jpegBlob = await new Promise((resolve, reject) => {
      canvas.toBlob((result) => (result ? resolve(result) : reject(new Error("Could not encode the image."))), "image/jpeg", quality);
    });
    return { jpeg: new Uint8Array(await jpegBlob.arrayBuffer()), width: canvas.width, height: canvas.height };
  } finally {
    if (typeof bitmap.close === "function") bitmap.close();
  }
}
