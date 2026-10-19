import { iconResponse } from "../brand";

// Served at the conventional /apple-touch-icon.png, which iOS and the
// add-to-homescreen install guide both look for.
export const dynamic = "force-static";

export function GET() {
  return iconResponse(180);
}
