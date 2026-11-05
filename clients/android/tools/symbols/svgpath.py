"""SVG path data <-> skia-pathops paths."""
import re
import pathops
from fontTools.svgLib.path import parse_path
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen

def to_path(d, transform=None):
    p = pathops.Path()
    pen = p.getPen()
    parse_path(d, TransformPen(pen, transform) if transform else pen)
    return p

def to_d(path, digits=1):
    pen = SVGPathPen(None, ntos=lambda v: (f"{v:.{digits}f}").rstrip("0").rstrip("."))
    path.draw(pen)
    return pen.getCommands()

def file_d(path):
    return re.search(r' d="([^"]+)"', open(path).read()).group(1)
