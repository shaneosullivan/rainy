import type { Metadata, Viewport } from "next";
import "maplibre-gl/dist/maplibre-gl.css";
import "./globals.css";
import { ServiceWorker } from "./ServiceWorker";
import { UpdateCheck } from "./UpdateCheck";
import { DESCRIPTION, SITE_NAME, SITE_URL, THEME_COLOR, TITLE } from "./site";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: TITLE, template: `%s · ${SITE_NAME}` },
  description: DESCRIPTION,
  applicationName: SITE_NAME,
  keywords: [
    "rain radar Ireland",
    "Ireland weather radar",
    "live rain map",
    "Met Éireann radar",
    "rainfall radar",
    "is it going to rain",
    "Dublin rain radar",
    "Cork rain radar",
    "Galway rain radar",
    "weather Ireland",
  ],
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    url: "/",
    siteName: SITE_NAME,
    title: TITLE,
    description: DESCRIPTION,
    locale: "en_IE",
  },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
  robots: { index: true, follow: true, googleBot: { index: true, follow: true, "max-image-preview": "large" } },
  // "default" (opaque) status bar: with "black-translucent", iOS draws the
  // installed app under the status bar but keeps the page one status bar too
  // short, leaving an empty strip at the bottom of the screen.
  appleWebApp: { capable: true, title: SITE_NAME, statusBarStyle: "default" },
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "16x16 32x32 48x48" },
      { url: "/icons/favicon-192.png", type: "image/png", sizes: "192x192" },
    ],
    // ?v= busts browsers still caching the pre-logo icon at this URL.
    apple: { url: "/apple-touch-icon.png?v=2", sizes: "180x180" },
  },
  formatDetection: { telephone: false },
  category: "weather",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: THEME_COLOR,
};

// Structured data so search engines know this is a free weather web app.
const JSON_LD = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: SITE_NAME,
  url: SITE_URL,
  description: DESCRIPTION,
  applicationCategory: "WeatherApplication",
  operatingSystem: "Any",
  inLanguage: "en-IE",
  isAccessibleForFree: true,
  offers: { "@type": "Offer", price: "0", priceCurrency: "EUR" },
  areaServed: { "@type": "Country", name: "Ireland" },
  image: `${SITE_URL}/opengraph-image`,
};

// Vercel sets VERCEL_ENV to "production" only for builds of the live site.
const ANALYTICS = process.env.VERCEL_ENV === "production";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IE">
      <body>
        {children}
        <ServiceWorker />
        <UpdateCheck />
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }} />
        {/* SimpleAnalytics (privacy-friendly visit tracking), last in <body>.
            Only on the live site: not in dev, local builds or Vercel previews. */}
        {ANALYTICS && <script defer src="https://scripts.simpleanalyticscdn.com/latest.js" />}
        {/* Counts visits from browsers with JavaScript turned off. */}
        {ANALYTICS && (
          <noscript>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="https://queue.simpleanalyticscdn.com/noscript.gif"
              alt=""
              referrerPolicy="no-referrer-when-downgrade"
            />
          </noscript>
        )}
      </body>
    </html>
  );
}
