package com.umbrel.android.ui

import android.os.Build
import androidx.compose.foundation.background
import androidx.compose.foundation.shape.CornerBasedShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.unit.dp
import com.kyant.backdrop.Backdrop
import com.kyant.backdrop.drawBackdrop
import com.kyant.backdrop.effects.blur
import com.kyant.backdrop.effects.lens
import com.kyant.backdrop.effects.vibrancy

/**
 * What glass controls draw through: the content behind them, captured with
 * `Modifier.layerBackdrop`. A screen provides it to the controls floating over that content,
 * never to anything inside the captured layer: glass drawing a layer it is part of loops on
 * the render thread and crashes. Without one, glass falls back to a translucent fill.
 */
val LocalGlassBackdrop = staticCompositionLocalOf<Backdrop?> { null }

// The tint over glass: enough to keep white text readable over a bright photo.
private val GlassTint = Color(0xFF121212).copy(alpha = 0.35f)

/**
 * iOS 26 Liquid Glass: the content behind, a little blurred and more saturated, bending
 * at the edges like a lens, with a specular rim. Blur needs Android 12 and the lens
 * Android 13; before 12 the content would show through sharp, so it gets the fallback
 * fill instead.
 */
@Composable
fun Modifier.liquidGlass(shape: Shape): Modifier {
	val backdrop = LocalGlassBackdrop.current
	if (backdrop == null || Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return background(MainTheme.glassFallback, shape)
	return drawBackdrop(
		backdrop = backdrop,
		shape = { shape },
		effects = {
			vibrancy()
			blur(2.dp.toPx())
			val corner = (shape as? CornerBasedShape)?.topStart?.toPx(size, this)
			if (corner != null) {
				// The lens bends the edge band; it can be no deeper than the corner is round.
				lens(minOf(12.dp.toPx(), corner), minOf(18.dp.toPx(), size.minDimension))
			}
		},
		// Every glass control is clipped to its shape, which would hide a shadow anyway.
		shadow = null,
		onDrawSurface = { drawRect(GlassTint) },
	)
}
