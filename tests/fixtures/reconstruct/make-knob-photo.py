"""Regenerate tests/fixtures/reconstruct/broken-knob.jpg (the R6 e2e / G3 demo photo).

A top-down "photo" at 0.1 mm per pixel: a credit card (85.60 x 53.98 mm -> 856 x 540 px; its top
long edge runs from x = 172 to 1028 at y = 400) below a broken 1.5 in (38.1 mm -> 381 px) knob
centred at (600, 200) with 12 grip flutes and a crack. The e2e marks the card's long edge and the knob's
diameter at these pixel positions.

    python3 tests/fixtures/reconstruct/make-knob-photo.py
"""

import math
import os

from PIL import Image, ImageDraw, ImageFilter

W, H = 1200, 960
img = Image.new("RGB", (W, H), (206, 199, 186))  # countertop
d = ImageDraw.Draw(img)
for y in range(0, H, 6):  # subtle wood grain
    d.line([(0, y), (W, y + 18)], fill=(200, 192, 178), width=2)

# Credit card: top long edge on y = 400 from x = 172 to x = 1028.
cx0, cy0 = 172, 400
d.rounded_rectangle([cx0, cy0, cx0 + 856, cy0 + 540], radius=32, fill=(32, 86, 160), outline=(18, 50, 98), width=3)
d.rectangle([cx0 + 70, cy0 + 150, cx0 + 190, cy0 + 240], fill=(214, 182, 92))  # chip
d.text((cx0 + 70, cy0 + 420), "4000 1234 5678 9010", fill=(235, 238, 245))

# Knob: 381 px across, 12 flutes, a crack and a D bore glimpse.
kx, ky, r = 600, 200, 190.5
d.ellipse([kx - r - 8, ky - r + 10, kx + r + 8, ky + r + 22], fill=(150, 142, 130))  # shadow
d.ellipse([kx - r, ky - r, kx + r, ky + r], fill=(38, 40, 44), outline=(20, 21, 24), width=3)
for i in range(12):
    a = 2 * math.pi * i / 12
    fx, fy = kx + r * math.cos(a), ky + r * math.sin(a)
    d.ellipse([fx - 8, fy - 8, fx + 8, fy + 8], fill=(206, 199, 186))
d.ellipse([kx - r + 22, ky - r + 22, kx + r - 22, ky + r - 22], outline=(58, 60, 66), width=4)
d.rectangle([kx + 40, ky - 6, kx + r - 10, ky + 6], fill=(230, 230, 230))  # pointer notch
d.line([(kx - 40, ky - r + 10), (kx - 10, ky - 60), (kx - 55, ky + 10), (kx - 20, ky + 90)], fill=(205, 199, 186), width=5)  # crack

img = img.filter(ImageFilter.GaussianBlur(0.6))
out = os.path.join(os.path.dirname(__file__), "broken-knob.jpg")
img.save(out, "JPEG", quality=72, optimize=True)
print(out, os.path.getsize(out))
