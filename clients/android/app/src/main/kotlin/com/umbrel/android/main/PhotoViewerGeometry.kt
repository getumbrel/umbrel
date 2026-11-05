package com.umbrel.android.main

import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.geometry.lerp
import java.util.Locale
import kotlin.math.max
import kotlin.math.min

/** The rectangle an image of [width] × [height] fills when fitted, centered, in [container]. */
internal fun fitRect(width: Int, height: Int, container: Size): Rect? {
	if (width <= 0 || height <= 0 || container.width <= 0f || container.height <= 0f) return null
	val scale = min(container.width / width, container.height / height)
	val size = Size(width * scale, height * scale)
	return Rect(Offset((container.width - size.width) / 2, (container.height - size.height) / 2), size)
}

/** [rect] moved by [offset] and scaled by [scale] about its center: a photo being dragged away. */
internal fun dragged(rect: Rect, offset: Offset, scale: Float): Rect {
	val size = rect.size * scale
	return Rect(rect.center + offset - Offset(size.width / 2, size.height / 2), size)
}

/** The rectangle with [aspect] (width / height) that covers [target], centered: an aspect-fill crop. */
internal fun fillRect(aspect: Float, target: Rect): Rect {
	val width = max(target.width, target.height * aspect)
	val height = width / aspect
	return Rect(Offset(target.center.x - width / 2, target.center.y - height / 2), Size(width, height))
}

/**
 * One frame of the viewer's zoom between a grid tile and the full-screen photo. At 0 the
 * photo is cropped to the tile as the tile shows it (aspect fill); at 1 it is uncropped in
 * [full]. [image] is where the whole photo is drawn and [clip] the visible part of it.
 */
internal data class ZoomFrame(val image: Rect, val clip: Rect) {
	companion object {
		fun of(progress: Float, tile: Rect, full: Rect): ZoomFrame {
			val crop = fillRect(full.width / full.height, tile)
			return ZoomFrame(lerp(crop, full, progress), lerp(tile, full, progress))
		}
	}
}

/**
 * Pinch and double-tap zoom over a full-screen page, the port of the iOS viewer's zooming
 * scroll view: 1× to 4×, double tap to 2.5× centered on the tapped point, and panning
 * clamped to the page's bounds. A point p of the page draws at p × scale + offset.
 */
internal data class PageZoom(val scale: Float = 1f, val offset: Offset = Offset.Zero) {
	val isZoomed: Boolean get() = scale > 1.001f

	/** Pinch about [centroid] by [zoom] while moving by [pan]. */
	fun transformed(centroid: Offset, pan: Offset, zoom: Float, size: Size): PageZoom {
		val nextScale = (scale * zoom).coerceIn(MIN_SCALE, MAX_SCALE)
		val anchor = (centroid - offset) / scale
		return PageZoom(nextScale, centroid + pan - anchor * nextScale).clamped(size)
	}

	/** Double tap: back to fit when zoomed, otherwise 2.5× with the tapped point centered. */
	fun toggled(point: Offset, size: Size): PageZoom {
		if (scale > MIN_SCALE + 0.01f) return PageZoom()
		val nextScale = min(MAX_SCALE, DOUBLE_TAP_SCALE)
		val anchor = (point - offset) / scale
		return PageZoom(nextScale, size.center - anchor * nextScale).clamped(size)
	}

	fun clamped(size: Size): PageZoom {
		if (scale <= MIN_SCALE) return PageZoom()
		val minX = size.width - size.width * scale
		val minY = size.height - size.height * scale
		return copy(offset = Offset(offset.x.coerceIn(minX, 0f), offset.y.coerceIn(minY, 0f)))
	}

	companion object {
		const val MIN_SCALE = 1f
		const val MAX_SCALE = 4f
		const val DOUBLE_TAP_SCALE = 2.5f
	}
}

private val Size.center: Offset get() = Offset(width / 2, height / 2)

/** The info sheet's coordinates, to five decimal places (about a meter) like iOS. */
internal fun formatCoordinates(latitude: Double, longitude: Double): String =
	String.format(Locale.ROOT, "%.5f, %.5f", latitude, longitude)

/**
 * What the viewer says about an item's backup, from its receipt and the backup toggles. iOS
 * also says "Couldn’t back up" for a failed item; the receipts the app reads say only
 * whether an item is backed up.
 */
enum class ViewerBackupStatus(val text: String) {
	BACKED_UP("Backed up"),
	WAITING("Waiting to back up"),
	NOT_BACKED_UP("Not backed up"),
	;

	companion object {
		fun of(backedUp: Boolean, backupEnabled: Boolean): ViewerBackupStatus = when {
			backedUp -> BACKED_UP
			!backupEnabled -> NOT_BACKED_UP
			else -> WAITING
		}
	}
}
