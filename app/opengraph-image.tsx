import { readFile } from "node:fs/promises";
import path from "node:path";
import { ImageResponse } from "next/og";
import { BRAND_COLOR, BRAND_COLOR_DARK } from "./site";

export const alt = "rainy.ie — live rain radar for Ireland";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OpenGraphImage() {
  const logo = await readFile(path.join(process.cwd(), "public/icons/icon-512.png"));
  const logoSrc = `data:image/png;base64,${logo.toString("base64")}`;
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          gap: 64,
          padding: "0 88px",
          color: "#fff",
          background: `radial-gradient(circle at 25% 50%, ${BRAND_COLOR} 0%, ${BRAND_COLOR_DARK} 55%, #0f172a 100%)`,
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={logoSrc}
          width={420}
          height={420}
          alt=""
          style={{ borderRadius: 72, boxShadow: "0 24px 60px rgba(0, 0, 0, 0.35)" }}
        />
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 104, fontWeight: 800, letterSpacing: -3 }}>rainy.ie</div>
          <div style={{ fontSize: 44, opacity: 0.9, marginTop: 8 }}>Live rain radar for Ireland</div>
          <div style={{ fontSize: 28, opacity: 0.7, marginTop: 28 }}>Updated every 5 minutes · Met Éireann data</div>
        </div>
      </div>
    ),
    size,
  );
}
