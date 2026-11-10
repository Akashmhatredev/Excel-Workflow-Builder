"use client";

import { DEFAULT_BRAND_COLOR, REPORT_MAX_ROWS } from "@/lib/schema";

/**
 * ReportView (owner: Agent C): the table "poster" that is exported as a PNG.
 *
 * Props: { ref, report, columns: [{ key, name, type }], rows: string[][], totalRows?, generatedAt?, className? }
 *
 * - Static and self-contained: every colour and size is an inline style from the palette below,
 *   so it looks the same in the app's light and dark mode and inside an image capture.
 * - Renders at its natural pixel size: the width is the sum of the column widths (explicit
 *   `report.columnWidths[key]`, otherwise estimated from the content), never the viewport.
 * - `ref` lands on the root element (React 19: ref is a normal prop) for lib/share.js.
 * - `generatedAt` (Date, ISO string or epoch ms) is shown when `report.showDate` is on. The
 *   caller supplies it because reading the clock during render is not allowed.
 */

const FONT_STACK =
  'var(--font-geist-sans, ui-sans-serif), ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

const INK = "#111827";
const WHITE = "#ffffff";
const BLACK = "#000000";
// Secondary text (subtitle, date, row numbers, notes). Dark enough for 4.5:1 on every light
// background below, including the tinted zebra rows of the brand theme.
const MUTED_ON_LIGHT = "#4b5563";
const MIN_CONTRAST = 4.5;

const PADDING_X = 32;
const CELL_PADDING_X = 12;
const MIN_CONTENT_WIDTH = 416;
const MIN_COLUMN_WIDTH = 64;
const MAX_AUTO_COLUMN_WIDTH = 300;
const MIN_USER_COLUMN_WIDTH = 40;
const MAX_USER_COLUMN_WIDTH = 800;
const SAMPLE_ROWS = 200;
const BODY_FONT_SIZE = 13;
const HEADER_FONT_SIZE = 11;

const PALETTES = {
  light: {
    page: WHITE,
    text: INK,
    muted: MUTED_ON_LIGHT,
    title: INK,
    accent: "#047857",
    tableBg: WHITE,
    headerBg: "#f3f4f6",
    headerText: "#374151",
    border: "#e5e7eb",
    zebra: "#f9fafb",
  },
  dark: {
    page: "#0b1220",
    text: "#e5e9f0",
    muted: "#94a3b8",
    title: "#f8fafc",
    accent: "#34d399",
    tableBg: "#111a2c",
    headerBg: "#1c2740",
    headerText: "#cbd5e1",
    border: "#26324a",
    zebra: "#0e1626",
  },
};

/* ------------------------------------------------------------------ */
/* colour helpers                                                       */
/* ------------------------------------------------------------------ */

function parseHex(value) {
  const match = /^#?([0-9a-f]{6})$/i.exec(String(value ?? "").trim());
  if (!match) return null;
  const n = parseInt(match[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex(rgb) {
  return `#${rgb.map((c) => Math.round(Math.min(255, Math.max(0, c))).toString(16).padStart(2, "0")).join("")}`;
}

/** Blend `a` towards `b` by `amount` (0..1). */
function mix(a, b, amount) {
  return toHex(a.map((channel, i) => channel + (b[i] - channel) * amount));
}

function luminance(rgb) {
  const [r, g, b] = rgb.map((c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * Text colour for a solid background: white or ink when either reaches 4.5:1. For mid-tones
 * where neither does, the better of white and pure black (one of them always reaches 4.58:1).
 */
function readableOn(background) {
  const onWhite = contrast(background, parseHex(WHITE));
  const onInk = contrast(background, parseHex(INK));
  if (onWhite >= MIN_CONTRAST && onWhite >= onInk) return WHITE;
  if (onInk >= MIN_CONTRAST) return INK;
  return onWhite >= contrast(background, parseHex(BLACK)) ? WHITE : BLACK;
}

function brandPalette(brandColor) {
  const brand = parseHex(brandColor) || parseHex(DEFAULT_BRAND_COLOR);
  const white = parseHex(WHITE);
  const brandHex = toHex(brand);
  return {
    page: WHITE,
    text: INK,
    muted: MUTED_ON_LIGHT,
    // The brand colour is only used for text where it stays readable on white.
    title: contrast(brand, white) >= MIN_CONTRAST ? brandHex : INK,
    accent: brandHex,
    tableBg: WHITE,
    headerBg: brandHex,
    headerText: readableOn(brand),
    border: mix(brand, white, 0.78),
    zebra: mix(brand, white, 0.94),
  };
}

function paletteFor(report) {
  if (report.theme === "brand") return brandPalette(report.brandColor);
  return PALETTES[report.theme] || PALETTES.light;
}

/* ------------------------------------------------------------------ */
/* layout helpers                                                       */
/* ------------------------------------------------------------------ */

/** Rough rendered width of a string. Deliberately generous so estimated columns rarely wrap. */
function estimateTextWidth(text, fontSize) {
  let em = 0;
  for (const char of String(text ?? "")) {
    const code = char.codePointAt(0);
    if (code > 0x2e7f) em += 1.02;
    else if (code > 0x7f) em += 0.68;
    else if (char === " ") em += 0.3;
    else if (/[0-9]/.test(char)) em += 0.64;
    else if (/[A-Z]/.test(char)) em += 0.72;
    else if (/[mwMW@%]/.test(char)) em += 0.9;
    else if (/[iljtfr.,:;'|!()[\]]/.test(char)) em += 0.36;
    else em += 0.58;
  }
  return em * fontSize;
}

function userWidth(report, key) {
  const value = Number(report.columnWidths && report.columnWidths[key]);
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.round(Math.min(MAX_USER_COLUMN_WIDTH, Math.max(MIN_USER_COLUMN_WIDTH, value)));
}

function autoWidth(column, columnIndex, rows) {
  // The header is upper-case with letter-spacing: measure it as such.
  let widest = estimateTextWidth(String(column.name ?? "").toUpperCase(), HEADER_FONT_SIZE) * 1.08;
  const sample = Math.min(rows.length, SAMPLE_ROWS);
  for (let i = 0; i < sample; i += 1) {
    const width = estimateTextWidth(rows[i][columnIndex], BODY_FONT_SIZE);
    if (width > widest) widest = width;
  }
  return Math.round(Math.min(MAX_AUTO_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, widest + CELL_PADDING_X * 2 + 4)));
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "5 Nov 2026, 09:07" in local time. Locale-independent so every capture reads the same. */
function formatStamp(value) {
  if (value === null || value === undefined || value === "") return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const two = (n) => String(n).padStart(2, "0");
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}, ${two(date.getHours())}:${two(date.getMinutes())}`;
}

const countFormat = new Intl.NumberFormat("en-US");

/* ------------------------------------------------------------------ */
/* component                                                            */
/* ------------------------------------------------------------------ */

export default function ReportView({ ref, report, columns, rows, totalRows, generatedAt, className }) {
  const settings = report || {};
  const palette = paletteFor(settings);
  const cols = Array.isArray(columns) ? columns : [];
  const maxRows = Math.min(REPORT_MAX_ROWS, Math.max(1, Math.round(Number(settings.maxRows) || REPORT_MAX_ROWS)));
  const body = (Array.isArray(rows) ? rows : []).slice(0, maxRows);
  const total = Number.isFinite(Number(totalRows)) ? Math.max(Number(totalRows), body.length) : body.length;
  const showRowNumbers = Boolean(settings.showRowNumbers) && cols.length > 0;

  const widths = cols.map((column, index) => userWidth(settings, column.key) ?? autoWidth(column, index, body));
  const numberWidth = showRowNumbers ? Math.max(40, String(body.length || 1).length * 9 + 22) : 0;
  const columnsWidth = widths.reduce((sum, width) => sum + width, 0) + numberWidth;
  const contentWidth = Math.max(columnsWidth, MIN_CONTENT_WIDTH);
  const frameWidth = contentWidth + 2; // the frame's 1px borders sit outside the table
  const rootWidth = frameWidth + PADDING_X * 2;

  const title = String(settings.title ?? "").trim();
  const subtitle = String(settings.subtitle ?? "").trim();
  const footer = String(settings.footer ?? "").trim();
  const stamp = settings.showDate ? formatStamp(generatedAt) : "";
  const truncated = total > body.length;
  const hasHeader = Boolean(title || subtitle || stamp);

  const cellBase = {
    boxSizing: "border-box",
    margin: 0,
    padding: `8px ${CELL_PADDING_X}px`,
    fontSize: BODY_FONT_SIZE,
    lineHeight: "18px",
    fontWeight: 400,
    verticalAlign: "top",
    overflowWrap: "anywhere",
    wordBreak: "normal",
    whiteSpace: "normal",
    border: "0 solid transparent",
  };
  const headBase = {
    ...cellBase,
    padding: `10px ${CELL_PADDING_X}px`,
    fontSize: HEADER_FONT_SIZE,
    lineHeight: "15px",
    fontWeight: 600,
    letterSpacing: "0.05em",
    textTransform: "uppercase",
    verticalAlign: "bottom",
    color: palette.headerText,
    backgroundColor: palette.headerBg,
  };
  const alignOf = (column) => (column.type === "number" ? "right" : "left");
  const noteStyle = { margin: "12px 0 0", padding: 0, fontSize: 12, lineHeight: "17px", color: palette.muted };

  return (
    <div
      ref={ref}
      className={className}
      data-report-view=""
      style={{
        boxSizing: "border-box",
        position: "relative",
        display: "block",
        width: rootWidth,
        minWidth: rootWidth,
        maxWidth: rootWidth,
        margin: 0,
        padding: `0 ${PADDING_X}px 28px`,
        overflow: "hidden",
        backgroundColor: palette.page,
        color: palette.text,
        fontFamily: FONT_STACK,
        fontSize: BODY_FONT_SIZE,
        fontStyle: "normal",
        fontWeight: 400,
        lineHeight: "18px",
        letterSpacing: "normal",
        textAlign: "left",
        textTransform: "none",
        textIndent: 0,
        whiteSpace: "normal",
        direction: "ltr",
        fontVariantNumeric: "tabular-nums",
        WebkitFontSmoothing: "antialiased",
      }}
    >
      <div
        aria-hidden="true"
        style={{ height: 6, margin: `0 -${PADDING_X}px 26px`, backgroundColor: palette.accent }}
      />

      {hasHeader ? (
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 24, margin: "0 0 18px" }}>
          <div style={{ minWidth: 0, flex: "1 1 auto" }}>
            {title ? (
              <div
                role="heading"
                aria-level={2}
                style={{
                  margin: 0,
                  fontSize: 22,
                  lineHeight: "28px",
                  fontWeight: 700,
                  letterSpacing: "-0.01em",
                  color: palette.title,
                  overflowWrap: "anywhere",
                }}
              >
                {title}
              </div>
            ) : null}
            {subtitle ? (
              <div
                style={{
                  margin: title ? "4px 0 0" : 0,
                  fontSize: 14,
                  lineHeight: "20px",
                  color: palette.muted,
                  overflowWrap: "anywhere",
                }}
              >
                {subtitle}
              </div>
            ) : null}
          </div>
          {stamp ? (
            <div
              style={{
                flex: "0 0 auto",
                margin: 0,
                paddingTop: title ? 7 : 2,
                fontSize: 12,
                lineHeight: "17px",
                color: palette.muted,
                whiteSpace: "nowrap",
              }}
            >
              {stamp}
            </div>
          ) : null}
        </div>
      ) : null}

      {cols.length ? (
        <div
          style={{
            boxSizing: "border-box",
            width: frameWidth,
            border: `1px solid ${palette.border}`,
            borderRadius: 10,
            overflow: "hidden",
            backgroundColor: palette.tableBg,
          }}
        >
          <table
            style={{
              width: contentWidth,
              margin: 0,
              padding: 0,
              tableLayout: "fixed",
              borderCollapse: "separate",
              borderSpacing: 0,
              border: 0,
              color: palette.text,
              fontFamily: "inherit",
              fontSize: BODY_FONT_SIZE,
              textIndent: 0,
            }}
          >
            <colgroup>
              {showRowNumbers ? <col style={{ width: numberWidth }} /> : null}
              {cols.map((column, index) => (
                <col key={column.key ?? index} style={{ width: widths[index] }} />
              ))}
            </colgroup>
            <thead>
              <tr>
                {showRowNumbers ? (
                  <th scope="col" style={{ ...headBase, textAlign: "right" }}>
                    #
                  </th>
                ) : null}
                {cols.map((column, index) => (
                  <th key={column.key ?? index} scope="col" style={{ ...headBase, textAlign: alignOf(column) }}>
                    {column.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {body.length ? (
                body.map((row, rowIndex) => {
                  const backgroundColor = settings.zebra && rowIndex % 2 === 1 ? palette.zebra : palette.tableBg;
                  const borderTop = `1px solid ${palette.border}`;
                  return (
                    <tr key={rowIndex}>
                      {showRowNumbers ? (
                        <td style={{ ...cellBase, backgroundColor, borderTop, textAlign: "right", color: palette.muted }}>
                          {rowIndex + 1}
                        </td>
                      ) : null}
                      {cols.map((column, columnIndex) => (
                        <td
                          key={column.key ?? columnIndex}
                          style={{ ...cellBase, backgroundColor, borderTop, textAlign: alignOf(column) }}
                        >
                          {row[columnIndex] ?? ""}
                        </td>
                      ))}
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td
                    colSpan={cols.length + (showRowNumbers ? 1 : 0)}
                    style={{
                      ...cellBase,
                      padding: "22px 12px",
                      textAlign: "center",
                      color: palette.muted,
                      borderTop: `1px solid ${palette.border}`,
                    }}
                  >
                    No rows to show
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <div
          style={{
            boxSizing: "border-box",
            width: frameWidth,
            padding: "28px 16px",
            border: `1px dashed ${palette.border}`,
            borderRadius: 10,
            textAlign: "center",
            color: palette.muted,
          }}
        >
          No columns to show
        </div>
      )}

      {truncated ? (
        <div style={noteStyle}>
          Showing first {countFormat.format(body.length)} of {countFormat.format(total)} rows
        </div>
      ) : null}
      {footer ? <div style={{ ...noteStyle, overflowWrap: "anywhere", whiteSpace: "pre-line" }}>{footer}</div> : null}
    </div>
  );
}
