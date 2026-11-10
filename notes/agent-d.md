# Agent D (templates): notes

Branch `feat/templates`, on top of `origin/main` (after main gained tags/folder, cleaning, lookup,
history and share links).

## What is built

- `lib/templates.js`: migration pipeline (`MIGRATIONS` = `{ fromVersion: step }`, applied in sequence,
  then normalised) with a real v0 -> v1 step (`mappings` -> `fields`, `sheetName`/`headerRow` ->
  `source`, string transforms such as `"trim"` / `"uppercase"` -> transform objects). Export
  (`serializeTemplate`, `serializeTemplates` bundle, file names) and import (`parseTemplateJson`:
  wrapped export, bare template, `{ templates: [...] }` bundle or a plain list; refuses invalid JSON,
  wrong `app`/`kind`, newer schema versions, bad `schemaVersion`, files > 2 MB, > 200 templates;
  error lists are capped at 20 lines). `columnUsage()` for the Fix mapping dialog. Never throws.
- `lib/storage.js`: same API, plus `onStorageChange` (other tabs), `UNKNOWN_MESSAGE`, and a quota error
  on an empty store is reported as `unavailable` (private windows with a zero quota).
  `zustandStorage.setItem/removeItem` now return the write result.
- `store/useTemplateStore.js`: same public API. Every write is checked; on failure the in-memory
  change is rolled back and the action returns `{ ok: false, error, code }`. Each stored template is
  run through `migrateTemplate` on every hydration (also when the payload version is current).
  Corrupt JSON hydrates as an empty list, sets `loadError`, and the raw text is kept under
  `ewb:v1:templates.corrupt` so the next save does not destroy it. An action called before
  hydration hydrates first, so it can never overwrite stored templates with an unloaded list.
  Tags go through `normalizeTags`; `folder` is kept on save, update, duplicate and import.
- UI: `/templates` (`app/templates/page.js` is a server component for metadata; the client part is
  `components/templates/TemplatesView.jsx`), `TemplateCard`, `SaveTemplateButton`,
  `FixMappingDialog`, `StorageBridge`, plus helpers `ActionMenu.jsx`, `importer.js`, `notify.js`.

## Deviations from CONTRACTS.md (please fold into sections 5 and 10)

- Store results carry `code` on failure: `'quota' | 'unavailable' | 'unknown' | 'not-found' | 'invalid'`.
- New store state `loadError: string | null`. New export `CORRUPT_BACKUP_KEY`.
- `saveTemplate` / `updateTemplate` also accept `folder` (main added the field to `Template`).
- `renameTemplate(id, "")` now returns `{ ok: false, code: 'invalid' }` instead of silently keeping the name.
- `importTemplates([])` returns `{ ok: false, added: [], code: 'invalid' }`.
- `parseTemplateJson` success also has `skipped`: in a bundle the valid templates are imported and the
  broken ones are listed in `warnings`. The call only fails when nothing is usable.
- New `lib/templates.js` exports: `MIGRATIONS`, `templateVersion`, `serializeTemplates`,
  `bundleFileName`, `cleanTemplateName`, `cleanTemplateDescription`, `cleanTemplateFolder`,
  `columnUsage`, `TEMPLATE_KIND`, `BUNDLE_KIND`, `MAX_IMPORT_BYTES`, `MAX_IMPORT_TEMPLATES`,
  `NAME_MAX_LENGTH`, `DESCRIPTION_MAX_LENGTH`. `migrateDefinition(definition, fromVersion?)` takes an
  optional version.
- New `lib/storage.js` exports: `onStorageChange(listener) -> unsubscribe`, `UNKNOWN_MESSAGE`.

## Requests for other owners

- **Foundation (`store/useWorkflowStore.js`)**: there is no action to change the template link
  without touching `dirty`. After renaming the template a workflow came from I call
  `useWorkflowStore.setState({ templateName })`, and after deleting it
  `setState({ templateId: null, templateName: "" })` (`markTemplateSaved` would clear `dirty`).
  A small `setTemplateLink({ id, name })` action would be cleaner; I will switch to it.
- **Agent A**: the empty state's "Load the sample template" fetches `/samples/sample-template.json`.
  Any format `parseTemplateJson` accepts works; the export envelope is preferred. A missing file
  shows an error toast, so nothing breaks before it lands.
- **Agent E**: toasts sit over the bottom of the page and can cover the last template card's
  buttons for a few seconds (pointer events are off on the container, so it is cosmetic). Consider
  the bottom-right corner on wide screens. `Toaster` should stay mounted before `StorageBridge`
  (it is), since storage errors during hydration are toasted.

## Assumptions

- The draft is written 500 ms after the last change to `definition`, `templateId`, `templateName` or
  `dirty`, and flushed on `pagehide`, on `visibilitychange` to hidden, and on unmount. An empty
  definition (no fields, no outputs) removes the draft key.
- Storage error toasts are de-duplicated per kind: background failures (autosave) at most once every
  30 s, failures of something the user just did unless the same toast was shown < 1.5 s ago.
- "Unsaved changes" before Use/Edit = `dirty && definition.fields.length > 0`, as briefed.
- "Save as new" from a template inherits that template's tags and folder.
- Search appears from 4 templates (or while a query is typed) and matches name, description and tags.

## Skipped (later phase, as instructed)

- No UI for tags or folders, run history (`lib/history.js`) or share links (`lib/shareLink.js`).
  `parseTemplateJson` is ready for decoded share-link text.

## Verified

- Vitest: `tests/templates.test.js` and `tests/storage.test.js` (migrations incl. a mocked 3-version
  pipeline, every import failure class, round trips, store persistence, corrupt storage, quota
  rollback for every action, a fake `localStorage` with a size limit).
- Chrome via Playwright against `next dev -p 3103` (62 checks, no console errors): empty state,
  sample import (404 and success), file import (bare, broken, not JSON, newer version, bundle with a
  broken entry, legacy v0), search, duplicate, rename (validation, focus, keyboard), export and
  re-import, export all, delete, reload persistence, Use/Edit, the replace-unsaved-work confirm,
  save / update / save as new, draft restore and debounced autosave, pagehide flush, Fix mapping
  (usage labels, suggestion preselect, apply, skip, remember on/off), quota (dialog stays open,
  rollback, download fallback, one toast), cross-tab sync, corrupt storage, 360 px layout, the
  action menu by keyboard, dark mode. The check used a temporary page that was deleted before
  committing.
- Not verified in the real wizard with a loaded Excel file: the engine and upload UI are other
  branches, so `columnFix` was set directly on the store.
