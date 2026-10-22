"use client";
// Keeps the app from getting stuck on old assets. Every build writes
// public/buildId.json and bakes the same id in here (next.config.mjs). When
// the page loads or is refocused, fetch the deployed file (cache-busted); if
// its id differs, a newer build is live, so drop the cached app pages and the
// service worker and reload from the network.

import { useEffect } from "react";

const BUILD_ID = process.env.NEXT_PUBLIC_BUILD_ID ?? "dev";
// The build we last reloaded for, so a deploy that still mismatches after a
// reload (e.g. a CDN serving the old page) can't cause a reload loop.
const RELOADED_FOR_KEY = "rainy.reloadedFor";

async function deployedBuildId(): Promise<string | null> {
  const res = await fetch(`/buildId.json?t=${Date.now()}`, { cache: "no-store" });
  if (!res.ok) {
    return null;
  }
  const { buildId } = (await res.json()) as { buildId?: unknown };
  return typeof buildId === "string" ? buildId : null;
}

function alreadyReloadedFor(id: string): boolean {
  try {
    if (sessionStorage.getItem(RELOADED_FOR_KEY) === id) {
      return true;
    }
    sessionStorage.setItem(RELOADED_FOR_KEY, id);
  } catch {
    // No sessionStorage: reload anyway (worst case, once per focus).
  }
  return false;
}

/**
 * Deletes the cached app pages and unregisters the service worker. Caches of
 * things that never change (content-hashed build files, third-party scripts,
 * map and rain tiles; see public/sw.js) are kept.
 */
async function discardCaches() {
  if ("caches" in window) {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith("shell-")).map((k) => caches.delete(k)));
  }
  if ("serviceWorker" in navigator) {
    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(regs.map((r) => r.unregister()));
  }
}

export function UpdateCheck() {
  useEffect(() => {
    if (BUILD_ID === "dev") {
      return; // no build id in `next dev`
    }
    let checking = false;
    const check = async () => {
      if (checking || document.visibilityState !== "visible") {
        return;
      }
      checking = true;
      try {
        const deployed = await deployedBuildId();
        if (deployed && deployed !== BUILD_ID && !alreadyReloadedFor(deployed)) {
          await discardCaches();
          window.location.reload();
        }
      } catch {
        // Offline or the request failed: try again next time.
      } finally {
        checking = false;
      }
    };
    check();
    window.addEventListener("focus", check);
    window.addEventListener("pageshow", check); // includes restores from the back/forward cache
    document.addEventListener("visibilitychange", check);
    return () => {
      window.removeEventListener("focus", check);
      window.removeEventListener("pageshow", check);
      document.removeEventListener("visibilitychange", check);
    };
  }, []);
  return null;
}
