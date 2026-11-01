"""Builds the Android app's custom icons as single filled paths, at any Material weight.

Each icon is assembled from Material Symbols Rounded pieces (Apache 2.0) and simple
geometry, placed where the matching SF Symbol puts its pieces (measured from Apple's own
render with measure.swift and measure_pieces.py). Gaps around badges are cut with path
booleans, so the result needs no masks: Compose's ImageVector draws it as one path.
"""
import os, subprocess, sys
import pathops
from svgpath import to_path, to_d, file_d

HERE = os.path.dirname(os.path.abspath(__file__))
# Material Symbols SVGs, downloaded once.
CACHE = os.path.join(HERE, "build", "material")
REPO = "https://raw.githubusercontent.com/google/material-design-icons/master/symbols/web"
# Material's outline stroke on the 960 grid, by weight (measured from radio_button_unchecked).
STROKE = {300: 60, 400: 80, 500: 91, 600: 106, 700: 126}


def material(name, weight, fill=False):
    suffix = ("" if weight == 400 else f"_wght{weight}") + ("fill1" if fill and weight != 400 else ("_fill1" if fill else ""))
    file = f"{name}{suffix}_24px.svg"
    path = os.path.join(CACHE, file)
    if not os.path.exists(path):
        os.makedirs(CACHE, exist_ok=True)
        subprocess.run(["curl", "-sf", "-o", path, f"{REPO}/{name}/materialsymbolsrounded/{file}"], check=True)
    return file_d(path)


def bounds(p):
    return p.bounds  # (x0, y0, x1, y1) on the 960 grid, y negative upward


class Fit:
    """Maps an SF Symbol render (960 px, y down) onto Material's 800-unit live area."""

    def __init__(self, glyph):
        x0, y0, x1, y1 = glyph
        self.k = 800 / max(x1 - x0, y1 - y0)
        self.ox = 480 - (x1 - x0) * self.k / 2 - x0 * self.k
        self.oy = -480 - (y1 - y0) * self.k / 2 - y0 * self.k

    def box(self, b):
        x0, y0, x1, y1 = b
        return (self.ox + x0 * self.k, self.oy + y0 * self.k, self.ox + x1 * self.k, self.oy + y1 * self.k)

    def pt(self, x, y):
        return (self.ox + x * self.k, self.oy + y * self.k)


def place(d, target, reference=None, mirror=False):
    """Scales a piece uniformly into a target box, centred. The reference box (the piece at
    weight 400) keeps the geometry the same at every weight: heavier strokes grow outward."""
    p = to_path(d)
    rx0, ry0, rx1, ry1 = reference or bounds(p)
    tx0, ty0, tx1, ty1 = target
    s = min((tx1 - tx0) / (rx1 - rx0), (ty1 - ty0) / (ry1 - ry0))
    cx, cy = (rx0 + rx1) / 2, (ry0 + ry1) / 2
    tcx, tcy = (tx0 + tx1) / 2, (ty0 + ty1) / 2
    sx = -s if mirror else s
    return to_path(d, (sx, 0, 0, s, tcx - cx * sx, tcy - cy * s)), s


def disc(cx, cy, r):
    p = pathops.Path()
    k = 0.5522847498 * r
    p.moveTo(cx + r, cy)
    p.cubicTo(cx + r, cy + k, cx + k, cy + r, cx, cy + r)
    p.cubicTo(cx - k, cy + r, cx - r, cy + k, cx - r, cy)
    p.cubicTo(cx - r, cy - k, cx - k, cy - r, cx, cy - r)
    p.cubicTo(cx + k, cy - r, cx + r, cy - k, cx + r, cy)
    p.close()
    return p


def union(*paths):
    out = pathops.Path(paths[0])
    for p in paths[1:]:
        out = pathops.op(out, p, pathops.PathOp.UNION)
    return pathops.op(out, pathops.Path(), pathops.PathOp.UNION)


def minus(a, *cut):
    out = pathops.Path(a)
    for p in cut:
        out = pathops.op(out, p, pathops.PathOp.DIFFERENCE)
    return out


def ring(cx, cy, r, w):
    return minus(disc(cx, cy, r), disc(cx, cy, r - w))


def grown(p, gap):
    """The piece plus a margin all round: what to cut from the base so the badge floats."""
    outline = pathops.Path(p)
    outline.stroke(2 * gap, pathops.LineCap.ROUND_CAP, pathops.LineJoin.ROUND_JOIN, 4)
    outline.convertConicsToQuads()
    return union(p, outline)


def stroked(points, width, cap=pathops.LineCap.ROUND_CAP):
    p = pathops.Path()
    p.moveTo(*points[0])
    for x, y in points[1:]:
        p.lineTo(x, y)
    p.stroke(width, cap, pathops.LineJoin.ROUND_JOIN, 4)
    p.convertConicsToQuads()
    return union(p)


def squircle(x0, y0, x1, y1, r, c=0.75):
    a = r * (1 - c)
    p = pathops.Path()
    p.moveTo(x0 + r, y0)
    p.lineTo(x1 - r, y0); p.cubicTo(x1 - a, y0, x1, y0 + a, x1, y0 + r)
    p.lineTo(x1, y1 - r); p.cubicTo(x1, y1 - a, x1 - a, y1, x1 - r, y1)
    p.lineTo(x0 + r, y1); p.cubicTo(x0 + a, y1, x0, y1 - a, x0, y1 - r)
    p.lineTo(x0, y0 + r); p.cubicTo(x0, y0 + a, x0 + a, y0, x0 + r, y0)
    p.close()
    return p


def badge_on(base, badge, gap):
    return union(minus(base, grown(badge, gap)), badge)


# ── The icons. Boxes are (x0, y0, x1, y1) in Apple's 960 px render, from measure_pieces.py. ──

def without_keyhole(d):
    """Material's lock with its keyhole removed: the small round piece in the body."""
    out = pathops.Path()
    for contour in to_path(d).contours:
        x0, y0, x1, y1 = contour.bounds
        if x1 - x0 < 250 and abs((x0 + x1) / 2 - 480) < 40 and abs((y0 + y1) / 2 + 360) < 60:
            continue
        out.addPath(contour)
    return out


def lock_warning(w):  # card 6: lock.trianglebadge.exclamationmark
    f = Fit((189, 145, 727, 774))
    ref = without_keyhole(material("lock", 400)).bounds
    lock = to_d(without_keyhole(material("lock", w)), digits=2)
    base, _ = place(lock, f.box((329, 145, 727, 719)), ref)
    tri, _ = place(material("warning", w, fill=True), f.box((189, 477, 513, 774)), bounds(to_path(material("warning", 400, fill=True))))
    return badge_on(base, tri, 39.4 * f.k)


def apps_diamond(w):  # card 9: circle.grid.cross.up.filled; rings at 5/8 of Material's stroke (Nate's pick)
    f = Fit((139, 133, 820, 826))
    rw = STROKE[w] * 50 / 80
    def centre(b):
        x0, y0, x1, y1 = f.box(b); return ((x0 + x1) / 2, (y0 + y1) / 2, (x1 - x0) / 2)
    top = centre((352, 133, 606, 387)); left = centre((139, 353, 393, 607))
    right = centre((565, 353, 820, 607)); bottom = centre((352, 572, 606, 826))
    return union(disc(*top), ring(*left, rw), ring(*right, rw), ring(*bottom, rw))


def circle_grid(w):  # card 18: circle.grid.2x2, same rings as the Apps tab
    f = Fit((201, 202, 758, 758))
    rw = STROKE[w] * 50 / 80
    rings = []
    for b in ((201, 202, 455, 456), (503, 202, 758, 456), (201, 504, 455, 758), (503, 504, 758, 758)):
        x0, y0, x1, y1 = f.box(b)
        rings.append(ring((x0 + x1) / 2, (y0 + y1) / 2, (x1 - x0) / 2, rw))
    return union(*rings)


def refresh_circle(w):  # card 19: arrow.clockwise.circle
    f = Fit((181, 181, 778, 778))
    x0, y0, x1, y1 = f.box((181, 181, 778, 778))
    outer = ring((x0 + x1) / 2, (y0 + y1) / 2, (x1 - x0) / 2, STROKE[w])
    arrow, _ = place(material("refresh", w), f.box((349, 313, 609, 624)), bounds(to_path(material("refresh", 400))))
    return union(outer, arrow)


def drive_badge(w, badge):  # cards 21 and 22: externaldrive.badge.questionmark / .exclamationmark
    f = Fit((64, 187, 859, 733))
    # The drive keeps its full size (externaldrive is 691 px wide); the badge cuts its corner.
    drive, _ = place(material("hard_drive", w), f.box((859 - 691, 187, 859, 686)), bounds(to_path(material("hard_drive", 400))))
    dot, _ = place(material(badge, w, fill=True), f.box((64, 437, 361, 733)), bounds(to_path(material(badge, 400, fill=True))))
    return badge_on(drive, dot, 40.2 * f.k)


def drive_warning(w):  # card 41: externaldrive.trianglebadge.exclamationmark
    f = Fit((74, 182, 850, 737))
    drive, _ = place(material("hard_drive", w), f.box((850 - 691, 182, 850, 681)), bounds(to_path(material("hard_drive", 400))))
    tri, _ = place(material("warning", w, fill=True), f.box((74, 440, 398, 737)), bounds(to_path(material("warning", 400, fill=True))))
    return badge_on(drive, tri, 39.6 * f.k)


def key_mirrored(w):  # card 23: key.horizontal points the other way from Material's key
    p, _ = place(material("key", w), bounds(to_path(material("key", 400))), bounds(to_path(material("key", 400))), mirror=True)
    return p


def moon_zzz(w):  # card 29: moon.zzz
    f = Fit((211, 146, 772, 814))
    moon, s = place(material("bedtime", w), f.box((211, 327, 694, 814)), bounds(to_path(material("bedtime", 400))))
    zw = STROKE[w] * s * 31 / 45  # Apple draws the z's at 31/45 of the moon's stroke
    zs = []
    for b in ((504, 146, 635, 301), (665, 286, 772, 411), (545, 397, 642, 510)):
        x0, y0, x1, y1 = f.box(b)
        x0, y0, x1, y1 = x0 + zw / 2, y0 + zw / 2, x1 - zw / 2, y1 - zw / 2
        zs.append(stroked([(x0, y0), (x1, y0), (x0, y1), (x1, y1)], zw))
    return union(moon, *zs)


def photo_check(w):  # card 30: Material's square photo with check_circle, as approved
    photo = to_path(material("photo", w), (0.94, 0, 0, 0.94, -20, -10))
    bs = 0.36
    badge = to_path(material("check_circle", w, fill=True), (bs, 0, 0, bs, 725 - 480 * bs, -235 + 480 * bs))
    return badge_on(photo, badge, 40)


def antenna(w):  # card 38: antenna.radiowaves.left.and.right
    f = Fit((169, 210, 790, 753))
    waves, _ = place(material("sensors", w), f.box((169, 210, 790, 625)), bounds(to_path(material("sensors", 400))))
    cx = sum(f.box((427, 365, 532, 753))[0::2]) / 2
    top = (f.box((427, 365, 532, 753))[1] + f.box((427, 365, 532, 753))[3]) / 2
    bottom = f.box((427, 365, 532, 753))[3] - STROKE[w] / 2
    return union(waves, stroked([(cx, (f.box((169, 210, 790, 625))[1] + f.box((169, 210, 790, 625))[3]) / 2), (cx, bottom)], STROKE[w]))


def app_badge(w):  # card 43: app.badge
    f = Fit((200, 204, 793, 796))
    x0, y0, x1, y1 = f.box((200, 257, 739, 796))
    r = 153 * f.k * 1.25
    sw = STROKE[w]
    square = minus(squircle(x0, y0, x1, y1, r), squircle(x0 + sw, y0 + sw, x1 - sw, y1 - sw, r - sw))
    dx0, dy0, dx1, dy1 = f.box((591, 204, 793, 406))
    dot = disc((dx0 + dx1) / 2, (dy0 + dy1) / 2, (dx1 - dx0) / 2)
    return badge_on(square, dot, 39.8 * f.k)


ICONS = {
    "LockWarning": lock_warning,
    "AppsDiamond": apps_diamond,
    "CircleGrid": circle_grid,
    "RefreshCircle": refresh_circle,
    "DriveQuestion": lambda w: drive_badge(w, "help"),
    "DriveExclamation": lambda w: drive_badge(w, "error"),
    "DriveWarning": drive_warning,
    "KeyHorizontal": key_mirrored,
    "MoonZzz": moon_zzz,
    "PhotoCheck": photo_check,
    "Antenna": antenna,
    "AppBadge": app_badge,
}


def build(name, weight):
    return to_d(ICONS[name](weight))


if __name__ == "__main__":
    # Draws one icon at one weight as an SVG, for checking a change: custom_icons.py MoonZzz 500
    name, weight = sys.argv[1], int(sys.argv[2])
    out = os.path.join(HERE, "build", f"{name}_{weight}.svg")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    open(out, "w").write(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960"><path d="{build(name, weight)}"/></svg>')
    print(out)
