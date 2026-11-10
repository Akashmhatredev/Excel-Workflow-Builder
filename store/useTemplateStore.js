import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { SCHEMA_VERSION, clone, createId, uniqueName } from "../lib/schema";
import { KEYS, UNKNOWN_MESSAGE, zustandStorage } from "../lib/storage";
import { cleanTemplateName, migrateTemplate } from "../lib/templates";

/**
 * store/useTemplateStore.js: saved templates, persisted to localStorage with
 * zustand's persist middleware (key "ewb:v1:templates"). Templates hold a
 * workflow definition only, never spreadsheet data.
 *
 * Hydration is manual (skipHydration) to avoid a server/client HTML mismatch:
 * components/templates/StorageBridge.jsx calls useTemplateStore.persist.rehydrate()
 * once on mount. Read `hasHydrated` before showing an empty state. An action
 * called before that hydrates first, so it can never overwrite stored templates
 * with a list that was not loaded yet.
 *
 * Every change is written to storage straight away. When the write fails (storage
 * full or switched off) the change is ROLLED BACK in memory and the action returns
 * { ok: false, error, code }, so what the user sees is always what a reload shows.
 *
 * PUBLIC API (do not rename; Agent D owns the internals):
 *   templates: Template[]
 *   hasHydrated: boolean
 *   loadError: string | null      set when the stored templates could not be read (the list then starts empty)
 *   saveTemplate({ name, description?, tags?, folder?, definition }) -> { ok, template?, error?, code? }
 *   updateTemplate(id, patch)  -> { ok, template?, error?, code? }   patch: { name?, description?, tags?, folder?, definition? }
 *   renameTemplate(id, name)   -> { ok, template?, error?, code? }
 *   duplicateTemplate(id)      -> { ok, template?, error?, code? }   "Copy of X", new id
 *   deleteTemplate(id)         -> { ok, error?, code? }
 *   importTemplates(templates) -> { ok, added: Template[], error?, code? }   always assigns new ids, de-duplicates names
 *   getTemplate(id)            -> Template | undefined
 *
 * `code` on a failure: 'quota' | 'unavailable' | 'unknown' (storage), 'not-found', 'invalid'.
 * Every template that enters the store goes through migrateTemplate (lib/templates.js), so
 * tags are always normalizeTags()-clean and `folder` is always a string. Duplicates and
 * imports keep both.
 */

/** Unreadable stored JSON is copied here before the next save overwrites it. */
export const CORRUPT_BACKUP_KEY = `${KEYS.templates}.corrupt`;

const notFound = () => ({
  ok: false,
  code: "not-found",
  error: "This template no longer exists. It may have been deleted in another tab.",
});
const LOAD_ERROR =
  "Your saved templates could not be read, so the list starts empty. The unreadable data was kept in this browser's storage.";

let lastWrite = null; // result of the most recent persist write: { ok, code?, message? }
let writesPaused = false; // true while rolling back: a rollback must never touch storage
let unreadable = false; // the stored value was not valid JSON (set by getItem, read by merge)

function withoutWriting(action) {
  writesPaused = true;
  try {
    action();
  } finally {
    writesPaused = false;
  }
}

/** zustandStorage plus two things persist does not give us: the result of each write, and survival of corrupt JSON. */
const trackedStorage = {
  getItem: (name) => {
    unreadable = false;
    const raw = zustandStorage.getItem(name);
    if (raw == null) return null;
    try {
      JSON.parse(raw);
      return raw;
    } catch {
      unreadable = true;
      zustandStorage.setItem(CORRUPT_BACKUP_KEY, raw);
      return null;
    }
  },
  setItem: (name, value) => {
    if (writesPaused) return;
    lastWrite = zustandStorage.setItem(name, value);
  },
  removeItem: (name) => {
    zustandStorage.removeItem(name);
  },
};

/** Stored state -> a clean Template[] (every entry migrated, junk dropped, ids unique). Never throws. */
function readStoredTemplates(persisted) {
  const list = persisted && typeof persisted === "object" && Array.isArray(persisted.templates) ? persisted.templates : [];
  const ids = new Set();
  const templates = [];
  for (const entry of list) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    let template = migrateTemplate(entry);
    if (ids.has(template.id)) template = { ...template, id: createId("tpl") };
    ids.add(template.id);
    templates.push(template);
  }
  return templates;
}

function safeClone(value) {
  try {
    return { ok: true, value: clone(value) };
  } catch {
    return { ok: false, code: "invalid", error: "This workflow could not be saved because it contains values that cannot be stored." };
  }
}

export const useTemplateStore = create(
  persist(
    (set, get, api) => {
      const ensureHydrated = () => {
        if (!get().hasHydrated && api.persist) api.persist.rehydrate();
      };

      /**
       * Apply a change to the list and make sure it reached storage.
       * recipe(templates) => newTemplates. Returns { ok: true } or { ok: false, error, code }.
       */
      const commit = (recipe) => {
        ensureHydrated();
        const previous = get().templates;
        const next = recipe(previous);
        if (next === previous) return { ok: true };
        lastWrite = null;
        set({ templates: next });
        const result = lastWrite;
        lastWrite = null;
        if (result && result.ok === false) {
          withoutWriting(() => set({ templates: previous }));
          return { ok: false, error: result.message || UNKNOWN_MESSAGE, code: result.code || "unknown" };
        }
        return { ok: true };
      };

      return {
        templates: [],
        hasHydrated: false,
        loadError: null,

        saveTemplate: (input) => {
          const { name, description = "", tags = [], folder = "", definition } = input || {};
          const copy = safeClone(definition);
          if (!copy.ok) return copy;
          const now = new Date().toISOString();
          const template = migrateTemplate({
            id: createId("tpl"),
            name,
            description,
            tags,
            folder,
            createdAt: now,
            updatedAt: now,
            schemaVersion: SCHEMA_VERSION,
            definition: copy.value,
          });
          const result = commit((templates) => [template, ...templates]);
          return result.ok ? { ok: true, template } : result;
        },

        updateTemplate: (id, patch) => {
          ensureHydrated();
          const existing = get().templates.find((template) => template.id === id);
          if (!existing) return notFound();
          const p = patch || {};
          let definition = existing.definition;
          if (p.definition !== undefined) {
            const copy = safeClone(p.definition);
            if (!copy.ok) return copy;
            definition = copy.value;
          }
          const updated = migrateTemplate({
            ...existing,
            name: p.name !== undefined ? cleanTemplateName(p.name) || existing.name : existing.name,
            description: p.description !== undefined ? p.description : existing.description,
            tags: p.tags !== undefined ? p.tags : existing.tags,
            folder: p.folder !== undefined ? p.folder : existing.folder,
            definition,
            updatedAt: new Date().toISOString(),
          });
          const result = commit((templates) => templates.map((template) => (template.id === id ? updated : template)));
          return result.ok ? { ok: true, template: updated } : result;
        },

        renameTemplate: (id, name) => {
          const clean = cleanTemplateName(name);
          if (!clean) return { ok: false, code: "invalid", error: "Enter a name for the template." };
          return get().updateTemplate(id, { name: clean });
        },

        duplicateTemplate: (id) => {
          ensureHydrated();
          const original = get().templates.find((template) => template.id === id);
          if (!original) return notFound();
          const now = new Date().toISOString();
          const copy = {
            ...clone(original),
            id: createId("tpl"),
            name: uniqueName(
              cleanTemplateName(`Copy of ${original.name}`),
              get().templates.map((template) => template.name),
            ),
            createdAt: now,
            updatedAt: now,
          };
          const result = commit((templates) => {
            const index = templates.findIndex((template) => template.id === id);
            const next = templates.slice();
            next.splice(index + 1, 0, copy);
            return next;
          });
          return result.ok ? { ok: true, template: copy } : result;
        },

        deleteTemplate: (id) =>
          commit((templates) => {
            const next = templates.filter((template) => template.id !== id);
            return next.length === templates.length ? templates : next;
          }),

        importTemplates: (incoming) => {
          ensureHydrated();
          const list = (Array.isArray(incoming) ? incoming : []).filter(
            (entry) => entry && typeof entry === "object" && !Array.isArray(entry),
          );
          if (!list.length) return { ok: false, added: [], code: "invalid", error: "There are no templates to import." };
          const names = get().templates.map((template) => template.name);
          const now = new Date().toISOString();
          const added = list.map((entry) => {
            const template = migrateTemplate(entry);
            const name = uniqueName(template.name, names);
            names.push(name);
            return { ...template, id: createId("tpl"), name, updatedAt: now };
          });
          const result = commit((templates) => [...added, ...templates]);
          return result.ok ? { ok: true, added } : { ...result, added: [] };
        },

        getTemplate: (id) => get().templates.find((template) => template.id === id),
      };
    },
    {
      name: KEYS.templates,
      version: SCHEMA_VERSION,
      storage: createJSONStorage(() => trackedStorage),
      partialize: (state) => ({ templates: state.templates }),
      skipHydration: true,
      // Runs when the stored payload was written by another persist version.
      migrate: (persisted) => ({ templates: readStoredTemplates(persisted) }),
      // Runs on every hydration: each stored template goes through migrateTemplate, whatever wrote it.
      merge: (persisted, current) => ({
        ...current,
        templates: readStoredTemplates(persisted),
        hasHydrated: true,
        loadError: unreadable ? LOAD_ERROR : null,
      }),
      onRehydrateStorage: () => (_state, error) => {
        if (!error) return;
        // Hydration itself failed. Still mark the store as ready, without overwriting what is stored.
        withoutWriting(() => useTemplateStore.setState({ hasHydrated: true, loadError: LOAD_ERROR }));
      },
    },
  ),
);
