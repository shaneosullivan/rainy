import { iconResponse } from "../../brand";

// PWA icons: /icons/192, /icons/512 and the padded /icons/maskable.
const ICONS: Record<string, { px: number; inset: number }> = {
  "192": { px: 192, inset: 0.1 },
  "512": { px: 512, inset: 0.1 },
  maskable: { px: 512, inset: 0.2 },
};

export const dynamic = "force-static";

export function generateStaticParams() {
  return Object.keys(ICONS).map((size) => ({ size }));
}

export function GET(_req: Request, { params }: { params: { size: string } }) {
  const icon = ICONS[params.size];
  if (!icon) {
    return new Response("Not found", { status: 404 });
  }
  return iconResponse(icon.px, { inset: icon.inset });
}
