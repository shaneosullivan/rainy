"use client";
// "Install App" button using philfung/add-to-homescreen, which shows the right
// install steps for the visitor's device and browser. The button only appears
// where the app can actually be installed.

import Script from "next/script";
import { useEffect, useState } from "react";
import { SITE_NAME } from "./site";

const LIB = "https://cdn.jsdelivr.net/gh/philfung/add-to-homescreen@v4.3.0/dist";

type AddToHomeScreenInstance = {
  show: (locale?: string) => unknown;
  isStandAlone: () => boolean;
  isDeviceIOS: () => boolean;
  isDeviceAndroid: () => boolean;
  isBrowserIOSSafari: () => boolean;
  isBrowserIOSSafari26: () => boolean;
  isBrowserIOSChrome: () => boolean;
  isBrowserAndroidChrome: () => boolean;
  isBrowserAndroidFirefox: () => boolean;
  isDesktopChrome: () => boolean;
  isDesktopEdge: () => boolean;
  isDesktopSafari: () => boolean;
};

declare global {
  interface Window {
    AddToHomeScreen?: (opts: Record<string, unknown>) => AddToHomeScreenInstance;
    AddToHomeScreenInstance?: AddToHomeScreenInstance;
  }
}

/**
 * Whether the app can be installed here, mirroring the cases where the
 * library's show() has install steps (its canBeStandAlone) — show() itself
 * can't be asked without displaying its UI. Desktop Chrome/Edge are only
 * installable once the browser fires `beforeinstallprompt`.
 */
function canInstall(ath: AddToHomeScreenInstance, promptFired: boolean): boolean {
  if (ath.isStandAlone()) {
    return false; // already installed and running as an app
  }
  if (ath.isDeviceIOS()) {
    return ath.isBrowserIOSSafari() || ath.isBrowserIOSSafari26() || ath.isBrowserIOSChrome();
  }
  if (ath.isDeviceAndroid()) {
    // The library's Android Edge check isn't exported, so match its UA token.
    return ath.isBrowserAndroidChrome() || ath.isBrowserAndroidFirefox() || /EdgA\//.test(navigator.userAgent);
  }
  if (ath.isDesktopChrome() || ath.isDesktopEdge()) {
    return promptFired;
  }
  return ath.isDesktopSafari();
}

export function InstallButton() {
  const [ath, setAth] = useState<AddToHomeScreenInstance | null>(null);
  const [promptFired, setPromptFired] = useState(false);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    const onPrompt = () => setPromptFired(true);
    const onInstalled = () => setInstalled(true);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  // The instance must be created at load (not on click) so it can catch
  // Chrome's install prompt event.
  function init() {
    if (!window.AddToHomeScreen) {
      return;
    }
    window.AddToHomeScreenInstance ??= window.AddToHomeScreen({
      appName: SITE_NAME,
      appIconUrl: "/apple-touch-icon.png",
      assetUrl: `${LIB}/assets/img/`,
      maxModalDisplayCount: -1,
    });
    setAth(window.AddToHomeScreenInstance);
  }

  const visible = !!ath && !installed && canInstall(ath, promptFired);

  return (
    <>
      <link rel="stylesheet" href={`${LIB}/add-to-homescreen.min.css`} />
      <Script src={`${LIB}/add-to-homescreen_en.min.js`} strategy="afterInteractive" onReady={init} />
      {visible && (
        <button className="install" onClick={() => ath.show("en")}>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth={2.2} aria-hidden>
            <path d="M12 4v11M7 10l5 5 5-5M5 20h14" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Install App
        </button>
      )}
    </>
  );
}
