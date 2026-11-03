# /// script
# requires-python = ">=3.11"
# dependencies = ["pillow==11.3.0"]
# ///
"""
Renders the Windows app icons from the macOS app icon source (clients/apple/AppIcon.icon):
the white umbrel.svg glyph on Umbrel's purple, as a plated icon on Windows' icon grid. Also
converts the images the Windows app shares with the macOS app from the macOS resources, so
they are never converted by hand.

Run on a Mac from clients/windows:  uv run scripts/generate-icons.py
Needs rsvg-convert (brew install librsvg) to rasterize the SVGs.

Sizes and file names follow Microsoft's "Construct your Windows app's icon" guidance:
Win32 .ico frames, the Square44x44Logo target sizes with the unplated light and dark
variants (without them Windows shrinks the icon onto a system plate), and 100/200/400%
scales for the manifest logos. package-msix.ps1 indexes them with makepri.
"""

import io
import shutil
import subprocess
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
GLYPH_SVG = ROOT.parent / "apple" / "AppIcon.icon" / "Assets" / "umbrel.svg"
ASSETS = ROOT / "Umbrel" / "Assets"
MAC_RESOURCES = ROOT.parent / "apple" / "macos" / "Sources" / "Umbrel" / "Resources"

# Shared with the macOS app, as PNGs: WPF can't load SVG, and loads WebP only through an
# optional Windows codec. SVG widths are in pixels, sharp at 400% at the sizes shown.
SHARED = {
    "tailscale.svg": 128,
    "system-pi.svg": 256,
    "system-generic-device.svg": 256,
    "folder.webp": None,
    "system-asus-nuc-14-essential.webp": None,
    "system-asus-nuc-16-pro.webp": None,
    "system-asus-rog-nuc-16.webp": None,
    "umbrel-home.webp": None,
    "umbrel-logo.webp": None,
    "umbrel-pro.webp": None,
    "status-connected.png": None,
    "status-disconnected.png": None,
}

MASTER = 1024
# Microsoft's 48 px icon grid: a square shape sits on the 42 px keyline with a 2 px
# exterior corner radius.
PLATE = round(MASTER * 42 / 48)
RADIUS = round(MASTER * 2 / 48)
# The macOS icon's colours and glyph placement, measured from its rendered icon.
TOP_LEFT = (124, 123, 255)
BOTTOM_RIGHT = (82, 81, 235)
GLYPH_WIDTH = 0.729  # of the plate
GLYPH_CENTER_Y = 0.468  # of the plate, from its top

TARGET_SIZES = [16, 20, 24, 30, 32, 36, 40, 48, 60, 64, 72, 80, 96, 256]
ICO_SIZES = [16, 20, 24, 32, 40, 48, 64, 256]


def gradient(size):
    # Windows icons use a 120 degree gradient, lighter at the top left.
    image = Image.new("RGB", (size, size))
    pixels = image.load()
    # Direction of 120 degrees in design tools: right and slightly down.
    dx, dy = 0.866, 0.5
    span = size * (dx + dy)
    for y in range(size):
        for x in range(size):
            t = (x * dx + y * dy) / span
            pixels[x, y] = tuple(round(a + (b - a) * t) for a, b in zip(TOP_LEFT, BOTTOM_RIGHT))
    return image


def master():
    canvas = Image.new("RGBA", (MASTER, MASTER), (0, 0, 0, 0))
    offset = (MASTER - PLATE) // 2
    mask = Image.new("L", (PLATE, PLATE), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, PLATE - 1, PLATE - 1), RADIUS, fill=255)
    canvas.paste(gradient(PLATE), (offset, offset), mask)

    width = round(PLATE * GLYPH_WIDTH)
    png = subprocess.run(
        ["rsvg-convert", "--width", str(width), "--keep-aspect-ratio", str(GLYPH_SVG)],
        check=True,
        capture_output=True,
    ).stdout
    glyph = Image.open(io.BytesIO(png)).convert("RGBA")
    x = (MASTER - glyph.width) // 2
    y = offset + round(PLATE * GLYPH_CENTER_Y) - glyph.height // 2
    canvas.alpha_composite(glyph, (x, y))
    return canvas


def convert_shared():
    for name, width in SHARED.items():
        source = MAC_RESOURCES / name
        target = ASSETS / f"{source.stem}.png"
        if source.suffix == ".svg":
            # rsvg-convert, unlike some converters, leaves mask shapes undrawn.
            subprocess.run(
                ["rsvg-convert", "--width", str(width), "--keep-aspect-ratio", "-o", str(target), str(source)],
                check=True,
            )
        elif source.suffix == ".webp":
            Image.open(source).save(target)
        else:
            shutil.copyfile(source, target)


def scaled(image, size):
    return image.resize((size, size), Image.Resampling.LANCZOS)


def main():
    icon = master()

    icon.save(ASSETS / "Umbrel.ico", sizes=[(s, s) for s in ICO_SIZES])
    # The About and update windows show the icon at 64 DIPs; 256 px stays sharp at 400%.
    scaled(icon, 256).save(ASSETS / "app-icon.png")

    for name, base, scales in [
        ("Square44x44Logo", 44, [200, 400]),
        ("Square150x150Logo", 150, [200, 400]),
        ("StoreLogo", 50, [125, 150, 200, 400]),
    ]:
        scaled(icon, base).save(ASSETS / f"{name}.png")
        for scale in scales:
            scaled(icon, round(base * scale / 100)).save(ASSETS / f"{name}.scale-{scale}.png")

    # The plated icon reads on both taskbar themes, so the unplated variants match it.
    for size in TARGET_SIZES:
        image = scaled(icon, size)
        for suffix in ["", "_altform-unplated", "_altform-lightunplated"]:
            image.save(ASSETS / f"Square44x44Logo.targetsize-{size}{suffix}.png")

    convert_shared()


if __name__ == "__main__":
    main()
