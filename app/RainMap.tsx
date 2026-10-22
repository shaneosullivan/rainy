"use client";
// Live rainfall radar and rainfall forecast from Met Éireann (CC BY 4.0) over
// OpenFreeMap tiles. Met Éireann's map API lists the recent radar frames (one
// every 5 minutes) and the forecast frames (hourly at first, out to about a
// week; only the next FORECAST_HOURS are shown), and serves each as
// transparent raster tiles. Both are
// CORS-enabled, so the browser uses them directly.

import { useCallback, useEffect, useRef, useState } from "react";
import type { Map as MapLibreMap, Marker } from "maplibre-gl";
import { FORECAST_PROTOCOL, loadForecastTile } from "./forecastTiles";
import { InstallButton } from "./InstallButton";
import { Legend } from "./Legend";
import {
  animateDrop,
  animateLeave,
  clearPin,
  createPinElement,
  isOnPin,
  loadPin,
  onLongPress,
  savePin,
  sizePin,
} from "./pin";

const MAPS_API = "https://gdal.met.ie/api/maps";
const MAP_STYLE = "https://tiles.openfreemap.org/styles/positron";
const IRELAND: [[number, number], [number, number]] = [
  [-10.6, 51.4],
  [-5.4, 55.4],
];
/** Padding around Ireland, leaving room below for the scrubber (taller on phones, see --scrubber-h) and Install App. */
function irelandPadding() {
  const phone = typeof window !== "undefined" && window.matchMedia(PHONE_QUERY).matches;
  return { top: 20, bottom: phone ? 156 : 130, left: 20, right: 20 };
}
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
  '<div class="built-by"><img src="/brand/chofter-mark.png" width="14" height="14" alt="" />' +
  'Built by <a href="https://apps.chofter.com" target="_blank" rel="noopener">Chofter Apps</a></div>' +
  '<div>Radar &amp; forecast © <a href="https://www.met.ie/" target="_blank" rel="noopener">Met Éireann</a></div>' +
  `<div>${BASEMAP_ATTRIBUTION}</div>`;
const RAIN_OPACITY = 0.75;
const FRAME_MS = 450;
const HOLD_MS = 1600; // pause on the last frame before looping back to the start
const LOAD_WAIT_MS = 3000; // max wait for the next frame's tiles before moving on
// Met Éireann publishes a radar frame every 5 minutes, 4-5 minutes after its
// timestamp, so each lands just before the next 5-minute mark. Refresh just
// after each mark, and retry a few times if the new frame isn't out yet.
const FRAME_INTERVAL_MS = 5 * 60 * 1000;
const AFTER_MARK_MS = 15 * 1000;
const RETRY_MS = 30 * 1000;
const MAX_RETRIES = 4;
// Focus and visibility events can fire often (and together); refetch on them at
// most this often. The API's responses are cacheable for 60s, so it can't be
// fresher anyway. Scheduled refreshes at each 5-minute mark aren't limited.
const MIN_REFRESH_GAP_MS = 60 * 1000;
const FETCH_TIMEOUT_MS = 15 * 1000;
// How far ahead the forecast goes (Met Éireann's runs to about a week).
const FORECAST_HOURS = 24;
// The pin hint shows for this long, then fades out (and collapses) over HINT_FADE_MS.
const HINT_MS = 5000;
const HINT_FADE_MS = 700;
// On phones the attribution shows for this long, then its text fades out (over
// ATTRIB_FADE_MS) and the legend takes its place.
const ATTRIB_SHOW_MS = 3000;
const ATTRIB_FADE_MS = 300;
const PHONE_QUERY = "(max-width: 600px)";
// Resolution of the scrubber's range input, which snaps to the nearest frame.
const SLIDER_STEPS = 1000;
// Load only the frame on screen until it's in (or this long), then the rest.
const PRIME_TIMEOUT_MS = 2000;

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
// The deepest zoom each layer has tiles for: forecast tiles are blank beyond
// zoom 9 (radar goes to 11). Past it, MapLibre upscales the deepest tiles.
const MAX_TILE_ZOOM: Record<Kind, number> = { radar: 10, forecast: 9 };

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

/**
 * Radar frames, then the forecast frames after the newest radar frame and
 * within FORECAST_HOURS of now. Either alone is fine.
 */
async function fetchFrames(): Promise<Array<Frame>> {
  const [radar, forecast] = await Promise.allSettled([fetchKind("radar"), fetchKind("forecast")]);
  const past = radar.status === "fulfilled" ? radar.value : [];
  const future = forecast.status === "fulfilled" ? forecast.value : [];
  if (radar.status === "rejected" && forecast.status === "rejected") {
    throw radar.reason;
  }
  const latest = past.at(-1)?.time ?? -Infinity;
  const horizon = Date.now() + FORECAST_HOURS * 60 * 60 * 1000;
  return [...past, ...future.filter((f) => f.time > latest && f.time <= horizon)];
}

const layerId = (f: Frame) => `frame-${f.id}`;

// Start downloading MapLibre (the biggest file) as soon as this module runs in
// the browser, rather than waiting for React to mount the map.
const maplibre = typeof window !== "undefined" ? import("maplibre-gl") : null;

/** Tile URL template for a frame (note Met Éireann's x/y/z order). */
function tileUrl(f: Frame): string {
  const url = `${MAPS_API}/${API_PATH[f.kind]}/${f.src}/{x}/{y}/{z}/${f.mod}`;
  return f.kind === "forecast" ? url.replace(/^https:/, `${FORECAST_PROTOCOL}:`) : url;
}

/** "15:40" today, "Tue 15:00" on other days. */
function fmtTime(t: number): string {
  const d = new Date(t);
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return d.toDateString() === new Date().toDateString() ? time : `${d.toLocaleDateString([], { weekday: "short" })} ${time}`;
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
  // The "Long press to drop a pin" hint: only for people without a pin, shown
  // briefly, then faded out ("out") and removed ("off").
  const [hint, setHint] = useState<"off" | "on" | "out">("off");
  const hideHint = useCallback(() => setHint((h) => (h === "on" ? "out" : h)), []);
  // Whether the compact (phone) attribution is expanded; on phones the legend
  // shows only while it isn't.
  const [attribOpen, setAttribOpen] = useState(true);

  // Create the map once.
  useEffect(() => {
    let map: MapLibreMap | null = null;
    let cancelled = false;
    let stopLongPress = () => {};
    let attribObserver: MutationObserver | null = null;
    let attribTimer = 0;
    (maplibre ?? import("maplibre-gl")).then((lib) => {
      if (cancelled || !containerRef.current) {
        return;
      }
      lib.addProtocol(FORECAST_PROTOCOL, loadForecastTile);
      const saved = loadView();
      map = new lib.Map({
        container: containerRef.current,
        style: MAP_STYLE,
        ...(saved
          ? { center: saved.center, zoom: saved.zoom }
          : { bounds: IRELAND, fitBoundsOptions: { padding: irelandPadding() } }),
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
      // Follow the attribution's open state (its "i" button and map drags
      // toggle it), and on phones fade its text out after a few seconds so
      // the legend can take its place.
      const attrib = map.getContainer().querySelector<HTMLElement>(".maplibregl-ctrl-attrib");
      if (attrib) {
        const sync = () => setAttribOpen(attrib.classList.contains("maplibregl-compact-show"));
        attribObserver = new MutationObserver(sync);
        attribObserver.observe(attrib, { attributes: true, attributeFilter: ["class"] });
        sync();
        attribTimer = window.setTimeout(() => {
          if (!window.matchMedia(PHONE_QUERY).matches || !attrib.classList.contains("maplibregl-compact-show")) {
            return;
          }
          attrib.classList.add("attrib-fading");
          attribTimer = window.setTimeout(() => {
            attrib.classList.remove("attrib-fading", "maplibregl-compact-show");
          }, ATTRIB_FADE_MS);
        }, ATTRIB_SHOW_MS);
      }
      // Missing rain tiles just leave gaps; don't log each one.
      map.on("error", (e) => {
        if (!(e as { sourceId?: string }).sourceId?.startsWith("frame-")) {
          console.warn("[map]", e.error?.message ?? e);
        }
      });
      // "Zoomed out" means at or below the zoom that fits Ireland in this viewport.
      const updateZoomedOut = () => {
        const fit = map?.cameraForBounds(IRELAND, { padding: irelandPadding() })?.zoom;
        if (map && fit != null) {
          setZoomedOut(map.getZoom() <= fit + 0.05);
        }
      };
      map.on("zoom", updateZoomedOut);
      map.on("resize", updateZoomedOut);

      // The user's pin: restored from last time, and dropped (replacing any
      // existing one) by a long press. Sized loosely by zoom so it's always
      // easy to see.
      let pin: Marker | null = null;
      const placePin = (lng: number, lat: number) => {
        const el = createPinElement(map?.getZoom() ?? 6);
        pin = new lib.Marker({ element: el, anchor: "bottom" }).setLngLat([lng, lat]).addTo(map as MapLibreMap);
        return el;
      };
      const savedPin = loadPin();
      if (savedPin) {
        placePin(savedPin.lng, savedPin.lat);
      }
      map.on("zoom", () => {
        const el = pin?.getElement();
        if (el && map) {
          sizePin(el, map.getZoom());
        }
      });
      stopLongPress = onLongPress(map, (lngLat, point) => {
        if (!map) {
          return;
        }
        hideHint();
        // A long press on the pin removes it.
        if (pin && isOnPin(pin.getElement(), map.getContainer(), point)) {
          const removed = pin;
          pin = null;
          animateLeave(removed.getElement(), () => removed.remove());
          clearPin();
          navigator.vibrate?.(15);
          return;
        }
        const old = pin;
        if (old) {
          animateLeave(old.getElement(), () => old.remove());
        }
        const el = placePin(lngLat.lng, lngLat.lat);
        // Fall from just above the top of the map to where it lands.
        animateDrop(el, map.project(lngLat).y + 80);
        savePin({ lng: lngLat.lng, lat: lngLat.lat });
        navigator.vibrate?.(15);
      });
      // Rain layers can go in as soon as the style is ready; no need to wait
      // for every basemap tile ("load").
      map.once("style.load", () => setMapReady(true));
      map.on("load", () => {
        updateZoomedOut();
        // Zooming dismisses the pin hint (only the user zooms after load).
        map?.on("zoomstart", hideHint);
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
      stopLongPress();
      attribObserver?.disconnect();
      window.clearTimeout(attribTimer);
      map?.remove();
      mapRef.current = null;
    };
  }, [hideHint]);

  // Show the pin hint if there's no saved pin; hide it after a few seconds,
  // and remove it once it has faded out.
  useEffect(() => {
    if (!loadPin()) {
      setHint("on");
    }
    const id = window.setTimeout(hideHint, HINT_MS);
    return () => window.clearTimeout(id);
  }, [hideHint]);
  useEffect(() => {
    if (hint !== "out") {
      return;
    }
    const id = window.setTimeout(() => setHint("off"), HINT_FADE_MS);
    return () => window.clearTimeout(id);
  }, [hint]);

  // The latest frames and selection, for the refresh below (which outlives renders).
  const framesRef = useRef(frames);
  framesRef.current = frames;
  const selectedRef = useRef(selectedId);
  selectedRef.current = selectedId;

  // Fetch the frame list now, just after each 5-minute mark (when Met Éireann
  // publishes), and whenever the page is focused, shown again or back online,
  // so a map left open never drifts out of date.
  useEffect(() => {
    let inFlight = false;
    let lastLoad = 0;
    let newestRadar = -Infinity; // time of the newest radar frame loaded
    let stopped = false;
    const load = async (force = false) => {
      if (inFlight || (!force && Date.now() - lastLoad < MIN_REFRESH_GAP_MS)) {
        return;
      }
      inFlight = true;
      lastLoad = Date.now();
      try {
        const next = await fetchFrames();
        if (stopped || next.length === 0) {
          return;
        }
        // If the newest radar frame ("now") was showing, move on to the new newest.
        const prevLatest = framesRef.current.findLast((f) => f.kind === "radar")?.id;
        const nextLatest = next.findLast((f) => f.kind === "radar")?.id;
        if (prevLatest && nextLatest && selectedRef.current === prevLatest) {
          setSelectedId(nextLatest);
        }
        newestRadar = next.findLast((f) => f.kind === "radar")?.time ?? newestRadar;
        setFrames(next);
        setError(false);
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
    // Just after each 5-minute mark, expecting the frame stamped 5 minutes
    // before it; retry every RETRY_MS until that frame is in (up to
    // MAX_RETRIES), then wait for the next mark. Hidden pages skip the fetch
    // (they refresh when shown again) but keep the schedule.
    let timer = 0;
    const scheduleMark = () => {
      const now = Date.now();
      const mark = Math.floor((now - AFTER_MARK_MS) / FRAME_INTERVAL_MS) * FRAME_INTERVAL_MS + FRAME_INTERVAL_MS;
      timer = window.setTimeout(() => tick(mark, 0), mark + AFTER_MARK_MS - now);
    };
    const tick = async (mark: number, retry: number) => {
      const visible = document.visibilityState === "visible";
      if (visible && newestRadar < mark - FRAME_INTERVAL_MS) {
        await load(true);
      }
      if (stopped) {
        return;
      }
      if (visible && newestRadar < mark - FRAME_INTERVAL_MS && retry < MAX_RETRIES) {
        timer = window.setTimeout(() => tick(mark, retry + 1), RETRY_MS);
      } else {
        scheduleMark();
      }
    };
    load(true);
    scheduleMark();
    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);
    window.addEventListener("pageshow", refresh); // includes back/forward cache restores
    document.addEventListener("visibilitychange", refresh);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("online", refresh);
      window.removeEventListener("pageshow", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);

  // Start on the first (oldest) frame, scrubber all the way left; if the shown
  // frame drops out of the list, fall back to that too.
  const latestRadar = frames.findLastIndex((f) => f.kind === "radar");
  const found = frames.findIndex((f) => f.id === selectedId);
  const index = Math.max(0, found);
  const current = frames[index];
  const last = frames.length - 1;

  // Until the frame on screen has loaded, load only it, so it isn't stuck in
  // MapLibre's tile queue behind every other frame (or for PRIME_TIMEOUT_MS at most).
  const [primed, setPrimed] = useState(false);
  const currentId = current ? layerId(current) : null;
  useEffect(() => {
    const map = mapRef.current;
    if (primed || !map || !mapReady || !currentId) {
      return;
    }
    // A tile event for it, with the source loaded: its tiles are actually in
    // (a source just added counts as "loaded" before it has requested any).
    const check = (e: { sourceId?: string; tile?: unknown; isSourceLoaded?: boolean }) => {
      if (e.sourceId === currentId && e.tile && e.isSourceLoaded) {
        setPrimed(true);
      }
    };
    map.on("sourcedata", check);
    const timer = window.setTimeout(() => setPrimed(true), PRIME_TIMEOUT_MS);
    return () => {
      map.off("sourcedata", check);
      window.clearTimeout(timer);
    };
  }, [primed, mapReady, currentId]);

  // One raster layer per frame, under the place labels so town names stay
  // readable, with only the current frame visible. Every frame (radar and
  // forecast) stays loaded, so scrubbing shows each one instantly. They're
  // added current frame first, then in playback order, so tiles load in the
  // order they'll be shown.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || frames.length === 0) {
      return;
    }
    const existing = new Set(frames.map(layerId));
    for (const layer of map.getStyle().layers ?? []) {
      if (layer.id.startsWith("frame-") && !existing.has(layer.id)) {
        map.removeLayer(layer.id);
        map.removeSource(layer.id);
      }
    }
    const order = primed ? frames.map((_, k) => frames[(index + k) % frames.length]) : [frames[index]];
    const beforeId = map.getStyle().layers?.find((l) => l.type === "symbol")?.id;
    for (const f of order) {
      const id = layerId(f);
      if (map.getLayer(id)) {
        continue;
      }
      map.addSource(id, {
        type: "raster",
        tiles: [tileUrl(f)],
        tileSize: 256,
        bounds: RAIN_BOUNDS,
        minzoom: 4,
        maxzoom: MAX_TILE_ZOOM[f.kind],
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
  }, [frames, index, mapReady, primed]);

  // Playback: straight through the past, now and the forecast, holding on the
  // last frame before looping back to the start. Waits (briefly) for the next
  // frame's tiles so it doesn't flash empty frames.
  useEffect(() => {
    if (!playing || last < 1) {
      return;
    }
    const next = index < last ? index + 1 : 0;
    let waited = 0;
    let timer = 0;
    const advance = () => {
      const map = mapRef.current;
      const id = layerId(frames[next]);
      // Not added yet (still loading the first frame) counts as not loaded.
      if (map && (!map.getSource(id) || !map.isSourceLoaded(id)) && waited < LOAD_WAIT_MS) {
        waited += 150;
        timer = window.setTimeout(advance, 150);
        return;
      }
      setSelectedId(frames[next].id);
    };
    timer = window.setTimeout(advance, index === last ? HOLD_MS : FRAME_MS);
    return () => window.clearTimeout(timer);
  }, [playing, index, last, frames]);

  // Where the scrubber track switches from radar to forecast (0-1), if it does.
  const radarCount = latestRadar + 1;
  const hasBoth = radarCount > 0 && radarCount < frames.length;
  // With both, the past and the forecast get half the track each, "now" (the
  // newest radar frame) in the middle, whatever their frame counts.
  const split = hasBoth ? 0.5 : radarCount > 0 ? 1 : 0;
  const forecastCount = frames.length - radarCount;
  /** Position (0-1) of frame i along the track. */
  const position = (i: number): number => {
    if (!hasBoth) {
      return frames.length > 1 ? i / (frames.length - 1) : 0;
    }
    return i < radarCount
      ? 0.5 * (radarCount > 1 ? i / (radarCount - 1) : 1)
      : 0.5 + (0.5 * (i - radarCount + 1)) / forecastCount;
  };
  /** The frame nearest a track position. */
  const nearestFrame = (p: number): number => {
    let best = 0;
    for (let i = 1; i < frames.length; i++) {
      if (Math.abs(position(i) - p) < Math.abs(position(best) - p)) {
        best = i;
      }
    }
    return best;
  };
  const seek = (i: number) => {
    setPlaying(false);
    setSelectedId(frames[Math.max(0, Math.min(frames.length - 1, i))].id);
  };

  // The time split at its first colon (fmtTime's output varies by locale), so
  // the colon can sit over the Now line on phones.
  const kindLabel = current?.kind === "forecast" ? "Forecast" : "Radar";
  const timeText = current ? fmtTime(current.time) : "";
  const colonAt = timeText.indexOf(":");
  const [timeBefore, timeColon, timeAfter] =
    colonAt >= 0 ? [timeText.slice(0, colonAt), ":", timeText.slice(colonAt + 1)] : [timeText, "", ""];

  return (
    <>
      <div ref={containerRef} className="map" />
      <Legend hidden={attribOpen} />
      <div className="above-scrubber">
        <InstallButton hidden={!zoomedOut} />
        {hint !== "off" && (
          <div className={hint === "out" ? "hint-wrap hint-out" : "hint-wrap"} role="status">
            <div className="hint-clip">
              <div className="hint">
                <span className="hint-icon">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src="/pin.png" alt="" />
                </span>
                Long press to drop a pin
              </div>
            </div>
          </div>
        )}
      </div>
      {frames.length === 0 && <div className="status">{error ? "Rain data unavailable right now" : "Loading radar…"}</div>}
      {current && (
        <div className="scrubber">
          <button onClick={() => setPlaying((p) => !p)} aria-label={playing ? "Pause" : "Play"}>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden>
              {playing ? <path d="M7 5h4v14H7zM13 5h4v14h-4z" /> : <path d="M8 5v14l11-7z" />}
            </svg>
          </button>
          {/* Layers: the coloured track, the "Now" marker, then the slider (transparent track) on top. */}
          <div className="track" style={{ "--split": split } as React.CSSProperties}>
            <div className="track-bar" />
            {hasBoth && (
              <>
                <span className="edge-label edge-past" aria-hidden>
                  Past
                </span>
                <span className="edge-label edge-future" aria-hidden>
                  Future
                </span>
              </>
            )}
            {hasBoth && (
              <>
                <div className="now-line" />
                <span className="now-label" aria-hidden>
                  Now
                </span>
              </>
            )}
            {/* A fine-grained range (frames aren't evenly spaced) that snaps to the
                nearest frame; keys step one frame at a time. */}
            <input
              type="range"
              min={0}
              max={SLIDER_STEPS}
              value={Math.round(position(index) * SLIDER_STEPS)}
              aria-label="Rain time"
              aria-valuetext={`${current.kind === "forecast" ? "Forecast" : "Radar"}, ${fmtTime(current.time)}`}
              onChange={(e) => seek(nearestFrame(Number(e.target.value) / SLIDER_STEPS))}
              onKeyDown={(e) => {
                const step: Record<string, number> = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1, PageDown: -6, PageUp: 6 };
                if (e.key in step) {
                  seek(index + step[e.key]);
                } else if (e.key === "Home") {
                  seek(0);
                } else if (e.key === "End") {
                  seek(frames.length - 1);
                } else {
                  return;
                }
                e.preventDefault();
              }}
            />
          </div>
          {/* Desktop: the kind above the time. Phones (see CSS): one row above the
              slider with the colon fixed over the Now line, "Radar" before the
              time and "Forecast" after it. */}
          <div className="when">
            <span className={`kind kind-top kind-${current.kind}`}>{kindLabel}</span>
            <time>
              <span className="time-before">
                {current.kind === "radar" && <span className="kind kind-inline kind-radar">{kindLabel}</span>}
                {timeBefore}
              </span>
              <span className="time-colon">{timeColon}</span>
              <span className="time-after">
                {timeAfter}
                {current.kind === "forecast" && <span className="kind kind-inline kind-forecast">{kindLabel}</span>}
              </span>
            </time>
          </div>
        </div>
      )}
    </>
  );
}
