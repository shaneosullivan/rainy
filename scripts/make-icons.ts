// Generate the favicon, app icons and touch icon from app/assets/logo_source.jpg.
//
//   bun run icons
//
// Outputs are committed, so this only needs re-running when the logo changes.

import { mkdir } from "node:fs/promises";
import path from "node:path";
import sharp, { type Sharp } from "sharp";

const ROOT = path.resolve(import.meta.dir, "..");
const SOURCE = path.join(ROOT, "app/assets/logo_source.jpg");
// The logo's background blue at its edges, used to pad the maskable icon.
const EDGE_BLUE = { r: 1, g: 78, b: 160 };
const FAVICON_SIZES = [16, 32, 48];
// Resolution the sea is cut out at before favicons are downscaled from it.
const CUTOUT_PX = 1024;

const resized = (img: Sharp, px: number) => img.clone().resize(px, px, { kernel: "lanczos3" });

/** Sea blue: blue clearly above red and green. Ireland's white outline isn't. */
const isSea = (r: number, g: number, b: number) => b > 60 && b - r > 60 && b - g > 25;

/**
 * The artwork (Ireland + drop) with the sea made transparent, cropped square
 * to it so it fills small favicons. The sea is flood-filled from the image
 * edges, so the blue drop inside Ireland's white outline is untouched.
 */
async function cutout(img: Sharp): Promise<Sharp> {
  const n = CUTOUT_PX;
  const rgb = await resized(img, n).removeAlpha().raw().toBuffer();
  const sea = new Uint8Array(n * n);
  const stack: Array<number> = [];
  const visit = (i: number) => {
    if (!sea[i] && isSea(rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2])) {
      sea[i] = 1;
      stack.push(i);
    }
  };
  for (let k = 0; k < n; k++) {
    visit(k); // top row
    visit((n - 1) * n + k); // bottom row
    visit(k * n); // left column
    visit(k * n + n - 1); // right column
  }
  while (stack.length > 0) {
    const i = stack.pop() as number;
    const x = i % n;
    if (x > 0) visit(i - 1);
    if (x < n - 1) visit(i + 1);
    if (i >= n) visit(i - n);
    if (i < n * (n - 1)) visit(i + n);
  }

  // Square crop around what's left, with a sliver of margin.
  let [minX, minY, maxX, maxY] = [n, n, 0, 0];
  for (let i = 0; i < n * n; i++) {
    if (!sea[i]) {
      const x = i % n;
      const y = (i - x) / n;
      [minX, minY, maxX, maxY] = [Math.min(minX, x), Math.min(minY, y), Math.max(maxX, x), Math.max(maxY, y)];
    }
  }
  const side = Math.min(n, Math.ceil(Math.max(maxX - minX, maxY - minY) * 1.02) + 1);
  const left = Math.max(0, Math.min(n - side, Math.round((minX + maxX - side) / 2)));
  const top = Math.max(0, Math.min(n - side, Math.round((minY + maxY - side) / 2)));

  // Alpha from the sea mask, softened slightly so edges anti-alias.
  const alpha = await sharp(Buffer.from(sea.map((v) => (v ? 0 : 255))), { raw: { width: n, height: n, channels: 1 } })
    .blur(1)
    .extractChannel(0) // blur outputs sRGB; keep one channel
    .raw()
    .toBuffer();
  // Two steps: sharp would otherwise crop before joining the alpha channel.
  const rgba = await sharp(rgb, { raw: { width: n, height: n, channels: 3 } })
    .joinChannel(alpha, { raw: { width: n, height: n, channels: 1 } })
    .png()
    .toBuffer();
  return sharp(await sharp(rgba).extract({ left, top, width: side, height: side }).png().toBuffer());
}

/** The logo shrunk into the maskable safe zone, feathered into a padded background. */
async function maskable(img: Sharp, px: number, scale = 0.8): Promise<Sharp> {
  const inner = Math.round(px * scale);
  const feather = Math.round(inner * 0.06);
  // A white square inset by the feather width, blurred into a soft-edged alpha mask.
  const mask = await sharp(
    Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${inner}" height="${inner}">` +
        `<rect width="100%" height="100%" fill="black"/>` +
        `<rect x="${feather}" y="${feather}" width="${inner - 2 * feather}" height="${inner - 2 * feather}" fill="white"/>` +
        `</svg>`,
    ),
  )
    .blur(feather / 2)
    .extractChannel(0)
    .raw()
    .toBuffer();
  const logo = await resized(img, inner)
    .removeAlpha()
    .joinChannel(mask, { raw: { width: inner, height: inner, channels: 1 } })
    .png()
    .toBuffer();
  const offset = Math.floor((px - inner) / 2);
  return sharp({ create: { width: px, height: px, channels: 3, background: EDGE_BLUE } }).composite([
    { input: logo, left: offset, top: offset },
  ]);
}

/** An .ico holding one PNG per size (supported by every current browser). */
async function ico(img: Sharp, sizes: Array<number>): Promise<Buffer> {
  const pngs = await Promise.all(sizes.map((s) => resized(img, s).png().toBuffer()));
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(sizes.length, 4);
  let offset = 6 + 16 * sizes.length;
  const entries = sizes.map((s, i) => {
    const e = Buffer.alloc(16);
    e.writeUInt8(s % 256, 0); // width (0 means 256)
    e.writeUInt8(s % 256, 1); // height
    e.writeUInt16LE(1, 4); // colour planes
    e.writeUInt16LE(32, 6); // bits per pixel
    e.writeUInt32LE(pngs[i].length, 8);
    e.writeUInt32LE(offset, 12);
    offset += pngs[i].length;
    return e;
  });
  return Buffer.concat([header, ...entries, ...pngs]);
}

async function main() {
  const src = sharp(SOURCE).removeAlpha();
  const favicon = await cutout(src);

  const outputs: Record<string, Sharp> = {
    "public/apple-touch-icon.png": resized(src, 180),
    "public/icons/icon-192.png": resized(src, 192),
    "public/icons/icon-512.png": resized(src, 512),
    "public/icons/maskable-512.png": await maskable(src, 512),
    "public/icons/favicon-192.png": resized(favicon, 192),
  };
  for (const [rel, img] of Object.entries(outputs)) {
    const file = path.join(ROOT, rel);
    await mkdir(path.dirname(file), { recursive: true });
    await img.png({ compressionLevel: 9 }).toFile(file);
    console.log(`wrote ${rel}`);
  }

  await Bun.write(path.join(ROOT, "public/favicon.ico"), await ico(favicon, FAVICON_SIZES));
  console.log("wrote public/favicon.ico");
}

await main();
