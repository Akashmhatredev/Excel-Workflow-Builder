# Agent B: Upload + Mapping UI

Branch `feat/upload-mapping`. Everything lives in my folders: `components/DataTable.jsx`,
`components/UploadStep.jsx`, `components/MappingStep.jsx`, `components/upload/*`, `components/mapping/*`.

## What is built

- **DataTable**: one scroll container scrolls both ways. The header row and the row-number column are
  sticky inside it, so the page never scrolls sideways. Rows are virtualized with react-window 2 `List`
  (`scrollElement` = the container). Columns are virtualized with `useVirtualizer({ direction: "horizontal" })`,
  so only visible cells are in the DOM. Checked with 12,000 rows x 64 columns: about 375 cells mounted,
  about 17 ms per frame while scrolling.
- **UploadStep**: dropzone (the whole step accepts a drop), keyboard file picker, "Try the sample file",
  parse/load progress, a read-failure notice with "Choose another file", file summary with Replace/Remove,
  sheet checkboxes with row counts, header row, warnings, detected columns with type badges, a preview of
  the first 50 rows, "Browse all rows" (pages of 200 through `getRows`), the restored-draft notice and
  "Your data never leaves your browser".
- **MappingStep**: toolbar (Map all columns, Add field, Undo/Redo plus shortcuts), an issue summary,
  collapsible field rows, the source editor (Column / Combine / Formula with click-to-insert column chips
  and a syntax hint), transform editors, Filters, Group and aggregate, Sort, and a live preview that
  sticks to the top on wide layouts.
- **FilterBuilder / SortEditor / GroupByEditor**: controlled components that never read the store.

## Assumptions

- **Where issues are shown.** This needs Agent A to confirm the ids.
  - `scope: "field"` with `id` = field id: shown on that field row. A code containing `name` (such as
    `empty-name` or `duplicate-name`) marks the name input invalid; any other error marks the source control.
  - `scope: "filter"` / `"sort"` with `id` = rule id: shown on that rule.
  - `scope: "groupBy"` with `id` = aggregation id: shown on that aggregation.
  - A filter, sort or groupBy issue whose id matches nothing on screen is listed at the top of its section.
    Anything else (for example `no-fields` with `id: null`) is listed under the summary.
  - Issues with an `outputId` or `scope: "output"` are left to the Outputs step.
  - `columnIssues` for the preview: field ids, plus aggregation ids from groupBy issues.
- **Validation source.** `preview.data.issues` once a preview has come back; otherwise
  `validateDefinition(definition, columns)` is called directly (inside try/catch).
- **Undo shortcuts.** Ctrl/Cmd+Z undoes; Ctrl/Cmd+Shift+Z and Ctrl+Y redo. They are ignored in
  input, textarea, select and contenteditable, and while any `dialog[open]` exists.
- **Sheets** are applied with a "Use selected sheets" button, not on every checkbox, because each apply
  re-reads the table. The current selection comes from `pickSheetNames` (the store's own rule).
- **Header row** is committed on blur, Enter or Apply. A row that failed to load is not retried on blur.
- **Progress labels.** `progress.message` wins when set. The phases `reading`, `parsing`, `loading` and
  `indexing` get friendly labels; any other phase is shown capitalised. The bar is indeterminate
  without `percent`.
- **Field names.** Choosing a column for a field whose name is empty or still `Field N` renames it to the
  column name (through `uniqueName`).
- **Stray drops.** While UploadStep is mounted, window-level `dragover`/`drop` of files is prevented, so a
  drop next to the zone does not navigate away from the workflow.
- **Layout** uses container queries: the Mapping step switches to two columns when its container is at
  least 64rem wide (`@5xl`), whatever the viewport.

## Deviations from CONTRACTS.md section 9 (additive only)

- `SortEditor` and `GroupByEditor` accept an optional `issues` prop, as `FilterBuilder` does. Without it
  they behave exactly as specified.
- The FilterBuilder stub's comment mentioned an `idPrefix` prop. CONTRACTS.md does not list it and it is not
  needed (controls get ids from `useId` and descriptive `aria-label`s), so passing it has no effect.

## Skipped

- Lookup-file and cleaning UI (later phase). Lookup columns (`origin: "lookup"`) show as ordinary columns.
- `runPreview.cellIssues` is not rendered: DataTable has no prop for it yet.
- Drag-to-reorder fields (up/down buttons instead) and drag-to-resize table columns.

## Requests

- **Agent A**: please confirm the issue ids and codes above, and that `getRows` accepts any
  `offset`/`limit` and returns `total`. The sample at `/samples/sample-data.xlsx` is fetched as-is; until it
  exists the button shows a toast.
- **Agent E**: the Wizard renders the step heading (my steps start straight with content). If the wizard
  header is sticky, set the CSS variable `--ewb-sticky-top` to its height; the Mapping preview uses it as its
  sticky offset (default `5rem`).
- **Agent C**: import `DataTable`, `FilterBuilder`, `SortEditor` and `GroupByEditor` with the contract props.
  Pass `issues` filtered to the output if you want them shown inline.
- **Foundation (later phase)**: consider a `cellIssues` prop on DataTable for the `runPreview` cell flags.
