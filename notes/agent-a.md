# Agent A (data engine): notes

Branch `feat/data-engine`, based on the rewritten `origin/main` (`a8c5fe9`).

## What is in place

| File | Contents |
| --- | --- |
| `lib/transforms.js` | `isEmpty`, `toNumber` (lenient), `toDate` (day-first), `toText`, `formatNumber`, `formatDate`, `applyTransform(s)`, `splitTrailingFormat`, `formatDisplay`, `excelNumberFormat` |
| `lib/filters.js` | `compareValues`, `evaluateRule`, `evaluateFilterGroup`, plus compiled variants |
| `lib/formula.js` | hand-written tokenizer, parser and closure compiler (no `eval` or `new Function`), `compileFormula`, `compileTemplate` |
| `lib/validate.js` | `validateDefinition(definition, columns)` |
| `lib/pipeline.js` | `runPipeline`, `toDisplayRows` |
| `lib/excel.js` | `readWorkbook`, `listSheets`, `buildTable`, `writeXlsx`, `writeCsv` |
| `workers/parse.worker.js` | every handler in CONTRACTS.md section 6 |
| `scripts/make-samples.mjs` | `npm run samples` writes `public/samples/*` (seeded; the output is byte-identical on every run) |
| `scripts/make-large-sample.mjs`, `scripts/bench-engine.mjs` | performance tooling; their output is never committed |

Tests: 335 in 9 files (`npm test`), including the foundation's `schema` and `extras` suites.

## Deviations from CONTRACTS.md, and additions

Every export named in section 7 exists with its documented signature. The additions:

- **The workbook is the engine's own structure, not a SheetJS workbook:**
  `{ fileName, format, sheets: [{ name, grid: any[][], rowCount, colCount, errorCells }] }`. Cells are converted once while reading, and SheetJS's cell objects are released.
- **`loadTable` also returns `lookupInfo: null`.** The `lookup` payload is accepted and ignored for now (see the later-phase notes below).
- **`runPreview.columns` is `{ key, name, type }`**, as the contract says. The column `format` stays inside the worker.
- **The worker exports `handlers` and `resetDatasets()`** so Vitest can drive it in Node. The message loop is installed only when the file runs as a worker. Errors without a `.code` reach the UI as a generic message and are logged with `console.error` in the worker.
- **Extra exports:**
  - `lib/transforms.js`: `isStrictNumeric`, `cleanNumber`, `roundNumber`, `trimText`, `titleCase`, `compileTransform(s)`, `buildReplacePattern`, `coerceForFormat`, `excelSerialToDate`, `dateToExcelSerial`
  - `lib/filters.js`: `compareText`, `isRuleComplete`, `compileRule`, `compileFilterGroup`
  - `lib/formula.js`: `FORMULA_ERROR`, `FORMULA_FUNCTIONS`, and `bind(resolve)` on compiled formulas and templates
  - `lib/validate.js`: `createColumnLookup`
  - `lib/excel.js`: `writeXlsxBook` (several sheets), `parseDelimited`, `isNumericText`, `buildOutputFile`, `uniqueFileNames`, `zipFileName`, `zipFiles`
- **Issue codes beyond the contract list:**
  - static: `invalid-regex`, `empty-group`, `duplicate-output-name`
  - run-time (from the pipeline): `formula-failed`, `format-skipped`, `non-numeric`

## Semantics worth knowing

- **Dates are wall-clock values.** The UTC fields of a `Date` hold the calendar date and time the user sees, and nothing reads the local time zone. SheetJS is read with `cellDates: false` and date-formatted serials are converted by the engine. A test reads and writes 2024-01-05 as the same day in Asia/Kolkata, America/New_York, Pacific/Auckland and UTC. 1904 workbooks are handled.
- **Type inference** (every format, and always the engine's own, never SheetJS's):
  - A column is a number only if every value is a number or numeric text. Leading-zero codes such as `00123`, `+91...` and `1,2` stay text, but thousands-grouped amounts such as `1,200.50` and `12,34,567` count as numbers. This is a small extension of "strictly numeric", made because otherwise ordinary CSV amounts would be typed text.
  - Excel booleans become `"TRUE"`/`"FALSE"` text.
  - Times of day become `"HH:mm"` text.
  - Error cells become empty, with a warning.
- **Filters:** the typed rule value decides the comparison: number, then date (a date without a time compares whole days), then case-insensitive text. Empty cells only pass `isEmpty`, `notEquals` and `notContains`. `between` accepts its bounds in either order.
- **Sort** follows Excel's order: numbers, then dates, then text ascending, reversed for descending. Empty values are always last, and the sort is stable.
- **Formulas:**
  - Empty cells count as 0 and numeric text is read as a number.
  - Text in maths, or a division by zero, gives an empty cell plus a `formula-failed` warning counting the affected rows.
  - `10%` is a percentage, but `{A} % 3` is a remainder.
  - Date ± n moves the date by n days, and Date − Date gives a number of days.
  - `AND`, `OR` and `NOT` were added to the function list.
- **Combine templates** collapse the double space an empty value leaves behind (`"{First} {Last}"` gives `"Asha"`, not `"Asha "`).
- **Group keys** compare exact mapped values, so add trim and title transforms when "North" and " north " should be one group.
- **Odd `.xls` files:** HTML and tab-separated text saved as `.xls` (common web exports) are read too. A real workbook renamed to `.csv` still opens.

## Benchmark (Node 24, M-series Mac, 100,000 rows × 20 columns)

`node scripts/make-large-sample.mjs <file> && node scripts/bench-engine.mjs <file>`

| Step | xlsx (24.7 MB) | csv (13.7 MB) |
| --- | ---: | ---: |
| readWorkbook | 2.9–3.9 s | 0.1 s |
| buildTable (with type inference) | 0.04 s | 0.3 s |
| runPipeline: plain mapping of 20 columns | 0.04–0.09 s | 0.02 s |
| runPipeline: transforms, combine, formula, filter, 2-key sort | 0.2 s | 0.2 s |
| runPipeline: filter, group-by and sum/count, sort | 0.09 s | 0.08 s |
| writeXlsx (100k rows) | 2.6–4.6 s | same |
| writeCsv | 0.5–1.0 s | same |

The heap peaks around 300–370 MB.

- **Where the time goes:** a preview after a definition change runs the whole pipeline, which takes 0.1–0.2 s at this size. Reading an xlsx and writing an xlsx are SheetJS-bound. Of the write options I tried (compression on or off, `bookSST`), `compression: true` was the fastest.
- **Caching:** the worker keeps the last two pipeline results per dataset, so "preview, then download" runs the workflow once.

## Known gaps

- **xlsx output size.** SheetJS's built-in deflate only reaches about 2.7×, so 100k rows come out at about 25 MB, where Excel would write about 10 MB. A later fix could re-zip with the native `CompressionStream("deflate-raw")`.
- **No progress during parsing.** SheetJS reads synchronously, so the 3–4 s spent inside `XLSX.read` cannot report percentages.
- **Not yet run in a browser.** The worker bundle was only inspected: the Upload step is still a stub, so nothing calls the worker yet. The build emits a Turbopack worker entry (`turbopack-worker-*.js` plus a 696 KB chunk with the engine, SheetJS and JSZip). Turbopack's worker factory drops `type: "module"` and runs a classic worker, which is fine because the worker uses no top-level await. The build also copies the raw worker source into `static/media/`; that copy is unused and harmless.
- **Node warning in scripts.** Node prints `MODULE_TYPELESS_PACKAGE_JSON` when the `scripts/*.mjs` files import `lib/*.js`. It is only a warning; see the foundation request below.

## Requests for other owners

- **Foundation (optional).** Adding `"type": "module"` to `package.json` would silence the Node warning above. It changes nothing for Next, because every config file is already `.mjs`.
- **Foundation (`CONTRACTS.md`).**
  - List the extra issue codes above.
  - Document that `loadTable` returns `lookupInfo`.
  - Document that `buildZip` returns `mime: "application/zip"`.
- **Agent C (export).**
  - `buildZip` de-duplicates file names case-insensitively, and the names in `files` are the exact zip entry names.
  - `buildOutput` and `buildZip` throw `INVALID_DEFINITION` for a missing output, an output with no columns, or an xlsx larger than 1,048,575 rows. The message suggests saving as CSV instead.
- **Agent B (mapping).** Preview columns carry `type`, so numbers can be right-aligned. Field issues use `scope: "field"` and `id: field.id`; filter issues use the rule id.

## Later-phase features (main added the schema; not implemented yet)

The engine ignores these safely today: `normalizeDefinition` fills them in, and tests cover that the pipeline still runs. How I would add each one:

1. **`definition.cleaning`**
   - Apply it in `runPipeline` after the filter, before grouping, on the mapped slot arrays.
   - `trimText` wraps every text slot with `trimText`.
   - `removeEmptyRows` skips rows whose mapped slots are all empty.
   - `removeDuplicates` keys rows with the same `keyPart` encoding grouping uses (every slot when `keys` is `[]`); the first row wins.
   - `fillBlanks` handles `value` (coerced like the `default` transform) and `previous` (the last non-empty value per slot).
   - Report counts as issues, for example "12 duplicate rows removed".
2. **`lookup` on `loadTable`**
   - Build a `Map` from the lookup dataset's key column (normalised text, first match wins). Then append the chosen columns to every main row, with `origin: 'lookup'` and a " (lookup)" suffix on clashing names.
   - Return `lookupInfo: { applied, matched, unmatched, addedColumns }`.
   - `getRows` and the previews then see the joined table with no other change.
3. **`runPreview.cellIssues`**
   - The pipeline already knows which rows failed a formula or a format, through the per-slot counters.
   - Record `[row, column]` pairs for the first `limit` result rows only, plus `'blank'` for empty cells, and return them next to the display rows.
4. **`runPivot`**
   - Run the pipeline without grouping or projection, then make two passes over the row and column key slots, reusing `createAggregator` per cell.
   - Cap the distinct column keys (set `truncatedColumns`) and add a totals row and a totals column.
5. **`output.conditionalFormats` and `sheetStyle`** in `writeXlsx`:
   - Compile each format with `compileRule`.
   - Set `s` styles (fill, font colour, bold) on matching cells; this needs `cellStyles: true` when writing.
   - Implement `freezeHeader` and `autoFilter` with `!freeze`/`!autofilter`, and `boldHeader` as a header style. Check the SheetJS community build's style support before promising fills; if it lacks them, emit the formats as Excel conditional-formatting XML.
