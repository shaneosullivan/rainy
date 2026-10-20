// Fetches and cleans forecast tiles off the main thread (see forecastTiles.ts):
// download, decode, remove the baked-in coastline, and send back an
// ImageBitmap that MapLibre can use directly.

import { cleanTile } from "./forecastTiles";

type Request = { id: number; url: string } | { id: number; abort: true };

const pending = new Map<number, AbortController>();

self.onmessage = async (e: MessageEvent<Request>) => {
  const msg = e.data;
  if ("abort" in msg) {
    pending.get(msg.id)?.abort();
    pending.delete(msg.id);
    return;
  }
  const abort = new AbortController();
  pending.set(msg.id, abort);
  try {
    const bitmap = await cleanTile(msg.url, abort.signal);
    (self as unknown as Worker).postMessage({ id: msg.id, bitmap }, [bitmap]);
  } catch (err) {
    (self as unknown as Worker).postMessage({ id: msg.id, error: String((err as Error)?.message ?? err) });
  } finally {
    pending.delete(msg.id);
  }
};
