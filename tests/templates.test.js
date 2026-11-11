import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  APP_ID,
  SCHEMA_VERSION,
  createDefinition,
  createField,
  createFilterRule,
  createOutput,
  createSortRule,
  createTemplate,
  createTransform,
} from "@/lib/schema";
import {
  BUNDLE_KIND,
  MAX_IMPORT_BYTES,
  MAX_IMPORT_TEMPLATES,
  MIGRATIONS,
  NAME_MAX_LENGTH,
  NO_FOLDER,
  TEMPLATE_KIND,
  bundleFileName,
  cleanTemplateName,
  columnUsage,
  filterTemplates,
  groupTemplatesByFolder,
  migrateDefinition,
  migrateTemplate,
  parseTemplateJson,
  serializeTemplate,
  serializeTemplates,
  templateFileName,
  templateFolders,
  templateTags,
  templateVersion,
} from "@/lib/templates";

/* ------------------------------------------------------------------ */
/* fixtures                                                             */
/* ------------------------------------------------------------------ */

function sampleDefinition() {
  const region = createField({
    name: "Region",
    source: { kind: "column", column: "Region" },
    transforms: [createTransform("trim"), createTransform("upper")],
  });
  const fullName = createField({ name: "Full name", source: { kind: "combine", template: "{First} {Last}" } });
  const total = createField({
    name: "Total",
    source: { kind: "formula", expression: "{Qty} * {Price}" },
    transforms: [createTransform("numberFormat", { decimals: 0 })],
  });
  return createDefinition({
    source: {
      sheetNames: ["Sales"],
      headerRow: 2,
      expectedColumns: [
        { name: "Region", type: "text" },
        { name: "First", type: "text" },
        { name: "Last", type: "text" },
        { name: "Qty", type: "number" },
        { name: "Price", type: "number" },
        { name: "Status", type: "text" },
      ],
    },
    fields: [region, fullName, total],
    filters: {
      combinator: "and",
      rules: [createFilterRule({ target: { kind: "column", ref: "Status" }, operator: "equals", value: "Paid" })],
    },
    sort: [createSortRule({ key: total.id, direction: "desc" })],
    outputs: [
      createOutput({ name: "Summary", report: { enabled: true, title: "Sales by region", theme: "brand" } }),
      createOutput({
        name: "Regions only",
        fileType: "csv",
        fieldIds: [region.id],
        overrides: {
          filters: {
            enabled: true,
            group: { combinator: "and", rules: [createFilterRule({ target: { kind: "column", ref: "Qty" }, operator: "gt", value: "0" })] },
          },
        },
      }),
    ],
  });
}

function sampleTemplate(overrides = {}) {
  return createTemplate({
    name: "Monthly sales",
    description: "Regional totals for the finance team",
    tags: ["sales"],
    definition: sampleDefinition(),
    ...overrides,
  });
}

/** What a template looked like before templates carried a schemaVersion ("version 0"). */
function legacyTemplate() {
  return {
    id: "tpl_legacy",
    name: "Legacy sales",
    description: "Saved before templates had versions",
    createdAt: "2026-01-05T10:00:00.000Z",
    updatedAt: "2026-02-01T08:30:00.000Z",
    definition: {
      sheetName: "Sales",
      headerRow: 3,
      mappings: [
        { id: "fld_a", name: "Region", source: { kind: "column", column: "Region" }, transforms: ["trim", "uppercase"] },
        { id: "fld_b", name: "Total", source: { kind: "formula", expression: "{Qty} * {Price}" }, transforms: [] },
      ],
      outputs: [{ id: "out_a", name: "Report", fileType: "xlsx", fieldIds: null }],
    },
  };
}

const json = (value) => JSON.stringify(value);

/* ------------------------------------------------------------------ */
/* migrations                                                           */
/* ------------------------------------------------------------------ */

describe("template migrations", () => {
  it("has one migration step for every older schema version", () => {
    for (let version = 0; version < SCHEMA_VERSION; version += 1) {
      expect(typeof MIGRATIONS[version], `MIGRATIONS[${version}]`).toBe("function");
    }
  });

  it("reads the version a template was written with", () => {
    expect(templateVersion(legacyTemplate())).toBe(0);
    expect(templateVersion(sampleTemplate())).toBe(SCHEMA_VERSION);
    expect(templateVersion({ definition: { schemaVersion: 1 } })).toBe(1);
    expect(templateVersion({ schemaVersion: "1" })).toBe(0);
    expect(templateVersion(null, 7)).toBe(7);
  });

  it("migrates a version 0 template to the current schema", () => {
    const legacy = legacyTemplate();
    const snapshot = structuredClone(legacy);
    const migrated = migrateTemplate(legacy);

    expect(legacy).toEqual(snapshot); // the input is not mutated
    expect(migrated).toMatchObject({
      id: "tpl_legacy",
      name: "Legacy sales",
      description: "Saved before templates had versions",
      tags: [],
      createdAt: "2026-01-05T10:00:00.000Z",
      updatedAt: "2026-02-01T08:30:00.000Z",
      schemaVersion: SCHEMA_VERSION,
    });

    const { definition } = migrated;
    expect(definition.schemaVersion).toBe(SCHEMA_VERSION);
    // mappings -> fields
    expect(definition).not.toHaveProperty("mappings");
    expect(definition.fields.map((field) => [field.id, field.name, field.source.kind])).toEqual([
      ["fld_a", "Region", "column"],
      ["fld_b", "Total", "formula"],
    ]);
    // sheetName / headerRow -> source
    expect(definition).not.toHaveProperty("sheetName");
    expect(definition).not.toHaveProperty("headerRow");
    expect(definition.source).toEqual({ sheetNames: ["Sales"], headerRow: 3, expectedColumns: [] });
    // "trim", "uppercase" -> transform objects with the current type names
    const transforms = definition.fields[0].transforms;
    expect(transforms.map((transform) => transform.type)).toEqual(["trim", "upper"]);
    for (const transform of transforms) expect(transform.id).toMatch(/^tr_/);
    // everything the old format did not have is filled in
    expect(definition.filters).toEqual({ combinator: "and", rules: [] });
    expect(definition.outputs[0]).toMatchObject({ id: "out_a", name: "Report", fileType: "xlsx", fieldIds: null });
    expect(definition.outputs[0].report.enabled).toBe(false);
  });

  it("accepts the legacy sheet name inside `source` and string transforms with parameters filled in", () => {
    const migrated = migrateTemplate({
      name: "Old",
      definition: {
        source: { sheetName: " Data ", headerRow: 2 },
        mappings: [{ id: "fld_1", name: "Amount", source: { kind: "column", column: "Amount" }, transforms: ["numberFormat", "TitleCase"] }],
      },
    });
    expect(migrated.definition.source).toMatchObject({ sheetNames: ["Data"], headerRow: 2 });
    expect(migrated.definition.source).not.toHaveProperty("sheetName");
    expect(migrated.definition.fields[0].transforms).toMatchObject([
      { type: "numberFormat", decimals: 2, thousands: true, prefix: "", suffix: "" },
      { type: "title" },
    ]);
  });

  it("leaves a current template unchanged", () => {
    const template = sampleTemplate();
    expect(migrateTemplate(template)).toEqual(template);
    // and migrating is idempotent: a migrated legacy template does not change again
    const once = migrateTemplate(legacyTemplate());
    expect(migrateTemplate(once)).toEqual(once);
  });

  it("migrates a bare definition (drafts)", () => {
    const definition = migrateDefinition(legacyTemplate().definition);
    expect(definition.schemaVersion).toBe(SCHEMA_VERSION);
    expect(definition.fields).toHaveLength(2);
    expect(definition.source.sheetNames).toEqual(["Sales"]);
    const current = sampleDefinition();
    expect(migrateDefinition(current)).toEqual(current);
    // an explicit version wins over what the definition says about itself
    expect(migrateDefinition({ schemaVersion: SCHEMA_VERSION, mappings: [{ id: "f", name: "A" }] }, 0).fields).toHaveLength(1);
  });

  it("never throws, whatever it is given", () => {
    const junk = [undefined, null, 0, "text", [], {}, { definition: "nope" }, { name: 12, definition: { mappings: "x", sheetName: 5 } }];
    for (const value of junk) {
      const template = migrateTemplate(value);
      expect(template.id).toMatch(/^tpl_/);
      expect(typeof template.name).toBe("string");
      expect(template.name.length).toBeGreaterThan(0);
      expect(template.schemaVersion).toBe(SCHEMA_VERSION);
      expect(Array.isArray(template.definition.fields)).toBe(true);
      expect(Array.isArray(template.definition.outputs)).toBe(true);
      expect(Array.isArray(migrateDefinition(value).fields)).toBe(true);
    }
  });

  it("keeps a template when a migration step throws", () => {
    const original = MIGRATIONS[0];
    MIGRATIONS[0] = () => {
      throw new Error("broken step");
    };
    try {
      const migrated = migrateTemplate({ id: "tpl_x", name: "Survivor", definition: { fields: [] } });
      expect(migrated).toMatchObject({ id: "tpl_x", name: "Survivor", schemaVersion: SCHEMA_VERSION });
    } finally {
      MIGRATIONS[0] = original;
    }
  });

  it("drops unknown template properties and tidies the known ones", () => {
    const migrated = migrateTemplate({
      ...sampleTemplate(),
      name: `   ${"x".repeat(200)}  `,
      tags: ["a", "A", 7, " b "],
      folder: "  Finance \n reports  ",
      createdAt: "not a date",
      rows: [["never", "stored"]],
    });
    expect(migrated).not.toHaveProperty("rows");
    expect(migrated.name).toHaveLength(NAME_MAX_LENGTH);
    expect(migrated.tags).toEqual(["a", "7", "b"]); // normalizeTags: case-insensitive de-duplication
    expect(migrated.folder).toBe("Finance reports");
    expect(Number.isNaN(Date.parse(migrated.createdAt))).toBe(false);
  });

  it("keeps tags and folder, and fills them in when they are missing", () => {
    const template = sampleTemplate({ tags: ["sales", "monthly"], folder: "Finance" });
    expect(template.folder).toBe("Finance");
    expect(migrateTemplate(template)).toEqual(template);
    const legacy = migrateTemplate(legacyTemplate());
    expect(legacy.tags).toEqual([]);
    expect(legacy.folder).toBe("");
    expect(migrateTemplate({ name: "Odd", tags: "not a list", folder: 12, definition: {} })).toMatchObject({ tags: [], folder: "" });
    expect(migrateTemplate({ name: "Long", folder: "f".repeat(100), tags: Array.from({ length: 20 }, (_, i) => `t${i}`) })).toMatchObject({
      folder: "f".repeat(40),
      tags: Array.from({ length: 12 }, (_, i) => `t${i}`),
    });
  });

  describe("with several schema versions", () => {
    afterEach(() => {
      vi.doUnmock("@/lib/schema");
      vi.resetModules();
    });

    it("applies the steps in sequence, starting at the template's own version", async () => {
      vi.resetModules();
      vi.doMock("@/lib/schema", async (importOriginal) => ({ ...(await importOriginal()), SCHEMA_VERSION: 3 }));
      const templates = await import("@/lib/templates");
      const trail = (template, step) => ({ ...template, description: `${template.description || ""}${step}` });
      templates.MIGRATIONS[1] = (template) => trail(template, "b");
      templates.MIGRATIONS[2] = (template) => trail(template, "c");
      const base = { name: "T", definition: { fields: [] } };

      const fromLegacy = templates.migrateTemplate({ ...base, definition: { mappings: [{ id: "f", name: "A" }] } });
      expect(fromLegacy.description).toBe("bc");
      expect(fromLegacy.definition.fields).toHaveLength(1); // step 0 ran first
      expect(fromLegacy.schemaVersion).toBe(3);

      expect(templates.migrateTemplate({ ...base, schemaVersion: 1 }).description).toBe("bc");
      expect(templates.migrateTemplate({ ...base, schemaVersion: 2 }).description).toBe("c");
      expect(templates.migrateTemplate({ ...base, schemaVersion: 3 }).description).toBe("");

      // a file from version 4 is "newer than this app"
      const newer = templates.parseTemplateJson(json({ ...base, schemaVersion: 4 }));
      expect(newer.ok).toBe(false);
      expect(newer.errors[0]).toMatch(/newer version of the app/);
      // and one from version 2 is upgraded on import
      const older = templates.parseTemplateJson(json({ ...base, schemaVersion: 2 }));
      expect(older.ok).toBe(true);
      expect(older.templates[0]).toMatchObject({ description: "c", schemaVersion: 3 });
      expect(older.warnings[0]).toMatch(/older version/);
    });
  });
});

/* ------------------------------------------------------------------ */
/* export                                                               */
/* ------------------------------------------------------------------ */

describe("exporting templates", () => {
  it("wraps a template in the export envelope", () => {
    const template = sampleTemplate();
    const exported = serializeTemplate(template);
    expect(Object.keys(exported)).toEqual(["app", "kind", "schemaVersion", "exportedAt", "template"]);
    expect(exported).toMatchObject({ app: APP_ID, kind: TEMPLATE_KIND, schemaVersion: SCHEMA_VERSION, template });
    expect(new Date(exported.exportedAt).toISOString()).toBe(exported.exportedAt);
  });

  it("builds safe file names", () => {
    expect(templateFileName({ name: "Monthly sales" })).toBe("Monthly sales.template.json");
    expect(templateFileName({ name: 'Q1/Q2: "draft"?' })).toBe("Q1 Q2 draft.template.json");
    expect(templateFileName({ name: "" })).toBe("template.template.json");
    expect(templateFileName(null)).toBe("template.template.json");
    expect(bundleFileName(new Date("2026-11-10T12:00:00Z"))).toBe("excel-workflow-templates-2026-11-10.json");
  });

  it("round-trips a template through export and import", () => {
    const template = sampleTemplate({ tags: ["sales", "monthly"], folder: "Finance" });
    const result = parseTemplateJson(JSON.stringify(serializeTemplate(template), null, 2));
    expect(result).toEqual({ ok: true, templates: [template], warnings: [], skipped: 0 });
    expect(result.templates[0]).toMatchObject({ tags: ["sales", "monthly"], folder: "Finance" });
  });

  it("round-trips the newer definition parts (cleaning, lookup, conditional formats, sheet style)", () => {
    const definition = createDefinition({
      ...sampleDefinition(),
      cleaning: { trimText: true, removeDuplicates: { enabled: true, keys: ["fld_x"] } },
      lookup: { enabled: true, sheetName: "Prices", matchColumn: "Region", lookupColumn: "Code", columns: ["Rate"] },
    });
    definition.outputs[0] = {
      ...definition.outputs[0],
      conditionalFormats: [{ id: "cf_1", columnKey: "fld_x", operator: "gt", value: "10", value2: "", style: "green", bold: true }],
      sheetStyle: { boldHeader: false, freezeHeader: true, autoFilter: true },
    };
    const template = sampleTemplate({ definition });
    const [imported] = parseTemplateJson(json(serializeTemplate(template))).templates;
    expect(imported).toEqual(template);
    expect(imported.definition.lookup).toMatchObject({ enabled: true, mainKeyColumns: ["Region"], lookupKeyColumns: ["Code"], columns: ["Rate"] });
    expect(imported.definition.outputs[0].conditionalFormats[0].style).toBe("green");
  });

  it("round-trips several templates as a bundle", () => {
    const templates = [sampleTemplate(), sampleTemplate({ name: "Second" })];
    const bundle = serializeTemplates(templates);
    expect(bundle).toMatchObject({ app: APP_ID, kind: BUNDLE_KIND, schemaVersion: SCHEMA_VERSION });
    const result = parseTemplateJson(json(bundle));
    expect(result.ok).toBe(true);
    expect(result.templates).toEqual(templates);
    expect(result.warnings).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* import                                                               */
/* ------------------------------------------------------------------ */

describe("parseTemplateJson: accepted input", () => {
  it("accepts a bare template object", () => {
    const template = sampleTemplate();
    const result = parseTemplateJson(json(template));
    expect(result.ok).toBe(true);
    expect(result.templates).toEqual([template]);
  });

  it("accepts a bare template with only a name and a definition, and fills in the rest", () => {
    const result = parseTemplateJson(json({ name: "  Hand   written ", definition: { fields: [] } }));
    expect(result.ok).toBe(true);
    expect(result.warnings).toEqual([]);
    const [template] = result.templates;
    expect(template.name).toBe("Hand written");
    expect(template.id).toMatch(/^tpl_/);
    expect(template.description).toBe("");
    expect(template.tags).toEqual([]);
    expect(template.schemaVersion).toBe(SCHEMA_VERSION);
    expect(template.definition).toEqual(createDefinition());
  });

  it("accepts a bundle, a plain list, and exports nested in a bundle", () => {
    const a = sampleTemplate({ name: "A" });
    const b = sampleTemplate({ name: "B" });
    expect(parseTemplateJson(json({ templates: [a, b] })).templates).toEqual([a, b]);
    expect(parseTemplateJson(json([a, b])).templates).toEqual([a, b]);
    expect(parseTemplateJson(json({ templates: [serializeTemplate(a), b] })).templates).toEqual([a, b]);
  });

  it("migrates an old template and says so", () => {
    const result = parseTemplateJson(json(legacyTemplate()));
    expect(result.ok).toBe(true);
    expect(result.templates[0].definition.fields).toHaveLength(2);
    expect(result.templates[0].schemaVersion).toBe(SCHEMA_VERSION);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/"Legacy sales".*older version/);
  });

  it("uses the envelope's version for a template that does not state its own", () => {
    const { definition } = legacyTemplate();
    const result = parseTemplateJson(
      json({ app: APP_ID, kind: TEMPLATE_KIND, schemaVersion: 0, exportedAt: "2026-01-01T00:00:00.000Z", template: { name: "Old export", definition } }),
    );
    expect(result.ok).toBe(true);
    expect(result.templates[0].definition.source.sheetNames).toEqual(["Sales"]);
  });

  it("ignores a byte-order mark and surrounding whitespace", () => {
    const result = parseTemplateJson(`﻿\n  ${json(sampleTemplate())}\n`);
    expect(result.ok).toBe(true);
  });

  it("imports the valid templates of a bundle and reports the broken ones", () => {
    const good = sampleTemplate({ name: "Good" });
    const result = parseTemplateJson(json({ templates: [good, { name: "Broken", definition: { fields: "nope" } }, 5] }));
    expect(result.ok).toBe(true);
    expect(result.templates).toEqual([good]);
    expect(result.skipped).toBe(2);
    expect(result.warnings[0]).toMatch(/2 of 3 templates were skipped/);
    expect(result.warnings).toContain('Template 2 ("Broken"): definition.fields must be a list.');
    expect(result.warnings.some((warning) => /^Template 3: A template must be a JSON object, but this is a number\.$/.test(warning))).toBe(true);
  });
});

describe("parseTemplateJson: rejected input", () => {
  const errorsOf = (text) => {
    const result = parseTemplateJson(text);
    expect(result.ok, `expected a failure for ${String(text).slice(0, 60)}`).toBe(false);
    expect(result).not.toHaveProperty("templates");
    expect(result.errors.length).toBeGreaterThan(0);
    for (const error of result.errors) expect(typeof error).toBe("string");
    return result.errors;
  };

  it("rejects text that is not JSON", () => {
    expect(errorsOf("{ name: 'x' ")[0]).toMatch(/not valid JSON/);
    expect(errorsOf("Region,Amount\nNorth,10")[0]).toMatch(/not valid JSON/);
  });

  it("rejects empty and non-text input", () => {
    expect(errorsOf("")[0]).toMatch(/empty/);
    expect(errorsOf("   \n ")[0]).toMatch(/empty/);
    for (const value of [undefined, null, 42, {}, []]) expect(errorsOf(value)[0]).toMatch(/could not be read as text/);
  });

  it("rejects JSON that is not an object", () => {
    expect(errorsOf("42")[0]).toMatch(/must contain a JSON object.*a number/);
    expect(errorsOf("null")[0]).toMatch(/must contain a JSON object.*null/);
    expect(errorsOf('"just text"')[0]).toMatch(/must contain a JSON object.*text/);
    expect(errorsOf("true")[0]).toMatch(/must contain a JSON object/);
  });

  it("rejects files from another app or of another kind", () => {
    const exported = serializeTemplate(sampleTemplate());
    expect(errorsOf(json({ ...exported, app: "some-other-app" }))[0]).toMatch(/not made by Excel Workflow Builder.*"some-other-app"/);
    expect(errorsOf(json({ ...exported, kind: "draft" }))[0]).toMatch(/"draft" data, not a template/);
    // the markers are checked on a bare template too
    expect(errorsOf(json({ ...sampleTemplate(), app: "nope" }))[0]).toMatch(/not made by Excel Workflow Builder/);
  });

  it("rejects templates made with a newer version of the app", () => {
    const template = sampleTemplate();
    const newer = SCHEMA_VERSION + 1;
    const pattern = /made with a newer version of the app/;
    expect(errorsOf(json({ ...serializeTemplate(template), schemaVersion: newer }))[0]).toMatch(pattern);
    expect(errorsOf(json({ ...template, schemaVersion: newer }))[0]).toMatch(pattern);
    expect(errorsOf(json({ ...template, schemaVersion: undefined, definition: { ...template.definition, schemaVersion: newer } }))[0]).toMatch(pattern);
    expect(errorsOf(json({ templates: [{ ...template, schemaVersion: newer }] }))[0]).toMatch(/^Template 1 \("Monthly sales"\): .*newer version/);
    expect(errorsOf(json({ ...template, schemaVersion: newer }))[0]).toContain(`format ${newer}`);
  });

  it("rejects a schemaVersion that is not a whole number", () => {
    const template = sampleTemplate();
    expect(errorsOf(json({ ...template, schemaVersion: "1" }))[0]).toMatch(/"schemaVersion" must be a whole number.*"1"/);
    expect(errorsOf(json({ ...template, schemaVersion: 1.5 }))[0]).toMatch(/whole number/);
    expect(errorsOf(json({ ...serializeTemplate(template), schemaVersion: -1 }))[0]).toMatch(/whole number/);
  });

  it("rejects objects that are not templates", () => {
    expect(errorsOf(json({ hello: "world" }))[0]).toMatch(/does not look like a workflow template/);
    expect(errorsOf(json({ template: "nope" }))[0]).toMatch(/"template" must be an object, but it is text/);
    expect(errorsOf(json({ templates: { a: 1 } }))[0]).toMatch(/"templates" must be a list/);
    expect(errorsOf(json({ templates: [] }))[0]).toMatch(/contains no templates/);
    expect(errorsOf("[]")[0]).toMatch(/contains no templates/);
  });

  it("names the field that is wrong", () => {
    const template = sampleTemplate();
    const withFields = (fields) => json({ ...template, definition: { ...template.definition, fields } });
    const [first, second] = template.definition.fields;

    expect(errorsOf(json({ ...template, name: "   " }))).toContain("The template has no name.");
    expect(errorsOf(json({ name: "No definition" }))).toContain("The template has no definition.");
    expect(errorsOf(json({ ...template, tags: "sales, monthly" }))).toContain("tags must be a list.");
    expect(errorsOf(json({ ...template, definition: { ...template.definition, lookup: "Prices" } }))).toContain(
      "definition.lookup must be an object.",
    );
    expect(errorsOf(withFields("Region"))).toContain("definition.fields must be a list.");
    expect(errorsOf(withFields([first, { ...second, id: first.id }]))[0]).toMatch(/fields\[1\]\.id .* is used more than once/);
    expect(errorsOf(withFields([{ ...first, id: "" }]))).toContain("fields[0].id is missing.");
    expect(errorsOf(withFields([{ ...first, source: { kind: "lookup" } }]))[0]).toMatch(/fields\[0\]\.source\.kind "lookup" is not supported/);
    expect(errorsOf(withFields([{ ...first, transforms: [{ id: "tr_1", type: "reverse" }] }]))[0]).toMatch(
      /fields\[0\]\.transforms\[0\] has an unknown type "reverse"/,
    );
    expect(errorsOf(json({ ...template, definition: { ...template.definition, outputs: [{ id: "out_1", fileType: "pdf" }] } }))[0]).toMatch(
      /outputs\[0\]\.fileType "pdf" is not supported/,
    );
    // several problems are all reported
    expect(errorsOf(json({ name: "", definition: { fields: [{}], outputs: "x" } })).length).toBeGreaterThan(2);
  });

  it("reports an unknown legacy transform by name after migrating", () => {
    const legacy = legacyTemplate();
    legacy.definition.mappings[0].transforms = ["trim", "reverse"];
    expect(errorsOf(json(legacy))[0]).toMatch(/fields\[0\]\.transforms\[1\] has an unknown type "reverse"/);
  });

  it("fails a bundle in which nothing is usable, listing every problem", () => {
    const errors = errorsOf(json({ templates: [{ name: "A" }, { definition: { fields: [] } }] }));
    expect(errors).toContain('Template 1 ("A"): The template has no definition.');
    expect(errors).toContain("Template 2: The template has no name.");
  });

  it("refuses absurd input: huge files, too many templates, endless error lists", () => {
    expect(errorsOf(" ".repeat(MAX_IMPORT_BYTES + 1))[0]).toMatch(/too large to be a template/);
    const many = Array.from({ length: MAX_IMPORT_TEMPLATES + 1 }, (_, index) => ({ name: `T${index}`, definition: { fields: [] } }));
    expect(errorsOf(json({ templates: many }))[0]).toMatch(new RegExp(`contains ${MAX_IMPORT_TEMPLATES + 1} templates`));
    const brokenFields = Array.from({ length: 100 }, () => ({}));
    const errors = errorsOf(json({ name: "Broken", definition: { fields: brokenFields } }));
    expect(errors.length).toBeLessThanOrEqual(21);
    expect(errors.at(-1)).toMatch(/and \d+ more problems/);
  });
});

/* ------------------------------------------------------------------ */
/* helpers                                                              */
/* ------------------------------------------------------------------ */

describe("template helpers", () => {
  it("cleans names", () => {
    expect(cleanTemplateName("  Monthly \n sales  ")).toBe("Monthly sales");
    expect(cleanTemplateName(null)).toBe("");
    expect(cleanTemplateName(42)).toBe("42");
    expect(cleanTemplateName("x".repeat(500))).toHaveLength(NAME_MAX_LENGTH);
  });

  it("says where a source column is used", () => {
    const definition = sampleDefinition();
    expect(columnUsage(definition, "Region")).toEqual(["Region"]);
    expect(columnUsage(definition, "First")).toEqual(["Full name"]);
    expect(columnUsage(definition, "Qty")).toEqual(["Total", 'the filter of output "Regions only"']);
    expect(columnUsage(definition, "Status")).toEqual(["the workflow filter"]);
    expect(columnUsage(definition, "Nope")).toEqual([]);
    expect(columnUsage(null, "Region")).toEqual([]);
    // a disabled output filter does not count, an unnamed field still shows up
    definition.outputs[1].overrides.filters.enabled = false;
    definition.fields[2].name = "";
    expect(columnUsage(definition, "Qty")).toEqual(["an unnamed field"]);
  });

  it("names the lookup when its match column is the missing one", () => {
    const definition = createDefinition({
      ...sampleDefinition(),
      lookup: { enabled: true, matchColumn: "Region", lookupColumn: "Code" },
    });
    expect(columnUsage(definition, "Region")).toEqual(["Region", "the merge key"]);
    // a lookup that is switched off, or not fully set up, does not read the column
    expect(columnUsage({ ...definition, lookup: { ...definition.lookup, enabled: false } }, "Region")).toEqual(["Region"]);
    expect(columnUsage({ ...definition, lookup: { ...definition.lookup, lookupColumn: "", lookupKeyColumns: [] } }, "Region")).toEqual(["Region"]);
  });
});

describe("tags and folders", () => {
  const list = () => [
    { id: "a", name: "Monthly sales", description: "Region summary", tags: ["Sales", "Monthly"], folder: "Finance" },
    { id: "b", name: "Payroll", description: "", tags: ["HR", "monthly"], folder: "finance" },
    { id: "c", name: "Stock count", description: "Warehouse export", tags: ["Ops"], folder: "Operations" },
    { id: "d", name: "Scratch", description: "Try things", tags: [], folder: "" },
    { id: "e", name: "Old", description: "", tags: "not a list", folder: 42 },
  ];

  it("lists the folders in use, A-Z, once each whatever their case", () => {
    expect(templateFolders(list())).toEqual(["Finance", "Operations"]);
    expect(templateFolders([])).toEqual([]);
    expect(templateFolders(null)).toEqual([]);
  });

  it("lists the tags in use with their counts, most used first", () => {
    expect(templateTags(list())).toEqual([
      { tag: "Monthly", count: 2 },
      { tag: "HR", count: 1 },
      { tag: "Ops", count: 1 },
      { tag: "Sales", count: 1 },
    ]);
  });

  it("filters by folder: all, none, or one folder (case-insensitive)", () => {
    const ids = (options) => filterTemplates(list(), options).map((template) => template.id);
    expect(ids({})).toEqual(["a", "b", "c", "d", "e"]);
    expect(ids({ folder: null })).toEqual(["a", "b", "c", "d", "e"]);
    expect(ids({ folder: NO_FOLDER })).toEqual(["d", "e"]);
    expect(ids({ folder: "FINANCE" })).toEqual(["a", "b"]);
    expect(ids({ folder: "Nowhere" })).toEqual([]);
  });

  it("filters by tags (every selected tag must be there) and by search, combined", () => {
    const ids = (options) => filterTemplates(list(), options).map((template) => template.id);
    expect(ids({ tags: ["monthly"] })).toEqual(["a", "b"]);
    expect(ids({ tags: ["Monthly", "sales"] })).toEqual(["a"]);
    expect(ids({ tags: ["Monthly", "Ops"] })).toEqual([]);
    expect(ids({ query: "  WAREHOUSE " })).toEqual(["c"]);
    expect(ids({ query: "hr" })).toEqual(["b"]); // tags are searched
    expect(ids({ query: "operations" })).toEqual(["c"]); // so is the folder
    expect(ids({ query: "sales", tags: ["monthly"], folder: "finance" })).toEqual(["a"]);
    expect(ids({ query: "summary payroll" })).toEqual([]); // a match never spans two parts
  });

  it("groups by folder: named folders A-Z, then the templates without one, order kept inside", () => {
    const groups = groupTemplatesByFolder([list()[3], ...list()]);
    expect(groups.map((group) => [group.folder, group.templates.map((template) => template.id)])).toEqual([
      ["Finance", ["a", "b"]],
      ["Operations", ["c"]],
      ["", ["d", "d", "e"]],
    ]);
    expect(groupTemplatesByFolder([])).toEqual([]);
    expect(groupTemplatesByFolder([{ id: "x", folder: "Z" }])).toEqual([{ folder: "Z", templates: [{ id: "x", folder: "Z" }] }]);
  });
});

/* ------------------------------------------------------------------ */
/* the template store (persistence, migration on load, quota handling)  */
/* ------------------------------------------------------------------ */

/** In-memory stand-in for window.localStorage with an optional size limit (in characters, keys + values). */
class FakeStorage {
  constructor({ quota = Infinity } = {}) {
    this.map = new Map();
    this.quota = quota;
    this.writes = 0;
  }

  get length() {
    return this.map.size;
  }

  key(index) {
    return [...this.map.keys()][index] ?? null;
  }

  getItem(key) {
    return this.map.has(key) ? this.map.get(key) : null;
  }

  setItem(key, value) {
    const text = String(value);
    let used = 0;
    for (const [k, v] of this.map) if (k !== key) used += k.length + v.length;
    if (used + key.length + text.length > this.quota) {
      throw Object.assign(new Error("The quota has been exceeded."), { name: "QuotaExceededError", code: 22 });
    }
    this.writes += 1;
    this.map.set(key, text);
  }

  removeItem(key) {
    this.map.delete(key);
  }
}

const TEMPLATES_KEY = "ewb:v1:templates";

describe("useTemplateStore", () => {
  let local;

  /** A fresh store module (and storage module) on top of `local`. Pass null for "no browser storage". */
  async function loadStore(localStorage = local) {
    vi.resetModules();
    if (localStorage) globalThis.window = { localStorage, addEventListener() {}, removeEventListener() {} };
    else delete globalThis.window;
    const storage = await import("@/lib/storage");
    const { useTemplateStore, CORRUPT_BACKUP_KEY } = await import("@/store/useTemplateStore");
    return { useTemplateStore, storage, CORRUPT_BACKUP_KEY };
  }

  const stored = () => JSON.parse(local.getItem(TEMPLATES_KEY));
  const seed = (templates, version = SCHEMA_VERSION) => local.setItem(TEMPLATES_KEY, json({ state: { templates }, version }));

  beforeEach(() => {
    local = new FakeStorage();
  });

  afterEach(() => {
    delete globalThis.window;
  });

  it("saves a template (the definition only) and persists it under the namespaced key", async () => {
    const { useTemplateStore } = await loadStore();
    const definition = sampleDefinition();
    const result = useTemplateStore.getState().saveTemplate({ name: "  Monthly sales ", description: "Totals", definition });

    expect(result.ok).toBe(true);
    expect(result.template).toMatchObject({ name: "Monthly sales", description: "Totals", tags: [], folder: "", schemaVersion: SCHEMA_VERSION });
    expect(Object.keys(result.template).sort()).toEqual(
      ["createdAt", "definition", "description", "folder", "id", "name", "schemaVersion", "tags", "updatedAt"].sort(),
    );
    expect(result.template.definition).toEqual(definition);
    expect(result.template.definition).not.toBe(definition); // a copy: later edits do not leak into the template
    expect(useTemplateStore.getState().templates).toEqual([result.template]);
    expect(useTemplateStore.getState().getTemplate(result.template.id)).toBe(result.template);
    expect(stored()).toEqual({ state: { templates: [result.template] }, version: SCHEMA_VERSION });
  });

  it("loads stored templates on rehydrate and marks itself hydrated", async () => {
    const template = sampleTemplate();
    seed([template]);
    const { useTemplateStore } = await loadStore();
    expect(useTemplateStore.getState()).toMatchObject({ templates: [], hasHydrated: false });

    await useTemplateStore.persist.rehydrate();

    expect(useTemplateStore.getState()).toMatchObject({ templates: [template], hasHydrated: true, loadError: null });
  });

  it("migrates templates stored by an older version and writes the upgrade back", async () => {
    seed([legacyTemplate(), null, "junk", 42, sampleTemplate()], 0);
    const { useTemplateStore } = await loadStore();
    await useTemplateStore.persist.rehydrate();

    const { templates } = useTemplateStore.getState();
    expect(templates.map((template) => template.name)).toEqual(["Legacy sales", "Monthly sales"]);
    expect(templates[0].schemaVersion).toBe(SCHEMA_VERSION);
    expect(templates[0].definition.fields).toHaveLength(2);
    expect(templates[0].definition.source.sheetNames).toEqual(["Sales"]);
    expect(stored().version).toBe(SCHEMA_VERSION);
    expect(stored().state.templates).toEqual(templates);
  });

  it("migrates each template by its own version even when the stored payload looks current", async () => {
    const twin = sampleTemplate();
    seed([legacyTemplate(), twin, { ...twin, name: "Same id" }]);
    const { useTemplateStore } = await loadStore();
    await useTemplateStore.persist.rehydrate();

    const { templates } = useTemplateStore.getState();
    expect(templates[0].definition.fields).toHaveLength(2);
    expect(new Set(templates.map((template) => template.id)).size).toBe(3); // duplicate ids are repaired
  });

  it("survives corrupt stored JSON: hydrates empty, keeps a backup, and can save again", async () => {
    const corrupt = '{"state":{"templates":[{"id":"tpl_1","name":"Cut off';
    local.setItem(TEMPLATES_KEY, corrupt);
    const { useTemplateStore, CORRUPT_BACKUP_KEY } = await loadStore();

    await expect(useTemplateStore.persist.rehydrate()).resolves.toBeUndefined();

    const state = useTemplateStore.getState();
    expect(state.hasHydrated).toBe(true);
    expect(state.templates).toEqual([]);
    expect(state.loadError).toMatch(/could not be read/);
    expect(local.getItem(`ewb:v1:${CORRUPT_BACKUP_KEY}`)).toBe(corrupt);
    expect(local.getItem(TEMPLATES_KEY)).toBe(corrupt); // not overwritten by hydration itself

    expect(state.saveTemplate({ name: "Fresh start", definition: sampleDefinition() }).ok).toBe(true);
    expect(stored().state.templates).toHaveLength(1);
  });

  it("survives stored JSON of the wrong shape", async () => {
    for (const payload of ['"hello"', "[]", "null", "7", '{"state":null,"version":1}', '{"state":{"templates":"x"},"version":0}', '{"version":1}']) {
      local.setItem(TEMPLATES_KEY, payload);
      const { useTemplateStore } = await loadStore();
      await useTemplateStore.persist.rehydrate();
      expect(useTemplateStore.getState(), payload).toMatchObject({ templates: [], hasHydrated: true });
    }
  });

  it("hydrates before the first change, so stored templates are never overwritten by an unloaded list", async () => {
    const existing = sampleTemplate({ name: "Already saved" });
    seed([existing]);
    const { useTemplateStore } = await loadStore();

    const result = useTemplateStore.getState().saveTemplate({ name: "New", definition: sampleDefinition() });

    expect(result.ok).toBe(true);
    expect(useTemplateStore.getState().hasHydrated).toBe(true);
    expect(useTemplateStore.getState().templates.map((template) => template.name)).toEqual(["New", "Already saved"]);
    expect(stored().state.templates.map((template) => template.name)).toEqual(["New", "Already saved"]);
  });

  it("rolls a save back and reports 'storage is full' when the write fails", async () => {
    const { useTemplateStore, storage } = await loadStore();
    const definition = sampleDefinition();
    expect(useTemplateStore.getState().saveTemplate({ name: "First", definition }).ok).toBe(true);
    const before = local.getItem(TEMPLATES_KEY);
    local.quota = TEMPLATES_KEY.length + before.length + 20; // no room for a second template
    const reported = [];
    storage.onStorageError((detail) => reported.push(detail));
    const seen = [];
    useTemplateStore.subscribe((state) => seen.push(state.templates.length));

    const result = useTemplateStore.getState().saveTemplate({ name: "Second", definition });

    expect(result).toEqual({ ok: false, code: "quota", error: storage.QUOTA_MESSAGE });
    expect(useTemplateStore.getState().templates.map((template) => template.name)).toEqual(["First"]);
    expect(seen.at(-1)).toBe(1); // subscribers end up with the rolled-back list
    expect(local.getItem(TEMPLATES_KEY)).toBe(before); // what a reload would show
    expect(reported.map((detail) => [detail.code, detail.key])).toEqual([["quota", "templates"]]);

    local.quota = Infinity;
    expect(useTemplateStore.getState().saveTemplate({ name: "Second", definition }).ok).toBe(true);
    expect(stored().state.templates.map((template) => template.name)).toEqual(["Second", "First"]);
  });

  it("rolls back every kind of change when storage is full", async () => {
    const { useTemplateStore, storage } = await loadStore();
    const actions = useTemplateStore.getState();
    const { template } = actions.saveTemplate({ name: "Only", description: "Original", definition: sampleDefinition() });
    const before = local.getItem(TEMPLATES_KEY);
    local.quota = TEMPLATES_KEY.length + before.length;
    const snapshot = useTemplateStore.getState().templates;
    const failure = { ok: false, code: "quota", error: storage.QUOTA_MESSAGE };

    expect(actions.updateTemplate(template.id, { description: "x".repeat(300) })).toEqual(failure);
    expect(actions.renameTemplate(template.id, "A much longer name than before")).toEqual(failure);
    expect(actions.duplicateTemplate(template.id)).toEqual(failure);
    expect(actions.importTemplates([sampleTemplate(), sampleTemplate()])).toEqual({ ...failure, added: [] });

    expect(useTemplateStore.getState().templates).toBe(snapshot);
    expect(local.getItem(TEMPLATES_KEY)).toBe(before);
    // deleting frees space, so it still works
    expect(actions.deleteTemplate(template.id)).toEqual({ ok: true });
    expect(stored().state.templates).toEqual([]);
  });

  it("refuses to pretend when there is no browser storage at all", async () => {
    const { useTemplateStore, storage } = await loadStore(null);
    const result = useTemplateStore.getState().saveTemplate({ name: "Nowhere to go", definition: sampleDefinition() });
    expect(result).toEqual({ ok: false, code: "unavailable", error: storage.UNAVAILABLE_MESSAGE });
    expect(useTemplateStore.getState()).toMatchObject({ templates: [], hasHydrated: true });
  });

  it("updates and renames a template", async () => {
    const { useTemplateStore } = await loadStore();
    const actions = useTemplateStore.getState();
    const { template } = actions.saveTemplate({ name: "Sales", description: "Old", definition: sampleDefinition() });
    const nextDefinition = createDefinition({ fields: [createField({ name: "Only field" })] });

    const updated = actions.updateTemplate(template.id, { name: " Sales v2 ", description: "New", definition: nextDefinition });
    expect(updated.ok).toBe(true);
    expect(updated.template).toMatchObject({ id: template.id, name: "Sales v2", description: "New", createdAt: template.createdAt });
    expect(updated.template.definition).toEqual(nextDefinition);
    expect(Date.parse(updated.template.updatedAt)).toBeGreaterThanOrEqual(Date.parse(template.updatedAt));
    expect(stored().state.templates[0].name).toBe("Sales v2");

    // a partial patch keeps the rest; an empty name keeps the old one
    expect(actions.updateTemplate(template.id, { name: "   " }).template).toMatchObject({ name: "Sales v2", description: "New" });

    expect(actions.renameTemplate(template.id, "Renamed").template.name).toBe("Renamed");
    expect(actions.renameTemplate(template.id, "  ")).toMatchObject({ ok: false, code: "invalid" });
    expect(useTemplateStore.getState().templates[0].name).toBe("Renamed");

    expect(actions.updateTemplate("tpl_missing", { name: "x" })).toMatchObject({ ok: false, code: "not-found" });
    expect(actions.renameTemplate("tpl_missing", "x")).toMatchObject({ ok: false, code: "not-found" });
    expect(actions.duplicateTemplate("tpl_missing")).toMatchObject({ ok: false, code: "not-found" });
  });

  it("keeps tags and folder through save, update, duplicate and import, normalising tags", async () => {
    const { useTemplateStore } = await loadStore();
    const actions = useTemplateStore.getState();
    const { template } = actions.saveTemplate({
      name: "Tagged",
      tags: [" Sales ", "sales", "Monthly"],
      folder: "  Finance ",
      definition: sampleDefinition(),
    });
    expect(template).toMatchObject({ tags: ["Sales", "Monthly"], folder: "Finance" });

    // a patch without tags/folder keeps them; a patch with them replaces them
    expect(actions.updateTemplate(template.id, { description: "x" }).template).toMatchObject({ tags: ["Sales", "Monthly"], folder: "Finance" });
    const retagged = actions.updateTemplate(template.id, { tags: ["Q1", "q1"], folder: "" }).template;
    expect(retagged).toMatchObject({ tags: ["Q1"], folder: "" });
    actions.updateTemplate(template.id, { tags: ["Sales"], folder: "Finance" });

    expect(actions.duplicateTemplate(template.id).template).toMatchObject({ tags: ["Sales"], folder: "Finance" });
    const [imported] = actions.importTemplates([sampleTemplate({ tags: ["a", "A", "b"], folder: "Ops" })]).added;
    expect(imported).toMatchObject({ tags: ["a", "b"], folder: "Ops" });
    expect(stored().state.templates.map((t) => [t.tags, t.folder])).toEqual([
      [["a", "b"], "Ops"],
      [["Sales"], "Finance"],
      [["Sales"], "Finance"],
    ]);
  });

  it('duplicates a template as "Copy of X" with a new id', async () => {
    const { useTemplateStore } = await loadStore();
    const actions = useTemplateStore.getState();
    const { template } = actions.saveTemplate({ name: "Sales", definition: sampleDefinition() });

    const first = actions.duplicateTemplate(template.id);
    const second = actions.duplicateTemplate(template.id);

    expect(first.ok && second.ok).toBe(true);
    expect(first.template.name).toBe("Copy of Sales");
    expect(second.template.name).toBe("Copy of Sales (2)");
    expect(new Set([template.id, first.template.id, second.template.id]).size).toBe(3);
    expect(first.template.definition).toEqual(template.definition);
    expect(first.template.definition).not.toBe(template.definition);
    expect(useTemplateStore.getState().templates).toHaveLength(3);
    expect(stored().state.templates).toHaveLength(3);
  });

  it("deletes a template", async () => {
    const { useTemplateStore } = await loadStore();
    const actions = useTemplateStore.getState();
    const a = actions.saveTemplate({ name: "A", definition: sampleDefinition() }).template;
    const b = actions.saveTemplate({ name: "B", definition: sampleDefinition() }).template;

    expect(actions.deleteTemplate(a.id)).toEqual({ ok: true });
    expect(useTemplateStore.getState().templates).toEqual([b]);
    expect(stored().state.templates).toEqual([b]);
    expect(actions.deleteTemplate("tpl_missing")).toEqual({ ok: true });
    expect(useTemplateStore.getState().getTemplate(a.id)).toBeUndefined();
  });

  it("imports templates with new ids and unique names", async () => {
    const { useTemplateStore } = await loadStore();
    const actions = useTemplateStore.getState();
    const existing = actions.saveTemplate({ name: "Sales", definition: sampleDefinition() }).template;
    const incoming = [sampleTemplate({ name: "Sales" }), sampleTemplate({ name: "sales " }), { ...sampleTemplate({ name: "Other" }), id: existing.id }];
    const snapshot = structuredClone(incoming);

    const result = actions.importTemplates(incoming);

    expect(result.ok).toBe(true);
    expect(result.added.map((template) => template.name)).toEqual(["Sales (2)", "sales (3)", "Other"]);
    const ids = [existing.id, ...incoming.map((template) => template.id), ...result.added.map((template) => template.id)];
    expect(new Set(ids).size).toBe(1 + 2 + 3); // incoming[2] reused existing.id on purpose
    expect(incoming).toEqual(snapshot);
    expect(useTemplateStore.getState().templates.map((template) => template.name)).toEqual(["Sales (2)", "sales (3)", "Other", "Sales"]);
    expect(stored().state.templates).toHaveLength(4);

    // old templates are upgraded on the way in; junk is refused
    expect(actions.importTemplates([legacyTemplate()]).added[0].definition.fields).toHaveLength(2);
    expect(actions.importTemplates([])).toMatchObject({ ok: false, added: [], code: "invalid" });
    expect(actions.importTemplates("nope")).toMatchObject({ ok: false, added: [] });
    expect(actions.importTemplates([null, 3])).toMatchObject({ ok: false, added: [] });
  });
});
