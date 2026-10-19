import { readFileSync } from "node:fs";

// The id scripts/write-build-id.ts wrote to public/buildId.json for this build,
// baked into the app so it can tell when a newer build has been deployed.
// "dev" when there's no file (e.g. `next dev`), which disables the check.
function readBuildId() {
  try {
    return JSON.parse(readFileSync(new URL("./public/buildId.json", import.meta.url), "utf8")).buildId ?? "dev";
  } catch {
    return "dev";
  }
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  env: { NEXT_PUBLIC_BUILD_ID: readBuildId() },
};

export default nextConfig;
