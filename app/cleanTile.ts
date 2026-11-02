// Shared by the page (app/forecastTiles.ts) and the worker
// (app/coastline.worker.ts). It lives in its own file so the worker doesn't
// import forecastTiles.ts, which creates the worker: that loop makes
// Turbopack's production build hang.

import { removeCoastline } from "./coastline";

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
