"""Measures an SF Symbol render from measure.swift: the glyph's bounds, each connected piece's
bounds (x0, y0, x1, y1), and the gap between the two largest pieces when one is a badge.

usage: measure_pieces.py render.png"""
import sys, json
from PIL import Image
import numpy as np
from collections import deque
from scipy import ndimage
a = np.array(Image.open(sys.argv[1]))[:, :, 3] > 127
labels, n = ndimage.label(a)
pieces = []
for i in range(1, n + 1):
    ys, xs = np.where(labels == i)
    pieces.append({"area": int(len(xs)), "box": [int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())], "id": i})
pieces.sort(key=lambda p: -p["area"])
ys, xs = np.where(a)
out = {"glyph": [int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())], "pieces": [{k: v for k, v in p.items() if k != "id"} for p in pieces[:8]]}
if len(pieces) >= 2:
    # Gap: how far the second piece must grow before it touches the first.
    first = labels == pieces[0]["id"]; second = labels == pieces[1]["id"]
    dist = ndimage.distance_transform_edt(~first)
    out["gap_between_two_largest"] = float(dist[second].min())
print(json.dumps(out))
