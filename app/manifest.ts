import type { MetadataRoute } from "next";
import { BRAND_COLOR_DARK, DESCRIPTION, SITE_NAME, THEME_COLOR } from "./site";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "rainy.ie — Live Rain Radar",
    short_name: SITE_NAME,
    description: DESCRIPTION,
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: BRAND_COLOR_DARK, // splash screen, behind the icon
    theme_color: THEME_COLOR,
    categories: ["weather", "utilities"],
    lang: "en-IE",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
