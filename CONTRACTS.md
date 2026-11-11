# CONTRACTS

The shared contract for everyone working on this codebase in parallel. Code against this file and
`lib/schema.js`. If something here is wrong or missing, **do not edit another owner's file**: write
the request in `notes/agent-<letter>.md` and work around it.

## 1. Architecture in one minute

```
 UI thread (React)                                   Worker (workers/parse.worker.js)
 ─────────────────                                   ────────────────────────────────
 store/useWorkflowStore  ──┐                         holds the parsed workbook + table
   dataset metadata        │  lib/workerClient.js    lib/excel.js      read / write files
   workflow definition     ├──── postMessage ──────▶ lib/pipeline.js   definition -> rows
 hooks/usePreview          │   (promises, small      lib/transforms.js lib/filters.js
 store/useTemplateStore  ──┘    display slices)      lib/formula.js    lib/validate.js
   (persist -> localStorage)
```

- The **full dataset lives only in the worker**. The UI thread receives display-ready slices
  (`string[][]`) and finished file bytes. Nothing about the file is ever persisted.
- The **definition** (`lib/schema.js`) is plain JSON. It is the only thing saved (draft + templates).
- No backend, no API routes, no env vars. JavaScript only (`.js` / `.jsx`), no TypeScript.

## 2. Ownership

| Owner | Files |
| --- | --- |
| Foundation (integrator, frozen for agents) | `lib/schema.js`, `lib/workerClient.js`, `lib/toast.js`, `lib/download.js`, `lib/cn.js`, `lib/aliases.js`, `store/useWorkflowStore.js`, `store/useToastStore.js`, `hooks/usePreview.js`, `package.json`, configs, `CONTRACTS.md` |
| **A** Data engine | `workers/parse.worker.js`, `lib/excel.js`, `lib/transforms.js`, `lib/filters.js`, `lib/formula.js`, `lib/pipeline.js`, `lib/validate.js`, `tests/{transforms,filters,formula,pipeline,excel,validate,samples}.test.js`, `scripts/*`, `public/samples/*` |
| **B** Upload + Mapping UI | `components/UploadStep.jsx`, `components/MappingStep.jsx`, `components/DataTable.jsx`, `components/upload/*`, `components/mapping/*` |
| **C** Outputs + Export | `components/OutputsStep.jsx`, `components/ExportStep.jsx`, `components/ReportView.jsx`, `components/outputs/*`, `components/export/*`, `lib/share.js` |
| **D** Templates | `lib/templates.js`, `lib/storage.js`, `store/useTemplateStore.js`, `app/templates/*`, `components/TemplateCard.jsx`, `components/templates/*`, `tests/{templates,storage}.test.js` |
| **E** Shell + polish | `app/layout.js`, `app/page.js`, `app/workflow/*`, `app/globals.css`, `app/{not-found,error,loading,manifest,icon}*`, `components/Wizard.jsx`, `components/shell/*`, `components/ui/*` (styling only: keep every export and prop) |

Rules:
- Edit only your files. You may add new files inside your folders.
- Stubs exist for every cross-owner import so each worktree builds. Keep **export names and props** of your stubs.
- Requests for other owners or for the foundation go in `notes/agent-<letter>.md` (create it; one file per agent so merges never conflict).
- No new npm dependencies. If you truly need one, note it and work without it.
- Before finishing: `npm run lint` (zero warnings), `npm test`, `npm run build` must all pass in your worktree.

## 3. Conventions

- Node 24: `export PATH=$HOME/.nvm/versions/node/v24.18.0/bin:$PATH` before any `node`/`npm` command. Run `npm ci` once in your worktree.
- Next.js 16.4 (App Router, Turbopack), React 19.3, Tailwind 4.3, zustand 5, react-window **2.x** (new API: read `node_modules/react-window/README.md`), lucide-react icons, Vitest 5.
- This Next.js version has breaking changes relative to older ones. When unsure, read `node_modules/next/dist/docs/`.
- Components: one default export per file, `"use client"` at the top of anything interactive, import with the `@/` alias. Files in `lib/` and `workers/` use **relative** imports so they also load in the worker and in Vitest.
- ESLint is `eslint-config-next` with the strict React 19 hooks rules: no synchronous `setState` inside `useEffect`, no reading/writing `ref.current` during render, no impure calls (`Date.now()`, `Math.random()`) during render. Derive state instead, or set it in event handlers / async callbacks.
- Styling: Tailwind with the **semantic tokens** from `app/globals.css`: `bg-bg`, `bg-surface`, `bg-surface-2`, `border-line`, `border-line-strong`, `text-fg`, `text-muted`, `bg-brand text-brand-fg`, `hover:bg-brand-hover`, `bg-brand-soft text-brand-soft-fg`, `text-danger bg-danger-soft`, `text-warning bg-warning-soft`, `text-info bg-info-soft`, `shadow-card`. They switch with the `.dark` class, so you rarely need `dark:`. No hard-coded greys.
- Build on `components/ui` (section 8). Buttons, inputs, modals and empty states must come from there.
- Accessibility: every control has a label (`Field`, `aria-label`), everything works with the keyboard, focus is visible, status changes use `role="status"`/`aria-live`, touch targets are at least 40px on mobile.
- Responsive from 360px wide. Wide tables scroll inside their own container, never the page.
- Every async action has a loading state; every list has an empty state; failures call `toast.error(...)`.
- Dev server ports (stop the server when you are done): A none, B 3101, C 3102, D 3103, E 3104 (`npx next dev -p 3101`).
- Commits: `type(scope): summary` (for example `feat(engine): add pipeline`). No AI co-author or "Generated with" trailers. Never push.

## 4. Data shapes

All shapes, factories and helpers are in `lib/schema.js` (read its header comment). Summary:

```
WorkflowDefinition { schemaVersion, source{ sheetNames[], headerRow, expectedColumns[{name,type}] },
                     fields[], filters, groupBy, sort[], outputs[] }
MappingField       { id, name, source{ kind:'column'|'combine'|'formula', column, template, expression }, transforms[] }
Transform          { id, type, ...params }      types: trim upper lower title numberFormat dateFormat default split replace
FilterGroup        { combinator:'and'|'or', rules[] }
FilterRule         { id, target{ kind:'column'|'field', ref }, operator, value, value2 }
GroupBy            { enabled, keys[fieldId], aggregations[{ id, fieldId, fn, name }] }
SortRule           { id, key, direction:'asc'|'desc' }     key = a result column key
Output             { id, name, fileType:'xlsx'|'csv', sheetName, fieldIds|null,
                     overrides{ filters{enabled,group}, sort{enabled,rules}, groupBy{enabled,config} }, report }
Report             { enabled, title, subtitle, theme:'light'|'dark'|'brand', brandColor, columnWidths{key:px},
                     maxRows, showRowNumbers, zebra, footer, showDate }
Template           { id, name, description, tags[], createdAt, updatedAt, schemaVersion, definition }
Column             { name, type:'text'|'number'|'date', index }
Issue              { level:'error'|'warning', scope:'field'|'filter'|'groupBy'|'sort'|'output', id, outputId?, code, message }
```

Semantics every module must agree on:

- **Columns are referenced by name**, fields by id. `{Name}` inside `source.template` / `source.expression` is a column reference.
- **"Rename"** is simply `field.name`.
- **Transform chain**: applied in order to the source value. `numberFormat` / `dateFormat` produce strings, except when one is the **last** transform of a field: then the engine keeps the typed value (number / Date) and treats that transform as the *column format*. That keeps Excel cells numeric, lets aggregations sum them, and aggregation columns inherit the format.
- **Filters** run per source row and may target a source column (`kind:'column'`, raw value) or a mapped field (`kind:'field'`, value after transforms). Incomplete rules (no target, or a missing value for an operator that needs one) are ignored. An empty group matches everything.
- **Group-by** keys and aggregations reference field ids. Result columns = key fields, then aggregations (`key = aggregation.id`). `count` with an empty `fieldId` counts rows.
- **Sort** keys are result column keys. Without grouping any field id is valid (even one the output does not include). Unknown keys are ignored. Empty values sort last.
- **Outputs**: `fieldIds === null` means all fields. When grouping is active the output emits all key + aggregation columns and `fieldIds` is ignored. An enabled override **replaces** the workflow-level setting. Always use `resolveOutputConfig(definition, output)` and `getResultColumns(definition, output)` from `lib/schema.js` rather than re-deriving this.
- **Display strings**: previews and reports are `string[][]`, already formatted by the engine. Empty cells are `""`.

Schema helpers you should use instead of re-implementing: `createId`, `createField`, `createTransform`,
`createFilterRule`, `createFilterGroup`, `createAggregation`, `createGroupBy`, `createSortRule`, `createOutput`,
`createReport`, `createDefinition`, `createTemplate`, `clone`, `normalizeName`, `uniqueName`, `sanitizeFileName`,
`sanitizeSheetName`, `outputFileName`, `extractRefs`, `replaceRefs`, `fieldColumnRefs`, `collectColumnRefs`,
`remapColumnRefs`, `matchColumns`, `suggestColumn`, `resolveOutputConfig`, `isGroupingActive`, `aggregationLabel`,
`getResultColumns`, `normalizeDefinition`, `validateDefinitionShape`, `validateTemplateShape`, and the catalogues
`TRANSFORMS`, `FORMAT_TRANSFORMS`, `DATE_PATTERNS`, `FILTER_OPERATORS`, `AGGREGATIONS`, `FILE_TYPES`,
`REPORT_THEMES`, `SOURCE_KINDS`, `COLUMN_TYPES`, `SCHEMA_VERSION`, `APP_ID`.

## 5. Stores

### `store/useWorkflowStore.js` (foundation, complete)

State:

| Key | Meaning |
| --- | --- |
| `step` | 0 Upload, 1 Mapping, 2 Outputs, 3 Export (`STEPS` export) |
| `file` | `{ name, size, lastModified }` or `null` |
| `sheets` | `[{ name, rowCount, colCount }]` of the parsed workbook |
| `columns` | `[{ name, type, index }]` of the loaded table |
| `rowCount`, `previewRows` | total source rows; first 50 rows as `string[][]` |
| `warnings` | `string[]` from the last table load |
| `status` | `'idle' \| 'parsing' \| 'loading' \| 'ready' \| 'error'` |
| `progress` | `{ phase, percent?, message? }` or `null` |
| `error` | message of the last load failure. `sheets` can still be set (pick another sheet) |
| `columnFix` | `{ missing: string[], suggestions: { [name]: string \| null } }` or `null` |
| `dataVersion` | bumps when the loaded table changes |
| `definition` | the `WorkflowDefinition` |
| `past`, `future` | undo / redo stacks |
| `dirty` | definition changed since the last template save |
| `templateId`, `templateName` | template this workflow came from (or `null`, `""`) |
| `draftRestored` | a draft was restored on page load (show a notice) |

Actions:

```
setStep(n) nextStep() prevStep()
loadFile(file) -> Promise<boolean>        parses in the worker, loads the table, toasts on failure
selectSheets(names) -> Promise<boolean>   setHeaderRow(n) -> Promise<boolean>   clearData()
resolveColumnFix({ missingName: actualName | "" })   dismissColumnFix()
updateDefinition(recipe, tag?)            generic undoable change: recipe(definition) => newDefinition
setDefinition(definition)   undo()   redo()
addField(overrides?) -> id   autoMapFields() -> count   updateField(id, patch)   removeField(id)
duplicateField(id) -> id     moveField(id, toIndex)
addTransform(fieldId, type, overrides?) -> id   updateTransform(fieldId, transformId, patch)
removeTransform(fieldId, transformId)           moveTransform(fieldId, transformId, -1 | 1)
setFilters(group)   setGroupBy(groupBy)   setSort(rules)
addOutput(overrides?) -> id   updateOutput(id, patch)   removeOutput(id)   duplicateOutput(id) -> id   moveOutput(id, -1 | 1)
applyTemplate(template, { mode: 'use' | 'edit' })   markTemplateSaved({ id, name })
resetWorkflow({ keepData = true })   getDraft()   restoreDraft(draft) -> boolean   dismissDraftNotice()
```

- `updateField` merges `patch.source` into `field.source`. `updateOutput` merges `patch.report` and `patch.overrides.{filters,sort,groupBy}` one level deep.
- `removeField` also removes the field from outputs, grouping, sorting and field-targeted filters.
- Selectors/hooks exported from the same file: `selectHasData`, `selectIsBusy`, `selectAvailableColumns` (loaded columns, or the template's `expectedColumns` when no file is loaded), `selectCanUndo`, `selectCanRedo`, `getStepStates(...)`, `useStepStates()`.
- **Selector rule (zustand 5)**: a selector must return a stable reference. Never build a new array/object inside a selector (`useWorkflowStore(s => s.definition.fields.map(...))` loops forever). Select the raw value and derive with `useMemo`.
- **No file loaded** is a supported state for Mapping and Outputs (editing a template): columns come from `selectAvailableColumns`, previews show an "upload a file to preview" empty state.

### `store/useTemplateStore.js` (owner D; API frozen)

```
templates: Template[]      hasHydrated: boolean
saveTemplate({ name, description?, tags?, definition }) -> { ok, template?, error? }
updateTemplate(id, { name?, description?, tags?, definition? }) -> { ok, template?, error? }
renameTemplate(id, name)   duplicateTemplate(id)   deleteTemplate(id)
importTemplates(templates) -> { ok, added, error? }     getTemplate(id)
```

Persisted with zustand `persist` under `ewb:v1:templates`, `skipHydration: true`. `StorageBridge` rehydrates it.

### `hooks/usePreview.js` (foundation)

`usePreview({ outputId = null, limit = 20, enabled = true })` -> `{ data, loading, error, hasData }` where
`data = { columns: [{ key, name, type }], rows: string[][], totalRows, sourceRows, issues } | null`.
Debounced, runs in the worker, keeps the previous data while loading.

### Toasts

`import { toast } from "@/lib/toast"` then `toast.success(msg, { description })`, `toast.error`, `toast.info`, `toast.warning`.

## 6. Worker protocol (`lib/workerClient.js` <-> `workers/parse.worker.js`)

Envelope: request `{ id, type, payload }`; progress `{ id, progress }`; response `{ id, ok, result | error{code,message} }`.
The dispatch loop is already in `workers/parse.worker.js`; Agent A fills in the handlers.

| type | payload | result |
| --- | --- | --- |
| `parseFile` | `{ file: File, datasetId }` | `{ datasetId, fileName, fileSize, sheets: [{ name, rowCount, colCount }] }` |
| `loadTable` | `{ datasetId, sheetNames, headerRow, previewLimit }` | `{ columns, rowCount, previewRows: string[][], sheetNames, headerRow, warnings: string[] }` |
| `getRows` | `{ datasetId, offset, limit }` | `{ rows: string[][], offset, total }` |
| `runPreview` | `{ datasetId, definition, outputId \| null, limit }` | `{ columns: [{ key, name, type }], rows: string[][], totalRows, sourceRows, issues }` |
| `buildOutput` | `{ datasetId, definition, outputId }` | `{ fileName, mime, bytes: Uint8Array, rowCount }` |
| `buildZip` | `{ datasetId, definition, outputIds \| null, zipName }` | `{ fileName, mime, bytes: Uint8Array, files: [{ fileName, rowCount }] }` |
| `disposeDataset` | `{ datasetId }` | `{ ok: true }` |

- Errors are thrown as `Error` with `.code` from `ERROR_CODES` and a **user-facing** `.message`
  (`UNSUPPORTED_FORMAT`, `CORRUPT_FILE`, `PASSWORD_PROTECTED`, `EMPTY_FILE`, `EMPTY_SHEET`, `NO_DATA`, `INVALID_DEFINITION`).
- `loadTable`: `headerRow` is 1-based; rows above it are skipped. Blank headers become `Column C` (sheet letter); duplicate
  headers get ` (2)`, ` (3)`. Fully empty rows are dropped. Several sheets are stacked by header name (union of columns)
  and a `Source Sheet` column is appended. Column `type` is inferred from the values.
- Source cell display strings: numbers without float noise, dates as `YYYY-MM-DD` (plus ` HH:mm` when a time is present).
- `runPreview.issues` = `validateDefinition(definition, columns)` plus run-time issues (for example a formula failing on N rows).
- UI code calls these through the store and `usePreview`; only `ExportStep` calls `buildOutput` / `buildZip` directly.

## 7. Engine modules (owner A)

```
lib/transforms.js
  isEmpty(v) -> boolean
  toNumber(v) -> number | null          lenient: "1,234.50", "₹ 1,200", "(45)", "12%" (-> 12), " 7 "
  toDate(v) -> Date | null              Date, ISO, DD/MM/YYYY, DD-MM-YYYY, YYYY/MM/DD, "5 Jan 2024", "Jan 5, 2024"; ambiguous a/b/yyyy is day-first
  toText(v) -> string                   raw value -> display string
  formatNumber(v, { decimals, thousands, prefix, suffix }) -> string
  formatDate(v, pattern) -> string      tokens YYYY YY MMMM MMM MM M DD D HH H hh h mm ss A
  applyTransform(v, transform) -> value
  applyTransforms(v, transforms) -> value          the whole chain (formats stringify)
  splitTrailingFormat(transforms) -> { head, format | null }
  formatDisplay(v, format | null) -> string        typed value + column format -> display string
  excelNumberFormat(format) -> string | null       "#,##0.00", "dd/mm/yyyy", ...

lib/filters.js
  compareValues(a, b) -> -1 | 0 | 1     numeric when both numeric, chronological when both dates, else case-insensitive text
  evaluateRule(rule, value) -> boolean
  evaluateFilterGroup(group, resolve) -> boolean   resolve(target) returns the value for rule.target

lib/formula.js                          hand-written parser. NEVER eval / new Function (templates are imported JSON)
  compileFormula(expression) -> { ok, error, refs, evaluate(getValue) }   getValue(columnName) -> raw value
      numbers, "strings", {Column}, + - * / %, unary minus, parentheses, & (concat), comparisons (= != <> < <= > >=),
      functions ROUND ABS MIN MAX SUM IF CONCAT LEN UPPER LOWER TRIM FLOOR CEIL COALESCE. Bad maths (text * 2, x / 0) -> null
  compileTemplate(template) -> { refs, render(getValue) -> string }

lib/pipeline.js
  runPipeline(table, definition, { outputId = null }) -> { columns: [{ key, name, type, format }], rows: any[][], totalRows, sourceRows, issues }
      table = { columns: [{ name, type, index }], rows: any[][] }
      order: map fields -> filter -> group/aggregate -> sort -> project columns (getResultColumns)
  toDisplayRows(result, limit) -> string[][]

lib/validate.js
  validateDefinition(definition, columns) -> Issue[]    pure and cheap: the UI also calls it directly when no file is loaded
      codes: missing-column, empty-source, empty-name, duplicate-name, formula-error, type-mismatch, missing-field, no-fields, empty-output-name ...

lib/excel.js
  readWorkbook(data: ArrayBuffer | Uint8Array, fileName) -> workbook      throws coded errors
  listSheets(workbook) -> [{ name, rowCount, colCount }]
  buildTable(workbook, { sheetNames, headerRow }) -> { columns, rows, sheetNames, headerRow, warnings }
  writeXlsx(result, { sheetName }) -> Uint8Array        real numbers/dates with number formats, sensible column widths
  writeCsv(result) -> Uint8Array                        UTF-8 with BOM, RFC 4180 quoting, formatted values
```

Target: 100,000 rows x 20 columns parse and preview without the worker taking more than a few seconds.

## 8. UI kit (`components/ui`, import from `"@/components/ui"`)

```
Button      { variant: 'primary'|'secondary'|'ghost'|'soft'|'danger'|'dangerGhost', size: 'sm'|'md'|'lg', icon, iconRight, loading, ...button }
IconButton  { label (required), icon, variant, size, ...button }
Input, Textarea, Select   native props + { invalid }
Field       { label, hint, error, required, hideLabel, children: (p) => <Input {...p} /> }   p = { id, aria-describedby, invalid }
Checkbox    { label, description, checked, onChange(bool), disabled }
Switch      { label, description, checked, onChange(bool), disabled }
Segmented   { label, options: [{ value, label }], value, onChange, size }
Card        { as, className }           SectionHeader { title, description, actions, as }
Badge       { tone: 'neutral'|'brand'|'danger'|'warning'|'info' }
Notice      { tone: 'info'|'success'|'warning'|'error', title, icon, actions, children }
Spinner     { label }                   EmptyState { icon, title, description, action }
Modal       { open, onClose, title, description, footer, size: 'sm'|'md'|'lg'|'xl', dismissable }
ConfirmDialog { open, title, message, confirmLabel, cancelLabel, tone: 'default'|'danger', onConfirm, onCancel }
```

## 9. Shared components

```
components/DataTable.jsx (B)
  { columns: ({ key?, name, type? } | string)[], rows: string[][], height?, maxHeight = 420, rowNumbers = true,
    startIndex = 0, loading = false, emptyMessage?, columnIssues?: { [key]: 'error'|'warning' },
    columnWidths?: { [key]: px }, caption?, className? }
  Virtualized rows (react-window 2), sticky header, horizontal scroll inside itself, numbers right-aligned.

components/mapping/FilterBuilder.jsx (B)   controlled
  { value: FilterGroup, onChange(next), columns: [{ name, type }], fields: [{ id, name }], issues?: Issue[] }
components/mapping/SortEditor.jsx (B)      controlled
  { value: SortRule[], onChange(next), options: [{ key, name }] }
components/mapping/GroupByEditor.jsx (B)   controlled
  { value: GroupBy, onChange(next), fields: [{ id, name }] }

components/ReportView.jsx (C)
  { ref, report: Report, columns: [{ key, name, type }], rows: string[][], totalRows?, generatedAt?, className? }
  Self-contained styling with explicit colours (must not depend on the app theme); `ref` lands on the root node for PNG capture.

components/templates/SaveTemplateButton.jsx (D)   { size?, variant?, className? }   opens the save / update dialog
components/templates/FixMappingDialog.jsx (D)     no props; shows while useWorkflowStore.columnFix is set
components/templates/StorageBridge.jsx (D)        no props; hydration, draft autosave, storage error toasts
components/TemplateCard.jsx (D)                   { template }
components/shell/Toaster.jsx (E)                  no props
components/Wizard.jsx (E)                         no props; renders the 4 steps, SaveTemplateButton and FixMappingDialog
```

## 10. Other modules

```
lib/share.js (C)
  nodeToPngBlob(node, { scale = 2, backgroundColor? }) -> Promise<Blob>
  canShareFiles() -> boolean
  shareImage(blob, { fileName, title, text }) -> Promise<{ ok, reason?: 'unsupported'|'cancelled'|'failed' }>
  copyImageToClipboard(blob) -> Promise<{ ok, reason? }>
  buildWhatsAppTextUrl(text, phone) -> string        https://wa.me/<digits>?text=...
  openWhatsAppWeb()

lib/templates.js (D)
  migrateDefinition(definition) -> definition        migrateTemplate(template) -> template
  serializeTemplate(template) -> object              templateFileName(template) -> string
  parseTemplateJson(text) -> { ok: true, templates, warnings } | { ok: false, errors }

lib/storage.js (D)      the only code that touches localStorage; never throws
  KEYS, storageKey(name), readJSON(name, fallback), writeJSON(name, value) -> { ok, code?, message? },
  readRaw, writeRaw, remove, onStorageError(listener) -> unsubscribe, isStorageAvailable(), isQuotaError(e),
  zustandStorage, storageUsage(), QUOTA_MESSAGE, UNAVAILABLE_MESSAGE

lib/aliases.js (foundation)   loadAliases() -> [{ from, to }], saveAlias(from, to), removeAlias(from, to)
lib/download.js (foundation)  downloadBlob(blob, name), downloadBytes(bytes, name, mime), downloadText, downloadJSON
```

Storage keys (all prefixed `ewb:v1:`): `templates`, `draft`, `theme` (`light` | `dark` | `system`), `aliases`, `history`.

## 11. Integration changes (after the first parallel build)

Additions agreed during integration. They extend the sections above; nothing was removed.

- **Worker start-up**: the worker posts `{ ready: true }` once its handler is attached and
  `lib/workerClient.js` waits for it before sending requests. Inside the worker, never test
  `typeof window`: Next.js compiles it to a constant in client bundles. Use `WorkerGlobalScope`.
- **Group-by overrides**: an enabled override replaces the workflow grouping including its `enabled`
  flag, so an output can switch grouping off (`resolveOutputConfig`).
- **Template store**: failed actions return `{ ok: false, error, code }` with
  `code: 'quota' | 'unavailable' | 'unknown' | 'not-found' | 'invalid'`; new state `loadError`; templates
  keep `folder`; `renameTemplate(id, "")` and `importTemplates([])` fail with `code: 'invalid'`.
- **`parseTemplateJson`** success also returns `skipped`: a bundle imports its valid templates and lists
  the broken ones in `warnings`.
- **`lib/templates.js`** also exports `MIGRATIONS`, `templateVersion`, `serializeTemplates`, `bundleFileName`,
  `cleanTemplateName`, `cleanTemplateDescription`, `cleanTemplateFolder`, `columnUsage` and limits;
  `migrateDefinition(definition, fromVersion?)`.
- **`lib/storage.js`** also exports `onStorageChange(listener)` (changes from other tabs) and `UNKNOWN_MESSAGE`.
- **Workflow store**: `setTemplateLink({ id, name })` changes the linked template without touching `dirty`.
- **`SortEditor` / `GroupByEditor`** accept an optional `issues` prop, like `FilterBuilder`.
- **`lib/share.js`**: `copyImageToClipboard` also accepts a `Promise<Blob>`; `openWhatsAppWeb()` returns `{ ok, reason }`.
- **`lib/excel.js`**: `readWorkbook` returns the engine's own sheet structure (not a SheetJS workbook);
  `zipFiles(files)` and `zipEntryDate()` are exported. The worker module exports `handlers` and
  `resetDatasets` for tests.
- **UI kit** additions: `ButtonLink`, tokens `control`, `surface-raised`, `brand-soft-hover`, `danger-hover`,
  `shadow-raised`, variants `usable-hover:` / `usable-active:`, the `.tap-target` utility. `Segmented`
  supports arrow keys.
- `package.json` is `"type": "module"`.

The per-area notes in `notes/agent-*.md` list each area's assumptions in detail.

## 12. Extras contract (phase 3)

Shapes are in the `lib/schema.js` header: `Cleaning`, `Lookup`, `ConditionalFormat`, `output.sheetStyle`,
`report.logo` / `report.logoHeight`, template `tags` / `folder`.

- **Pipeline order**: map fields -> filter -> **clean** -> group/aggregate -> sort -> project.
  Cleaning works on mapped field values: `trimText` (trim + collapse spaces in text values), `removeEmptyRows`
  (all mapped fields empty), `removeDuplicates` (`keys` = field ids, `[]` = whole row, first row wins),
  `fillBlanks` (`mode: 'value' | 'previous'`, `fieldIds` `[]` = every field).
- **`runPreview` result** also has `stats`, `cellIssues` and `highlights` (see `lib/workerClient.js`).
  Indexes are relative to the returned `rows` / `columns`.
- **Conditional formats** (`output.conditionalFormats`): `columnKey` is a result column key, `operator` one of
  `CONDITIONAL_OPERATORS`, `style` a `HIGHLIGHT_STYLES` key. xlsx files get real Excel conditional formatting
  rules; `sheetStyle` gives a bold header, a frozen header row and an auto filter. CSV carries none of it.
- **Lookup / merge**: `loadTable({ ..., lookup })` left-joins the table in the `"lookup"` dataset: key match is
  trimmed and case-insensitive (numbers by value), the first lookup row wins for duplicate keys, the chosen
  `columns` (`[]` = all except the key) are appended with `origin: 'lookup'` and a ` (lookup)` suffix on a name
  clash. Result `lookupInfo = { applied, matched, unmatched, addedColumns, duplicateKeys }`.
- **`runPivot`**: see `lib/workerClient.js`. Runs on the workflow-level rows after cleaning, before grouping.
- **`DataTable`** gains `cellMarks?: [row, col, tone, bold?][]`, tone `'error' | 'blank' |` a `HIGHLIGHT_STYLES` key.
- **`ReportView`** gains `highlights?` (same tuples as `runPreview.highlights`) and renders `report.logo`.
- **Run history**: every successful download calls `logRun` from `lib/history.js`.
- **Routes**: `/batch` (apply one template to several files), `/history` (run log).

## 13. Extras as built

- **Issue scopes**: `'cleaning'` is new (`id: 'removeDuplicates' | 'fillBlanks'`). Highlight-rule issues use
  `scope: 'output'` with `id` = the rule id and `outputId` set.
- **Excel conditional formatting**: each column with rules gets a leading `containsBlanks` rule and every rule has
  `stopIfTrue`, so blanks never match a comparison and the first matching rule wins, as in the preview. Date values
  without a time compare whole days; `contains` escapes Excel wildcards. `buildOutputFile` is async.
- **`runPreview.highlights`** are computed for every output with rules, CSV included (the file itself carries none).
- **Pivot** without a column field: two columns, labels and the value (which is also the row total).
- **`DataTable`** also takes `totalsRow` and `totalsColumn` (sticky, bold).
- **Toasts** accept `action?: { label, onClick }`.
- **Service worker** (`public/sw.js`, production only): cache-first for hashed `/_next/static/*`, network-first for
  pages and RSC payloads, stale-while-revalidate for other same-origin GETs. Bump `VERSION` in `public/sw.js` when
  the caching logic changes. Worker scripts must be answered with a fresh `Response` (Turbopack's worker URL
  carries a `#params` fragment that a cached response would lose).
- **Templates**: "Edit details" (name, description, tags, folder) replaces "Rename". Share links are
  `/templates#template=<payload>`; QR codes were left out because links are 2,000+ characters.
- **Batch** (`/batch`, `/batch?template=<id>`): runs queue one after another in the worker dataset `"batch"`; the zip
  is downloaded with a button after the run.

## 14. Summary settings in the definition

`definition.summary = { rowKey, columnKey, valueKey, fn }` (field ids, `""` = not chosen; `fn` an `AGGREGATIONS`
key) holds the Mapping step's Summary tab settings, so they are undoable, autosaved with the draft and saved in
templates. `createSummary()` builds the default and `normalizeDefinition` fills it in for older templates (no schema
version bump: the field is additive). Store action: `setSummary(patch)` (undoable, a no-op patch records nothing).
`removeField` clears any summary key that pointed at the removed field. The UI still falls back to a sensible row
field when `rowKey` is empty or unknown (`resolvePivot` in `components/summary/pivot.js`).

## 15. Multi-column merge keys

`Lookup` keys are lists: `mainKeyColumns: string[]` and `lookupKeyColumns: string[]` (the sides may differ in length),
joined with `keySeparator` (default `"_"`, `""` allowed, at most 5 characters). `keyColumnName` (`""` = off) adds the
main file's built key as a column with `origin: 'key'`. Older definitions with `matchColumn` / `lookupColumn` are
converted by `normalizeDefinition`; read keys through `getLookupKeys(lookup)` (`{ main, lookup }`), which accepts both.
`describeKey(columns, separator)` formats a key for sentences; `KEY_SEPARATORS` lists the offered separators.

Engine (`lib/lookup.js`): a one-column key matches exactly as before. For several columns each part is trimmed (numbers
in plain form, dates `YYYY-MM-DD`), the parts are joined, and the joined text is matched case-insensitively like a
one-column key; a key with any empty part never matches. `lookupInfo` adds `mainDuplicateKeys`, `emptyKeys` and
`keyColumn` (the added column's name or `null`). `columnUsage` labels a main key column "the merge key".
