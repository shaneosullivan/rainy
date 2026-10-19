import { ImageResponse } from "next/og";
import { BRAND_COLOR } from "./site";

export const alt = "rainy.ie — live rain radar for Ireland";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          gap: 56,
          padding: "0 96px",
          color: "#fff",
          background: `linear-gradient(135deg, #0f172a 0%, ${BRAND_COLOR} 100%)`,
        }}
      >
        <svg width={260} height={260} viewBox="0 0 64 64">
          <path d="M20 38a9 9 0 0 1-.8-18A12 12 0 0 1 42.5 17 10.5 10.5 0 0 1 45 38Z" fill="#fff" />
          <path d="M24 44l-3 7M33 44l-3 7M42 44l-3 7" stroke="#bae6fd" strokeWidth={4} strokeLinecap="round" />
        </svg>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 112, fontWeight: 800, letterSpacing: -3 }}>rainy.ie</div>
          <div style={{ fontSize: 44, opacity: 0.85, marginTop: 8 }}>Live rain radar for Ireland</div>
          <div style={{ fontSize: 30, opacity: 0.65, marginTop: 24 }}>Updated every 5 minutes · Met Éireann data</div>
        </div>
      </div>
    ),
    size,
  );
}
