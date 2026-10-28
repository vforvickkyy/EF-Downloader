#!/usr/bin/env python3
"""Builds every icon and the installer artwork from one square master image.

    python3 scripts/make-icons.py path/to/icon-1024.png

The master is a 1024x1024 PNG with transparent corners (build/appicon.png
is kept as the master, so running without an argument redraws everything
else from it). Needs Pillow and the Inter font (fonts-inter).
"""
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent.parent
FONTS = Path('/usr/share/fonts/opentype/inter')


def font(name, size):
    return ImageFont.truetype(str(FONTS / name), size)


def sized(icon, size):
    return icon.resize((size, size), Image.LANCZOS)


def sidebar(icon):
    """Installer welcome/finish page art, 164x314, drawn at 2x."""
    s = 2
    w, h = 164 * s, 314 * s
    img = Image.new('RGBA', (w, h), (8, 8, 9, 255))
    glow = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    ImageDraw.Draw(glow).ellipse([w * -0.25, h * 0.05, w * 1.25, h * 0.55], fill=(255, 255, 255, 26))
    img = Image.alpha_composite(img, glow.filter(ImageFilter.GaussianBlur(50)))
    size = 112 * s
    cx, cy = w // 2, int(h * 0.31)
    img.alpha_composite(sized(icon, size), (cx - size // 2, cy - size // 2))
    d = ImageDraw.Draw(img)
    d.text((w // 2, int(h * 0.555)), 'Eastape', font=font('InterDisplay-Bold.otf', 29 * s), fill=(245, 245, 247), anchor='mm')
    d.text((w // 2, int(h * 0.555) + 31 * s), 'Downloader', font=font('InterDisplay-Medium.otf', 20 * s), fill=(176, 176, 182), anchor='mm')
    d.line([(w // 2 - 18 * s, int(h * 0.735)), (w // 2 + 18 * s, int(h * 0.735))], fill=(70, 70, 76), width=s)
    tag = font('Inter-Medium.otf', 10 * s)
    d.text((w // 2, int(h * 0.79)), 'Made by Creators,', font=tag, fill=(150, 150, 158), anchor='mm')
    d.text((w // 2, int(h * 0.79) + 14 * s), 'for Creators', font=tag, fill=(150, 150, 158), anchor='mm')
    return img.convert('RGB')


def header(icon):
    """Installer page header art, 150x57 on white, drawn at 2x."""
    s = 2
    w, h = 150 * s, 57 * s
    img = Image.new('RGBA', (w, h), (255, 255, 255, 255))
    size = 44 * s
    img.alpha_composite(sized(icon, size), (w - size - 8 * s, (h - size) // 2))
    return img.convert('RGB')


def main():
    master_path = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / 'build' / 'appicon.png'
    icon = Image.open(master_path).convert('RGBA')
    if icon.size != (1024, 1024):
        sys.exit('The master must be 1024x1024.')
    if master_path.resolve() != (ROOT / 'build' / 'appicon.png').resolve():
        icon.save(ROOT / 'build' / 'appicon.png', optimize=True)

    ico_sizes = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256]
    sized(icon, 256).save(ROOT / 'build' / 'windows' / 'icon.ico', sizes=[(n, n) for n in ico_sizes])
    sized(icon, 512).save(ROOT / 'frontend' / 'src' / 'assets' / 'logo.png', optimize=True)
    sized(icon, 256).save(ROOT / 'web' / 'public' / 'logo.png', optimize=True)
    sized(icon, 64).save(ROOT / 'web' / 'public' / 'favicon.png', optimize=True)
    assets = ROOT / 'build' / 'windows' / 'installer' / 'assets'
    sidebar(icon).save(assets / 'sidebar.bmp')
    header(icon).save(assets / 'header.bmp')
    print('icons and installer artwork written')


if __name__ == '__main__':
    main()
