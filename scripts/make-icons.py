"""Generate the favicon, app icons and touch icon from app/assets/logo_source.jpg.

    python3 scripts/make-icons.py

Needs Pillow (pip install pillow). Outputs are committed, so this only needs
re-running when the logo changes.
"""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "app/assets/logo_source.jpg"
# The logo's background blue at its edges, used to pad the maskable icon.
EDGE_BLUE = (1, 78, 160)
# Square around the artwork (Ireland + drop), as fractions of the source. The
# artwork spans roughly x 0.17-0.81, y 0.11-0.85; tiny icons crop to it so it
# stays legible.
TIGHT_CENTER = (0.489, 0.477)
TIGHT_SIZE = 0.80


def resized(im: Image.Image, px: int) -> Image.Image:
    return im.resize((px, px), Image.Resampling.LANCZOS)


def tight(im: Image.Image) -> Image.Image:
    w = im.width
    half = TIGHT_SIZE * w / 2
    cx, cy = TIGHT_CENTER[0] * w, TIGHT_CENTER[1] * w
    return im.crop((round(cx - half), round(cy - half), round(cx + half), round(cy + half)))


def maskable(im: Image.Image, px: int, scale: float = 0.8) -> Image.Image:
    """The logo shrunk into the maskable safe zone, feathered into a padded background."""
    inner = round(px * scale)
    logo = resized(im, inner)
    feather = round(inner * 0.06)
    mask = Image.new("L", (inner, inner), 0)
    ImageDraw.Draw(mask).rectangle((feather, feather, inner - feather, inner - feather), fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(feather / 2))
    out = Image.new("RGB", (px, px), EDGE_BLUE)
    offset = (px - inner) // 2
    out.paste(logo, (offset, offset), mask)
    return out


def main() -> None:
    src = Image.open(SOURCE).convert("RGB")
    small = tight(src)

    outputs = {
        "public/apple-touch-icon.png": resized(src, 180),
        "public/icons/icon-192.png": resized(src, 192),
        "public/icons/icon-512.png": resized(src, 512),
        "public/icons/maskable-512.png": maskable(src, 512),
        "public/icons/favicon-192.png": resized(small, 192),
    }
    for rel, img in outputs.items():
        path = ROOT / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        img.save(path, optimize=True)
        print(f"wrote {rel}")

    resized(small, 256).save(ROOT / "public/favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)])
    print("wrote public/favicon.ico")


if __name__ == "__main__":
    main()
