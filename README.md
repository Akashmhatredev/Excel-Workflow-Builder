# Excel Workflow Builder

Turn a raw Excel or CSV dump into clean output files and shareable report images, entirely in the
browser. Upload a file, map its columns to the fields you need, define one or more outputs, then
download them (individually or as a zip), export a report as PNG or PDF, or share it to WhatsApp.
The whole setup can be saved as a reusable template.

**Your data never leaves your browser.** There is no backend, no database, no API route and no
environment variable. Files are parsed in a Web Worker and kept in memory only. Templates, the
in-progress draft and small preferences are stored in `localStorage`; they contain column names and
settings, never rows.

## Quick start

Requires Node 20.9 or newer (the repo pins Node 24 in `.nvmrc`).

```bash
nvm use            # or put Node 20.9+ on your PATH
npm install
npm run dev        # http://localhost:3000
```

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server (Turbopack) |
| `npm run build` | Production build |
| `npm start` | Serve the production build |
| `npm run lint` | ESLint, zero warnings allowed |
| `npm test` | Vitest unit tests |
| `npm run samples` | Regenerate the files in `public/samples/` |

Sample files for trying the app live in `public/samples/`:

- `sample-data.xlsx`: a sales-order dump with two sheets
- `sample-data-renamed.xlsx`: similar data with renamed headers, for testing "Fix mapping"
- `sample-template.json`: a template for the sample data (import it on the Templates page)

## How it works

The wizard has four steps. You can move back and forward freely; nothing is lost.

1. **Upload**: drop an `.xlsx`, `.xls` or `.csv` file (`.xlsm` and `.tsv` work too). Pick the
   sheet(s) and the header row, and check the detected columns, their inferred types and the first
   50 rows. "Browse all rows" pages through the whole file. "Merge columns from a second file" works like
   VLOOKUP: pick a key in each file and the chosen columns of the second file are added to every
   matching row. A key can be one column or **several columns combined** with a separator of your
   choice (`_`, `-`, `|`, `/`, `.`, space, nothing, or a custom one), for example Customer + Date ->
   `C001_2024-01-05`. The two files may use a different number of key columns, so a combined key also
   matches a column that already holds the joined text. You can add the combined key to the file as a
   column (a ready-made unique ID for your outputs), and the result says whether the key is unique in
   each file.
2. **Mapping**: define the output fields. Each field takes a source column, a combination of
   columns (`{First} {Last}`) or a formula (`{Qty} * {Price}`), plus a chain of transforms: trim,
   upper/lower/title case, number format, date format, default if empty, split by delimiter, find
   and replace. Add row filters (AND/OR), grouping with aggregations (sum, count, average, min, max)
   and multi-column sorting. **Data cleaning** trims spaces, removes empty rows and duplicates, and fills
   blanks (with a value or the value from the row above). A live preview shows the first 20 result rows
   ("Highlight problems" marks cells that could not be calculated and empty cells), a **Summary** tab
   builds a pivot table with totals (its settings are saved with the workflow and in templates, and
   they are undoable), and validation problems
   (missing source columns, type mismatches, broken formulas) are highlighted on the field they
   belong to. Undo and redo work here (Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z).
3. **Outputs**: add as many outputs as you need. Each has a name, a file type (xlsx or csv), a sheet
   name, the fields to include, and optional overrides for filters, sorting and grouping. Any
   output can also be a **report view**: a styled table with a title, subtitle, logo, theme, column
   widths, footer and date stamp, meant to be exported as an image. xlsx outputs can carry
   **conditional formatting** (highlight rules such as "Qty greater than 5 in red"), a bold and frozen
   header row and filter buttons; the rules are real Excel rules, and they also colour the preview and the
   report image.
4. **Export**: download each file, or everything as one zip. Download a report as PNG (1x, 2x, 3x)
   or PDF (fitted to the image or on A4). Share it:
   - on phones and other browsers that support it, through the system share sheet (Web Share API
     with the PNG file), where you can pick WhatsApp;
   - on desktop, "Copy image and open WhatsApp Web" copies the PNG to the clipboard and opens
     WhatsApp Web; paste it into the chat with Ctrl+V (Cmd+V on a Mac). **WhatsApp Web cannot
     receive an image automatically**, so the paste is a manual step;
   - or send a text-only message through `https://wa.me/?text=...`, optionally to a phone number.

### Templates

"Save as template" is available at every step. A template stores only the definition: sheet and
header settings, expected columns, mappings, transforms, filters, outputs and report styling.

On the Templates page you can use, edit, duplicate, rename, delete, export (JSON) and import
templates (a single template, a bundle, or the sample). "Edit" opens the Mapping step without
needing a file; the columns come from the template. Templates can be organised with **tags and
folders** (filter by both, plus search), and **shared as a link**: the template is compressed into the
URL hash, so nothing is uploaded, and opening the link offers to import it.

**Column aliases** ("Cust Name" = "Customer") are saved when you tick "Remember these matches" in Fix
mapping, or managed on the Templates page. They apply to every template, in both directions.

### Batch mode, history and offline use

- **Batch** (`/batch`): apply one template (or the current workflow) to several files and download one
  zip with a folder per file. Files are processed in the browser, one at a time; missing columns are
  reported per file.
- **History** (`/history`, and "Recent runs" on the home page): every download is logged with the
  template name, the source file name, the outputs and their row counts. No data is stored.
- **Offline**: the production build registers a service worker (`public/sw.js`). Once the app has
  been loaded it opens and processes files without a connection, and it can be installed as an app.
  When a new version is deployed a "Reload" message appears.

When a template is applied to a new file, headers are matched ignoring case and extra whitespace,
then through your saved column aliases. If referenced columns are still missing, a **Fix mapping**
screen lets you remap them (and remember the match as an alias).

Templates carry a `schemaVersion`. Older versions are upgraded by the migration functions in
`lib/templates.js`; templates from a newer version are rejected with a clear message.

### Architecture

```
 UI thread (React, zustand)                          Web Worker (workers/parse.worker.js)
 ──────────────────────────                          ────────────────────────────────────
 store/useWorkflowStore   dataset metadata           keeps the parsed workbook and table
                          + workflow definition      lib/excel.js       SheetJS read / write
 store/useTemplateStore   persist -> localStorage    lib/pipeline.js    definition -> result rows
 hooks/usePreview         debounced previews         lib/transforms.js  lib/filters.js
 lib/workerClient.js  ───── postMessage (promises) ─▶ lib/formula.js    lib/validate.js
```

- The full dataset lives only in the worker. The UI receives small display-ready slices and
  finished file bytes, so large files (100k+ rows) do not freeze the page. Tables are virtualized
  with `react-window`.
- The workflow **definition** (`lib/schema.js`) is plain JSON. It is the only thing that is ever
  saved: as the autosaved draft and inside templates.
- Formulas are evaluated by a hand-written parser (`lib/formula.js`). Nothing is ever `eval`'d, so
  an imported template cannot run code.
- `CONTRACTS.md` documents every module's exports, the data shapes and the worker protocol.
- The workflow draft is autosaved (debounced) so a refresh keeps your mapping. After a refresh you
  only have to load the file again.

Measured in Chrome on a laptop with a generated 100,000 x 20 workbook (24.7 MB): the file loads in
about 3 s, the mapping preview refreshes in about 0.3 s, and an xlsx export takes about 2 s, with no
main-thread task over 50 ms while it works. Run `node scripts/make-large-sample.mjs big.xlsx` to try
it yourself and `node scripts/bench-engine.mjs` for the engine timings in Node.

### Storage keys

Everything is namespaced under `ewb:v1:` in `localStorage`: `templates`, `draft`, `theme`
(`light`, `dark` or `system`; the theme follows the OS until you pick one), `aliases` (remembered
column matches from "Fix mapping") and `history`. Every read and write is wrapped in try/catch; a
full or blocked storage shows a message and the app keeps working in memory.

### Project structure

```
app/            layout, dashboard (/), wizard (/workflow), templates (/templates), batch (/batch),
                history (/history), manifest, icons, error/404 pages
components/     Wizard, UploadStep, MappingStep, OutputsStep, ExportStep, DataTable, ReportView,
                TemplateCard, ui/ (shared kit), upload/, mapping/, summary/, outputs/, export/,
                templates/, batch/, history/, shell/
hooks/          usePreview
lib/            schema, excel, transforms, filters, formula, pipeline, validate, templates, storage,
                share, workerClient, download, aliases, toast, history, shareLink, pdf, batch,
                cleaning, lookup, pivot, xlsxStyle
store/          useWorkflowStore, useTemplateStore, useToastStore
workers/        parse.worker.js
tests/          Vitest unit tests (508)
public/samples/ sample data and a sample template
public/sw.js    the service worker (bump VERSION when its caching logic changes)
scripts/        sample generators, large-file generator, engine benchmark
notes/          per-area implementation notes and assumptions
```

## Deploying to Vercel

No configuration is needed.

1. Push the repository to GitHub.
2. In Vercel choose **Add New... > Project** and import the repository.
3. Keep the detected settings: **Framework Preset: Next.js**, build command `next build`, default
   output, install command `npm install`.
4. Do not add any environment variables. There are none.
5. Click **Deploy**.

Every page is statically prerendered, so the deployment is just static files plus the client bundle.
`xlsx` (SheetJS) is installed from the official SheetJS CDN tarball (`cdn.sheetjs.com`), which is
where current releases are published; the copy on the npm registry is outdated.

## Assumptions

- **Dates**: an ambiguous text date such as `03/04/2024` is read day-first (3 April). Real Excel date
  cells are unambiguous and keep their calendar day regardless of time zone.
- **CSV**: decoded as UTF-8 (falling back to Windows-1252). Values with leading zeros such as
  `00123` stay text. CSV output is UTF-8 with a BOM so Excel opens it correctly.
- **Several sheets** selected together are stacked by header name, with a `Source Sheet` column.
- **Number/date format as the last transform** of a field keeps the cell a real number or date in
  Excel (with a number format) rather than text, so totals still work.
- **Grouped outputs** contain the group keys and the aggregations; the field checklist is ignored.
- **An output override replaces** the workflow-level filter, sort or grouping for that output.
- **Report images** are capped at 500 rows. A report is a picture, not a data export.
- **CSV types**: a column is a number only if every non-empty value is numeric (thousands
  separators such as `1,200` are allowed); a date only if every value parses as a date.
- **Templates with missing columns**: a column that cannot be matched can be left unmapped; the
  fields that use it show a validation error until it is remapped.
- **Merging into `main`**: work is delivered as one branch per area plus an integration branch, so
  each can be reviewed as a pull request.

## Known limitations

- Large xlsx exports are big (a 100,000 x 20 export is about 12 MB). Re-saving in Excel shrinks it;
  CSV output is much smaller.
- Reading an xlsx cannot report fine-grained progress while SheetJS parses it.
- WhatsApp Web cannot receive an image automatically; the image has to be pasted (or attached).
- Sharing a PNG through the system share sheet depends on the browser (works on Android Chrome, iOS
  Safari and recent desktop Chrome/Edge; Firefox desktop falls back to copy or download).

- Grouping and duplicate detection compare text exactly (after trimming when "Trim spaces" is on), so
  "East" and "EAST" are different groups; add an UPPERCASE or Title Case transform to merge them.
- Share links are 2,000+ characters, so there is no QR code option.
- The conditional formatting written into xlsx files was checked by reading the files back (SheetJS and
  openpyxl), not by opening them in Microsoft Excel.

## Future improvements

- Drag-and-drop reordering of fields and outputs (up/down buttons today).
- Resizable preview columns.
- Fine-grained parse progress for very large xlsx files.
- A smaller xlsx writer for very large exports.
- QR codes for short templates; a template gallery shared between people (would need a backend).
