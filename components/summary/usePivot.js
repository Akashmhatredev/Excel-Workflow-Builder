"use client";

import { useEffect, useState } from "react";
import { runPivot } from "@/lib/workerClient";
import { selectHasData, useWorkflowStore } from "@/store/useWorkflowStore";

/**
 * Pivot of the workflow-level rows, computed in the worker (lib/workerClient.js runPivot).
 *
 *   const { data, loading, error, retry } = usePivot({ request: { rowKey, columnKey, valueKey, fn } | null });
 *
 * - request null (or no file loaded): nothing runs; data = null
 * - re-runs (debounced) when the request, the definition or the loaded table changes
 * - the previous data stays visible while `loading`; `error` is the message of a failed run
 * - retry() runs the same request again
 */
export function usePivot({ request, limit = 200, debounceMs = 250 }) {
  const definition = useWorkflowStore((state) => state.definition);
  const dataVersion = useWorkflowStore((state) => state.dataVersion);
  const hasData = useWorkflowStore(selectHasData);
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState(null);

  // A string key keeps the effect from re-running for an equal request object.
  const key = request
    ? JSON.stringify([request.rowKey || "", request.columnKey || "", request.valueKey || "", request.fn || "count", limit])
    : "";
  const active = hasData && Boolean(key);

  useEffect(() => {
    if (!active) return undefined;
    let cancelled = false;
    const stamp = { definition, dataVersion, key, attempt };
    const [rowKey, columnKey, valueKey, fn, max] = JSON.parse(key);
    const timer = setTimeout(async () => {
      try {
        const data = await runPivot({
          definition,
          rowKey,
          columnKey: columnKey || null,
          valueKey: valueKey || null,
          fn,
          limit: max,
        });
        if (!cancelled) setResult({ ...stamp, data, error: null });
      } catch (error) {
        if (!cancelled) {
          setResult({ ...stamp, data: null, error: (error && error.message) || "The summary could not be calculated." });
        }
      }
    }, debounceMs);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [active, definition, dataVersion, key, attempt, debounceMs]);

  const fresh =
    Boolean(result) &&
    result.definition === definition &&
    result.dataVersion === dataVersion &&
    result.key === key &&
    result.attempt === attempt;
  const keep = Boolean(result) && result.dataVersion === dataVersion && Boolean(result.data);
  return {
    data: active && keep ? result.data : null,
    error: active && fresh ? result.error : null,
    loading: active && !fresh,
    retry: () => setAttempt((count) => count + 1),
  };
}
