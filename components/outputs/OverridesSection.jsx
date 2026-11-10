"use client";

import { useMemo } from "react";
import FilterBuilder from "@/components/mapping/FilterBuilder";
import GroupByEditor from "@/components/mapping/GroupByEditor";
import SortEditor from "@/components/mapping/SortEditor";
import { Card, SectionHeader, Switch } from "@/components/ui";
import { clone, createFilterGroup, createGroupBy, createId, isGroupingActive } from "@/lib/schema";
import { summarizeFilters, summarizeGroupBy, summarizeSort } from "./helpers";

function OverrideBlock({ label, description, enabled, onToggle, inherited, children }) {
  return (
    <div className="rounded-lg border border-line p-3 sm:p-4">
      <Switch label={label} description={enabled ? description : undefined} checked={enabled} onChange={onToggle} />
      {enabled ? (
        <div className="mt-4 min-w-0">{children}</div>
      ) : (
        <p className="mt-2 text-sm text-muted">
          <span className="font-medium text-fg">Workflow setting: </span>
          {inherited}
        </p>
      )}
    </div>
  );
}

/**
 * Per-output overrides. Each switch replaces one workflow-level setting (filters, sorting or
 * grouping) for this output only; while a switch is off the inherited setting is summarised.
 *
 * Turning a switch on for the first time starts from a copy of the workflow-level setting, so
 * "the same, plus one more rule" is a small edit instead of a rebuild.
 */
export default function OverridesSection({ output, definition, availableColumns, grouped, resultColumns, issues, onChange }) {
  const { filters, sort, groupBy } = output.overrides;
  const fields = definition.fields;

  const sortOptions = useMemo(
    () =>
      grouped
        ? resultColumns.map((column) => ({ key: column.key, name: column.name }))
        : fields.map((field) => ({ key: field.id, name: field.name })),
    [grouped, resultColumns, fields],
  );
  const filterIssues = useMemo(() => (issues || []).filter((issue) => issue.scope === "filter"), [issues]);

  const toggleFilters = (enabled) => {
    if (!enabled) return onChange({ filters: { enabled: false } });
    const own = filters.group || createFilterGroup();
    const inherited = definition.filters || createFilterGroup();
    const group =
      own.rules.length || !inherited.rules.length
        ? own
        : {
            combinator: inherited.combinator,
            rules: inherited.rules.map((rule) => ({ ...clone(rule), id: createId("flt") })),
          };
    return onChange({ filters: { enabled: true, group } });
  };

  const toggleSort = (enabled) => {
    if (!enabled) return onChange({ sort: { enabled: false } });
    const own = sort.rules || [];
    const inherited = definition.sort || [];
    const rules = own.length || !inherited.length ? own : inherited.map((rule) => ({ ...rule, id: createId("srt") }));
    return onChange({ sort: { enabled: true, rules } });
  };

  const toggleGroupBy = (enabled) => {
    if (!enabled) return onChange({ groupBy: { enabled: false } });
    const own = { ...createGroupBy(), ...(groupBy.config || {}) };
    const empty = !own.keys.length && !own.aggregations.length;
    // Aggregation ids are kept on purpose: they are result column keys, so an inherited sort
    // (and the report's column widths) keep pointing at the right columns.
    const base = empty && isGroupingActive(definition.groupBy) ? clone(definition.groupBy) : own;
    return onChange({ groupBy: { enabled: true, config: { ...base, enabled: true } } });
  };

  const changeGroupBy = (next) => {
    // resolveOutputConfig() treats an enabled override as "grouping on" whatever config.enabled
    // says, and the output is grouped whenever keys or aggregations exist. If the editor switches
    // grouping off, clear them so what the editor shows is what the engine does (undo restores them).
    const config = next && next.enabled === false ? { ...next, keys: [], aggregations: [] } : next;
    onChange({ groupBy: { config } });
  };

  return (
    <Card as="section" className="p-4 sm:p-5">
      <SectionHeader
        as="h4"
        title="Filters, sorting and grouping"
        description="This output follows the workflow settings from the Mapping step unless you switch one on here."
      />
      <div className="mt-4 flex flex-col gap-3">
        <OverrideBlock
          label="Use different filters for this output"
          description="These rules replace the workflow's filters for this output."
          enabled={filters.enabled}
          onToggle={toggleFilters}
          inherited={summarizeFilters(definition.filters, fields)}
        >
          <FilterBuilder
            value={filters.group}
            onChange={(group) => onChange({ filters: { group } })}
            columns={availableColumns}
            fields={fields}
            issues={filterIssues}
            idPrefix={`output-${output.id}-filters`}
          />
        </OverrideBlock>

        <OverrideBlock
          label="Use different sorting for this output"
          description="This order replaces the workflow's sorting for this output."
          enabled={sort.enabled}
          onToggle={toggleSort}
          inherited={summarizeSort(definition.sort, sortOptions)}
        >
          <SortEditor value={sort.rules} onChange={(rules) => onChange({ sort: { rules } })} options={sortOptions} />
        </OverrideBlock>

        <OverrideBlock
          label="Use different grouping for this output"
          description="This grouping replaces the workflow's. Leave it without keys and aggregations to export ungrouped rows."
          enabled={groupBy.enabled}
          onToggle={toggleGroupBy}
          inherited={summarizeGroupBy(definition, definition.groupBy)}
        >
          <GroupByEditor value={groupBy.config} onChange={changeGroupBy} fields={fields} />
        </OverrideBlock>
      </div>
    </Card>
  );
}
