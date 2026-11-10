"use client";

import { useEffect } from "react";
import { toast } from "@/lib/toast";

/**
 * Registers public/sw.js (production builds only) once the page has loaded, and runs the
 * update flow:
 *
 * - a new worker that finished installing while this page is controlled by an older one
 *   shows a sticky "A new version is available" toast with a Reload button;
 * - Reload asks that worker to skipWaiting(); once it takes control the page reloads;
 * - when another tab applied the update, this tab gets a quieter "updated in another tab" toast
 *   instead of being reloaded under the user's feet (a loaded file lives only in memory).
 *
 * Updates are checked by the browser on navigation, and here when the tab becomes visible
 * again or every hour, whichever comes first.
 *
 * In development any worker left on this origin by a production run is removed, so `next dev`
 * never serves stale cached files.
 */

const SW_URL = "/sw.js";
const UPDATE_EVERY_MS = 60 * 60 * 1000;
const RELOAD_FALLBACK_MS = 4000;

let started = false;

function cleanUpForDevelopment() {
  const sw = navigator.serviceWorker;
  sw.getRegistrations()
    .then((registrations) => Promise.all(registrations.map((registration) => registration.unregister())))
    .catch(() => {});
  if (typeof caches !== "undefined") {
    caches
      .keys()
      .then((names) => Promise.all(names.filter((name) => name.startsWith("ewb-")).map((name) => caches.delete(name))))
      .catch(() => {});
  }
}

function start() {
  const sw = navigator.serviceWorker;
  // A page that loaded without a controller gets one on the first install (clients.claim()).
  // That controllerchange is not an update.
  let hadController = Boolean(sw.controller);
  let reloadRequested = false;
  let promptedWorker = null;
  let promptId = null;

  const reload = () => window.location.reload();

  const applyUpdate = (worker) => {
    reloadRequested = true;
    if (worker.state === "activated" || sw.controller === worker) {
      reload();
      return;
    }
    worker.postMessage({ type: "SKIP_WAITING" });
    // If the worker never takes over (it was replaced meanwhile), a reload still picks up the new version.
    window.setTimeout(reload, RELOAD_FALLBACK_MS);
  };

  const promptUpdate = (worker) => {
    if (!worker || worker === promptedWorker) return;
    promptedWorker = worker;
    if (promptId) toast.dismiss(promptId);
    promptId = toast.info("A new version is available", {
      description: "Reload to start using it. Your workflow draft is kept; a loaded file has to be added again.",
      duration: 0,
      action: { label: "Reload", onClick: () => applyUpdate(worker) },
    });
  };

  const watchInstalling = (worker) => {
    if (!worker) return;
    const onStateChange = () => {
      // "installed" with a controller in place = an update waiting for its turn.
      if (worker.state === "installed" && sw.controller) promptUpdate(worker);
      if (worker.state !== "installing") worker.removeEventListener("statechange", onStateChange);
    };
    worker.addEventListener("statechange", onStateChange);
  };

  sw.addEventListener("controllerchange", () => {
    if (!hadController) {
      hadController = true;
      return;
    }
    if (reloadRequested) {
      reload();
      return;
    }
    if (promptId) toast.dismiss(promptId);
    promptId = toast.info("The app was updated in another tab", {
      description: "Reload this tab when it suits you to use the new version.",
      duration: 0,
      action: { label: "Reload", onClick: reload },
    });
  });

  sw.register(SW_URL, { scope: "/", updateViaCache: "none" })
    .then((registration) => {
      if (registration.waiting && sw.controller) promptUpdate(registration.waiting);
      watchInstalling(registration.installing);
      registration.addEventListener("updatefound", () => watchInstalling(registration.installing));

      let lastCheck = Date.now();
      const checkForUpdate = () => {
        if (Date.now() - lastCheck < UPDATE_EVERY_MS / 4) return;
        lastCheck = Date.now();
        // Rejects while offline or when the server is unreachable: try again next time.
        registration.update().catch(() => {});
      };
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") checkForUpdate();
      });
      window.setInterval(() => {
        lastCheck = 0;
        checkForUpdate();
      }, UPDATE_EVERY_MS);
    })
    .catch(() => {
      // No offline support (blocked by the browser, private mode, ...). The app works as before.
    });
}

export default function ServiceWorkerRegistration() {
  useEffect(() => {
    if (started || typeof navigator === "undefined" || !("serviceWorker" in navigator)) return undefined;
    started = true;
    if (process.env.NODE_ENV !== "production") {
      cleanUpForDevelopment();
      return undefined;
    }
    if (document.readyState === "complete") {
      start();
      return undefined;
    }
    window.addEventListener("load", start, { once: true });
    return undefined;
  }, []);

  return null;
}
