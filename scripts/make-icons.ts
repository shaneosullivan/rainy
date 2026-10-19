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
// Square around the artwork (Ireland + drop), as fractions of the source. The
// artwork spans roughly x 0.17-0.81, y 0.11-0.85; tiny icons crop to it so it
// stays legible.
const TIGHT_CENTER = [0.489, 0.477] as const;
const TIGHT_SIZE = 0.8;
const FAVICON_SIZES = [16, 32, 48];

const resized = (img: Sharp, px: number) => img.clone().resize(px, px, { kernel: "lanczos3" });

/** The source cropped to the square around the artwork. */
async function tight(img: Sharp): Promise<Sharp> {
  const { width = 0 } = await img.metadata();
  const size = Math.round(TIGHT_SIZE * width);
  const left = Math.round(TIGHT_CENTER[0] * width - size / 2);
  const top = Math.round(TIGHT_CENTER[1] * width - size / 2);
  return sharp(await img.clone().extract({ left, top, width: size, height: size }).toBuffer());
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
  const small = await tight(src);

  const outputs: Record<string, Sharp> = {
    "public/apple-touch-icon.png": resized(src, 180),
    "public/icons/icon-192.png": resized(src, 192),
    "public/icons/icon-512.png": resized(src, 512),
    "public/icons/maskable-512.png": await maskable(src, 512),
    "public/icons/favicon-192.png": resized(small, 192),
  };
  for (const [rel, img] of Object.entries(outputs)) {
    const file = path.join(ROOT, rel);
    await mkdir(path.dirname(file), { recursive: true });
    await img.png({ compressionLevel: 9 }).toFile(file);
    console.log(`wrote ${rel}`);
  }

  await Bun.write(path.join(ROOT, "public/favicon.ico"), await ico(small, FAVICON_SIZES));
  console.log("wrote public/favicon.ico");
}

await main();
