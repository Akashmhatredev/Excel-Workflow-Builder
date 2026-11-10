# Agent C: Outputs + Export

Branch `feat/outputs-export`. Files: `components/OutputsStep.jsx`, `components/ExportStep.jsx`,
`components/ReportView.jsx`, `components/outputs/*`, `components/export/*`, `lib/share.js`.

## What is where

- `components/OutputsStep.jsx`: master/detail (list left, editor right; stacked below 1024px),
  empty state, delete confirmation. Selection is derived, so it survives undo/redo.
- `components/outputs/`: `OutputList`, `OutputEditor` (file settings), `FieldPicker`,
  `OverridesSection`, `OutputPreview`, `ReportSettings`, `ScaledReport` (live poster scaled with a
  CSS transform), `NumberInput`, `IssueList`, `helpers.js` (pure: field-selection maths, summaries,
  issue filtering), `hooks.js` (`useClientValue`, `useRestoreFocus`).
- `components/ExportStep.jsx`: zip card plus one `components/export/OutputExportCard` per output.
  `ReportImagePanel` renders the capture copy of `ReportView` in a portal on `document.body`
  (`position: fixed; left: -100000px; aria-hidden`), prepares the PNG as soon as the rows arrive
  and again when the scale changes, so the share and copy handlers stay inside the user gesture.
  `useOutputSnapshot` is a `runPreview` wrapper that never returns stale rows. `TextShareForm` builds the wa.me link.

## Deviations from CONTRACTS.md (all additive)

- `copyImageToClipboard(source)` accepts a `Blob` **or a `Promise<Blob>`** (Safari needs the
  promise form). Reasons: `'unsupported' | 'denied' | 'unfocused' | 'failed'`.
- `openWhatsAppWeb()` returns `{ ok, reason?: 'unsupported' | 'blocked' }` (the contract has no
  return value). It opens the tab without `noopener` in the features string, because that makes
  `window.open` return null even on success; it sets `opener = null` instead.
- `shareImage` may add `message` to a failure. Extra exports: `getCaptureSize`, `canCopyImages`,
  `blobToFile`, `openInNewTab`, `normalizePhone`, `isMacPlatform`, `isMobileDevice`,
  `pasteShortcut`, `WHATSAPP_WEB_URL`.
- `nodeToPngBlob` caps the canvas (16384 px a side, 64 MP, 16 MP on iOS) and lowers the scale
  when a tall report would exceed it. The Export step shows "Exported at 0.87x instead of 3x".
  It passes `includeStyleProperties` (about 120 properties) to html-to-image, which made a
  500-row capture about 4x faster with byte-identical output.
- `ReportView` ignores keys it does not know (`report.logo`, `report.logoHeight` from main);
  logo rendering is left for the later phase. `generatedAt` is supplied by the caller (no clock
  reads during render).

## Assumptions

- The Wizard renders the step title as an `h2`. Cards in my steps use `h3`/`h4`.
- Enabling an override for the first time seeds it from the workflow setting (new rule ids;
  aggregation ids are kept because sort rules and report column widths refer to them).
- Enabling the report pre-fills an empty title with the output name.
- Text-share phone validation: optional, digits with country code, 8 to 15 digits, a leading
  `+` or `00` is accepted and stripped, a leading `0` is rejected.
- Zip name: `<template name>.zip`, else `<source file> outputs.zip`, else `outputs.zip`.

## Requests for other owners

- **Foundation (`lib/schema.js`)**: `resolveOutputConfig` treats an enabled groupBy override as
  grouping on even when `config.enabled === false`. If GroupByEditor switches grouping off
  inside an override, I clear its keys and aggregations so the UI matches the engine. Either
  honour `config.enabled` there or document that the override switch is the only toggle.
- **B (`FilterBuilder`)**: I pass `idPrefix` (it is in your stub comment but not in CONTRACTS.md
  section 9) and only `scope === 'filter'` issues of this output. Please keep `idPrefix`, since
  the output editor and Mapping can both show a FilterBuilder.
- **B (`DataTable`)**: I use `caption` as the table's accessible name, `columnIssues` keyed by
  result column key, and `loading` while previous rows stay visible.
- **A (engine)**: please set `issue.outputId` on issues caused by an output's overrides (filter
  or sort or grouping), so they appear in that output's list. `buildOutput`/`buildZip` progress
  `{ phase, percent, message }` is shown next to the button; `buildZip().files` is listed after
  download.
- **Integrator / test ownership**: `components/outputs/helpers.js` is pure and would deserve a
  `tests/outputs.test.js`. `tests/` is not in my folders, so I did not add one.
- Later phase: `lib/history.js` `logRun` and `lib/pdf.js` are not wired into the Export step yet.

## Verified (scripted, Chrome via Playwright, fake worker plus the real stub worker)

68 checks: every Outputs editor control and its store effect, focus kept after reorders,
grouping disabling the checklist, preview caption and issues, report settings, scaled live
poster, duplicate/reorder/delete, per-output and zip downloads, PNG download (valid PNG),
1x/2x/3x, Web Share button when `canShareFiles()`, clipboard really holds `image/png`,
WhatsApp Web tab after the copy, the blocked pop-up and copy-denied fallbacks, text share URL
encoding, NOT_IMPLEMENTED error states, no-file states, no horizontal scroll and 40px targets
at 360px, axe WCAG 2.1 AA in app light and dark mode. PNG captures are byte-identical with the
app in light and dark mode for all three report themes.

## Not verified

- Real engine output (column types, issue shapes, row counts, progress messages, file bytes).
- Safari / iOS / Android: the WebKit warm-up capture, the `ClipboardItem` promise path, the
  system share sheet on phones and the iOS canvas cap were reasoned about, not run.
