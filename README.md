# rainy.ie

**Live rain radar for Ireland** — [rainy.ie](https://rainy.ie)

A deliberately tiny web app: a full-screen map of Ireland with Met Éireann's rainfall radar and rain forecast animated over it, and a scrubber to step from the last hour of rain into the next 24 hours.

- Live radar from [Met Éireann](https://www.met.ie/), a new frame every 5 minutes
- Hourly rain forecast for the next 24 hours
- Play/pause and scrub from the past hour into the forecast; play runs straight through from the past into the forecast, then loops
- Zoom and pan, limited to the area around Ireland
- Remembers where you were zoomed in for your next visit
- A colour legend (mm/hr) matching Met Éireann's scale: vertical on the right on desktop; on phones a strip along the top that takes turns with the map credits
- Long press to drop a pin (with a drop-and-bounce animation); long press the pin to remove it. It's remembered, and sized to stay easy to see at every zoom
- Installable as an app (PWA), with an "Install App" button that shows the right steps for your phone or browser
- Works offline for the page and basemap (the rain data itself needs a connection)
- No API keys, no backend, and only privacy-friendly, cookie-free visit counts ([Simple Analytics](https://www.simpleanalytics.com/))

## How it works

Everything runs in the browser. There's no server-side data fetching.

- **Radar and forecast:** Met Éireann's map API lists the recent radar frames at `https://gdal.met.ie/api/maps/radar` and the rainfall forecast frames at `https://gdal.met.ie/api/maps/rainfall` (about a week of them; the app shows the next 24 hours). Each frame is served as transparent raster map tiles. Both are CORS-enabled, so the page fetches them directly. Frames are [MapLibre](https://maplibre.org/) raster layers with only the current one visible. Every frame, radar and forecast, is loaded up front and stays loaded, so scrubbing shows each one instantly. Met Éireann publishes a radar frame every 5 minutes, about 4½ minutes after its timestamp, so the frame lists refresh 15 seconds after each 5-minute mark, retrying every 30 seconds (up to 4 times) until that mark's frame is in. They also refresh whenever the page is focused, shown again or back online (at most once a minute), always revalidating rather than using the browser's cached copy. If you were on the newest radar frame, you move on to the new newest one.
- **Forecast coastlines:** the forecast tiles have coastlines drawn in, which would double up the basemap's. They load through a custom MapLibre protocol that removes them ([`app/coastline.ts`](app/coastline.ts)): it finds the line (near-black cores and their soft edges, colours too dark to be rain, and rain evenly darkened by the line) and fills each of its pixels from the nearest clean rain pixel, so the rain has no gap where the coast was. The clean-up runs in a small pool of web workers ([`app/forecastTiles.ts`](app/forecastTiles.ts), [`app/coastline.worker.ts`](app/coastline.worker.ts)) and hands MapLibre a ready `ImageBitmap`, so it never blocks the page.
- **Forecast zoom:** forecast tiles only have data up to zoom 9 (radar goes further), so beyond that MapLibre upscales the zoom-9 tiles rather than loading blank ones.
- **Basemap:** [OpenFreeMap](https://openfreemap.org/)'s free "positron" vector style. It needs no key, and its muted colours let the radar stand out.
- **Saved view:** the map's centre and zoom are saved to `localStorage` after each move and restored on the next visit.
- **PWA:** a web app manifest, icons generated from the logo, and a small service worker ([`public/sw.js`](public/sw.js)). The service worker uses network-first for pages, cache-first for build assets and basemap tiles, and never caches rain data. It registers in production builds only.
- **Never stuck on old assets:** each `bun run build` writes `public/buildId.json` with the build timestamp ([`scripts/write-build-id.ts`](scripts/write-build-id.ts)), and `next.config.mjs` bakes the same id into the app. Whenever the page loads or regains focus, [`app/UpdateCheck.tsx`](app/UpdateCheck.tsx) fetches `/buildId.json` with a cache-busting parameter; if it differs from the baked-in id, a newer build is live, so it deletes every cache, unregisters the service worker and reloads. It reloads at most once per new build, so a stale CDN can't cause a loop. The check is off in `next dev`.
- **Install button:** [philfung/add-to-homescreen](https://github.com/philfung/add-to-homescreen), loaded from jsDelivr in its English-only build.
- **SEO:** metadata, Open Graph/Twitter tags, a generated social preview image, `robots.txt`, `sitemap.xml` and schema.org `WebApplication` structured data.

## Project layout

```
app/
  RainMap.tsx          The map, radar layers, playback and scrubber
  InstallButton.tsx    "Install App" button (add-to-homescreen)
  ServiceWorker.tsx    Registers public/sw.js in production
  UpdateCheck.tsx      Reloads with fresh caches when a newer build is deployed
  coastline.ts         Removes the coastline drawn into forecast tiles
  Legend.tsx           The mm/hr colour legend (colours from met.ie's legend)
  pin.ts               The long-press pin: storage, sizing, animations, long-press detection
  assets/pin.png       Pin image (copied to public/pin.png)
  layout.tsx           Metadata, viewport, structured data
  page.tsx             The page (map + hidden heading for crawlers)
  site.ts              Site URL, name, description, colours
  assets/logo_source.jpg   The logo (4096×4096 source for every icon)
  opengraph-image.tsx      Social preview image, built from the logo
  manifest.ts, robots.ts, sitemap.ts
public/
  favicon.ico              Favicon, sea cut out to transparent (generated)
  apple-touch-icon.png     iOS home screen icon (generated)
  icons/                   PWA icons, a maskable one and a PNG favicon (generated)
  sw.js                    Service worker
  buildId.json             Build id, written on each build (not committed)
scripts/
  write-build-id.ts        Writes public/buildId.json (runs in bun run build)
  make-icons.ts            Generates the icons from the logo (bun run icons)
```

### Icons

All icons come from `app/assets/logo_source.jpg`. After changing the logo, regenerate them:

```bash
bun run icons
```

## Development

Requires [Bun](https://bun.sh/) (or use npm/pnpm with the same scripts).

```bash
bun install
bun run dev
```

Then open http://localhost:3000.

The service worker only runs in production builds. To try the PWA and offline behaviour locally:

```bash
bun run build && bun run start
```

## Deployment

It's a standard Next.js app, so it deploys anywhere Next.js runs (Vercel, Netlify, a Node server, etc.).

The canonical URL used in metadata, the sitemap and structured data defaults to `https://rainy.ie`. To serve it from somewhere else, set:

```bash
NEXT_PUBLIC_SITE_URL=https://your-domain.example
```

If you change the service worker's caching, bump `VERSION` in `public/sw.js` so returning visitors pick up the new caches.

## Data and attribution

- Radar and forecast data © [Met Éireann](https://www.met.ie/), licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). The map credits Met Éireann in its attribution control. Keep that credit if you reuse this.
- Basemap by [OpenFreeMap](https://openfreemap.org/) and [OpenMapTiles](https://openmaptiles.org/), with map data © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors.
- Install instructions UI by [add-to-homescreen](https://github.com/philfung/add-to-homescreen) (MIT).

rainy.ie is an independent project and is not affiliated with or endorsed by Met Éireann.

## Contributing

Issues and pull requests are welcome. The goal is to keep it small and simple, so please open an issue to discuss bigger features first.

## License

[MIT](LICENSE)
