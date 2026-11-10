"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import BrandMark from "./BrandMark";
import ThemeMenu from "./ThemeMenu";

const NAV = [
  { href: "/", label: "Home" },
  { href: "/workflow", label: "Workflow" },
  { href: "/templates", label: "Templates" },
];

function isActive(pathname, href) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * App header: product mark and name, the three destinations and the theme
 * control. One row at every width: on phones the name collapses to the mark
 * (the link keeps its accessible name) so the navigation stays visible
 * instead of hiding behind a menu button.
 */
export default function SiteHeader() {
  const pathname = usePathname() || "/";
  return (
    <header className="border-b border-line bg-surface">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-1 px-3 sm:gap-3 sm:px-6">
        <Link
          href="/"
          aria-label="Excel Workflow Builder, home"
          className="-ml-1 flex h-10 shrink-0 items-center gap-2.5 rounded-lg px-1 text-fg"
        >
          <BrandMark />
          <span className="hidden text-[0.9375rem] font-semibold tracking-tight md:inline">Excel Workflow Builder</span>
        </Link>
        <nav aria-label="Main" className="min-w-0 sm:ml-3">
          <ul className="flex items-center gap-0.5">
            {NAV.map((item) => {
              const active = isActive(pathname, item.href);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex h-10 items-center rounded-lg px-2.5 text-sm font-medium transition-colors duration-150 sm:px-3",
                      active ? "bg-surface-2 text-fg" : "text-muted hover:bg-surface-2 hover:text-fg",
                    )}
                  >
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <ThemeMenu className="ml-auto" />
      </div>
    </header>
  );
}
