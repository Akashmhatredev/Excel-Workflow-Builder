import { describe, expect, it } from "vitest";
import { createField } from "@/lib/schema";
import { useWorkflowStore } from "@/store/useWorkflowStore";

describe("workflow store: removeField", () => {
  it("removes the field from cleaning settings, outputs and conditional formats", () => {
    const store = useWorkflowStore;
    store.getState().resetWorkflow({ keepData: true });
    const keep = createField({ name: "Keep", source: { kind: "column", column: "A" } });
    const drop = createField({ name: "Drop", source: { kind: "column", column: "B" } });
    store.getState().updateDefinition((d) => ({ ...d, fields: [keep, drop] }));
    store.getState().setCleaning({
      removeDuplicates: { enabled: true, keys: [keep.id, drop.id] },
      fillBlanks: { enabled: true, fieldIds: [drop.id] },
    });
    const outputId = store.getState().addOutput({
      fieldIds: [keep.id, drop.id],
      conditionalFormats: [
        { id: "cf1", columnKey: drop.id, operator: "gt", value: "1", value2: "", style: "red", bold: false },
        { id: "cf2", columnKey: keep.id, operator: "gt", value: "1", value2: "", style: "red", bold: false },
      ],
    });
    store.getState().removeField(drop.id);
    const { definition } = store.getState();
    expect(definition.fields.map((f) => f.id)).toEqual([keep.id]);
    expect(definition.cleaning.removeDuplicates.keys).toEqual([keep.id]);
    expect(definition.cleaning.fillBlanks.fieldIds).toEqual([]);
    const output = definition.outputs.find((o) => o.id === outputId);
    expect(output.fieldIds).toEqual([keep.id]);
    expect(output.conditionalFormats.map((f) => f.id)).toEqual(["cf2"]);
    store.getState().undo();
    expect(store.getState().definition.fields).toHaveLength(2);
  });
});

describe("workflow store: summary settings", () => {
  it("keeps pivot settings in the definition, undoably, and clears removed fields", () => {
    const store = useWorkflowStore;
    store.getState().resetWorkflow({ keepData: true });
    const region = createField({ name: "Region", source: { kind: "column", column: "Region" } });
    const amount = createField({ name: "Amount", source: { kind: "column", column: "Amount" } });
    store.getState().updateDefinition((d) => ({ ...d, fields: [region, amount] }));
    expect(store.getState().definition.summary).toEqual({ rowKey: "", columnKey: "", valueKey: "", fn: "count" });

    store.getState().setSummary({ rowKey: region.id, fn: "sum", valueKey: amount.id });
    expect(store.getState().definition.summary).toEqual({ rowKey: region.id, columnKey: "", valueKey: amount.id, fn: "sum" });
    expect(store.getState().dirty).toBe(true);

    const before = store.getState().past.length;
    store.getState().setSummary({ fn: "sum" });
    expect(store.getState().past.length).toBe(before);

    store.getState().removeField(amount.id);
    expect(store.getState().definition.summary).toEqual({ rowKey: region.id, columnKey: "", valueKey: "", fn: "sum" });
    store.getState().undo();
    expect(store.getState().definition.summary.valueKey).toBe(amount.id);
  });

  it("restores saved summary settings when a template is applied", () => {
    const store = useWorkflowStore;
    const field = createField({ id: "fld_r", name: "Region", source: { kind: "column", column: "Region" } });
    store.getState().applyTemplate(
      { id: "tpl_1", name: "T", definition: { fields: [field], summary: { rowKey: "fld_r", fn: "avg", valueKey: "fld_r" } } },
      { mode: "edit" },
    );
    expect(store.getState().definition.summary).toEqual({ rowKey: "fld_r", columnKey: "", valueKey: "fld_r", fn: "avg" });
  });
});
