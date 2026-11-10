import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { SCHEMA_VERSION, clone, createId, createTemplate, normalizeDefinition, uniqueName } from "../lib/schema";
import { KEYS, zustandStorage } from "../lib/storage";

/**
 * store/useTemplateStore.js: saved templates, persisted to localStorage with
 * zustand's persist middleware (key "ewb:v1:templates"). Templates hold a
 * workflow definition only, never spreadsheet data.
 *
 * Hydration is manual (skipHydration) to avoid a server/client HTML mismatch:
 * components/templates/StorageBridge.jsx calls useTemplateStore.persist.rehydrate()
 * once on mount. Read `hasHydrated` before showing an empty state.
 *
 * PUBLIC API (do not rename; Agent D owns the internals):
 *   templates: Template[]
 *   hasHydrated: boolean
 *   saveTemplate({ name, description?, tags?, definition }) -> { ok, template?, error? }
 *   updateTemplate(id, patch)  -> { ok, template?, error? }   patch: { name?, description?, tags?, definition? }
 *   renameTemplate(id, name)   -> { ok, template?, error? }
 *   duplicateTemplate(id)      -> { ok, template?, error? }   "Copy of X", new id
 *   deleteTemplate(id)         -> { ok }
 *   importTemplates(templates) -> { ok, added: Template[], error? }   always assigns new ids
 *   getTemplate(id)            -> Template | undefined
 */
export const useTemplateStore = create(
  persist(
    (set, get) => ({
      templates: [],
      hasHydrated: false,

      saveTemplate: ({ name, description = "", tags = [], definition }) => {
        const template = createTemplate({ name, description, tags, definition: clone(definition) });
        set((state) => ({ templates: [template, ...state.templates] }));
        return { ok: true, template };
      },

      updateTemplate: (id, patch = {}) => {
        let updated = null;
        set((state) => ({
          templates: state.templates.map((template) => {
            if (template.id !== id) return template;
            updated = {
              ...template,
              ...(patch.name !== undefined ? { name: String(patch.name).trim() || template.name } : {}),
              ...(patch.description !== undefined ? { description: String(patch.description) } : {}),
              ...(patch.tags !== undefined ? { tags: patch.tags } : {}),
              ...(patch.definition !== undefined ? { definition: normalizeDefinition(clone(patch.definition)) } : {}),
              schemaVersion: SCHEMA_VERSION,
              updatedAt: new Date().toISOString(),
            };
            return updated;
          }),
        }));
        return updated ? { ok: true, template: updated } : { ok: false, error: "Template not found." };
      },

      renameTemplate: (id, name) => get().updateTemplate(id, { name }),

      duplicateTemplate: (id) => {
        const original = get().templates.find((template) => template.id === id);
        if (!original) return { ok: false, error: "Template not found." };
        const now = new Date().toISOString();
        const copy = {
          ...clone(original),
          id: createId("tpl"),
          name: uniqueName(`Copy of ${original.name}`, get().templates.map((t) => t.name)),
          createdAt: now,
          updatedAt: now,
        };
        set((state) => {
          const index = state.templates.findIndex((template) => template.id === id);
          const templates = state.templates.slice();
          templates.splice(index + 1, 0, copy);
          return { templates };
        });
        return { ok: true, template: copy };
      },

      deleteTemplate: (id) => {
        set((state) => ({ templates: state.templates.filter((template) => template.id !== id) }));
        return { ok: true };
      },

      importTemplates: (incoming = []) => {
        const names = get().templates.map((t) => t.name);
        const now = new Date().toISOString();
        const added = incoming.map((template) => {
          const name = uniqueName(template.name, names);
          names.push(name);
          return {
            ...createTemplate({ ...template, name }),
            createdAt: template.createdAt || now,
            updatedAt: now,
          };
        });
        set((state) => ({ templates: [...added, ...state.templates] }));
        return { ok: true, added };
      },

      getTemplate: (id) => get().templates.find((template) => template.id === id),
    }),
    {
      name: KEYS.templates,
      version: SCHEMA_VERSION,
      storage: createJSONStorage(() => zustandStorage),
      partialize: (state) => ({ templates: state.templates }),
      skipHydration: true,
      onRehydrateStorage: () => () => {
        useTemplateStore.setState({ hasHydrated: true });
      },
    },
  ),
);
