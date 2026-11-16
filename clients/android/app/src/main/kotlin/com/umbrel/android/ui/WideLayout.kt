package com.umbrel.android.ui

import androidx.compose.material3.adaptive.currentWindowAdaptiveInfo
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInWindow
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.min
import androidx.window.core.layout.WindowSizeClass

/**
 * Layouts for wide windows: a foldable's inner screen, a tablet, or a wide split-screen pane.
 * Wider grids add tiles at their phone size instead of stretching them, and two-column
 * layouts move their gutter onto a foldable's hinge while it's half open. The same rules as
 * WideLayout.swift on iOS.
 */
object WideLayout {
	// About the width a bento tile has on a phone
	val tileWidth = 100.dp

	// Wide enough for two phone-width columns
	val twoColumnMinWidth = 700.dp

	// Home's four sections are short cards, so they pair up in narrower windows than other
	// screens: an unfolded foldable held upright as well as sideways
	val homeTwoColumnMinWidth = 560.dp

	// The widest two-column Home gets, centered in wider windows. Its cards hold phone grids,
	// so wider columns would only stretch the tiles; this keeps them about as wide as on a
	// foldable's inner screen.
	val homeMaxWidth = 812.dp

	/**
	 * A grid keeps its phone column count until [width] fits more tiles, then uses an even
	 * number of columns so a hinge down the middle falls between two of them.
	 */
	fun columns(width: Dp, phone: Int, tileWidth: Dp = WideLayout.tileWidth): Int {
		val fit = (width / tileWidth).toInt()
		if (fit <= phone) return phone
		return fit - fit % 2
	}

	/**
	 * Where two side-by-side columns go across [width]. Normally the leading column takes
	 * [leadingFraction] of the width; with a separating hinge across the layout, the columns
	 * are equal and mirrored around it with the usual gap, so neither runs over the fold.
	 */
	fun twoColumns(width: Dp, spacing: Dp, leadingFraction: Float = 0.5f, fold: FoldBand? = null): List<ColumnFrame> {
		if (fold != null && fold.start > spacing && fold.end < width - spacing) {
			val columnWidth = min(fold.start - spacing / 2, width - fold.end - spacing / 2)
			return listOf(
				ColumnFrame(fold.start - spacing / 2 - columnWidth, columnWidth),
				ColumnFrame(fold.end + spacing / 2, columnWidth),
			)
		}
		val leading = Math.round((width - spacing).value * leadingFraction).toFloat().dp
		return listOf(ColumnFrame(0.dp, leading), ColumnFrame(leading + spacing, width - leading - spacing))
	}
}

/** One column of a two-column layout: its leading edge and width. */
data class ColumnFrame(val x: Dp, val width: Dp)

/** The horizontal band a foldable's hinge covers, in a composable's own coordinates. */
data class FoldBand(val start: Dp, val end: Dp)

/**
 * True when the window is at least Material's medium width (600dp): a foldable's inner
 * screen, a tablet, or a wide split-screen pane. This is the window, never the device, so a
 * tablet's narrow split-screen pane gets the phone layout.
 */
@Composable
fun isWideWindow(): Boolean =
	currentWindowAdaptiveInfo().windowSizeClass.isWidthAtLeastBreakpoint(WindowSizeClass.WIDTH_DP_MEDIUM_LOWER_BOUND)

/**
 * Follows where a vertical, separating hinge (a foldable half open like a book) crosses the
 * composable that [modifier] is applied to.
 */
@Stable
class FoldTracker {
	private var windowX by mutableFloatStateOf(0f)

	val modifier: Modifier = Modifier.onGloballyPositioned { windowX = it.positionInWindow().x }

	/** The hinge across the tracked composable, or null when there's none to avoid. */
	@Composable
	fun band(): FoldBand? = foldBand(windowX)
}

/** The hinge across the whole window, for things placed in window coordinates like a sheet. */
@Composable
fun windowFoldBand(): FoldBand? = foldBand(0f)

@Composable
private fun foldBand(originX: Float): FoldBand? {
	val hinge = currentWindowAdaptiveInfo().windowPosture.hingeList.firstOrNull { it.isSeparating && it.isVertical } ?: return null
	return with(LocalDensity.current) { FoldBand((hinge.bounds.left - originX).toDp(), (hinge.bounds.right - originX).toDp()) }
}

@Composable
fun rememberFoldTracker(): FoldTracker = remember { FoldTracker() }
