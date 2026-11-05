package com.umbrel.android.onboarding

import android.graphics.BlurMaskFilter
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.foundation.layout.Spacer
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.DpOffset
import androidx.compose.ui.graphics.shadow.Shadow
import androidx.compose.ui.draw.dropShadow
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.State
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawWithCache
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.graphics.nativeCanvas
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.drawIntoCanvas
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.res.imageResource
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.umbrel.android.R
import com.umbrel.android.ui.Palette
import com.umbrel.android.ui.Symbols
import com.umbrel.kit.UmbrelDeviceKind
import kotlin.math.PI
import kotlin.math.exp
import kotlin.math.roundToInt
import kotlin.math.sqrt

// Text styles from the Apple onboarding screens, at Apple's default sizes and leading.
internal val HeadlineSize = 17.sp
internal val HeadlineLineHeight = 22.sp
internal val CalloutSize = 16.sp
internal val CalloutLineHeight = 21.sp
internal val SubheadlineSize = 15.sp
internal val SubheadlineLineHeight = 20.sp
internal val FootnoteSize = 13.sp
internal val FootnoteLineHeight = 18.sp

// SwiftUI's easeOut curve.
internal val EaseOut = CubicBezierEasing(0f, 0f, 0.58f, 1f)

/**
 * The shared onboarding backdrop: black with two blurred glows, a strong one bleeding up
 * from the bottom-left and a subtle one off the top-right. Positions are scaled from a
 * 402 pt wide iPhone, as on iOS. Each glow is a circle blurred by a Gaussian (SwiftUI's
 * blur radius is its standard deviation), drawn as a radial gradient that follows the
 * blurred disk's exact falloff so it renders the same on every Android version.
 */
@Composable
internal fun OnboardingBackground(tint: Color = Palette.purple, secondaryTint: Color = Palette.purpleLight) {
	Box(
		Modifier.fillMaxSize().background(Color.Black).drawWithCache {
			val scale = size.width / 402.dp.toPx()
			fun glow(color: Color, radius: Float, x: Float, y: Float): Pair<Brush, Pair<Offset, Float>> {
				val center = Offset(x.dp.toPx() * scale, y.dp.toPx() * scale)
				val disk = radius.dp.toPx() * scale
				val sigma = 170.dp.toPx() * scale
				val extent = disk + 4 * sigma
				val stops = Array(49) { index ->
					val t = index / 48f
					t to color.copy(alpha = color.alpha * blurredDisk(t * extent, disk, sigma))
				}
				return Brush.radialGradient(*stops, center = center, radius = extent) to (center to extent)
			}
			val glows = listOf(glow(tint, 229f, 7f, 923f), glow(secondaryTint.copy(alpha = 0.2f), 209f, 430f, 132f))
			onDrawBehind {
				for ((brush, circle) in glows) drawCircle(brush, circle.second, circle.first)
			}
		},
	)
}

/**
 * Brightness at [distance] from the center of a uniform disk of radius [radius] after a
 * Gaussian blur with standard deviation [sigma]: the integral over the disk of the 2D
 * Gaussian, which in polar form is ∫₀ʳ (ρ/σ²)·exp(−(ρ²+d²)/2σ²)·I₀(ρd/σ²) dρ.
 */
internal fun blurredDisk(distance: Float, radius: Float, sigma: Float): Float {
	val steps = 200
	val d = distance.toDouble()
	val s2 = sigma.toDouble() * sigma
	var sum = 0.0
	for (step in 0 until steps) {
		val rho = (step + 0.5) * radius / steps
		val a = rho * d / s2
		// I₀(a)·e^(−a) keeps the terms finite; e^(−a) is folded into the exponent below.
		sum += rho / s2 * exp(-(rho - d) * (rho - d) / (2 * s2)) * scaledBesselI0(a)
	}
	return (sum * radius / steps).toFloat().coerceIn(0f, 1f)
}

/** The modified Bessel function I₀(x) multiplied by e^(−x). */
private fun scaledBesselI0(x: Double): Double {
	if (x > 30) return 1 / sqrt(2 * PI * x)
	var term = 1.0
	var sum = 1.0
	var k = 1
	while (term > 1e-12 * sum) {
		term *= (x / 2) * (x / 2) / (k.toDouble() * k)
		sum += term
		k++
	}
	return sum * exp(-x)
}

/** Title (one Text per line) and subtitle, used at the top of most onboarding screens. */
@Composable
internal fun OnboardingHeader(title: String, subtitle: String, modifier: Modifier = Modifier) {
	Column(
		modifier.widthIn(max = 328.dp),
		horizontalAlignment = Alignment.CenterHorizontally,
		verticalArrangement = Arrangement.spacedBy(8.dp),
	) {
		Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(4.dp)) {
			for (line in title.split("\n")) {
				Text(line, color = Color.White, fontSize = 32.sp, lineHeight = 38.sp, fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Center)
			}
		}
		Text(subtitle, color = Palette.textMuted, fontSize = CalloutSize, lineHeight = CalloutLineHeight, textAlign = TextAlign.Center)
	}
}

enum class OnboardingButtonStyle { SUBTLE, PROMINENT }

/**
 * Full-width pill anchored at the bottom of onboarding screens. Subtle is a translucent
 * tint fill; prominent is solid with a top rim light.
 */
@Composable
internal fun OnboardingButton(
	title: String,
	modifier: Modifier = Modifier,
	style: OnboardingButtonStyle = OnboardingButtonStyle.SUBTLE,
	tint: Color = Palette.purple,
	enabled: Boolean = true,
	busy: Boolean = false,
	onClick: () -> Unit,
) {
	val shape = CircleShape
	val active = enabled && !busy
	Box(
		modifier
			.fillMaxWidth()
			// A disabled button, including one busy with its action, draws at half opacity.
			.alpha(if (active) 1f else 0.5f)
			.clip(shape)
			.background(if (style == OnboardingButtonStyle.SUBTLE) tint.copy(alpha = 0.16f) else tint)
			.then(if (style == OnboardingButtonStyle.PROMINENT) Modifier.solidButtonRim(shape) else Modifier)
			.clickable(enabled = active, onClick = onClick)
			.padding(vertical = 18.dp),
		contentAlignment = Alignment.Center,
	) {
		Text(
			title,
			color = Color.White.copy(alpha = if (busy) 0f else 1f),
			fontSize = HeadlineSize,
			lineHeight = HeadlineLineHeight,
			fontWeight = FontWeight.SemiBold,
		)
		if (busy) CircularProgressIndicator(Modifier.size(20.dp), color = Color.White, strokeWidth = 2.dp)
	}
}

/** A 1 pt highlight hugging a solid button's top edge, fading out by mid-height. */
internal fun Modifier.solidButtonRim(shape: Shape): Modifier = border(
	1.dp,
	Brush.verticalGradient(0f to Color.White.copy(alpha = 0.25f), 0.55f to Color.Transparent),
	shape,
)

/** "Can't find your Umbrel? Connect by address ›", shown once discovery has an outcome. */
@Composable
internal fun ManualAddressPrompt(onClick: () -> Unit, modifier: Modifier = Modifier, leading: Boolean = false) {
	val text = buildAnnotatedString {
		append("Can’t find your Umbrel? ")
		withStyle(SpanStyle(fontWeight = FontWeight.SemiBold)) { append("Connect by address ") }
	}
	androidx.compose.foundation.layout.Row(
		modifier
			.then(if (leading) Modifier else Modifier.fillMaxWidth())
			.clickable(interactionSource = remember { MutableInteractionSource() }, indication = null, onClick = onClick)
			.padding(vertical = 6.dp),
		horizontalArrangement = if (leading) Arrangement.Start else Arrangement.Center,
		verticalAlignment = Alignment.CenterVertically,
	) {
		Text(text, color = Palette.textMuted, fontSize = FootnoteSize, lineHeight = FootnoteLineHeight)
		Icon(Symbols.ArrowForwardIosSemibold, contentDescription = null, tint = Palette.textMuted, modifier = Modifier.size(14.dp))
	}
}

/**
 * Staged reveal within a step: the header arrives with the step transition, then content
 * fades in a beat later. Opacity only, so the step transition stays the one source of motion.
 */
@Composable
internal fun rememberEntrance(delayMillis: Int = 150): State<Float> {
	val alpha = remember { Animatable(0f) }
	LaunchedEffect(Unit) { alpha.animateTo(1f, tween(350, delayMillis, EaseOut)) }
	return alpha.asState()
}

/** The three concentric radar rings: top-lit tint fill with a white hairline fading downward. */
@Composable
internal fun RadarRings(modifier: Modifier = Modifier, tint: Color = Palette.purple) {
	Canvas(modifier.size(360.dp)) {
		for (diameter in listOf(359.7f, 269f, 161f)) {
			val radius = diameter.dp.toPx() / 2
			val top = center.y - radius
			val bottom = center.y + radius
			drawCircle(
				Brush.verticalGradient(listOf(tint.copy(alpha = 0.12f), tint.copy(alpha = 0f)), startY = top, endY = bottom),
				radius,
			)
			drawCircle(
				Brush.verticalGradient(listOf(Color.White.copy(alpha = 0.12f), Color.White.copy(alpha = 0f)), startY = top, endY = bottom),
				radius,
				style = Stroke(1.79.dp.toPx()),
			)
		}
	}
}

/**
 * A glowing radar needle sweeping clockwise: a violet wake trails the needle, brightest at
 * the needle and easing out over 160°, and the needle carries a white bloom.
 */
@Composable
internal fun RadarSweep(modifier: Modifier = Modifier) {
	val transition = rememberInfiniteTransition(label = "radar")
	val angle by transition.animateFloat(
		initialValue = 0f,
		targetValue = 360f,
		animationSpec = infiniteRepeatable(tween(2_400, easing = LinearEasing), RepeatMode.Restart),
		label = "sweep",
	)
	val wakeSpan = 160f / 360f
	val wake = remember {
		val start = 1f - wakeSpan
		val stops = mutableListOf(0f to Color.Transparent, start to Color.Transparent)
		for (step in 1..48) {
			val t = step / 48f
			stops += (start + t * wakeSpan) to Palette.purple.copy(alpha = t * t * 0.58f)
		}
		stops.toTypedArray()
	}
	Canvas(modifier.size(360.dp)) {
		rotate(angle) {
			// The sweep gradient starts at 3 o'clock; turning it back a quarter puts its
			// end, where the needle sits, at 12 o'clock.
			rotate(-90f) { drawCircle(Brush.sweepGradient(*wake, center = center), size.minDimension / 2) }
			drawIntoCanvas { canvas ->
				val paint = android.graphics.Paint().apply {
					isAntiAlias = true
					color = android.graphics.Color.WHITE
					strokeWidth = 5.2.dp.toPx()
					strokeCap = android.graphics.Paint.Cap.ROUND
					setShadowLayer(6.7.dp.toPx(), 0f, 0f, android.graphics.Color.WHITE)
				}
				canvas.nativeCanvas.drawLine(center.x, center.y, center.x, center.y - 176.dp.toPx(), paint)
			}
		}
	}
}

/** A drop shadow cast by a device render's own shape: black at [opacity], blurred [radius], dropped [y]. */
internal data class RenderShadow(val opacity: Float, val radius: Dp, val y: Dp) {
	companion object {
		// The large render on the device found and connected screens.
		val Hero = RenderShadow(0.5f, 16.dp, 16.dp)
	}
}

/**
 * Where a hardware render is drawn. The renders have very different proportions, so each
 * gets its own frame per place, giving it about the area of the Umbrel Home render there.
 * The upright ROG stops at about 1.4x the Home's height, and the device row keeps its 71dp
 * column so names line up. A null side follows the aspect ratio.
 */
internal enum class UmbrelRenderPlacement {
	DEVICE_ROW,
	HERO,
	PROFILE;

	fun frame(kind: UmbrelDeviceKind): Pair<Dp?, Dp?> = when (this) {
		DEVICE_ROW -> when (kind) {
			UmbrelDeviceKind.HOME, UmbrelDeviceKind.PRO, UmbrelDeviceKind.ASUS_NUC_14_ESSENTIAL,
			UmbrelDeviceKind.ASUS_NUC_16_PRO, UmbrelDeviceKind.GENERIC -> 71.dp to 52.dp
			UmbrelDeviceKind.RASPBERRY_PI -> 71.dp to 60.dp
			UmbrelDeviceKind.ASUS_ROG_NUC_16 -> 71.dp to 73.dp
		}
		HERO -> when (kind) {
			UmbrelDeviceKind.HOME, UmbrelDeviceKind.PRO, UmbrelDeviceKind.RASPBERRY_PI, UmbrelDeviceKind.GENERIC -> 161.dp to null
			UmbrelDeviceKind.ASUS_NUC_14_ESSENTIAL -> 226.dp to null
			UmbrelDeviceKind.ASUS_NUC_16_PRO -> 207.dp to null
			UmbrelDeviceKind.ASUS_ROG_NUC_16 -> null to 164.dp
		}
		PROFILE -> when (kind) {
			UmbrelDeviceKind.HOME, UmbrelDeviceKind.PRO, UmbrelDeviceKind.RASPBERRY_PI, UmbrelDeviceKind.GENERIC -> null to 97.dp
			UmbrelDeviceKind.ASUS_NUC_14_ESSENTIAL -> 187.dp to null
			UmbrelDeviceKind.ASUS_NUC_16_PRO -> 171.dp to null
			UmbrelDeviceKind.ASUS_ROG_NUC_16 -> null to 136.dp
		}
	}
}

/**
 * The bundled hardware render for an Umbrel model, sized for [placement]. Unknown devices
 * use generic hardware rather than implying a Home or Pro; the bare Pi mark sits in a
 * device-shaped tile so it has the same visual weight as the renders.
 */
@Composable
internal fun UmbrelDeviceRender(model: String?, placement: UmbrelRenderPlacement, modifier: Modifier = Modifier, shadow: RenderShadow? = null) {
	val kind = UmbrelDeviceKind.fromModel(model)
	val (width, height) = placement.frame(kind)
	when {
		width != null && height != null -> Box(modifier.size(width, height), contentAlignment = Alignment.Center) {
			UmbrelDeviceRender(kind, Modifier, shadow)
		}
		width != null -> UmbrelDeviceRender(kind, modifier.width(width), shadow)
		height != null -> UmbrelDeviceRender(kind, modifier.height(height), shadow)
		else -> UmbrelDeviceRender(kind, modifier, shadow)
	}
}

@Composable
private fun UmbrelDeviceRender(kind: UmbrelDeviceKind, modifier: Modifier, shadow: RenderShadow?) {
	when (kind) {
		UmbrelDeviceKind.RASPBERRY_PI -> BoxWithConstraints(modifier.aspectRatio(1f), contentAlignment = Alignment.Center) {
			val tile = maxWidth
			val shape = RoundedCornerShape(tile * 27 / 128)
			val density = LocalDensity.current
			Box(
				Modifier
					.fillMaxSize()
					.then(if (shadow != null) Modifier.dropShadow(shape, shadow.compose(density)) else Modifier)
					.clip(shape)
					.background(Color(0xFF525252).copy(alpha = 0.48f))
					.border(1.dp, Brush.verticalGradient(0f to Color.White.copy(alpha = 0.33f), 0.5f to Color.Transparent), shape),
				contentAlignment = Alignment.Center,
			) {
				Image(painterResource(R.drawable.system_pi), contentDescription = null, modifier = Modifier.size(tile / 2))
			}
		}
		UmbrelDeviceKind.HOME -> RenderImage(R.drawable.umbrel_home, modifier, shadow)
		UmbrelDeviceKind.PRO -> RenderImage(R.drawable.umbrel_pro, modifier, shadow)
		UmbrelDeviceKind.ASUS_NUC_14_ESSENTIAL -> RenderImage(R.drawable.asus_nuc_14_essential, modifier, shadow)
		UmbrelDeviceKind.ASUS_NUC_16_PRO -> RenderImage(R.drawable.asus_nuc_16_pro, modifier, shadow)
		UmbrelDeviceKind.ASUS_ROG_NUC_16 -> RenderImage(R.drawable.asus_rog_nuc_16, modifier, shadow)
		UmbrelDeviceKind.GENERIC -> RenderImage(R.drawable.system_generic_device, modifier, shadow)
	}
}

/**
 * A render with a shadow cast by its own silhouette. A mask filter applied while drawing is
 * blurred by the GPU renderer, which on some devices barely blurs it; the shadow is instead
 * blurred once in software with [android.graphics.Bitmap.extractAlpha], as Compose's
 * dropShadow does for shapes, and redone only when the size changes.
 */
@Composable
private fun RenderImage(resource: Int, modifier: Modifier, shadow: RenderShadow?) {
	val bitmap = ImageBitmap.imageResource(resource)
	Spacer(
		modifier.aspectRatio(bitmap.width.toFloat() / bitmap.height).drawWithCache {
			val source = bitmap.asAndroidBitmap()
			val scale = size.width / source.width
			val image = android.graphics.Paint().apply { isFilterBitmap = true }
			val silhouette = shadow?.let {
				val offset = IntArray(2)
				// The blur runs at the source's resolution, so its radius is in source pixels.
				val blur = android.graphics.Paint().apply { maskFilter = BlurMaskFilter(shadowBlur(it.radius.toPx() / scale), BlurMaskFilter.Blur.NORMAL) }
				val alpha = source.extractAlpha(blur, offset)
				val y = it.y.toPx()
				val bounds = android.graphics.RectF(offset[0] * scale, offset[1] * scale + y, (offset[0] + alpha.width) * scale, (offset[1] + alpha.height) * scale + y)
				// An alpha-only bitmap draws in the paint's color.
				Triple(alpha, bounds, android.graphics.Paint().apply { isFilterBitmap = true; color = android.graphics.Color.argb((it.opacity * 255).roundToInt(), 0, 0, 0) })
			}
			val destination = android.graphics.RectF(0f, 0f, size.width, size.height)
			onDrawBehind {
				drawIntoCanvas { canvas ->
					silhouette?.let { (alpha, bounds, paint) -> canvas.nativeCanvas.drawBitmap(alpha, null, bounds, paint) }
					canvas.nativeCanvas.drawBitmap(source, null, destination, image)
				}
			}
		},
	)
}

/** The same shadow as Compose's documented drop shadow, which blurs its shape once in software. */
private fun RenderShadow.compose(density: Density) = Shadow(
	radius = with(density) { shadowBlur(radius.toPx()).toDp() },
	color = Color.Black,
	offset = DpOffset(0.dp, y),
	alpha = opacity,
)

/**
 * SwiftUI blur and shadow radii are Gaussian standard deviations; Android's BlurMaskFilter
 * takes a radius that Skia converts to sigma as radius × 0.57735 + 0.5.
 */
internal fun shadowBlur(sigma: Float): Float = ((sigma - 0.5f) / 0.57735f).coerceAtLeast(0.1f)
