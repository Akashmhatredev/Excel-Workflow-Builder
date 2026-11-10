import { cn } from "@/lib/cn";

/**
 * Class recipes shared by <Button>, <IconButton> and <ButtonLink>.
 * No "use client" here on purpose: Server Components (not-found, the landing
 * page) can call buttonClass() to style a link like a button.
 *
 * Hover and pressed states use the `usable-hover:` / `usable-active:` variants
 * from app/globals.css: they skip disabled controls and always lose to a
 * `hover:` utility passed in className.
 */

export const BUTTON_VARIANTS = {
  primary: "bg-brand text-brand-fg usable-hover:bg-brand-hover usable-active:bg-brand-hover",
  secondary:
    "border border-line-strong bg-surface text-fg usable-hover:border-control usable-hover:bg-surface-2 usable-active:bg-line",
  ghost: "text-fg usable-hover:bg-surface-2 usable-active:bg-line",
  soft: "bg-brand-soft text-brand-soft-fg usable-hover:bg-brand-soft-hover usable-active:bg-brand-soft-hover",
  danger: "bg-danger text-danger-fg usable-hover:bg-danger-hover usable-active:bg-danger-hover",
  dangerGhost: "text-danger usable-hover:bg-danger-soft usable-active:bg-danger-soft",
};

export const BUTTON_SIZES = {
  sm: "h-8 gap-1.5 px-2.5 text-sm",
  md: "h-10 gap-2 px-4 text-sm",
  lg: "h-12 gap-2 px-5 text-base",
};

export const ICON_BUTTON_SIZES = { sm: "size-8", md: "size-10", lg: "size-12" };

export const ICON_SIZES = { sm: "size-4", md: "size-4", lg: "size-5" };

const PRESSABLE =
  "inline-flex shrink-0 cursor-pointer items-center justify-center rounded-lg transition-colors duration-150 " +
  "disabled:cursor-not-allowed aria-disabled:cursor-not-allowed";

/** Classes for a text button (or a link that should look like one). */
export function buttonClass({ variant = "secondary", size = "md", className } = {}) {
  return cn(
    PRESSABLE,
    "font-medium whitespace-nowrap select-none disabled:opacity-50 aria-disabled:opacity-50",
    BUTTON_VARIANTS[variant] || BUTTON_VARIANTS.secondary,
    BUTTON_SIZES[size] || BUTTON_SIZES.md,
    className,
  );
}

/** Classes for a square icon-only button. */
export function iconButtonClass({ variant = "ghost", size = "md", className } = {}) {
  return cn(
    PRESSABLE,
    "disabled:opacity-40 aria-disabled:opacity-40",
    BUTTON_VARIANTS[variant] || BUTTON_VARIANTS.ghost,
    ICON_BUTTON_SIZES[size] || ICON_BUTTON_SIZES.md,
    className,
  );
}
