"""Writes the Android app's ui/Symbols.kt: every icon the app draws, in each weight it uses.

The icons and weights to write are listed in weights.json. Run it after changing that list,
STOCK or CUSTOM_DOCS below, or an icon in custom_icons.py.
"""
import json, os, sys
from custom_icons import material, build, ICONS, HERE, CACHE
from svgpath import to_path, to_d

OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "..", "..", "app", "src", "main", "kotlin", "com", "umbrel", "android", "ui", "Symbols.kt")
WEIGHT_SUFFIX = {400: "", 500: "Medium", 600: "Semibold", 700: "Bold"}

# name -> (Material Symbols Rounded name, filled, autoMirror). Custom icons come from custom_icons.py.
STOCK = {
    "Add": ("add", True, False),
    "ArrowBackIosNew": ("arrow_back_ios_new", True, True),
    "ArrowCircleUp": ("arrow_circle_up", True, False),
    "ArrowForwardIos": ("arrow_forward_ios", True, True),
    "AutoFixHigh": ("auto_fix_high", False, False),
    "Check": ("check", True, False),
    "CheckCircle": ("check_circle", True, False),
    "Close": ("close", True, False),
    "CloudDone": ("cloud_done", False, False),
    "ContentCopy": ("content_copy", False, False),
    "HardDrive": ("hard_drive", False, False),
    "Folder": ("folder", False, False),
    "History": ("history", False, False),
    "Home": ("home", True, False),
    "InfoI": ("info_i", False, False),
    "Language": ("language", False, False),
    "LocationOn": ("location_on", False, False),
    "Lock": ("lock", True, False),
    "MoreHoriz": ("more_horiz", True, False),
    "Notifications": ("notifications", False, False),
    "OpenInNew": ("open_in_new", False, True),
    "PauseCircle": ("pause_circle", False, False),
    "Person": ("person", True, False),
    "Photo": ("photo", False, False),
    "PhotoLibrary": ("photo_library", False, False),
    "PhotoLibraryFilled": ("photo_library", True, False),
    "PlayArrow": ("play_arrow", True, False),
    "PowerSettingsNew": ("power_settings_new", True, False),
    "Refresh": ("refresh", True, False),
    "RemoveCircleOutline": ("do_not_disturb_on", False, False),
    "Schedule": ("schedule", False, False),
    "Share": ("share", False, False),
    "ShieldLock": ("shield_lock", False, False),
    "Smartphone": ("smartphone", False, False),
    "South": ("south", False, False),
    "VerifiedUser": ("verified_user", True, False),
    "Videocam": ("videocam", False, False),
    "WarningAmber": ("warning", False, False),
    "WebAsset": ("web_asset", True, False),
    "Wifi": ("wifi", True, False),
    "WifiAlert": ("android_wifi_4_bar_alert", False, False),
}
CUSTOM_DOCS = {
    "LockWarning": "lock with a warning badge, after lock.trianglebadge.exclamationmark: lock + warning",
    "AppsDiamond": "four circles in a diamond, top one filled, after circle.grid.cross.up.filled",
    "CircleGrid": "2 x 2 rings, after circle.grid.2x2",
    "RefreshCircle": "refresh in a ring, after arrow.clockwise.circle: refresh",
    "DriveQuestion": "drive with a question badge, after externaldrive.badge.questionmark: hard_drive + help",
    "DriveExclamation": "drive with an alert badge, after externaldrive.badge.exclamationmark: hard_drive + error",
    "DriveWarning": "drive with a warning badge, after externaldrive.trianglebadge.exclamationmark: hard_drive + warning",
    "KeyHorizontal": "key pointing left, after key.horizontal: key, mirrored",
    "MoonZzz": "moon with three z's, after moon.zzz: bedtime",
    "PhotoCheck": "photo with a check badge, after photo.badge.checkmark: photo + check_circle",
    "Antenna": "antenna with waves both sides, after antenna.radiowaves.left.and.right: sensors",
    "AppBadge": "app with a notification dot, after app.badge",
}

weights = json.load(open(os.path.join(HERE, "weights.json")))


def stock_path(name, weight):
    material_name, filled, _ = STOCK[name]
    d = material(material_name, weight, filled)
    suffix = ("" if weight == 400 else f"_wght{weight}") + ("fill1" if filled and weight != 400 else ("_fill1" if filled else ""))
    svg = open(os.path.join(CACHE, f"{material_name}{suffix}_24px.svg")).read()
    if 'viewBox="0 -960 960 960"' in svg:
        return to_d(to_path(d, (1, 0, 0, 1, 0, 960))), 960
    return d, 24  # a few older symbols draw on a 24-unit grid


def custom_path(name, weight):
    return to_d(to_path(build(name, weight), (1, 0, 0, 1, 0, 960))), 960


lines = []
for name in sorted(weights):
    custom = name in ICONS
    for w in sorted(weights[name]):
        d, viewport = custom_path(name, w) if custom else stock_path(name, w)
        if custom:
            doc = f"{CUSTOM_DOCS[name]}, weight {w}"
        else:
            material_name, filled, _ = STOCK[name]
            doc = f"{material_name}{' (filled)' if filled else ''}, weight {w}"
        mirror = (not custom) and STOCK[name][2]
        args = f'"{name}{WEIGHT_SUFFIX[w]}", "{d}"' + (", viewport = 24f" if viewport == 24 else "") + (", autoMirror = true" if mirror else "")
        lines.append(f"\t/** {doc} */\n\tval {name}{WEIGHT_SUFFIX[w]}: ImageVector by lazy {{ symbol({args}) }}")

source = f'''package com.umbrel.android.ui

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.addPathNodes
import androidx.compose.ui.unit.dp

/**
 * The app's icons: Google's Material Symbols Rounded at 24 dp (Apache License 2.0,
 * assets/licenses), filled where the iOS app uses a filled SF Symbol. Apple licenses SF
 * Symbols for its own platforms only. Each comment names the symbol.
 *
 * Each icon comes in the weights the app draws it at, matching the weight iOS uses in the
 * same place: regular is 400 (no suffix), Medium 500, Semibold 600 and Bold 700.
 *
 * Where Material has nothing for an SF Symbol's idea, the icon is assembled from Material
 * pieces, placed where the SF Symbol puts its own and cut into one path: a badge cut into
 * a drive, say. Their comments name the SF Symbol they stand in for.
 *
 * Generated by clients/android/tools/symbols; change the generator, not this file.
 */
object Symbols {{
{chr(10).join(lines)}
}}

// Material Symbols draw on a 960-unit grid; a few older ones use 24.
private fun symbol(name: String, pathData: String, viewport: Float = 960f, autoMirror: Boolean = false): ImageVector =
	ImageVector.Builder(name, 24.dp, 24.dp, viewportWidth = viewport, viewportHeight = viewport, autoMirror = autoMirror)
		.addPath(addPathNodes(pathData), fill = SolidColor(Color.Black))
		.build()
'''
open(OUT, "w").write(source)
print(f"{len(lines)} icons written")
