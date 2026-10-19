// Met Éireann's forecast tiles have coastlines drawn in: a semi-transparent
// black line that's near-black over empty areas and darkens the rain it
// crosses. The basemap already has coastlines, so removeCoastline() finds the
// line's pixels and replaces each with the nearest clean rain pixel (so the
// rain has no gap where the line was), or makes it transparent if there's no
// rain nearby.

// Line cores are near-black; the darkest rain colours peak far higher.
const CORE_MAX_CHANNEL = 60;
// Rain colours all have a channel at 147 or above, except heavy rain's dark
// reds and purples (see isHeavyRain); anything darker is line blended over rain.
const DARK_MAX_CHANNEL = 150;
// A line pixel over rain is that rain's colour scaled by (1 - line alpha).
// Scaled by at most this much (and matching it within RESIDUAL) counts as line.
const MAX_DARKEN = 0.92;
const MIN_DARKEN = 0.05;
const RESIDUAL = 10;
const NEIGHBOUR_RADIUS = 2;
// How far to look for a clean rain pixel to fill a line pixel with.
const FILL_RADIUS = 4;

const isHeavyRain = (r: number, g: number) => r >= 100 && g < 60; // maroon / purple

/** Removes the coastline from RGBA tile pixels in place. */
export function removeCoastline(px: Uint8ClampedArray, w: number, h: number): void {
  const n = w * h;
  const src = new Uint8ClampedArray(px); // unmodified copy to read from
  const maxAt = (p: number) => Math.max(src[p * 4], src[p * 4 + 1], src[p * 4 + 2]);
  const line = new Uint8Array(n);

  // 1. Near-black cores, plus 1px around them (their soft edges), and any
  //    pixel too dark to be a rain colour.
  for (let p = 0; p < n; p++) {
    if (src[p * 4 + 3] === 0) {
      continue;
    }
    const max = maxAt(p);
    if (max < CORE_MAX_CHANNEL) {
      const x = p % w;
      const y = (p - x) / w;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < w && ny < h) {
            line[ny * w + nx] = 1;
          }
        }
      }
    } else if (max < DARK_MAX_CHANNEL && !isHeavyRain(src[p * 4], src[p * 4 + 1])) {
      line[p] = 1;
    }
  }

  // 2. Faint line over light rain: pixels that are an evenly darkened copy of
  //    an opaque neighbour. (A boundary between rain bands changes hue, not
  //    just brightness.) Only pixels darker than a direct neighbour can be.
  const faint: Array<number> = [];
  for (let p = 0; p < n; p++) {
    if (line[p] || src[p * 4 + 3] === 0) {
      continue;
    }
    const x = p % w;
    const y = (p - x) / w;
    const max = maxAt(p);
    const darkerThanNeighbour =
      (x > 0 && maxAt(p - 1) > max) ||
      (x < w - 1 && maxAt(p + 1) > max) ||
      (y > 0 && maxAt(p - w) > max) ||
      (y < h - 1 && maxAt(p + w) > max);
    if (!darkerThanNeighbour) {
      continue;
    }
    const [r, g, b] = [src[p * 4], src[p * 4 + 1], src[p * 4 + 2]];
    search: for (let dy = -NEIGHBOUR_RADIUS; dy <= NEIGHBOUR_RADIUS; dy++) {
      for (let dx = -NEIGHBOUR_RADIUS; dx <= NEIGHBOUR_RADIUS; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        const q = ny * w + nx;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h || q === p || line[q] || src[q * 4 + 3] !== 255) {
          continue;
        }
        const [cr, cg, cb] = [src[q * 4], src[q * 4 + 1], src[q * 4 + 2]];
        const cc = cr * cr + cg * cg + cb * cb;
        if (cc === 0) {
          continue;
        }
        const k = (r * cr + g * cg + b * cb) / cc;
        if (k < MIN_DARKEN || k > MAX_DARKEN) {
          continue;
        }
        if (Math.max(Math.abs(r - k * cr), Math.abs(g - k * cg), Math.abs(b - k * cb)) < RESIDUAL) {
          faint.push(p);
          break search;
        }
      }
    }
  }
  for (const p of faint) {
    line[p] = 1;
  }

  // 3. Fill each line pixel from the nearest clean, opaque rain pixel, or clear it.
  for (let p = 0; p < n; p++) {
    if (!line[p]) {
      continue;
    }
    const x = p % w;
    const y = (p - x) / w;
    let fill = -1;
    for (let r = 1; r <= FILL_RADIUS && fill < 0; r++) {
      for (let dy = -r; dy <= r && fill < 0; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          const q = ny * w + nx;
          if (nx >= 0 && ny >= 0 && nx < w && ny < h && !line[q] && src[q * 4 + 3] === 255) {
            fill = q;
            break;
          }
        }
      }
    }
    for (let c = 0; c < 4; c++) {
      px[p * 4 + c] = fill >= 0 ? src[fill * 4 + c] : 0;
    }
  }
}
