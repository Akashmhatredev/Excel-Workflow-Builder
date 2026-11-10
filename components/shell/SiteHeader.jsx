"use client";

import { Files, History, House, LayoutTemplate, Workflow } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import BrandMark from "./BrandMark";
import NavMoreMenu from "./NavMoreMenu";
import OfflineIndicator from "./OfflineIndicator";
import ThemeMenu from "./ThemeMenu";
import useOnline from "./useOnline";

const NAV = [
  { href: "/", label: "Home", icon: House },
  { href: "/workflow", label: "Workflow", icon: Workflow },
  { href: "/templates", label: "Templates", icon: LayoutTemplate },
  { href: "/batch", label: "Batch", icon: Files },
  { href: "/history", label: "History", icon: History },
];

/** On phones only these stay in the bar; the others move into "More". */
const PHONE_BAR = new Set(["/workflow", "/templates"]);
const PHONE_MORE = NAV.filter((item) => !PHONE_BAR.has(item.href));

function isActive(pathname, href) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * App header: product mark and name, the five destinations, the offline indicator and the
 * theme control.
 *
 * - From `sm` up every destination is in the bar.
 * - On phones the name collapses to the mark (the link keeps its accessible name), Workflow
 *   and Templates stay visible and Home, Batch and History move into a "More" disclosure.
 *   Only one of the two copies of a link is ever displayed, so assistive technology meets
 *   each destination once.
 * - The current page has aria-current="page" wherever its link is.
 */
export default function SiteHeader() {
  const pathname = usePathname() || "/";
  const activeHref = NAV.find((item) => isActive(pathname, item.href))?.href || null;
  const online = useOnline();
  return (
    <header className="border-b border-line bg-surface">
      <div className="mx-auto flex min-h-14 w-full max-w-6xl flex-wrap items-center gap-x-1 px-3 sm:gap-x-3 sm:px-6">
        <Link
          href="/"
          aria-label="Excel Workflow Builder, home"
          className="-ml-1 flex h-14 shrink-0 items-center gap-2.5 rounded-lg px-1 text-fg"
        >
          <BrandMark />
          <span className="hidden text-[0.9375rem] font-semibold tracking-tight lg:inline">Excel Workflow Builder</span>
        </Link>
        <nav aria-label="Main" className="min-w-0 sm:ml-1 lg:ml-3">
          <ul className="flex items-center gap-0.5">
            {NAV.map((item) => {
              const active = item.href === activeHref;
              return (
                <li key={item.href} className={PHONE_BAR.has(item.href) ? undefined : "hidden sm:block"}>
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex h-10 items-center rounded-lg px-2 text-sm font-medium transition-colors duration-150 sm:px-3",
                      active ? "bg-surface-2 text-fg" : "text-muted hover:bg-surface-2 hover:text-fg",
                    )}
                  >
                    {item.label}
                  </Link>
                </li>
              );
            })}
            <li className="sm:hidden">
              <NavMoreMenu items={PHONE_MORE} activeHref={activeHref} />
            </li>
          </ul>
        </nav>
        <OfflineIndicator className="sm:ml-auto" />
        {/* While the pill shows, it takes the free space on wide screens; the theme button sits after it. */}
        <ThemeMenu className={cn("ml-auto", !online && "sm:ml-0")} />
      </div>
    </header>
  );
}
