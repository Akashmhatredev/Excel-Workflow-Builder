"use client";

import { useEffect, useRef, useState } from "react";
import ReportView from "@/components/ReportView";
import { cn } from "@/lib/cn";

const FRAME_PADDING = 12; // p-3
const SCROLLBAR_ALLOWANCE = 16; // room for a vertical scrollbar so "fit" never needs a horizontal one

/**
 * A live ReportView shown inside a scrollable frame.
 *
 * ReportView always renders at its natural pixel size (that is what gets exported). Here it is
 * shrunk with a CSS transform so it fits the frame's width (`fit`), or shown 1:1 (`fit={false}`).
 * The sized wrapper around the transformed node makes the scroll area match what is visible.
 */
export default function ScaledReport({ fit = true, maxHeight = 520, label = "Report preview", className, ...reportProps }) {
  const outerRef = useRef(null);
  const reportRef = useRef(null);
  const [available, setAvailable] = useState(0);
  const [natural, setNatural] = useState(null);

  useEffect(() => {
    const outer = outerRef.current;
    const node = reportRef.current;
    if (!outer || !node || typeof ResizeObserver === "undefined") return undefined;
    const measure = () => {
      const width = node.offsetWidth;
      const height = node.offsetHeight;
      setAvailable(outer.clientWidth);
      setNatural((previous) =>
        previous && previous.width === width && previous.height === height ? previous : { width, height },
      );
    };
    const observer = new ResizeObserver(measure);
    observer.observe(outer);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const room = Math.max(0, available - FRAME_PADDING * 2 - SCROLLBAR_ALLOWANCE - 2);
  const scale = fit && natural && natural.width > 0 && room > 0 ? Math.min(1, room / natural.width) : 1;

  return (
    <div ref={outerRef} className={cn("min-w-0", className)}>
      <div
        role="region"
        aria-label={label}
        tabIndex={0}
        className="overflow-auto rounded-lg border border-line bg-surface-2 p-3"
        style={{ maxHeight }}
      >
        <div
          className="mx-auto overflow-hidden shadow-card"
          style={{
            width: natural ? Math.ceil(natural.width * scale) : undefined,
            height: natural ? Math.ceil(natural.height * scale) : undefined,
            visibility: natural ? "visible" : "hidden",
          }}
        >
          <div style={{ width: "max-content", transform: `scale(${scale})`, transformOrigin: "top left" }}>
            <ReportView ref={reportRef} {...reportProps} />
          </div>
        </div>
      </div>
    </div>
  );
}
