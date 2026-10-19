# rainy.ie

**Live rain radar for Ireland** — [rainy.ie](https://rainy.ie)

A deliberately tiny web app: a full-screen map of Ireland with Met Éireann's rainfall radar animated over it, and a scrubber to step through the last hour or so of rain.

- Live radar from [Met Éireann](https://www.met.ie/), a new frame every 5 minutes
- Play/pause and scrub through the recent frames
- Zoom and pan, limited to the area around Ireland
- Remembers where you were zoomed in for your next visit
- Installable as an app (PWA), with an "Install App" button that shows the right steps for your phone or browser
- Works offline for the page and basemap (the radar itself needs a connection)
- No API keys, no backend, no tracking

## How it works

Everything runs in the browser. There's no server-side data fetching.

- **Radar:** Met Éireann's map API at `https://gdal.met.ie/api/maps/radar` lists the recent radar frames. Each frame is served as transparent raster map tiles. Both are CORS-enabled, so the page fetches them directly. Every frame is added as a [MapLibre](https://maplibre.org/) raster layer, and only the current one is visible, so playback is smooth once the tiles have loaded. The frame list refreshes every 2.5 minutes and whenever the tab comes back into focus.
- **Basemap:** [OpenFreeMap](https://openfreemap.org/)'s free "positron" vector style. It needs no key, and its muted colours let the radar stand out.
- **Saved view:** the map's centre and zoom are saved to `localStorage` after each move and restored on the next visit.
- **PWA:** a web app manifest, icons generated from the logo, and a small service worker ([`public/sw.js`](public/sw.js)). The service worker uses network-first for pages, cache-first for build assets and basemap tiles, and never caches radar. It registers in production builds only.
- **Install button:** [philfung/add-to-homescreen](https://github.com/philfung/add-to-homescreen), loaded from jsDelivr in its English-only build.
- **SEO:** metadata, Open Graph/Twitter tags, a generated social preview image, `robots.txt`, `sitemap.xml` and schema.org `WebApplication` structured data.

## Project layout

```
app/
  RainMap.tsx          The map, radar layers, playback and scrubber
  InstallButton.tsx    "Install App" button (add-to-homescreen)
  ServiceWorker.tsx    Registers public/sw.js in production
  layout.tsx           Metadata, viewport, structured data
  page.tsx             The page (map + hidden heading for crawlers)
  site.ts              Site URL, name, description, colours
  assets/logo_source.jpg   The logo (4096×4096 source for every icon)
  opengraph-image.tsx      Social preview image, built from the logo
  manifest.ts, robots.ts, sitemap.ts
public/
  favicon.ico              Favicon (generated)
  apple-touch-icon.png     iOS home screen icon (generated)
  icons/                   PWA icons, a maskable one and a PNG favicon (generated)
  sw.js                    Service worker
scripts/
  make-icons.py            Generates the icons from the logo
```

### Icons

All icons come from `app/assets/logo_source.jpg`. After changing the logo, regenerate them (needs [Pillow](https://pillow.readthedocs.io/)):

```bash
python3 scripts/make-icons.py
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

- Radar data © [Met Éireann](https://www.met.ie/), licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). The map credits Met Éireann in its attribution control. Keep that credit if you reuse this.
- Basemap by [OpenFreeMap](https://openfreemap.org/) and [OpenMapTiles](https://openmaptiles.org/), with map data © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors.
- Install instructions UI by [add-to-homescreen](https://github.com/philfung/add-to-homescreen) (MIT).

rainy.ie is an independent project and is not affiliated with or endorsed by Met Éireann.

## Contributing

Issues and pull requests are welcome. The goal is to keep it small and simple, so please open an issue to discuss bigger features first.

## License

[MIT](LICENSE)
