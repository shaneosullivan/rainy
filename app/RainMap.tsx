"use client";
// Live rainfall radar and rainfall forecast from Met Éireann (CC BY 4.0) over
// OpenFreeMap tiles. Met Éireann's map API lists the recent radar frames (one
// every 5 minutes) and the forecast frames (hourly, then 3- and 6-hourly, out
// to about a week), and serves each as transparent raster tiles. Both are
// CORS-enabled, so the browser uses them directly.

import { useEffect, useRef, useState } from "react";
import type { Map as MapLibreMap } from "maplibre-gl";
import { InstallButton } from "./InstallButton";

const MAPS_API = "https://gdal.met.ie/api/maps";
const MAP_STYLE = "https://tiles.openfreemap.org/styles/positron";
const IRELAND: [[number, number], [number, number]] = [
  [-10.6, 51.4],
  [-5.4, 55.4],
];
// Room for the scrubber and Install App button below Ireland.
const IRELAND_PADDING = { top: 20, bottom: 130, left: 20, right: 20 };
// Panning is limited to a box around Ireland.
const MAX_BOUNDS: [[number, number], [number, number]] = [
  [-14, 49.5],
  [-2, 57.5],
];
// The extent of Met Éireann's radar composite; tiles outside it are empty.
const RAIN_BOUNDS: [number, number, number, number] = [-22.5, 48.93, 0, 61.6];
// One credit per line. MapLibre joins separate credits with " | " and drops any
// contained in another, so both lines go in one entry, with OpenFreeMap's own
// credit (from its tiles) verbatim so the map doesn't repeat it.
const BASEMAP_ATTRIBUTION =
  '<a href="https://openfreemap.org" target="_blank">OpenFreeMap</a> <a href="https://www.openmaptiles.org/" target="_blank">&copy; OpenMapTiles</a> Data from <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>';
const ATTRIBUTION =
  '<div>Radar &amp; forecast © <a href="https://www.met.ie/" target="_blank" rel="noopener">Met Éireann</a></div>' +
  `<div>${BASEMAP_ATTRIBUTION}</div>`;
const RAIN_OPACITY = 0.75;
const FRAME_MS = 450;
const HOLD_MS = 1600; // pause on the last frame of the radar or forecast before looping
const LOAD_WAIT_MS = 3000; // max wait for the next frame's tiles before moving on
const REFRESH_MS = 2.5 * 60 * 1000;
// Focus and visibility events often fire together; don't refetch more often than this.
const MIN_REFRESH_GAP_MS = 10 * 1000;
const FETCH_TIMEOUT_MS = 15 * 1000;
// Forecast frames are only loaded near the scrubber position (radar frames all
// stay loaded): this many behind and ahead.
const FORECAST_BEHIND = 2;
const FORECAST_AHEAD = 4;

type Kind = "radar" | "forecast";
type Frame = { id: string; kind: Kind; time: number; src: string; mod: number };

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

const API_PATH: Record<Kind, string> = { radar: "radar", forecast: "rainfall" };

async function fetchKind(kind: Kind): Promise<Array<Frame>> {
  // no-cache: revalidate rather than reuse the browser's copy (the API allows 60s).
  // The timeout stops a hung request from blocking later refreshes.
  const res = await fetch(`${MAPS_API}/${API_PATH[kind]}`, {
    cache: "no-cache",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`${kind} request failed (${res.status})`);
  }
  type ApiFrame = { src?: string; modifiedTime?: number };
  const data = (await res.json()) as Array<ApiFrame | Array<ApiFrame>>;
  return data
    .map((entry) => (Array.isArray(entry) ? entry[0] : entry))
    .flatMap((f) => {
      const time = parseSrc(f?.src ?? "");
      return Number.isFinite(time) && Number.isFinite(f?.modifiedTime)
        ? [{ id: `${kind}-${f.src}`, kind, time, src: f.src as string, mod: f.modifiedTime as number }]
        : [];
    })
    .sort((a, b) => a.time - b.time);
}

/** Radar frames, then the forecast frames after the newest radar frame. Either alone is fine. */
async function fetchFrames(): Promise<Array<Frame>> {
  const [radar, forecast] = await Promise.allSettled([fetchKind("radar"), fetchKind("forecast")]);
  const past = radar.status === "fulfilled" ? radar.value : [];
  const future = forecast.status === "fulfilled" ? forecast.value : [];
  if (radar.status === "rejected" && forecast.status === "rejected") {
    throw radar.reason;
  }
  const latest = past.at(-1)?.time ?? -Infinity;
  return [...past, ...future.filter((f) => f.time > latest)];
}

const layerId = (f: Frame) => `frame-${f.id}`;

// Forecast tiles have coastlines drawn in, which would double up the basemap's,
// so they load through this protocol, which strips them (see stripCoastlines).
const FORECAST_PROTOCOL = "metforecast";
// Coastline pixels are near-black; the darkest rain colour (maroon) peaks at 128.
const COASTLINE_MAX_CHANNEL = 60;

/** Tile URL template for a frame (note Met Éireann's x/y/z order). */
function tileUrl(f: Frame): string {
  const url = `${MAPS_API}/${API_PATH[f.kind]}/${f.src}/{x}/{y}/{z}/${f.mod}`;
  return f.kind === "forecast" ? url.replace(/^https:/, `${FORECAST_PROTOCOL}:`) : url;
}

/** Fetches a forecast tile and makes its near-black coastline pixels transparent. */
async function stripCoastlines(
  params: { url: string },
  abort: AbortController,
): Promise<{ data: ArrayBuffer }> {
  const res = await fetch(params.url.replace(`${FORECAST_PROTOCOL}:`, "https:"), { signal: abort.signal });
  if (!res.ok) {
    throw new Error(`Forecast tile failed (${res.status})`);
  }
  const bitmap = await createImageBitmap(await res.blob());
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    throw new Error("No 2D canvas");
  }
  ctx.drawImage(bitmap, 0, 0);
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = pixels.data;
  for (let i = 0; i < d.length; i += 4) {
    if (Math.max(d[i], d[i + 1], d[i + 2]) < COASTLINE_MAX_CHANNEL) {
      d[i + 3] = 0;
    }
  }
  ctx.putImageData(pixels, 0, 0);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) {
    throw new Error("Tile encode failed");
  }
  return { data: await blob.arrayBuffer() };
}

/** "15:40" today, "Tue 15:00" on other days. */
function fmtTime(t: number): string {
  const d = new Date(t);
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return d.toDateString() === new Date().toDateString() ? time : `${d.toLocaleDateString([], { weekday: "short" })} ${time}`;
}

/** The [first, last] index of the frames of the same kind as frames[i]. */
function section(frames: Array<Frame>, i: number): [number, number] {
  const kind = frames[i]?.kind;
  const first = frames.findIndex((f) => f.kind === kind);
  return [first, first + frames.filter((f) => f.kind === kind).length - 1];
}

export function RainMap() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [frames, setFrames] = useState<Array<Frame>>([]);
  const [error, setError] = useState(false);
  // The shown frame, by id so it survives the frame list refreshing.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [playing, setPlaying] = useState(true);
  // Whether the whole of Ireland is in view (the starting zoom, or further out).
  const [zoomedOut, setZoomedOut] = useState(true);

  // Create the map once.
  useEffect(() => {
    let map: MapLibreMap | null = null;
    let cancelled = false;
    import("maplibre-gl").then((lib) => {
      if (cancelled || !containerRef.current) {
        return;
      }
      lib.addProtocol(FORECAST_PROTOCOL, stripCoastlines);
      const saved = loadView();
      map = new lib.Map({
        container: containerRef.current,
        style: MAP_STYLE,
        ...(saved
          ? { center: saved.center, zoom: saved.zoom }
          : { bounds: IRELAND, fitBoundsOptions: { padding: IRELAND_PADDING } }),
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
      // Missing rain tiles just leave gaps; don't log each one.
      map.on("error", (e) => {
        if (!(e as { sourceId?: string }).sourceId?.startsWith("frame-")) {
          console.warn("[map]", e.error?.message ?? e);
        }
      });
      // "Zoomed out" means at or below the zoom that fits Ireland in this viewport.
      const updateZoomedOut = () => {
        const fit = map?.cameraForBounds(IRELAND, { padding: IRELAND_PADDING })?.zoom;
        if (map && fit != null) {
          setZoomedOut(map.getZoom() <= fit + 0.05);
        }
      };
      map.on("zoom", updateZoomedOut);
      map.on("resize", updateZoomedOut);
      map.on("load", () => {
        setMapReady(true);
        updateZoomedOut();
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

  // The latest frames and selection, for the refresh below (which outlives renders).
  const framesRef = useRef(frames);
  framesRef.current = frames;
  const selectedRef = useRef(selectedId);
  selectedRef.current = selectedId;

  // Fetch the frame list now, every few minutes while visible, and whenever the
  // page is focused, shown again or back online, so it never drifts out of date.
  useEffect(() => {
    let inFlight = false;
    let lastLoad = 0;
    const load = async (force = false) => {
      if (inFlight || (!force && Date.now() - lastLoad < MIN_REFRESH_GAP_MS)) {
        return;
      }
      inFlight = true;
      lastLoad = Date.now();
      try {
        const next = await fetchFrames();
        if (next.length > 0) {
          // If the newest radar frame ("now") was showing, move on to the new newest.
          const prev = framesRef.current;
          const prevLatest = prev.findLast((f) => f.kind === "radar")?.id;
          if (prevLatest && selectedRef.current === prevLatest) {
            setSelectedId(null);
          }
          setFrames(next);
          setError(false);
        }
      } catch {
        setError(true);
      } finally {
        inFlight = false;
      }
    };
    const refresh = () => {
      if (document.visibilityState === "visible") {
        load();
      }
    };
    load(true);
    const id = window.setInterval(refresh, REFRESH_MS);
    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);
    window.addEventListener("pageshow", refresh); // includes back/forward cache restores
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("online", refresh);
      window.removeEventListener("pageshow", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);

  // Start on the newest radar frame (now); if the shown frame drops out of the
  // list, fall back to that too.
  const latestRadar = frames.findLastIndex((f) => f.kind === "radar");
  const found = frames.findIndex((f) => f.id === selectedId);
  const index = found >= 0 ? found : Math.max(0, latestRadar);
  const current = frames[index];
  const [first, last] = section(frames, index);

  // One raster layer per loaded frame, under the place labels so town names
  // stay readable, with only the current frame visible. All radar frames stay
  // loaded; forecast frames only near the current one (and the forecast's
  // first frame, which playback loops back to).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) {
      return;
    }
    const wanted = new Set(
      frames
        .filter(
          (f, i) =>
            f.kind === "radar" || i === first || (i >= index - FORECAST_BEHIND && i <= index + FORECAST_AHEAD),
        )
        .map(layerId),
    );
    for (const layer of map.getStyle().layers ?? []) {
      if (layer.id.startsWith("frame-") && !wanted.has(layer.id)) {
        map.removeLayer(layer.id);
        map.removeSource(layer.id);
      }
    }
    const beforeId = map.getStyle().layers?.find((l) => l.type === "symbol")?.id;
    for (const f of frames) {
      const id = layerId(f);
      if (!wanted.has(id) || map.getLayer(id)) {
        continue;
      }
      map.addSource(id, {
        type: "raster",
        tiles: [tileUrl(f)],
        tileSize: 256,
        bounds: RAIN_BOUNDS,
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
    frames.forEach((f, i) => {
      if (map.getLayer(layerId(f))) {
        map.setPaintProperty(layerId(f), "raster-opacity", i === index ? RAIN_OPACITY : 0);
      }
    });
  }, [frames, index, first, mapReady]);

  // Playback: loop through the radar or the forecast, whichever is showing,
  // holding on its last frame. Waits (briefly) for the next frame's tiles so
  // it doesn't flash empty frames.
  useEffect(() => {
    if (!playing || last - first < 1) {
      return;
    }
    const next = index < last ? index + 1 : first;
    let waited = 0;
    let timer = 0;
    const advance = () => {
      const map = mapRef.current;
      const id = layerId(frames[next]);
      if (map?.getSource(id) && !map.isSourceLoaded(id) && waited < LOAD_WAIT_MS) {
        waited += 150;
        timer = window.setTimeout(advance, 150);
        return;
      }
      setSelectedId(frames[next].id);
    };
    timer = window.setTimeout(advance, index === last ? HOLD_MS : FRAME_MS);
    return () => window.clearTimeout(timer);
  }, [playing, index, first, last, frames]);

  // Where the scrubber track switches from radar to forecast (0-1), if it does.
  const radarCount = latestRadar + 1;
  const split =
    radarCount > 0 && radarCount < frames.length ? (radarCount - 0.5) / (frames.length - 1) : radarCount > 0 ? 1 : 0;

  return (
    <>
      <div ref={containerRef} className="map" />
      <InstallButton hidden={!zoomedOut} />
      {frames.length === 0 && <div className="status">{error ? "Rain data unavailable right now" : "Loading radar…"}</div>}
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
            aria-label="Rain time"
            aria-valuetext={`${current.kind === "forecast" ? "Forecast" : "Radar"}, ${fmtTime(current.time)}`}
            style={{ "--split": split } as React.CSSProperties}
            onChange={(e) => {
              setPlaying(false);
              setSelectedId(frames[Number(e.target.value)].id);
            }}
          />
          <div className="when">
            <span className={`kind kind-${current.kind}`}>{current.kind === "forecast" ? "Forecast" : "Radar"}</span>
            <time>{fmtTime(current.time)}</time>
          </div>
        </div>
      )}
    </>
  );
}
