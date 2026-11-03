package com.umbrel.android.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.geometry.isSpecified
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.addOutline
import androidx.compose.ui.graphics.drawscope.ContentDrawScope
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.clipPath
import androidx.compose.ui.layout.LayoutCoordinates
import androidx.compose.ui.layout.positionInRoot
import androidx.compose.ui.node.DrawModifierNode
import androidx.compose.ui.node.GlobalPositionAwareModifierNode
import androidx.compose.ui.node.ModifierNodeElement
import androidx.compose.ui.node.invalidateDraw
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import kotlin.math.max
import kotlin.math.roundToInt

/**
 * The blurred wallpaper for frosted surfaces, and the size of the window it is pinned to.
 * The backdrop and every frosted card crop the image to the same window-sized rectangle,
 * so a card's blurred copy lines up with the sharp wallpaper behind it.
 */
val LocalFrostWallpaper = staticCompositionLocalOf<ImageBitmap?> { null }
val LocalWallpaperViewport = staticCompositionLocalOf { Size.Zero }

/** The image rectangle that fills [viewport] like SwiftUI's scaledToFill, centred. */
internal fun fillRect(image: ImageBitmap, viewport: Size): Pair<IntOffset, IntSize> {
	val scale = max(viewport.width / image.width, viewport.height / image.height)
	val width = (image.width * scale).roundToInt()
	val height = (image.height * scale).roundToInt()
	val offset = IntOffset(((viewport.width - width) / 2).roundToInt(), ((viewport.height - height) / 2).roundToInt())
	return offset to IntSize(width, height)
}

private fun DrawScope.drawFilling(image: ImageBitmap, viewport: Size, origin: Offset = Offset.Zero) {
	if (viewport.width <= 0f || viewport.height <= 0f) return
	val (offset, size) = fillRect(image, viewport)
	drawImage(
		image,
		dstOffset = IntOffset(offset.x - origin.x.roundToInt(), offset.y - origin.y.roundToInt()),
		dstSize = size,
	)
}

/**
 * The account's wallpaper as a full-window backdrop, darkened at the top (status bar and
 * header) and the bottom (tab bar), brightest in the middle where the cards sit.
 */
@Composable
fun WallpaperBackground(image: ImageBitmap?, modifier: Modifier = Modifier) {
	val viewport = LocalWallpaperViewport.current
	Canvas(modifier.fillMaxSize().background(Color.Black)) {
		if (image != null) drawFilling(image, viewport)
		drawRect(
			Brush.verticalGradient(
				0f to Color.Black.copy(alpha = 0.45f),
				0.28f to Color.Black.copy(alpha = 0.10f),
				0.7f to Color.Black.copy(alpha = 0.20f),
				1f to Color.Black.copy(alpha = 0.55f),
			),
		)
	}
}

/**
 * Fixed top gradient for status-bar legibility over the wallpaper. iOS draws it 150 from the
 * top of the screen, which on iPhones with the Dynamic Island ends 88 below the status bar, just
 * inside the title. Android status bars are shorter, so it keeps that end point relative to the
 * content rather than to the screen edge.
 */
@Composable
fun WallpaperTopGradient(modifier: Modifier = Modifier) {
	Box(
		modifier
			.fillMaxWidth()
			.background(Brush.verticalGradient(listOf(Color.Black.copy(alpha = 0.9f), Color.Transparent)))
			.statusBarsPadding()
			.height(88.dp),
	)
}

/**
 * A frosted fill clipped to [shape]: the pre-blurred wallpaper offset by this element's
 * window position so it aligns with the backdrop, under the card tint.
 *
 * A scrolling container draws its content into its own layer, so a platform blur inside
 * it cannot sample the wallpaper behind it. Drawing the cached blur at an offset only
 * re-reads one bitmap per frame while scrolling.
 */
fun Modifier.frost(shape: Shape, wallpaper: ImageBitmap?, viewport: Size): Modifier =
	this then FrostElement(shape, wallpaper, viewport)

private data class FrostElement(val shape: Shape, val wallpaper: ImageBitmap?, val viewport: Size) : ModifierNodeElement<FrostNode>() {
	override fun create() = FrostNode(shape, wallpaper, viewport)

	override fun update(node: FrostNode) {
		if (node.shape != shape) node.clip = null
		node.shape = shape
		node.wallpaper = wallpaper
		node.viewport = viewport
		node.invalidateDraw()
	}
}

private class FrostNode(var shape: Shape, var wallpaper: ImageBitmap?, var viewport: Size) :
	Modifier.Node(), DrawModifierNode, GlobalPositionAwareModifierNode {
	private var origin = Offset.Unspecified
	var clip: Path? = null
	private var clipSize = Size.Unspecified
	private var clipDirection = LayoutDirection.Ltr

	override fun onGloballyPositioned(coordinates: LayoutCoordinates) {
		val position = coordinates.positionInRoot()
		if (position != origin) {
			origin = position
			invalidateDraw()
		}
	}

	override fun ContentDrawScope.draw() {
		val path = clip?.takeIf { clipSize == size && clipDirection == layoutDirection }
			?: Path().apply { addOutline(shape.createOutline(size, layoutDirection, this@draw)) }.also {
				clip = it
				clipSize = size
				clipDirection = layoutDirection
			}
		clipPath(path) {
			val image = wallpaper
			if (image != null && origin.isSpecified) drawFilling(image, viewport, origin)
			drawRect(MainTheme.card)
		}
		drawContent()
	}
}
