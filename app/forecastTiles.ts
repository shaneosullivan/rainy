// Forecast tiles have coastlines drawn in, which would double up the
// basemap's, so MapLibre loads them through a custom protocol that removes
// them (app/coastline.ts). The work runs in a small pool of workers so it
// doesn't hold up the page while scrubbing, and each cleaned tile goes back
// to MapLibre as an ImageBitmap (no PNG re-encode and re-decode).

import { removeCoastline } from "./coastline";

export const FORECAST_PROTOCOL = "metforecast";
const MAX_WORKERS = 4;

/** Download a forecast tile, remove its coastline, and return it as an ImageBitmap. */
export async function cleanTile(url: string, signal?: AbortSignal): Promise<ImageBitmap> {
  const res = await fetch(url, { signal });
  if (!res.ok) {
    throw new Error(`Forecast tile failed (${res.status})`);
  }
  const bitmap = await createImageBitmap(await res.blob());
  const { width, height } = bitmap;
  const canvas: OffscreenCanvas | HTMLCanvasElement =
    typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(width, height) : document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true }) as
    | OffscreenCanvasRenderingContext2D
    | CanvasRenderingContext2D
    | null;
  if (!ctx) {
    throw new Error("No 2D canvas");
  }
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const pixels = ctx.getImageData(0, 0, width, height);
  removeCoastline(pixels.data, width, height);
  ctx.putImageData(pixels, 0, 0);
  return createImageBitmap(canvas);
}

type Pending = { resolve: (b: ImageBitmap) => void; reject: (e: Error) => void };

let workers: Array<Worker> | null = null;
let nextWorker = 0;
let nextId = 0;
const pending = new Map<number, Pending>();

/** The worker pool, or null where workers or OffscreenCanvas aren't available (then the page does it). */
function pool(): Array<Worker> | null {
  if (workers) {
    return workers.length > 0 ? workers : null;
  }
  workers = [];
  if (typeof Worker === "undefined" || typeof OffscreenCanvas === "undefined") {
    return null;
  }
  const count = Math.max(1, Math.min(MAX_WORKERS, (navigator.hardwareConcurrency || 2) - 1));
  try {
    for (let i = 0; i < count; i++) {
      const w = new Worker(new URL("./coastline.worker.ts", import.meta.url));
      w.onmessage = (e: MessageEvent<{ id: number; bitmap?: ImageBitmap; error?: string }>) => {
        const p = pending.get(e.data.id);
        pending.delete(e.data.id);
        if (!p) {
          e.data.bitmap?.close();
        } else if (e.data.bitmap) {
          p.resolve(e.data.bitmap);
        } else {
          p.reject(new Error(e.data.error ?? "Forecast tile failed"));
        }
      };
      workers.push(w);
    }
  } catch {
    workers = [];
  }
  return workers.length > 0 ? workers : null;
}

/** MapLibre protocol handler: fetches a `metforecast://` tile and removes its coastline. */
export async function loadForecastTile(
  params: { url: string },
  abort: AbortController,
): Promise<{ data: ImageBitmap }> {
  const url = params.url.replace(`${FORECAST_PROTOCOL}:`, "https:");
  const ws = pool();
  if (!ws) {
    return { data: await cleanTile(url, abort.signal) };
  }
  const id = nextId++;
  const worker = ws[nextWorker++ % ws.length];
  const bitmap = await new Promise<ImageBitmap>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    abort.signal.addEventListener("abort", () => {
      pending.delete(id);
      worker.postMessage({ id, abort: true });
      reject(new DOMException("Aborted", "AbortError"));
    });
    worker.postMessage({ id, url });
  });
  return { data: bitmap };
}
