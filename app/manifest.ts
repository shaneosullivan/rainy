import type { MetadataRoute } from "next";
import { DESCRIPTION, SITE_NAME, THEME_COLOR } from "./site";

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
    background_color: "#e5e7eb",
    theme_color: THEME_COLOR,
    categories: ["weather", "utilities"],
    lang: "en-IE",
    icons: [
      { src: "/icons/192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/512", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
