"use client";

import { Loader2, X } from "lucide-react";
import { useEffect, useId, useRef } from "react";
import { cn } from "@/lib/cn";
import { ICON_SIZES, buttonClass, iconButtonClass } from "./styles";

/**
 * components/ui: the shared UI kit. Every screen builds on these so the app
 * looks like one product. Props are a stable contract (see CONTRACTS.md);
 * only the styling inside may change.
 *
 * Button looks live in ./styles.js so that ./ButtonLink.jsx (a link styled as
 * a button, usable from Server Components) shares them.
 */

/** <Button variant size icon={LucideIcon} iconRight={LucideIcon} loading /> */
export function Button({
  variant = "secondary",
  size = "md",
  icon: Icon,
  iconRight: IconRight,
  loading = false,
  disabled = false,
  className,
  children,
  type = "button",
  ...props
}) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={buttonClass({ variant, size, className })}
      {...props}
    >
      {loading ? (
        <Loader2 className={cn(ICON_SIZES[size], "animate-spin")} aria-hidden="true" />
      ) : Icon ? (
        <Icon className={ICON_SIZES[size]} aria-hidden="true" />
      ) : null}
      {children}
      {IconRight ? <IconRight className={ICON_SIZES[size]} aria-hidden="true" /> : null}
    </button>
  );
}

/** Icon-only button. `label` is required: it becomes the accessible name and the tooltip. */
export function IconButton({ label, icon: Icon, variant = "ghost", size = "md", className, type = "button", ...props }) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={iconButtonClass({ variant, size, className })}
      {...props}
    >
      <Icon className={size === "lg" ? "size-5" : "size-4"} aria-hidden="true" />
    </button>
  );
}

/*
 * Text controls. The border is the 3:1 `control` colour (WCAG 1.4.11) and the
 * placeholder is full `muted` (4.5:1). The font size comes from `.ui-control`
 * in globals.css: 14px, but 16px on phones so iOS does not zoom the page when
 * a field takes focus. Any text-* utility in className overrides it.
 */
const CONTROL =
  "ui-control w-full rounded-lg border border-control bg-surface text-fg placeholder:text-muted transition-colors duration-150 " +
  "usable-hover:border-muted focus-visible:border-brand disabled:cursor-not-allowed disabled:opacity-50 " +
  "aria-[invalid=true]:border-danger";

export function Input({ className, invalid, ...props }) {
  return <input aria-invalid={invalid || undefined} className={cn(CONTROL, "h-10 px-3", className)} {...props} />;
}

export function Textarea({ className, invalid, rows = 3, ...props }) {
  return (
    <textarea rows={rows} aria-invalid={invalid || undefined} className={cn(CONTROL, "px-3 py-2", className)} {...props} />
  );
}

/** Native select. Pass <option> children. */
export function Select({ className, invalid, children, ...props }) {
  return (
    <select aria-invalid={invalid || undefined} className={cn(CONTROL, "h-10 cursor-pointer px-2.5", className)} {...props}>
      {children}
    </select>
  );
}

/**
 * Label + control + hint/error. Pass a render function to receive the ids:
 *   <Field label="Name" hint="Shown in the file" error={err}>
 *     {(p) => <Input {...p} value={v} onChange={...} />}
 *   </Field>
 * p = { id, "aria-describedby", invalid }
 */
export function Field({ label, hint, error, required, className, children, hideLabel = false }) {
  const id = useId();
  const hintId = `${id}-hint`;
  const describedBy = hint || error ? hintId : undefined;
  const control =
    typeof children === "function" ? children({ id, "aria-describedby": describedBy, invalid: Boolean(error) }) : children;
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <label htmlFor={id} className={cn("text-sm font-medium text-fg", hideLabel && "sr-only")}>
        {label}
        {required ? <span className="text-danger"> *</span> : null}
      </label>
      {control}
      {error ? (
        <p id={hintId} className="text-xs text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="text-xs text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** Checkbox with a visible label. onChange receives the boolean. */
export function Checkbox({ label, checked, onChange, disabled, className, description, ...props }) {
  const id = useId();
  return (
    <div className={cn("flex items-start gap-2.5", className)}>
      <input
        id={id}
        type="checkbox"
        checked={Boolean(checked)}
        disabled={disabled}
        onChange={(event) => onChange && onChange(event.target.checked)}
        className="mt-0.5 size-4 shrink-0 cursor-pointer accent-(--brand) disabled:cursor-not-allowed"
        {...props}
      />
      <label htmlFor={id} className={cn("cursor-pointer text-sm text-fg", disabled && "cursor-not-allowed opacity-60")}>
        {label}
        {description ? <span className="block text-xs text-muted">{description}</span> : null}
      </label>
    </div>
  );
}

/** Toggle switch (role="switch"). onChange receives the boolean. */
export function Switch({ label, checked, onChange, disabled, className, description }) {
  const id = useId();
  return (
    <div className={cn("flex items-center justify-between gap-3", className)}>
      <label htmlFor={id} className="min-w-0 cursor-pointer text-sm font-medium text-fg">
        {label}
        {description ? <span className="block text-xs font-normal text-muted">{description}</span> : null}
      </label>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={Boolean(checked)}
        disabled={disabled}
        onClick={() => onChange && onChange(!checked)}
        className={cn(
          "relative h-6 w-11 shrink-0 cursor-pointer rounded-full transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50",
          checked ? "bg-brand usable-hover:bg-brand-hover" : "bg-control usable-hover:bg-muted",
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            "absolute top-0.5 left-0.5 size-5 rounded-full bg-surface shadow-sm transition-transform duration-150",
            checked && "translate-x-5",
          )}
        />
      </button>
    </div>
  );
}

/**
 * Small radio-style choice group. options = [{ value, label }].
 * Keyboard: like a native radio group, Tab reaches the selected option and the
 * arrow keys (plus Home / End) move the selection.
 */
export function Segmented({ label, options, value, onChange, className, size = "md" }) {
  const selectedIndex = options.findIndex((option) => option.value === value);
  const onKeyDown = (event, index) => {
    const last = options.length - 1;
    let next = -1;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") next = index === last ? 0 : index + 1;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = index === 0 ? last : index - 1;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = last;
    if (next < 0 || next === index) return;
    event.preventDefault();
    const group = event.currentTarget.parentElement;
    const target = group ? group.children[next] : null;
    if (target && typeof target.focus === "function") target.focus();
    if (onChange) onChange(options[next].value);
  };
  return (
    <div role="radiogroup" aria-label={label} className={cn("inline-flex rounded-lg border border-line bg-surface-2 p-0.5", className)}>
      {options.map((option, index) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected || (selectedIndex < 0 && index === 0) ? 0 : -1}
            onClick={() => onChange && onChange(option.value)}
            onKeyDown={(event) => onKeyDown(event, index)}
            className={cn(
              "cursor-pointer rounded-md font-medium transition-colors duration-150",
              size === "sm" ? "px-2.5 py-1 text-xs" : "px-3 py-1.5 text-sm",
              selected ? "bg-surface-raised text-fg shadow-sm" : "text-muted usable-hover:text-fg",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export function Card({ as: Tag = "div", className, children, ...props }) {
  return (
    <Tag className={cn("rounded-xl border border-line bg-surface shadow-card", className)} {...props}>
      {children}
    </Tag>
  );
}

/** Heading row for a card or section: title, optional description and actions on the right. */
export function SectionHeader({ title, description, actions, as: Tag = "h2", className }) {
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-3", className)}>
      <div className="min-w-0">
        <Tag className="text-base font-semibold text-fg">{title}</Tag>
        {description ? <p className="mt-0.5 text-sm text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

const BADGE_TONES = {
  neutral: "bg-surface-2 text-muted",
  brand: "bg-brand-soft text-brand-soft-fg",
  danger: "bg-danger-soft text-danger",
  warning: "bg-warning-soft text-warning",
  info: "bg-info-soft text-info",
};

export function Badge({ tone = "neutral", className, children, ...props }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium whitespace-nowrap",
        BADGE_TONES[tone] || BADGE_TONES.neutral,
        className,
      )}
      {...props}
    >
      {children}
    </span>
  );
}

const NOTICE_TONES = {
  info: "border-info/30 bg-info-soft text-fg",
  success: "border-brand/30 bg-brand-soft text-fg",
  warning: "border-warning/40 bg-warning-soft text-fg",
  error: "border-danger/40 bg-danger-soft text-fg",
};

const NOTICE_ICON_TONES = {
  info: "text-info",
  success: "text-brand",
  warning: "text-warning",
  error: "text-danger",
};

/** Inline message box. tone: info | success | warning | error. */
export function Notice({ tone = "info", title, icon: Icon, actions, className, children }) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn("flex items-start gap-3 rounded-lg border px-3.5 py-3 text-sm", NOTICE_TONES[tone] || NOTICE_TONES.info, className)}
    >
      {Icon ? (
        <Icon className={cn("mt-0.5 size-4 shrink-0", NOTICE_ICON_TONES[tone] || NOTICE_ICON_TONES.info)} aria-hidden="true" />
      ) : null}
      <div className="min-w-0 flex-1">
        {title ? <p className="font-medium">{title}</p> : null}
        {children ? <div className={cn("text-muted", title && "mt-0.5")}>{children}</div> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function Spinner({ className, label = "Loading" }) {
  return (
    <span role="status" className="inline-flex items-center">
      <Loader2 className={cn("size-5 animate-spin text-muted", className)} aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </span>
  );
}

/** Centered placeholder for "nothing here yet". `action` is any node (usually a Button). */
export function EmptyState({ icon: Icon, title, description, action, className }) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-3 px-6 py-10 text-center", className)}>
      {Icon ? (
        <span className="flex size-12 items-center justify-center rounded-full bg-surface-2 text-muted">
          <Icon className="size-6" aria-hidden="true" />
        </span>
      ) : null}
      <div>
        <p className="font-medium text-fg">{title}</p>
        {description ? <p className="mx-auto mt-1 max-w-md text-sm text-muted">{description}</p> : null}
      </div>
      {action || null}
    </div>
  );
}

const MODAL_SIZES = { sm: "max-w-sm", md: "max-w-lg", lg: "max-w-2xl", xl: "max-w-4xl" };

/**
 * Modal dialog built on the native <dialog> (focus trap and Escape for free).
 * <Modal open onClose title description footer={<Button/>} size="md">body</Modal>
 */
export function Modal({ open, onClose, title, description, footer, size = "md", dismissable = true, children }) {
  const ref = useRef(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        if (dismissable && onClose) onClose();
      }}
      onClick={(event) => {
        if (event.target === ref.current && dismissable && onClose) onClose();
      }}
      className={cn(
        "m-auto w-[calc(100%-2rem)] rounded-2xl border border-line bg-surface p-0 text-fg shadow-raised backdrop:bg-black/50",
        MODAL_SIZES[size] || MODAL_SIZES.md,
      )}
    >
      {open ? (
        <div className="flex max-h-[85dvh] flex-col">
          <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
            <div className="min-w-0">
              <h2 id={titleId} className="text-base font-semibold">
                {title}
              </h2>
              {description ? <p className="mt-0.5 text-sm text-muted">{description}</p> : null}
            </div>
            {dismissable ? (
              <IconButton label="Close" icon={X} size="sm" onClick={onClose} className="tap-target -mt-1 -mr-2" />
            ) : null}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
          {footer ? (
            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>
          ) : null}
        </div>
      ) : null}
    </dialog>
  );
}

/** Yes/no confirmation. tone "danger" for destructive actions. */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  tone = "default",
  onConfirm,
  onCancel,
}) {
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button variant={tone === "danger" ? "danger" : "primary"} onClick={onConfirm} autoFocus>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p className="text-sm text-muted">{message}</p>
    </Modal>
  );
}
