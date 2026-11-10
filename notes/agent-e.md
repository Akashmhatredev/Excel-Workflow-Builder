# Agent E: shell and polish

Branch `feat/app-shell`, rebased onto the rewritten `main` (a8c5fe9).

## What is in place

- **Shell** (`app/layout.js`, `components/shell/`): skip link, header (mark, Home / Workflow /
  Templates with `aria-current="page"`, theme menu), compact footer with the privacy note,
  `<Toaster />` and `<StorageBridge />` mounted once. Title template `%s | Excel Workflow Builder`,
  so child routes export a bare `title`. `app/icon.svg` and `app/manifest.js` (no service worker).
- **Theme** (`components/shell/theme.js`): `light` | `dark` | `system`, stored raw under
  `ewb:v1:theme` through `readRaw` / `writeRaw`. The inline script in `app/layout.js` and `theme.js`
  share one rule: `"dark"` is dark, `"light"` is light, anything else follows the OS. Change them
  together. `useTheme()` is a `useSyncExternalStore` store; it follows OS changes while on `system`
  and theme changes made in other tabs.
- **Toaster**: icon and colour per type, dismiss button, Escape, auto-dismiss with pause on hover
  or focus (at least 1.5 s left after a pause), polite live region that is always mounted, errors as
  `role="alert"`, bottom-right on desktop, full width above the wizard's sticky bar on phones.
- **Wizard**: title row (template name or "Untitled workflow", "Unsaved changes" badge,
  `SaveTemplateButton`, "Start over" with a confirm dialog that calls `resetWorkflow({ keepData: false })`),
  stepper (completed / current / upcoming / locked, `aria-current="step"`, locked steps are
  `aria-disabled` with the reason in `title` and in the visible description), `role="progressbar"`,
  a collapsible "Step 2 of 4: Mapping" summary on phones, focus and scroll to the step heading on every
  step change, Back / Next (sticky on phones) with the visible reason when Next is blocked, "Done" on
  the last step, a notice with a "Go to ..." button when the current step stops being available, and
  `FixMappingDialog` mounted once.
- **Landing page**: one-sentence pitch, "Start a workflow" / "Browse templates", "Continue where you
  left off" card, the latest three templates (skeleton until `hasHydrated`, then an empty state),
  "How it works", sample file downloads, privacy note.
- **States**: `not-found.js` (Server Component, links only), `error.js` (`retry` with a `reset`
  fallback), `global-error.js` (own document, re-imports the CSS and applies the saved theme),
  `loading.js` (skeleton).

## Changes to `components/ui` and `app/globals.css` that other owners should know

No export, prop or behaviour in CONTRACTS.md section 8 changed. Every existing token name is kept.

- New files: `components/ui/styles.js` (`buttonClass()`, `iconButtonClass()`, safe in Server
  Components) and `components/ui/ButtonLink.jsx` (a link that looks like `<Button>`; same `variant`,
  `size`, `icon`, `iconRight`; `download` / `external` render a plain `<a>`). Use it for navigation
  instead of a `<button>` that calls `router.push`.
- New tokens: `surface-raised`, `control` (3:1 border for inputs and switches), `brand-soft-hover`,
  `danger-hover`, `shadow-raised`. Every text/background pair the kit uses was computed to meet
  WCAG AA in both themes.
- New variants: `usable-hover:` and `usable-active:` (hover / pressed that skip disabled and
  `aria-disabled` controls). The kit's buttons use them, so a `hover:` class passed in `className`
  now reliably overrides the kit's default hover.
- New utilities: `.tap-target` (opt-in 40px touch area on touch screens, for 32px icon buttons),
  `.skeleton`, `.ui-control`, `animate-toast-in/out`, `animate-pop-in`, `animate-fade-in`. Modal
  dialogs fade in, and the page behind an open modal no longer scrolls.
- Visible differences: inputs, selects and textareas have a slightly stronger border, a full-contrast
  placeholder, a brand border on focus, and 16px text on phones (stops iOS zooming on focus, 14px from
  `sm` up). Secondary buttons have a stronger border. `Segmented` now supports arrow keys / Home / End
  with a roving tab stop, like a native radio group. `Notice` icons take the tone colour.
- `aria-disabled="true"` on a `Button` now looks disabled too. The wizard uses it for Next so the
  button stays focusable and can point at its reason with `aria-describedby`.
- Phones: an element with `data-bottom-bar` (or `data-bottom-bar="tall"`) lifts the toasts above it.

## Requests for other owners

- **D**: `app/templates/page.js` is a Client Component, so it cannot export `metadata` and the tab
  shows the default title. Please add `export const metadata = { title: "Templates" }` from a server
  `app/templates/layout.js` (or a server page wrapping a client component); the root template adds the
  product name.
- **D**: on the landing page `TemplateCard` renders inside `<li>` in a 1/2/3-column grid
  (`min-w-0`); it should fill its cell (`h-full`) and not set an outer margin.
- **D**: `SaveTemplateButton` sits in the wizard's title row next to a `ghost` "Start over" button;
  the default `variant`/`size` (`secondary`/`md`) fits.
- **A**: the landing page links to `/samples/sample-data.xlsx` and `/samples/sample-template.json`.
  They are not on `main` yet, so both links 404 until `public/samples/` lands.
- **Integrator**: `app/favicon.ico` is still the scaffold's default icon. Next lists it before
  `app/icon.svg`, so some browsers show it instead of the product mark. Delete it, or ask me to add
  an `.ico` of the mark.
- **Integrator / future `/batch` owner**: the README mentions a `/batch` route. When it lands, add it
  to `NAV` in `components/shell/SiteHeader.jsx`. At 360px the header fits one more short label;
  re-check the width.

## Deliberately not done

- The run log from `lib/history.js` is not on the dashboard yet (as instructed). A "Recent runs" card
  belongs between "Continue where you left off" and "Recent templates", reading
  `useSyncExternalStore(subscribeHistory, getHistorySnapshot, getServerHistorySnapshot)`.
- No README edits. Suggested README additions: the `ewb:v1:theme` key alongside the other storage
  keys, and a sentence that the theme follows the OS until the user picks one.

## How it was checked

A Playwright script (Chrome; never committed) ran 247 checks against `next dev -p 3104`. It covered
`/`, `/workflow`, `/templates`, a 404 and a temporary UI-kit page (removed before committing), in
light and dark, at 360px and 1280px. All passed, with no console errors or hydration warnings. It
checked: landmarks, one `h1` per page, no horizontal scroll, `aria-current`, header and wizard touch
targets of 40px or more, the skip link, every theme path (stored raw value, survives reload and
hydration, live OS changes on `system`, unknown values), toast placement, dismiss, Escape,
auto-dismiss and pause, and wizard gating, focus, scroll, progress, sticky bar, start over, the
continue card and recent templates. Not tested with a real screen reader; toasts carry a visually
hidden type prefix ("Error: ...") for one.
