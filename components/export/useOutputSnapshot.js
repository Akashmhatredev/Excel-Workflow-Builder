"use client";

import { useEffect, useState } from "react";
import { runPreview } from "@/lib/workerClient";
import { selectHasData, useWorkflowStore } from "@/store/useWorkflowStore";

/**
 * One worker run of an output for the Export step: its row count, its issues and (for a report)
 * the rows of the image, stamped with the moment they were read.
 *
 *   const { data, error, loading, generatedAt, hasData, retry } = useOutputSnapshot({ outputId, limit });
 *
 * Unlike usePreview() it never returns stale data: an image must not be captured from rows that
 * belong to an older definition. `data` is the runPreview result or null.
 */
export function useOutputSnapshot({ outputId, limit = 1, enabled = true }) {
  const definition = useWorkflowStore((state) => state.definition);
  const dataVersion = useWorkflowStore((state) => state.dataVersion);
  const hasData = useWorkflowStore(selectHasData);
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState(null);
  const active = enabled && hasData;

  useEffect(() => {
    if (!active) return undefined;
    let cancelled = false;
    const stamp = { definition, dataVersion, outputId, limit, attempt };
    const timer = setTimeout(() => {
      runPreview({ definition, outputId, limit }).then(
        (data) => {
          if (!cancelled) setResult({ ...stamp, data, error: null, generatedAt: new Date() });
        },
        (error) => {
          if (cancelled) return;
          const message = (error && error.message) || "This output could not be read.";
          setResult({ ...stamp, data: null, error: message, generatedAt: null });
        },
      );
    }, 100);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [active, definition, dataVersion, outputId, limit, attempt]);

  const fresh =
    Boolean(result) &&
    result.definition === definition &&
    result.dataVersion === dataVersion &&
    result.outputId === outputId &&
    result.limit === limit &&
    result.attempt === attempt;

  return {
    data: active && fresh ? result.data : null,
    error: active && fresh ? result.error : null,
    generatedAt: active && fresh ? result.generatedAt : null,
    loading: active && !fresh,
    hasData,
    retry: () => setAttempt((n) => n + 1),
  };
}
