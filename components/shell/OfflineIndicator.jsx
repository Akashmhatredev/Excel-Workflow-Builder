"use client";

import { WifiOff } from "lucide-react";
import { cn } from "@/lib/cn";
import useOnline from "./useOnline";

/**
 * "Offline" pill for the header. The wrapper is a polite live region that is always in the
 * page, so going offline is announced; while online it is empty and takes no space.
 * On phones it drops to its own row under the header bar (the bar has no room left); from
 * `sm` up it sits next to the theme button.
 */
export default function OfflineIndicator({ className }) {
  const online = useOnline();
  return (
    <div
      role="status"
      className={cn(online ? "sr-only" : "order-last basis-full pb-2 sm:order-none sm:basis-auto sm:pb-0", className)}
    >
      {online ? null : (
        <p className="flex items-center gap-2 rounded-lg bg-warning-soft px-2.5 py-1.5 text-sm text-fg sm:py-1">
          <WifiOff className="size-4 shrink-0 text-warning" aria-hidden="true" />
          <span>
            <span className="font-medium">Offline</span>
            <span className="text-muted sm:sr-only">. Files are still processed on this device.</span>
          </span>
        </p>
      )}
    </div>
  );
}
