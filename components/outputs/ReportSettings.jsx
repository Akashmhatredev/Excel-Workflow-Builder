"use client";

import { Image as ImageIcon, RotateCcw } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { Button, Card, Field, Input, Notice, SectionHeader, Segmented, Spinner, Switch } from "@/components/ui";
import { DEFAULT_BRAND_COLOR, REPORT_MAX_ROWS, REPORT_THEMES } from "@/lib/schema";
import { formatCount, plural } from "./helpers";
import NumberInput from "./NumberInput";
import ScaledReport from "./ScaledReport";

const THEME_OPTIONS = Object.entries(REPORT_THEMES).map(([value, spec]) => ({ value, label: spec.label }));
const ZOOM_OPTIONS = [
  { value: "fit", label: "Fit width" },
  { value: "full", label: "100%" },
];
const MIN_COLUMN_WIDTH = 40;
const MAX_COLUMN_WIDTH = 800;
const NO_ROWS = [];

/** "#abc" or "abcdef" -> "#aabbcc" / "#abcdef"; null when it is not a hex colour. */
function normalizeHex(text) {
  const value = String(text ?? "").trim();
  const short = /^#?([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(value);
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`.toLowerCase();
  const long = /^#?([0-9a-f]{6})$/i.exec(value);
  return long ? `#${long[1].toLowerCase()}` : null;
}

function BrandColorField({ value, onCommit }) {
  const [draft, setDraft] = useState(null);
  const invalid = draft !== null && !normalizeHex(draft);
  return (
    <Field
      label="Brand colour"
      hint="Used for the header row and accents. The text colour on it is chosen automatically."
      error={invalid ? "Enter a hex colour such as #059669." : undefined}
    >
      {(p) => (
        <div className="flex items-center gap-2">
          <input
            type="color"
            aria-label="Pick the brand colour"
            value={normalizeHex(value) || DEFAULT_BRAND_COLOR}
            onChange={(event) => {
              setDraft(null);
              onCommit(event.target.value);
            }}
            className="h-10 w-12 shrink-0 cursor-pointer rounded-lg border border-line-strong bg-surface p-1"
          />
          <Input
            {...p}
            value={draft !== null ? draft : value}
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
            maxLength={7}
            className="font-mono"
            onChange={(event) => {
              setDraft(event.target.value);
              const hex = normalizeHex(event.target.value);
              if (hex && hex !== value) onCommit(hex);
            }}
            onBlur={() => setDraft(null)}
          />
        </div>
      )}
    </Field>
  );
}

function ColumnWidths({ columns, widths, onChange }) {
  const titleId = useId();
  const hasCustom = columns.some((column) => Number(widths[column.key]) > 0);
  const setWidth = (key, value) => {
    const next = { ...widths };
    if (value === null) delete next[key];
    else next[key] = value;
    onChange(next);
  };
  return (
    <div role="group" aria-labelledby={titleId} className="min-w-0">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p id={titleId} className="text-sm font-medium text-fg">
            Column widths (px)
          </p>
          <p className="mt-0.5 text-xs text-muted">
            Leave a box empty to size that column automatically. {MIN_COLUMN_WIDTH} to {MAX_COLUMN_WIDTH} px.
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          icon={RotateCcw}
          className="max-sm:h-10"
          disabled={!hasCustom}
          onClick={() => onChange({})}
        >
          Reset widths
        </Button>
      </div>
      {columns.length ? (
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
          {columns.map((column) => (
            <Field key={column.key} label={column.name || "Untitled"} className="justify-end">
              {(p) => (
                <NumberInput
                  {...p}
                  value={Number(widths[column.key]) > 0 ? Number(widths[column.key]) : null}
                  min={MIN_COLUMN_WIDTH}
                  max={MAX_COLUMN_WIDTH}
                  allowEmpty
                  placeholder="Auto"
                  onCommit={(value) => setWidth(column.key, value)}
                />
              )}
            </Field>
          ))}
        </div>
      ) : (
        <p className="mt-3 text-sm text-muted">This output has no columns yet.</p>
      )}
    </div>
  );
}

/**
 * "Report image" settings of one output plus a live, scaled ReportView.
 * `preview` is the editor's usePreview() result (requested with limit >= report.maxRows).
 */
export default function ReportSettings({ output, resultColumns, preview, onChange }) {
  const report = output.report;
  const [zoom, setZoom] = useState("fit");
  const [generatedAt] = useState(() => new Date());
  const { data, error, hasData, loading } = preview;

  const columns = useMemo(
    () => (data ? data.columns : resultColumns.map((column) => ({ key: column.key, name: column.name, type: "text" }))),
    [data, resultColumns],
  );
  const rows = useMemo(() => (data ? data.rows.slice(0, report.maxRows) : NO_ROWS), [data, report.maxRows]);

  const toggle = (enabled) => {
    // A poster without a title looks unfinished: start from the output's name.
    const title = enabled && !report.title.trim() ? output.name.trim() : report.title;
    onChange(title === report.title ? { enabled } : { enabled, title });
  };

  let caption = "Upload a file to see real rows. The layout uses this output's columns.";
  if (hasData && data) {
    caption =
      data.totalRows > rows.length
        ? `The image shows the first ${formatCount(rows.length)} of ${plural(data.totalRows, "row")}.`
        : `The image shows all ${plural(data.totalRows, "row")}.`;
  } else if (hasData) {
    caption = "Building the preview";
  }

  return (
    <Card as="section" className="p-4 sm:p-5">
      <SectionHeader
        as="h4"
        title="Report image"
        description="A picture of this table that you can download as a PNG or share on WhatsApp from the Export step."
      />
      <Switch
        className="mt-4 rounded-lg border border-line p-3 sm:p-4"
        label="Create a report image for this output"
        description="The file above is produced either way."
        checked={report.enabled}
        onChange={toggle}
      />

      {report.enabled ? (
        <div className="mt-4 flex flex-col gap-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Title">
              {(p) => (
                <Input
                  {...p}
                  value={report.title}
                  maxLength={120}
                  placeholder="For example: Monthly sales"
                  onChange={(event) => onChange({ title: event.target.value })}
                />
              )}
            </Field>
            <Field label="Subtitle">
              {(p) => (
                <Input
                  {...p}
                  value={report.subtitle}
                  maxLength={160}
                  placeholder="Optional"
                  onChange={(event) => onChange({ subtitle: event.target.value })}
                />
              )}
            </Field>

            <div className="flex min-w-0 flex-col gap-1.5">
              <span className="text-sm font-medium text-fg">Theme</span>
              <Segmented
                label="Theme"
                className="self-start"
                options={THEME_OPTIONS}
                value={report.theme}
                onChange={(theme) => onChange({ theme })}
              />
            </div>
            {report.theme === "brand" ? (
              <BrandColorField value={report.brandColor} onCommit={(brandColor) => onChange({ brandColor })} />
            ) : (
              <div className="max-sm:hidden" />
            )}

            <Field label="Max rows" hint={`1 to ${REPORT_MAX_ROWS}. Fewer rows make a sharper, easier to read image.`}>
              {(p) => (
                <NumberInput
                  {...p}
                  value={report.maxRows}
                  min={1}
                  max={REPORT_MAX_ROWS}
                  onCommit={(maxRows) => onChange({ maxRows })}
                />
              )}
            </Field>
            <Field label="Footer text" hint="Shown under the table, for example a source or a contact.">
              {(p) => (
                <Input
                  {...p}
                  value={report.footer}
                  maxLength={200}
                  placeholder="Optional"
                  onChange={(event) => onChange({ footer: event.target.value })}
                />
              )}
            </Field>
          </div>

          <div className="grid gap-x-6 gap-y-1 sm:grid-cols-3">
            <Switch
              className="min-h-11"
              label="Row numbers"
              checked={report.showRowNumbers}
              onChange={(showRowNumbers) => onChange({ showRowNumbers })}
            />
            <Switch
              className="min-h-11"
              label="Zebra rows"
              checked={report.zebra}
              onChange={(zebra) => onChange({ zebra })}
            />
            <Switch
              className="min-h-11"
              label="Date stamp"
              checked={report.showDate}
              onChange={(showDate) => onChange({ showDate })}
            />
          </div>

          <ColumnWidths
            columns={resultColumns}
            widths={report.columnWidths || {}}
            onChange={(columnWidths) => onChange({ columnWidths })}
          />

          <div className="flex min-w-0 flex-col gap-3">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div className="min-w-0">
                <h5 className="flex items-center gap-2 text-sm font-medium text-fg">
                  <ImageIcon className="size-4 text-muted" aria-hidden="true" />
                  Image preview
                  {hasData && loading ? <Spinner className="size-4" label="Updating the image preview" /> : null}
                </h5>
                <p className="mt-0.5 text-xs text-muted" role="status" aria-live="polite">
                  {caption}
                </p>
              </div>
              <Segmented label="Preview size" size="sm" options={ZOOM_OPTIONS} value={zoom} onChange={setZoom} />
            </div>
            {hasData && error ? (
              <Notice tone="error" title="The image preview could not be built">
                {error}
              </Notice>
            ) : (
              <ScaledReport
                fit={zoom === "fit"}
                label="Report image preview"
                report={report}
                columns={columns}
                rows={rows}
                totalRows={data ? data.totalRows : undefined}
                generatedAt={generatedAt}
              />
            )}
          </div>
        </div>
      ) : null}
    </Card>
  );
}
