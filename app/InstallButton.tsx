"use client";
// "Install App" button using philfung/add-to-homescreen, which shows the right
// install steps for the visitor's device and browser (iOS Safari/Chrome,
// Android, desktop Chrome/Edge/Safari, in-app browsers).

import Script from "next/script";
import { useState } from "react";
import { SITE_NAME } from "./site";

const LIB = "https://cdn.jsdelivr.net/gh/philfung/add-to-homescreen@v4.3.0/dist";

type AddToHomeScreenInstance = { show: (locale?: string) => unknown; isStandAlone: () => boolean };

declare global {
  interface Window {
    AddToHomeScreen?: (opts: Record<string, unknown>) => AddToHomeScreenInstance;
    AddToHomeScreenInstance?: AddToHomeScreenInstance;
  }
}

export function InstallButton() {
  const [ready, setReady] = useState(false);

  // The instance must be created at load (not on click) so it can catch
  // Chrome's install prompt event.
  function init() {
    if (!window.AddToHomeScreen || window.AddToHomeScreenInstance) {
      setReady(!!window.AddToHomeScreenInstance && !window.AddToHomeScreenInstance.isStandAlone());
      return;
    }
    const instance = window.AddToHomeScreen({
      appName: SITE_NAME,
      appIconUrl: "/apple-touch-icon.png",
      assetUrl: `${LIB}/assets/img/`,
      maxModalDisplayCount: -1,
    });
    window.AddToHomeScreenInstance = instance;
    // Already installed and running as an app: no button.
    setReady(!instance.isStandAlone());
  }

  return (
    <>
      <link rel="stylesheet" href={`${LIB}/add-to-homescreen.min.css`} />
      <Script src={`${LIB}/add-to-homescreen_en.min.js`} strategy="afterInteractive" onReady={init} />
      {ready && (
        <button className="install" onClick={() => window.AddToHomeScreenInstance?.show("en")}>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth={2.2} aria-hidden>
            <path d="M12 4v11M7 10l5 5 5-5M5 20h14" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Install App
        </button>
      )}
    </>
  );
}
