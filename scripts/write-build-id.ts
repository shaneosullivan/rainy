// Write public/buildId.json with this build's timestamp. Runs before `next build`
// (see package.json). next.config.mjs bakes the same id into the app, which
// compares it with the deployed file to spot that it's out of date (see
// app/UpdateCheck.tsx).

import path from "node:path";

const ROOT = path.resolve(import.meta.dir, "..");
const builtAt = new Date();
const info = { buildId: String(builtAt.getTime()), builtAt: builtAt.toISOString() };

await Bun.write(path.join(ROOT, "public/buildId.json"), `${JSON.stringify(info, null, 2)}\n`);
console.log(`wrote public/buildId.json (${info.buildId}, ${info.builtAt})`);
