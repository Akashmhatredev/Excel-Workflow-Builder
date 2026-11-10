import { cn } from "@/lib/cn";

/**
 * The product mark: rows of a sheet narrowing down (shape, filter) and an
 * arrow leaving (export). Same drawing as app/icon.svg, but painted with the
 * theme tokens so it follows light and dark.
 */
export default function BrandMark({ className }) {
  return (
    <svg viewBox="0 0 32 32" className={cn("size-8 shrink-0", className)} aria-hidden="true" focusable="false">
      <rect width="32" height="32" rx="8" className="fill-brand" />
      <g className="fill-brand-fg">
        <rect x="7" y="8" width="18" height="3.5" rx="1.75" />
        <rect x="7" y="14.25" width="12" height="3.5" rx="1.75" opacity="0.82" />
        <rect x="7" y="20.5" width="6.5" height="3.5" rx="1.75" opacity="0.64" />
      </g>
      <path
        d="M17.5 22.25h7m-2.75-2.75 2.75 2.75-2.75 2.75"
        className="stroke-brand-fg"
        fill="none"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
