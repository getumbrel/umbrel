package com.umbrel.android.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontVariation
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.umbrel.android.R
import kotlin.math.abs

/** Onboarding palette (Theme.swift on iOS). The app is dark-only. */
object Palette {
	val purple = Color(0xFF742FF1)
	val purpleLight = Color(0xFFA46EFF)
	val textMuted = Color(0xFF837996)
	val error = Color(0xFFF12F59)
	val blue = Color(0xFF00A7E9)
	val green = Color(0xFF34C759)
	val amber = Color(0xFFFFC800)
	val sheet = Color(0xFF1C1C1E)
	val card = Color(0x1AFFFFFF)
}

/** Visual tokens shared across the main-app tabs (MainTheme.swift on iOS). */
object MainTheme {
	// umbrelOS accent blue, used for the selected tab.
	val blue = Color(0xFF00A7E9)

	// Card background: rgba(28,28,28,0.32).
	val card = Color(0xFF1C1C1C).copy(alpha = 0.32f)

	// Tile background inside a card: rgba(255,255,255,0.05).
	val tile = Color.White.copy(alpha = 0.05f)

	// Secondary label gray (gray-3).
	val gray3 = Color(0xFFC7C7CC)

	// Muted label gray, used for sheet section headers and values.
	val gray = Color(0xFF8E8E93)

	// Destructive red.
	val red = Color(0xFFFF4245)

	// Status dot colors.
	val online = Color(0xFF34C759)
	val syncing = Color(0xFFFFC800)

	// Sheet background and the rounded rows on it.
	val sheet = Color(0xFF1C1C1E)
	val sheetRow = Color(0xFF2C2C2E)

	// The filled action in the app-launch sheets.
	val launchAction = Color(0xFF6155F5)

	// SwiftUI's system green in dark mode, the tint of the credentials toggle.
	val toggleGreen = Color(0xFF30D158)

	// The fill of glass controls. Measured on iOS 26 over the sheet and several wallpapers,
	// dark Liquid Glass reads as a mostly opaque dark gray: it lifts near-black backgrounds a
	// little and darkens lighter ones, which a 75% #212121 fill matches.
	val glassFallback = Color(0xFF212121).copy(alpha = 0.75f)

	val contentInset = 20.dp
	val sectionGap = 32.dp
	val cardRadius = 24.dp
	val tileRadius = 16.dp
}

/**
 * Inter (SIL Open Font License, assets/licenses) stands in for SF Pro, which Apple licenses
 * for its own platforms only; umbrelOS uses Inter too. SF Pro switches from its text to its
 * display design at 20 points, so Inter's optical size axis does the same.
 */
private fun inter(opticalSize: Float) = FontFamily(
	listOf(FontWeight.Normal, FontWeight.Medium, FontWeight.SemiBold, FontWeight.Bold).map { weight ->
		Font(
			R.font.inter,
			weight,
			variationSettings = FontVariation.Settings(FontVariation.weight(weight.weight), FontVariation.Setting("opsz", opticalSize)),
		)
	},
)

private val InterText = inter(14f)
private val InterDisplay = inter(32f)

/** Inter's text or display design for a font size, as SF Pro picks between its own. */
internal fun interFor(fontSize: TextUnit): FontFamily = if (fontSize.value >= 20f) InterDisplay else InterText

/** Apple's text styles at their default size, as size and line height. */
object AppleType {
	val largeTitle = TextStyle(fontFamily = InterDisplay, fontSize = 34.sp, lineHeight = 41.sp)
	val title2 = TextStyle(fontFamily = InterDisplay, fontSize = 22.sp, lineHeight = 28.sp)
	val title3 = TextStyle(fontFamily = InterDisplay, fontSize = 20.sp, lineHeight = 25.sp)
	val headline = TextStyle(fontFamily = InterText, fontSize = 17.sp, lineHeight = 22.sp, fontWeight = FontWeight.SemiBold)
	val body = TextStyle(fontFamily = InterText, fontSize = 17.sp, lineHeight = 22.sp)
	val callout = TextStyle(fontFamily = InterText, fontSize = 16.sp, lineHeight = 21.sp)
	val subheadline = TextStyle(fontFamily = InterText, fontSize = 15.sp, lineHeight = 20.sp)
	val footnote = TextStyle(fontFamily = InterText, fontSize = 13.sp, lineHeight = 18.sp)
	val caption = TextStyle(fontFamily = InterText, fontSize = 12.sp, lineHeight = 16.sp)
	val caption2 = TextStyle(fontFamily = InterText, fontSize = 11.sp, lineHeight = 13.sp)
}

/**
 * iOS switches several layouts at the accessibility text sizes, which start at 1.65 times
 * the default body size. Android's font scale steps nearest that boundary are 1.3 and 1.5,
 * so the larger one marks the switch.
 */
@Composable
@ReadOnlyComposable
fun isAccessibilityTextSize(): Boolean = LocalDensity.current.fontScale >= 1.5f

/** The account's umbrelOS brand colour, parsed from "<hue> <sat>% <light>%". */
val LocalBrandColor = compositionLocalOf { MainTheme.blue }

object BrandColor {
	private data class Hsl(val hue: Double, val saturation: Double, val lightness: Double)

	private val fallback = Hsl(259.0, 1.0, 0.59)

	/**
	 * umbreld sends the wallpaper's brand colour as space-separated CSS HSL components.
	 * Anything else, including out-of-range values, uses the umbrelOS default violet.
	 */
	fun color(value: String?, mixWhite: Double = 0.0): Color {
		val hsl = components(value)
		return hslColor(hsl.hue, hsl.saturation, hsl.lightness, mixWhite)
	}

	/**
	 * CSS HSL to sRGB, optionally blended toward white like umbrelOS's
	 * `color-mix(in srgb, <brand>, white)`. Components are clamped so floating-point
	 * error can never reach Compose's range check.
	 */
	fun hslColor(hue: Double, saturation: Double, lightness: Double, mixWhite: Double = 0.0): Color {
		val c = (1 - abs(2 * lightness - 1)) * saturation
		val hp = (hue % 360) / 60
		val x = c * (1 - abs(hp % 2 - 1))
		val (r, g, b) = when {
			hp < 1 -> Triple(c, x, 0.0)
			hp < 2 -> Triple(x, c, 0.0)
			hp < 3 -> Triple(0.0, c, x)
			hp < 4 -> Triple(0.0, x, c)
			hp < 5 -> Triple(x, 0.0, c)
			else -> Triple(c, 0.0, x)
		}
		val m = lightness - c / 2
		val t = mixWhite.coerceIn(0.0, 1.0)
		fun channel(value: Double): Float = ((value + m) + (1 - (value + m)) * t).coerceIn(0.0, 1.0).toFloat()
		return Color(channel(r), channel(g), channel(b))
	}

	private fun components(value: String?): Hsl {
		val parts = value?.split(Regex("\\s+"))?.filter { it.isNotEmpty() } ?: return fallback
		if (parts.size != 3) return fallback
		val hue = parts[0].toDoubleOrNull() ?: return fallback
		val saturation = percentage(parts[1]) ?: return fallback
		val lightness = percentage(parts[2]) ?: return fallback
		if (!hue.isFinite() || hue !in 0.0..360.0) return fallback
		return Hsl(hue, saturation, lightness)
	}

	private fun percentage(value: String): Double? {
		if (!value.endsWith("%")) return null
		val number = value.dropLast(1).toDoubleOrNull() ?: return null
		if (!number.isFinite() || number !in 0.0..100.0) return null
		return number / 100
	}
}

private val DarkScheme = darkColorScheme(
	primary = Palette.purple,
	onPrimary = Color.White,
	secondary = Palette.blue,
	background = Color.Black,
	onBackground = Color.White,
	surface = Palette.sheet,
	onSurface = Color.White,
	surfaceVariant = Color(0xFF2C2C2E),
	onSurfaceVariant = Palette.textMuted,
	// Neutral iOS dark grays instead of Material's tinted defaults, so sheets and alerts
	// match the rest of the app.
	surfaceContainerLowest = Color.Black,
	surfaceContainerLow = Palette.sheet,
	surfaceContainer = Palette.sheet,
	surfaceContainerHigh = Color(0xFF2C2C2E),
	surfaceContainerHighest = Color(0xFF3A3A3C),
	error = Palette.error,
)

// Material's text styles add letter spacing (bodyLarge 0.5 sp, labelLarge 0.1 sp, and so
// on) that Apple's text styles don't have, so every style keeps Material's sizes and
// weights in Inter with no extra tracking.
internal val UntrackedTypography = Typography().run {
	fun TextStyle.untracked() = copy(fontFamily = interFor(fontSize), letterSpacing = 0.sp)
	copy(
		displayLarge = displayLarge.untracked(),
		displayMedium = displayMedium.untracked(),
		displaySmall = displaySmall.untracked(),
		headlineLarge = headlineLarge.untracked(),
		headlineMedium = headlineMedium.untracked(),
		headlineSmall = headlineSmall.untracked(),
		titleLarge = titleLarge.untracked(),
		titleMedium = titleMedium.untracked(),
		titleSmall = titleSmall.untracked(),
		bodyLarge = bodyLarge.untracked(),
		bodyMedium = bodyMedium.untracked(),
		bodySmall = bodySmall.untracked(),
		labelLarge = labelLarge.untracked(),
		labelMedium = labelMedium.untracked(),
		labelSmall = labelSmall.untracked(),
	)
}

@Composable
fun UmbrelTheme(content: @Composable () -> Unit) {
	// Dark-only, like the iOS app; the system setting is ignored deliberately.
	isSystemInDarkTheme()
	MaterialTheme(colorScheme = DarkScheme, typography = UntrackedTypography, content = content)
}
