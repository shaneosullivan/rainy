// The user's pin: long press the map to drop it (one at a time; long press the
// pin itself to remove it), saved in localStorage, drawn at a size that tracks the zoom loosely (never to scale)
// so it's always easy to see.

import type { LngLat, Map as MapLibreMap, MapMouseEvent, MapTouchEvent } from "maplibre-gl";

const PIN_KEY = "rainy.pin";
const LONG_PRESS_MS = 500;
// A press that moves further than this (px) is a drag, not a long press.
const LONG_PRESS_SLOP = 10;
const DROP_MS = 750;
const LEAVE_MS = 180;

export type Pin = { lng: number; lat: number };

export function loadPin(): Pin | null {
  try {
    const p = JSON.parse(localStorage.getItem(PIN_KEY) ?? "null") as Pin | null;
    return p && Number.isFinite(p.lng) && Number.isFinite(p.lat) ? p : null;
  } catch {
    return null;
  }
}

export function savePin(p: Pin) {
  try {
    localStorage.setItem(PIN_KEY, JSON.stringify(p));
  } catch {
    // Storage unavailable (e.g. private mode): the pin just won't be remembered.
  }
}

export function clearPin() {
  try {
    localStorage.removeItem(PIN_KEY);
  } catch {
    // Nothing saved to clear.
  }
}

/** Whether a map point (px, relative to the map) is on the pin's element, give or take `slop` px. */
export function isOnPin(el: HTMLElement, mapEl: HTMLElement, point: { x: number; y: number }, slop = 8): boolean {
  const pin = el.getBoundingClientRect();
  const map = mapEl.getBoundingClientRect();
  const x = point.x + map.left;
  const y = point.y + map.top;
  return x >= pin.left - slop && x <= pin.right + slop && y >= pin.top - slop && y <= pin.bottom + slop;
}

/** Pin height (px) for a zoom: ~30px over all of Ireland, up to ~50px zoomed right in. */
export function pinHeight(zoom: number): number {
  return Math.round(Math.min(52, Math.max(28, 30 + (zoom - 6) * 5)));
}

/** The pin's DOM: the image (which drops and bounces) and its shadow. Anchor it at the bottom. */
export function createPinElement(zoom: number): HTMLElement {
  const el = document.createElement("div");
  el.className = "pin";
  el.style.setProperty("--pin-h", `${pinHeight(zoom)}px`);
  el.innerHTML = '<div class="pin-shadow"></div><img class="pin-body" src="/pin.png" alt="" draggable="false" />';
  return el;
}

export function sizePin(el: HTMLElement, zoom: number) {
  el.style.setProperty("--pin-h", `${pinHeight(zoom)}px`);
}

/** Drops the pin in from above the top of the map, `fallPx` above where it lands. */
export function animateDrop(el: HTMLElement, fallPx: number) {
  el.style.setProperty("--drop-from", `${-Math.round(fallPx)}px`);
  el.classList.add("pin-dropping");
  window.setTimeout(() => el.classList.remove("pin-dropping"), DROP_MS + 50);
}

/** Shrinks the pin away, then calls `done` (to remove it). */
export function animateLeave(el: HTMLElement, done: () => void) {
  el.classList.add("pin-leaving");
  window.setTimeout(done, LEAVE_MS);
}

/**
 * Calls `onPress` when the map is pressed and held (touch or mouse) without
 * moving. Moving, dragging, zooming or a second finger cancels it. Returns a
 * function that removes the listeners.
 */
export function onLongPress(
  map: MapLibreMap,
  onPress: (lngLat: LngLat, point: { x: number; y: number }) => void,
): () => void {
  let timer = 0;
  let start: { x: number; y: number } | null = null;

  const cancel = () => {
    window.clearTimeout(timer);
    start = null;
  };
  const begin = (e: MapMouseEvent | MapTouchEvent) => {
    const touches = (e.originalEvent as TouchEvent).touches;
    if ((touches && touches.length > 1) || (e.originalEvent as MouseEvent).button > 0) {
      cancel();
      return;
    }
    cancel();
    const point = { x: e.point.x, y: e.point.y };
    start = point;
    const lngLat = e.lngLat;
    timer = window.setTimeout(() => {
      start = null;
      onPress(lngLat, point);
    }, LONG_PRESS_MS);
  };
  const move = (e: MapMouseEvent | MapTouchEvent) => {
    if (start && Math.hypot(e.point.x - start.x, e.point.y - start.y) > LONG_PRESS_SLOP) {
      cancel();
    }
  };
  // A long press on a phone also opens the browser's context menu: don't.
  const noMenu = (e: Event) => e.preventDefault();

  map.on("mousedown", begin);
  map.on("touchstart", begin);
  map.on("mousemove", move);
  map.on("touchmove", move);
  for (const type of ["mouseup", "touchend", "touchcancel", "dragstart", "zoomstart"] as const) {
    map.on(type, cancel);
  }
  map.getCanvasContainer().addEventListener("contextmenu", noMenu);
  return () => {
    cancel();
    map.off("mousedown", begin);
    map.off("touchstart", begin);
    map.off("mousemove", move);
    map.off("touchmove", move);
    for (const type of ["mouseup", "touchend", "touchcancel", "dragstart", "zoomstart"] as const) {
      map.off(type, cancel);
    }
    map.getCanvasContainer().removeEventListener("contextmenu", noMenu);
  };
}
