"use client";
// Live rainfall radar from Met Éireann (CC BY 4.0) over OpenFreeMap tiles.
// Met Éireann's API lists the recent radar frames (one every 5 minutes) and
// serves each as transparent raster tiles; both are CORS-enabled, so the
// browser uses them directly.

import { useEffect, useRef, useState } from "react";
import type { Map as MapLibreMap } from "maplibre-gl";

const RADAR_API = "https://gdal.met.ie/api/maps/radar";
const MAP_STYLE = "https://tiles.openfreemap.org/styles/positron";
const IRELAND: [[number, number], [number, number]] = [
  [-10.6, 51.4],
  [-5.4, 55.4],
];
// Panning is limited to a box around Ireland.
const MAX_BOUNDS: [[number, number], [number, number]] = [
  [-14, 49.5],
  [-2, 57.5],
];
// The extent of Met Éireann's radar composite; tiles outside it are empty.
const RADAR_BOUNDS: [number, number, number, number] = [-22.5, 48.93, 0, 61.6];
// One credit per line. MapLibre joins separate credits with " | " and drops any
// contained in another, so both lines go in one entry, with OpenFreeMap's own
// credit (from its tiles) verbatim so the map doesn't repeat it.
const BASEMAP_ATTRIBUTION =
  '<a href="https://openfreemap.org" target="_blank">OpenFreeMap</a> <a href="https://www.openmaptiles.org/" target="_blank">&copy; OpenMapTiles</a> Data from <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>';
const ATTRIBUTION =
  '<div>Radar © <a href="https://www.met.ie/" target="_blank" rel="noopener">Met Éireann</a></div>' +
  `<div>${BASEMAP_ATTRIBUTION}</div>`;
const RADAR_OPACITY = 0.75;
const FRAME_MS = 450;
const HOLD_MS = 1600; // pause on the newest frame before looping
const REFRESH_MS = 2.5 * 60 * 1000;

type Frame = { time: number; src: string; mod: number };

// The last map view (centre and zoom), so a return visit starts in the same place.
const VIEW_KEY = "rainy.view";
type View = { center: [number, number]; zoom: number };

function loadView(): View | null {
  try {
    const v = JSON.parse(localStorage.getItem(VIEW_KEY) ?? "null") as View | null;
    return v && Array.isArray(v.center) && v.center.every(Number.isFinite) && Number.isFinite(v.zoom) ? v : null;
  } catch {
    return null;
  }
}

function saveView(v: View) {
  try {
    localStorage.setItem(VIEW_KEY, JSON.stringify(v));
  } catch {
    // Storage unavailable (e.g. private mode): just don't remember.
  }
}

/** "202610191340" (UTC) -> ms since the epoch, or NaN if malformed. */
function parseSrc(src: string): number {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(src);
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) : NaN;
}

async function fetchFrames(): Promise<Array<Frame>> {
  const res = await fetch(RADAR_API);
  if (!res.ok) {
    throw new Error(`Radar request failed (${res.status})`);
  }
  type ApiFrame = { src?: string; modifiedTime?: number };
  const data = (await res.json()) as Array<ApiFrame | Array<ApiFrame>>;
  return data
    .map((entry) => (Array.isArray(entry) ? entry[0] : entry))
    .flatMap((f) => {
      const time = parseSrc(f?.src ?? "");
      return Number.isFinite(time) && Number.isFinite(f?.modifiedTime)
        ? [{ time, src: f.src as string, mod: f.modifiedTime as number }]
        : [];
    })
    .sort((a, b) => a.time - b.time);
}

const layerId = (f: Frame) => `radar-${f.src}`;
const fmtTime = (t: number) => new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

export function RainMap() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [frames, setFrames] = useState<Array<Frame>>([]);
  const [error, setError] = useState(false);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(true);

  // Create the map once.
  useEffect(() => {
    let map: MapLibreMap | null = null;
    let cancelled = false;
    import("maplibre-gl").then((lib) => {
      if (cancelled || !containerRef.current) {
        return;
      }
      const saved = loadView();
      map = new lib.Map({
        container: containerRef.current,
        style: MAP_STYLE,
        ...(saved
          ? { center: saved.center, zoom: saved.zoom }
          : { bounds: IRELAND, fitBoundsOptions: { padding: { top: 20, bottom: 90, left: 20, right: 20 } } }),
        maxBounds: MAX_BOUNDS,
        maxZoom: 10,
        dragRotate: false,
        pitchWithRotate: false,
        touchPitch: false,
        renderWorldCopies: false,
        attributionControl: false,
      });
      map.touchZoomRotate.disableRotation();
      map.keyboard.disableRotation();
      map.addControl(new lib.NavigationControl({ showCompass: false }), "top-right");
      map.addControl(new lib.AttributionControl({ compact: true, customAttribution: ATTRIBUTION }), "top-left");
      // Missing radar tiles just leave gaps; don't log each one.
      map.on("error", (e) => {
        if (!(e as { sourceId?: string }).sourceId?.startsWith("radar-")) {
          console.warn("[map]", e.error?.message ?? e);
        }
      });
      map.on("load", () => {
        setMapReady(true);
        // Remember every view after load: the only moves from then on are the user's.
        map?.on("moveend", () => {
          if (map) {
            const c = map.getCenter();
            saveView({ center: [c.lng, c.lat], zoom: map.getZoom() });
          }
        });
      });
      mapRef.current = map;
    });
    return () => {
      cancelled = true;
      map?.remove();
      mapRef.current = null;
    };
  }, []);

  // Fetch the frame list now, every few minutes, and when the tab is refocused.
  useEffect(() => {
    const load = () =>
      fetchFrames()
        .then((f) => {
          if (f.length > 0) {
            setFrames(f);
            setError(false);
          }
        })
        .catch(() => setError(true));
    load();
    const id = window.setInterval(load, REFRESH_MS);
    const onVisible = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  // One raster layer per frame (all loaded, only the current one visible),
  // under the place labels so town names stay readable.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) {
      return;
    }
    const wanted = new Set(frames.map(layerId));
    for (const layer of map.getStyle().layers ?? []) {
      if (layer.id.startsWith("radar-") && !wanted.has(layer.id)) {
        map.removeLayer(layer.id);
        map.removeSource(layer.id);
      }
    }
    const beforeId = map.getStyle().layers?.find((l) => l.type === "symbol")?.id;
    for (const f of frames) {
      const id = layerId(f);
      if (map.getLayer(id)) {
        continue;
      }
      map.addSource(id, {
        type: "raster",
        // Note Met Éireann's x/y/z order.
        tiles: [`${RADAR_API}/${f.src}/{x}/{y}/{z}/${f.mod}`],
        tileSize: 256,
        bounds: RADAR_BOUNDS,
        minzoom: 4,
        maxzoom: 10,
      });
      map.addLayer(
        {
          id,
          type: "raster",
          source: id,
          paint: { "raster-opacity": 0, "raster-opacity-transition": { duration: 200, delay: 0 }, "raster-fade-duration": 0 },
        },
        beforeId,
      );
    }
    setIndex((i) => (i === 0 ? frames.length - 1 : Math.min(i, frames.length - 1)));
  }, [frames, mapReady]);

  // Show only the current frame.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) {
      return;
    }
    frames.forEach((f, i) => {
      if (map.getLayer(layerId(f))) {
        map.setPaintProperty(layerId(f), "raster-opacity", i === index ? RADAR_OPACITY : 0);
      }
    });
  }, [frames, index, mapReady]);

  // Playback loop.
  useEffect(() => {
    if (!playing || frames.length < 2) {
      return;
    }
    const delay = index === frames.length - 1 ? HOLD_MS : FRAME_MS;
    const timer = window.setTimeout(() => setIndex((index + 1) % frames.length), delay);
    return () => window.clearTimeout(timer);
  }, [playing, index, frames]);

  const current = frames[index];

  return (
    <>
      <div ref={containerRef} className="map" />
      {frames.length === 0 && <div className="status">{error ? "Radar unavailable right now" : "Loading radar…"}</div>}
      {current && (
        <div className="scrubber">
          <button onClick={() => setPlaying((p) => !p)} aria-label={playing ? "Pause" : "Play"}>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden>
              {playing ? <path d="M7 5h4v14H7zM13 5h4v14h-4z" /> : <path d="M8 5v14l11-7z" />}
            </svg>
          </button>
          <input
            type="range"
            min={0}
            max={frames.length - 1}
            value={index}
            aria-label="Radar time"
            onChange={(e) => {
              setPlaying(false);
              setIndex(Number(e.target.value));
            }}
          />
          <time>{fmtTime(current.time)}</time>
        </div>
      )}
    </>
  );
}
