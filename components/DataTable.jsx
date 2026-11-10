"use client";

import { AlertCircle, AlertTriangle, Loader2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { List, useVirtualizer } from "react-window";
import { cn } from "@/lib/cn";
import { HIGHLIGHT_STYLES } from "@/lib/schema";

/**
 * DataTable: a read-only table for display-ready rows (string[][]).
 *
 * Props (CONTRACTS.md section 9):
 *   columns        ({ key?, name, type? } | string)[]
 *   rows           string[][]
 *   height         fixed height in px (otherwise the table grows up to maxHeight)
 *   maxHeight      default 420
 *   rowNumbers     show the row-number column (default true); startIndex offsets the numbers
 *   loading        dims the table and shows a spinner while keeping the current rows
 *   emptyMessage   shown when there are no rows
 *   columnIssues   { [columnKey]: 'error' | 'warning' } highlights those headers
 *   columnWidths   { [columnKey]: px } overrides the automatic widths
 *   caption        accessible name of the table
 *   cellMarks      [row, col, tone, bold?][] marks single cells (indexes into rows / columns):
 *                  'error' (danger tint + corner marker), 'blank' (hatched), or a HIGHLIGHT_STYLES key
 *   totalsRow      the last row holds totals: bold, and sticky at the bottom of the scroll area
 *   totalsColumn   the last column holds totals: bold, with a rule on its left
 *
 * Rows are virtualized with react-window's List and columns with its useVirtualizer,
 * so only the visible cells are in the DOM. One element scrolls both ways; the header
 * and the row numbers are sticky inside it, so the page itself never scrolls sideways.
 * Cell marks are indexed by row once (a Map of Maps), so a rendered cell costs one lookup.
 */

const ROW_HEIGHT = 36;
const HEADER_HEIGHT = 40;
const MIN_WIDTH = 72;
const MAX_WIDTH = 320;
const SAMPLE_ROWS = 60;
const EMPTY = [];

const CELL = "absolute top-0 h-full overflow-hidden px-3 leading-9 text-ellipsis whitespace-nowrap";
const CELL_NUMERIC = "text-right tabular-nums";
const TOTALS_COLUMN = "border-l border-line-strong font-semibold";
const MARK_LABELS = { error: "error", blank: "blank" };
// Hatching (a pattern, not just a colour) for blank cells; works in both themes.
const BLANK_STYLE = {
  backgroundImage: "repeating-linear-gradient(135deg, var(--line-strong) 0 1px, transparent 1px 7px)",
};
const HEADER_CELL = "absolute top-0 flex h-full items-center gap-1.5 px-3 font-semibold";
const GUTTER =
  "sticky left-0 z-10 h-full border-r border-line bg-surface-2 px-2 text-right text-xs text-muted tabular-nums select-none";

function normalizeColumns(columns) {
  return (Array.isArray(columns) ? columns : EMPTY).map((column, index) => {
    const source = column && typeof column === "object" ? column : { name: column };
    const name = source.name == null ? "" : String(source.name);
    const key = source.key == null || source.key === "" ? name || `column-${index + 1}` : String(source.key);
    return { key, name, numeric: source.type === "number" };
  });
}

/**
 * cellMarks -> Map<row, Map<col, { tone, bold }>>, or null when there are none.
 * Unknown tones are dropped; when a cell is marked twice an 'error' wins, otherwise the last mark.
 */
function indexMarks(marks) {
  if (!Array.isArray(marks) || !marks.length) return null;
  const byRow = new Map();
  for (const mark of marks) {
    if (!Array.isArray(mark)) continue;
    const [row, col, tone, bold] = mark;
    if (!Number.isInteger(row) || !Number.isInteger(col) || row < 0 || col < 0) continue;
    if (!MARK_LABELS[tone] && !HIGHLIGHT_STYLES[tone]) continue;
    let cells = byRow.get(row);
    if (!cells) {
      cells = new Map();
      byRow.set(row, cells);
    }
    const previous = cells.get(col);
    if (previous && previous.tone === "error" && tone !== "error") continue;
    cells.set(col, { tone, bold: Boolean(bold) });
  }
  return byRow.size ? byRow : null;
}

/** Class, inline style and screen-reader label of one cell. */
function cellLook(column, mark, isTotalsColumn, left, width) {
  const style = { left, width };
  let className = cn(CELL, column.numeric && CELL_NUMERIC, isTotalsColumn && TOTALS_COLUMN);
  let label = "";
  if (!mark) return { className: cn(className, "text-fg"), style, label };
  if (mark.tone === "error") {
    className = cn(className, "bg-danger-soft pr-4 text-danger");
    label = "error";
  } else if (mark.tone === "blank") {
    className = cn(className, "text-fg");
    Object.assign(style, BLANK_STYLE);
    label = "blank";
  } else {
    const look = HIGHLIGHT_STYLES[mark.tone];
    style.backgroundColor = look.fill;
    style.color = look.color;
    label = `highlighted ${look.label.toLowerCase()}`;
  }
  if (mark.bold) className = cn(className, "font-semibold");
  return { className, style, label };
}

function gutterWidth(lastRowNumber) {
  return Math.max(44, String(Math.max(1, lastRowNumber)).length * 8 + 22);
}

/**
 * Column geometry. Automatic widths come from the header and the first rows (capped);
 * when the table is narrower than its container the spare room is shared between the
 * automatic columns so the table fills the width.
 */
function buildLayout(cols, rows, overrides, issues, gutter, available) {
  const sample = Math.min(rows.length, SAMPLE_ROWS);
  const widths = new Array(cols.length);
  const flexible = [];
  let total = gutter;
  let flexTotal = 0;
  for (let c = 0; c < cols.length; c += 1) {
    const column = cols[c];
    const fixed = overrides ? Number(overrides[column.key]) : NaN;
    if (Number.isFinite(fixed) && fixed > 0) {
      widths[c] = Math.max(40, Math.round(fixed));
    } else {
      let chars = 0;
      for (let r = 0; r < sample; r += 1) {
        const cell = rows[r] ? rows[r][c] : null;
        const length = cell == null ? 0 : String(cell).length;
        if (length > chars) chars = length;
      }
      const header = (column.name.length || 9) * 8.2 + (issues && issues[column.key] ? 20 : 0);
      const body = chars * (column.numeric ? 8.4 : 7.4);
      widths[c] = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.ceil(Math.max(header, body)) + 26));
      flexible.push(c);
      flexTotal += widths[c];
    }
    total += widths[c];
  }
  const spare = Math.floor(available) - total;
  if (spare > 0 && flexible.length) {
    let given = 0;
    for (const c of flexible) {
      const extra = Math.floor((spare * widths[c]) / flexTotal);
      widths[c] += extra;
      given += extra;
    }
    widths[flexible[flexible.length - 1]] += spare - given;
    total += spare;
  }
  const lefts = new Array(cols.length);
  let left = gutter;
  for (let c = 0; c < cols.length; c += 1) {
    lefts[c] = left;
    left += widths[c];
  }
  return { widths, lefts, total, slots: gutter ? [gutter, ...widths] : widths };
}

/** One row. Only the cells of the visible columns (first..last) are rendered. */
function DataTableRow({ index, style, data, cols, layout, first, last, gutter, startIndex, marks, totalsColumn, totals = false }) {
  const row = data[index] || EMPTY;
  const rowMarks = marks ? marks.get(index) : undefined;
  const colOffset = gutter ? 2 : 1;
  const lastCol = cols.length - 1;
  const cells = [];
  for (let c = first; c <= last; c += 1) {
    const raw = row[c];
    const value = raw == null ? "" : String(raw);
    const look = cellLook(cols[c], rowMarks ? rowMarks.get(c) : undefined, totalsColumn && c === lastCol, layout.lefts[c], layout.widths[c]);
    const tip = look.label ? `${value || "(empty)"} (${look.label})` : value;
    cells.push(
      <div key={c} role="cell" aria-colindex={c + colOffset} title={tip || undefined} className={look.className} style={look.style}>
        {value}
        {look.label === "error" ? (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute top-0 right-0 size-0 border-t-8 border-l-8 border-t-danger border-l-transparent"
          />
        ) : null}
        {look.label ? <span className="sr-only"> ({look.label})</span> : null}
      </div>,
    );
  }
  return (
    <div
      role="row"
      aria-rowindex={index + 2}
      style={style}
      className={
        totals
          ? "relative border-t-2 border-line-strong bg-surface-2 font-semibold"
          : cn("border-b border-line hover:bg-brand-soft", index % 2 ? "bg-surface-2" : "bg-surface")
      }
    >
      {gutter ? (
        <div role="cell" aria-colindex={1} className={cn(GUTTER, "leading-9")} style={{ width: gutter }}>
          {totals ? (
            <>
              <span aria-hidden="true">Σ</span>
              <span className="sr-only">Totals</span>
            </>
          ) : (
            startIndex + index + 1
          )}
        </div>
      ) : null}
      {cells}
    </div>
  );
}

export default function DataTable({
  columns,
  rows,
  height,
  maxHeight = 420,
  rowNumbers = true,
  startIndex = 0,
  loading = false,
  emptyMessage,
  columnIssues,
  columnWidths,
  caption,
  className,
  cellMarks,
  totalsRow = false,
  totalsColumn = false,
}) {
  const [scroller, setScroller] = useState(null);
  const [content, setContent] = useState(null);
  const [available, setAvailable] = useState(0);

  const attachScroller = useCallback((node) => {
    setScroller(node);
    if (node) setAvailable(node.clientWidth);
  }, []);

  useEffect(() => {
    if (!scroller || typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver((entries) => {
      const width = Math.floor(entries[entries.length - 1].contentRect.width);
      setAvailable((current) => (current === width ? current : width));
    });
    observer.observe(scroller);
    return () => observer.disconnect();
  }, [scroller]);

  // A new page of rows (startIndex changed) starts at its first row.
  useEffect(() => {
    if (scroller) scroller.scrollTo({ top: 0 });
  }, [scroller, startIndex]);

  const cols = useMemo(() => normalizeColumns(columns), [columns]);
  const data = Array.isArray(rows) ? rows : EMPTY;
  const rowCount = data.length;
  const hasColumns = cols.length > 0;
  const hasTotalsRow = Boolean(totalsRow) && rowCount > 0;
  const bodyCount = hasTotalsRow ? rowCount - 1 : rowCount;
  const marks = useMemo(() => indexMarks(cellMarks), [cellMarks]);
  const gutter = rowNumbers && hasColumns ? gutterWidth(startIndex + bodyCount) : 0;

  const layout = useMemo(
    () => buildLayout(cols, data, columnWidths, columnIssues, gutter, available),
    [cols, data, columnWidths, columnIssues, gutter, available],
  );

  const slotSize = useCallback((slot) => layout.slots[slot], [layout]);
  const { items } = useVirtualizer({
    count: layout.slots.length,
    direction: "horizontal",
    element: content,
    scrollElement: scroller,
    itemSize: slotSize,
    overscanCount: 2,
    defaultSize: 1280,
  });

  // Slot 0 is the row-number column when it is shown; the rest map 1:1 to data columns.
  const slotOffset = gutter ? 1 : 0;
  const first = items.length ? Math.max(0, items[0].index - slotOffset) : 0;
  const last = items.length ? Math.min(cols.length - 1, items[items.length - 1].index - slotOffset) : -1;

  const rowProps = useMemo(
    () => ({ data, cols, layout, first, last, gutter, startIndex, marks, totalsColumn: Boolean(totalsColumn) }),
    [data, cols, layout, first, last, gutter, startIndex, marks, totalsColumn],
  );

  const label = caption || "Data table";
  const headerCells = [];
  for (let c = first; c <= last; c += 1) {
    const column = cols[c];
    const issue = columnIssues ? columnIssues[column.key] : null;
    const Icon = issue === "error" ? AlertCircle : AlertTriangle;
    headerCells.push(
      <div
        key={c}
        role="columnheader"
        aria-colindex={c + slotOffset + 1}
        title={column.name || undefined}
        className={cn(
          HEADER_CELL,
          column.numeric && "justify-end",
          totalsColumn && c === cols.length - 1 && "border-l border-line-strong",
          issue === "error" && "border-b-2 border-danger bg-danger-soft text-danger",
          issue === "warning" && "border-b-2 border-warning bg-warning-soft text-warning",
        )}
        style={{ left: layout.lefts[c], width: layout.widths[c] }}
      >
        {issue ? <Icon className="size-3.5 shrink-0" aria-hidden="true" /> : null}
        <span className="truncate">
          {column.name || <span className="font-normal text-muted italic">(unnamed)</span>}
        </span>
        {issue ? <span className="sr-only">{issue === "error" ? "(has errors)" : "(has warnings)"}</span> : null}
      </div>,
    );
  }

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-lg border border-line bg-surface",
        !hasColumns && loading && "min-h-32",
        className,
      )}
    >
      {hasColumns ? (
        <div
          ref={attachScroller}
          role="group"
          aria-label={label}
          tabIndex={0}
          className="overflow-auto overscroll-x-contain focus-visible:-outline-offset-2"
          style={height != null ? { height } : { maxHeight }}
        >
          <div
            ref={setContent}
            role="table"
            aria-label={label}
            aria-rowcount={rowCount + 1}
            aria-colcount={cols.length + slotOffset}
            aria-busy={loading || undefined}
            className="relative text-sm"
            style={{ width: layout.total, minWidth: "100%" }}
          >
            <div role="rowgroup" className="sticky top-0 z-20">
              <div
                role="row"
                aria-rowindex={1}
                className="relative border-b border-line-strong bg-surface-2 text-fg"
                style={{ height: HEADER_HEIGHT }}
              >
                {gutter ? (
                  <div
                    role="columnheader"
                    aria-colindex={1}
                    className={cn(GUTTER, "flex items-center justify-end font-semibold")}
                    style={{ width: gutter }}
                  >
                    <span aria-hidden="true">#</span>
                    <span className="sr-only">Row</span>
                  </div>
                ) : null}
                {headerCells}
              </div>
            </div>
            <List
              role="rowgroup"
              rowComponent={DataTableRow}
              rowCount={bodyCount}
              rowHeight={ROW_HEIGHT}
              rowProps={rowProps}
              scrollElement={scroller}
              defaultHeight={typeof height === "number" ? height : maxHeight}
              overscanCount={6}
              style={{ width: layout.total }}
            />
            {hasTotalsRow ? (
              <div role="rowgroup" className="sticky bottom-0 z-20" style={{ width: layout.total }}>
                <DataTableRow index={rowCount - 1} style={{ height: ROW_HEIGHT }} totals {...rowProps} />
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {rowCount === 0 && !(loading && !hasColumns) ? (
        <p className="px-4 py-8 text-center text-sm text-muted">{emptyMessage || "No rows to show."}</p>
      ) : null}

      <div
        className={cn(
          "pointer-events-none absolute inset-0 z-30 flex items-start justify-center bg-surface/60 pt-12 transition-opacity duration-200",
          loading ? "opacity-100 delay-150" : "opacity-0",
        )}
      >
        {loading ? (
          <span
            role="status"
            className="flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1.5 text-xs font-medium text-fg shadow-card"
          >
            <Loader2 className="size-4 animate-spin text-muted" aria-hidden="true" />
            Updating…
          </span>
        ) : null}
      </div>
    </div>
  );
}
