"use client";

import { useEffect, useState } from "react";
import { runPreview } from "../lib/workerClient";
import { selectHasData, useWorkflowStore } from "../store/useWorkflowStore";

/**
 * Live preview of the workflow result, computed in the worker.
 *
 *   const { data, loading, error, hasData } = usePreview({ outputId, limit: 20 });
 *
 * - outputId null  -> the workflow-level result (mapping step)
 * - outputId "..." -> that output (its field selection and overrides applied)
 * - data = { columns: [{ key, name, type }], rows: string[][], totalRows, sourceRows, issues } | null
 * - re-runs (debounced) whenever the definition or the loaded table changes;
 *   the previous data stays visible while `loading` is true
 * - when no file is loaded: data = null, loading = false, hasData = false
 */
export function usePreview({ outputId = null, limit = 20, enabled = true, debounceMs = 200 } = {}) {
  const definition = useWorkflowStore((state) => state.definition);
  const dataVersion = useWorkflowStore((state) => state.dataVersion);
  const hasData = useWorkflowStore(selectHasData);
  const [result, setResult] = useState(null);
  const active = enabled && hasData;

  useEffect(() => {
    if (!active) return undefined;
    let cancelled = false;
    const stamp = { definition, dataVersion, outputId, limit };
    const timer = setTimeout(async () => {
      try {
        const data = await runPreview({ definition, outputId, limit });
        if (!cancelled) setResult({ ...stamp, data, error: null });
      } catch (error) {
        if (!cancelled) setResult({ ...stamp, data: null, error: error.message || "Preview failed." });
      }
    }, debounceMs);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [active, definition, dataVersion, outputId, limit, debounceMs]);

  const sameTarget = result && result.outputId === outputId && result.dataVersion === dataVersion;
  const fresh = sameTarget && result.definition === definition && result.limit === limit;
  return {
    data: active && sameTarget ? result.data : null,
    error: active && fresh ? result.error : null,
    loading: active && !fresh,
    hasData,
  };
}
