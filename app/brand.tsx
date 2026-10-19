import { ImageResponse } from "next/og";
import { BRAND_COLOR } from "./site";

/**
 * The app icon (a cloud with rain) as a PNG. `inset` shrinks the artwork for
 * maskable icons, which platforms crop to a circle or squircle.
 */
export function iconResponse(size: number, { inset = 0, rounded = false } = {}) {
  const art = size * (1 - inset * 2);
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: BRAND_COLOR,
          borderRadius: rounded ? size * 0.22 : 0,
        }}
      >
        <svg width={art} height={art} viewBox="0 0 64 64">
          <path d="M20 38a9 9 0 0 1-.8-18A12 12 0 0 1 42.5 17 10.5 10.5 0 0 1 45 38Z" fill="#fff" />
          <path d="M24 44l-3 7M33 44l-3 7M42 44l-3 7" stroke="#bae6fd" strokeWidth={4} strokeLinecap="round" />
        </svg>
      </div>
    ),
    { width: size, height: size },
  );
}
