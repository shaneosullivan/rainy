// Background download of every rain frame's tiles for the whole pannable area,
// at the tile zoom the map uses when zoomed out to all of Ireland. They land in
// the browser's HTTP cache (Met Éireann allows a day), so zooming out or panning
// later shows the rain straight away instead of downloading it then.

type Bounds = [[number, number], [number, number]]; // [[west, south], [east, north]]

// A few at a time, so the frame on screen is never stuck behind this.
const CONCURRENCY = 4;

const tileX = (lng: number, z: number) => Math.floor(((lng + 180) / 360) * 2 ** z);
function tileY(lat: number, z: number) {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
}

/**
 * The tile zoom MapLibre loads for a 256px raster source at a given map zoom
 * (its tiles are counted in 512px units, and raster sources round).
 */
export function rasterTileZoom(mapZoom: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(mapZoom + 1)));
}

/** Every tile URL covering `bounds` at zoom `z`, from a `{x}/{y}/{z}` template. */
export function tileUrls(template: string, bounds: Bounds, z: number): Array<string> {
  const [[west, south], [east, north]] = bounds;
  const urls: Array<string> = [];
  for (let x = tileX(west, z); x <= tileX(east, z); x++) {
    for (let y = tileY(north, z); y <= tileY(south, z); y++) {
      urls.push(template.replace("{x}", String(x)).replace("{y}", String(y)).replace("{z}", String(z)));
    }
  }
  return urls;
}

// URLs already downloaded this session.
const done = new Set<string>();

/**
 * Download each URL not already done, a few at a time, until all are done or
 * `signal` aborts (when the map moves; the rest resume on the next call).
 */
export async function prefetch(urls: Array<string>, signal: AbortSignal): Promise<void> {
  const queue = urls.filter((u) => !done.has(u));
  const worker = async () => {
    while (queue.length > 0 && !signal.aborted) {
      const url = queue.shift() as string;
      try {
        const res = await fetch(url, { signal, priority: "low" } as RequestInit);
        await res.arrayBuffer(); // read it all, so the whole tile is cached
        done.add(url);
      } catch {
        // Aborted, offline or missing: it'll load (or not) when it's shown.
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
}
