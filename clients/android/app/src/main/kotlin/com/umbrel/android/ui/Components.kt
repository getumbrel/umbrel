package com.umbrel.android.ui

import androidx.compose.animation.Crossfade
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.requiredSize
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.SheetState
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.material3.pulltorefresh.PullToRefreshDefaults
import androidx.compose.material3.pulltorefresh.rememberPullToRefreshState
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalWindowInfo
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.umbrel.android.R
import com.umbrel.kit.UmbrelDeviceKind
import kotlinx.coroutines.launch
import java.math.RoundingMode
import java.text.NumberFormat
import java.util.Locale

// SwiftUI's easeOut and easeInOut curves.
val AppleEaseOut = CubicBezierEasing(0f, 0f, 0.58f, 1f)
val AppleEaseInOut = CubicBezierEasing(0.42f, 0f, 0.58f, 1f)

@Composable
fun PrimaryButton(text: String, modifier: Modifier = Modifier, enabled: Boolean = true, tint: Color = Palette.purple, onClick: () -> Unit) {
	Button(
		onClick = onClick,
		enabled = enabled,
		modifier = modifier.fillMaxWidth().height(52.dp),
		shape = RoundedCornerShape(26.dp),
		colors = ButtonDefaults.buttonColors(containerColor = tint, contentColor = Color.White),
	) {
		Text(text, fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
	}
}

@Composable
fun SecondaryButton(text: String, modifier: Modifier = Modifier, enabled: Boolean = true, onClick: () -> Unit) {
	Button(
		onClick = onClick,
		enabled = enabled,
		modifier = modifier.fillMaxWidth().height(52.dp),
		shape = RoundedCornerShape(26.dp),
		colors = ButtonDefaults.buttonColors(containerColor = Color.White.copy(alpha = 0.12f), contentColor = Color.White),
	) {
		Text(text, fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
	}
}

/** The transparent brand renders shared with the Apple apps, keyed by the classified model. */
@Composable
fun DeviceRender(kind: UmbrelDeviceKind, modifier: Modifier = Modifier) {
	val resource = when (kind) {
		UmbrelDeviceKind.HOME -> R.drawable.umbrel_home
		UmbrelDeviceKind.PRO -> R.drawable.umbrel_pro
		UmbrelDeviceKind.ASUS_NUC_14_ESSENTIAL -> R.drawable.asus_nuc_14_essential
		UmbrelDeviceKind.ASUS_NUC_16_PRO -> R.drawable.asus_nuc_16_pro
		UmbrelDeviceKind.ASUS_ROG_NUC_16 -> R.drawable.asus_rog_nuc_16
		UmbrelDeviceKind.RASPBERRY_PI -> R.drawable.system_pi
		UmbrelDeviceKind.GENERIC -> R.drawable.system_generic_device
	}
	Image(painter = painterResource(resource), contentDescription = null, modifier = modifier)
}

@Composable
fun StatusLine(text: String, color: Color, modifier: Modifier = Modifier) {
	Row(modifier = modifier, verticalAlignment = Alignment.CenterVertically) {
		Box(Modifier.size(7.dp).clip(CircleShape).background(color))
		Spacer(Modifier.width(6.dp))
		Text(text, color = color, fontSize = 13.sp)
	}
}

@Composable
fun Muted(text: String, modifier: Modifier = Modifier, fontSize: androidx.compose.ui.unit.TextUnit = 14.sp) {
	Text(text, color = Palette.textMuted, fontSize = fontSize, modifier = modifier)
}

// ── Glass and frost ──

/**
 * The specular rim on glass surfaces: light catches the upper-left and lower-right
 * corners. Compose's sweep, like SwiftUI's angular gradient, starts at 3 o'clock and runs
 * clockwise, so the stops carry over unchanged.
 */
val GlintBrush = Brush.sweepGradient(
	0f to Color.White.copy(alpha = 0.06f),
	0.125f to Color.White.copy(alpha = 0.55f), // lower-right corner
	0.375f to Color.White.copy(alpha = 0.06f), // lower-left corner
	0.625f to Color.White.copy(alpha = 0.55f), // upper-left corner
	0.875f to Color.White.copy(alpha = 0.06f), // upper-right corner
	1f to Color.White.copy(alpha = 0.06f),
)

fun Modifier.glassGlint(shape: Shape, width: Dp = 1.dp): Modifier = border(width, GlintBrush, shape)

/**
 * A small glass control, as iOS draws one: [liquidGlass] with the rim on top. Over content
 * a screen hasn't captured as [LocalGlassBackdrop], it is the translucent fill and rim the
 * iOS app uses on systems without Liquid Glass.
 */
@Composable
fun Modifier.glassControl(shape: Shape): Modifier = liquidGlass(shape).glassGlint(shape)

/** The noninteractive variant of [glassControl], without the rim. */
@Composable
fun Modifier.glassSurface(shape: Shape): Modifier = liquidGlass(shape)

/** A frosted card fill reading the wallpaper from the enclosing tab. */
@Composable
fun Modifier.frostBackground(shape: Shape): Modifier = frost(shape, LocalFrostWallpaper.current, LocalWallpaperViewport.current)

/**
 * A frosted-glass rounded card: the blurred wallpaper behind it, darkened by the card
 * tint, with the glint rim.
 */
@Composable
fun SectionCard(modifier: Modifier = Modifier, padding: Dp = 8.dp, content: @Composable () -> Unit) {
	val shape = RoundedCornerShape(MainTheme.cardRadius)
	Box(
		modifier
			.fillMaxWidth()
			.frostBackground(shape)
			.glassGlint(shape)
			.padding(padding),
	) {
		content()
	}
}

/** The size a notice's icon draws at unless its symbol needs another to match iOS. */
val NoticeIconSize = 22.dp

/**
 * A compact notice for an actionable condition above the normal content. The whole
 * surface is the action when one is supplied.
 */
@Composable
fun NoticeCard(
	icon: ImageVector,
	title: String,
	message: String,
	modifier: Modifier = Modifier,
	actionLabel: String? = null,
	onClick: (() -> Unit)? = null,
	iconSize: Dp = NoticeIconSize,
) {
	val shape = RoundedCornerShape(MainTheme.cardRadius)
	Row(
		modifier
			.fillMaxWidth()
			.clip(shape)
			.then(if (onClick != null) Modifier.clickable(role = Role.Button, onClick = onClick) else Modifier)
			.frostBackground(shape)
			.glassGlint(shape)
			.padding(16.dp),
		horizontalArrangement = Arrangement.spacedBy(8.dp),
		verticalAlignment = Alignment.CenterVertically,
	) {
		// A wider symbol overhangs the column rather than moving the text, as on iOS.
		Box(Modifier.width(26.dp), contentAlignment = Alignment.Center) {
			Icon(icon, contentDescription = null, tint = Color.White.copy(alpha = 0.8f), modifier = Modifier.requiredSize(iconSize))
		}
		Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
			Text(title, style = AppleType.footnote, fontWeight = FontWeight.SemiBold, color = Color.White)
			Text(message, style = AppleType.footnote, fontWeight = FontWeight.Medium, color = Color.White.copy(alpha = 0.55f))
		}
		if (onClick != null) {
			if (actionLabel != null) {
				Text(actionLabel, style = AppleType.caption, fontWeight = FontWeight.SemiBold, color = Color.White.copy(alpha = 0.75f), maxLines = 1)
			} else {
				Icon(
					Symbols.ArrowForwardIosSemibold,
					contentDescription = null,
					tint = Color.White.copy(alpha = 0.4f),
					modifier = Modifier.size(14.dp),
				)
			}
		}
	}
}

/**
 * A section header: a bold title, optionally with a chevron, and a trailing accessory.
 * With an action the whole row is one tap target.
 */
@Composable
fun SectionHeader(
	title: String,
	modifier: Modifier = Modifier,
	showsChevron: Boolean = false,
	onClick: (() -> Unit)? = null,
	trailing: (@Composable () -> Unit)? = null,
) {
	val base = modifier.then(if (onClick != null) Modifier.clickable(role = Role.Button, onClick = onClick) else Modifier)
	val titleLabel = @Composable {
		Row(horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.CenterVertically) {
			Text(title, style = AppleType.title3, fontWeight = FontWeight.SemiBold, color = Color.White)
			if (showsChevron) {
				Icon(
					Symbols.ArrowForwardIosSemibold,
					contentDescription = null,
					tint = Color.White.copy(alpha = 0.5f),
					modifier = Modifier.size(12.dp),
				)
			}
		}
	}
	if (isAccessibilityTextSize()) {
		Column(base.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
			titleLabel()
			trailing?.invoke()
		}
	} else {
		Row(base.fillMaxWidth().padding(end = 8.dp), verticalAlignment = Alignment.CenterVertically) {
			titleLabel()
			Spacer(Modifier.weight(1f).widthIn(min = 8.dp))
			trailing?.invoke()
		}
	}
}

/** The trailing label style used across section headers. */
@Composable
fun TrailingLabel(text: String, dot: Color? = null) {
	Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
		if (dot != null) StatusDot(dot)
		Text(text, style = AppleType.subheadline, fontWeight = FontWeight.Medium, color = Color.White.copy(alpha = 0.85f * 0.8f), maxLines = 1)
	}
}

/** A connection or status dot: a solid core inside a translucent halo of the same color. */
@Composable
fun StatusDot(color: Color) {
	Box(Modifier.size(14.dp).background(color.copy(alpha = 0.2f), CircleShape), contentAlignment = Alignment.Center) {
		Box(Modifier.size(6.dp).background(color, CircleShape))
	}
}

/** A small brand-colored pill button with an inset top highlight, inside a 44 tap target. */
@Composable
fun PillButton(title: String, modifier: Modifier = Modifier, icon: ImageVector? = null, isLoading: Boolean = false, onClick: () -> Unit) {
	val brand = LocalBrandColor.current
	Box(
		modifier
			.defaultMinSize(minWidth = 44.dp, minHeight = 44.dp)
			.clickable(enabled = !isLoading, role = Role.Button, onClick = onClick),
		contentAlignment = Alignment.Center,
	) {
		Row(
			Modifier
				.background(brand, CircleShape)
				.border(1.dp, Brush.verticalGradient(0f to Color.White.copy(alpha = 0.25f), 0.5f to Color.Transparent), CircleShape)
				.defaultMinSize(minHeight = 30.dp)
				.padding(horizontal = 16.dp),
			horizontalArrangement = Arrangement.spacedBy(4.dp),
			verticalAlignment = Alignment.CenterVertically,
		) {
			if (isLoading) {
				CircularProgressIndicator(Modifier.size(12.dp), color = Color.White, strokeWidth = 1.5.dp)
			} else if (icon != null) {
				Icon(icon, contentDescription = null, tint = Color.White, modifier = Modifier.size(15.dp))
			}
			Text(title, style = AppleType.footnote, fontWeight = FontWeight.SemiBold, color = Color.White)
		}
	}
}

/** A neutral full-width primary action for focused setup and recovery screens. */
@Composable
fun PrimaryActionButton(title: String, modifier: Modifier = Modifier, isLoading: Boolean = false, onClick: () -> Unit) {
	Row(
		modifier
			.fillMaxWidth()
			.defaultMinSize(minHeight = 50.dp)
			.clip(CircleShape)
			.background(Color.White.copy(alpha = 0.94f))
			.clickable(enabled = !isLoading, role = Role.Button, onClick = onClick),
		horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally),
		verticalAlignment = Alignment.CenterVertically,
	) {
		if (isLoading) CircularProgressIndicator(Modifier.size(16.dp), color = MainTheme.sheet, strokeWidth = 2.dp)
		Text(title, style = AppleType.callout, fontWeight = FontWeight.SemiBold, color = MainTheme.sheet)
	}
}

/** A centred icon, title, subtitle and call-to-action pill, used for empty states. */
@Composable
fun EmptyStateCard(
	icon: ImageVector,
	title: String,
	subtitle: String,
	buttonTitle: String,
	modifier: Modifier = Modifier,
	buttonIcon: ImageVector? = null,
	buttonLoading: Boolean = false,
	learnMore: (() -> Unit)? = null,
	iconSize: Dp = 26.dp,
	onClick: () -> Unit,
) {
	SectionCard(modifier) {
		Column(
			Modifier
				.fillMaxWidth()
				.padding(top = 28.dp, bottom = if (learnMore == null) 28.dp else 4.dp)
				.padding(horizontal = 8.dp),
			horizontalAlignment = Alignment.CenterHorizontally,
			verticalArrangement = Arrangement.spacedBy(14.dp),
		) {
			Icon(icon, contentDescription = null, tint = Color.White.copy(alpha = 0.8f), modifier = Modifier.size(iconSize))
			Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(4.dp)) {
				Text(title, style = AppleType.footnote, fontWeight = FontWeight.SemiBold, color = Color.White, textAlign = TextAlign.Center)
				Text(subtitle, style = AppleType.footnote, fontWeight = FontWeight.Medium, color = Color.White.copy(alpha = 0.5f), textAlign = TextAlign.Center)
			}
			Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(10.dp)) {
				PillButton(buttonTitle, icon = buttonIcon, isLoading = buttonLoading, onClick = onClick)
				if (learnMore != null) {
					Row(
						Modifier.defaultMinSize(minHeight = 44.dp).clickable(role = Role.Button, onClick = learnMore),
						horizontalArrangement = Arrangement.spacedBy(4.dp),
						verticalAlignment = Alignment.CenterVertically,
					) {
						Text("How Photo Backup works", style = AppleType.footnote, fontWeight = FontWeight.Medium, color = Color.White.copy(alpha = 0.65f))
						Icon(
							Symbols.ArrowForwardIosSemibold,
							contentDescription = null,
							tint = Color.White.copy(alpha = 0.65f),
							modifier = Modifier.size(11.dp),
						)
					}
				}
			}
		}
	}
}

/** A round glass control (header back button, sheet actions). */
@Composable
fun CircleIconButton(icon: ImageVector, contentDescription: String, modifier: Modifier = Modifier, iconSize: Dp = 20.dp, onClick: () -> Unit) {
	Box(
		modifier
			.size(42.dp)
			.clip(CircleShape)
			.glassControl(CircleShape)
			.clickable(role = Role.Button, onClick = onClick),
		contentAlignment = Alignment.Center,
	) {
		Icon(icon, contentDescription = contentDescription, tint = Color.White.copy(alpha = 0.85f), modifier = Modifier.size(iconSize))
	}
}

// ── Loading states ──

/** The umbrelOS loading pulse: a slow opacity oscillation on placeholder shapes. */
@Composable
fun Pulsing(modifier: Modifier = Modifier, content: @Composable () -> Unit) {
	val transition = rememberInfiniteTransition(label = "pulse")
	val alpha by transition.animateFloat(
		initialValue = 1f,
		targetValue = 0.45f,
		animationSpec = infiniteRepeatable(tween(900, easing = AppleEaseInOut), RepeatMode.Reverse),
		label = "pulseAlpha",
	)
	Box(modifier.graphicsLayer { this.alpha = alpha }) { content() }
}

/**
 * Crossfades a section from its skeleton to its content when the first load lands. [order]
 * staggers the swap top to bottom, about 60 ms apart, so Home reveals as one cascade.
 */
@Composable
fun LoadReveal(loaded: Boolean, order: Int = 0, content: @Composable () -> Unit, skeleton: @Composable () -> Unit) {
	Crossfade(loaded, animationSpec = tween(350, delayMillis = order * 60, easing = AppleEaseOut), label = "loadReveal") { isLoaded ->
		if (isLoaded) content() else skeleton()
	}
}

/**
 * Bento-style corner rounding: only the outer corners of a grid are rounded, inner corners
 * stay near-square, so a grid of tiles reads as one card.
 */
fun bentoShape(row: Int, col: Int, rows: Int, cols: Int, outer: Dp = MainTheme.tileRadius, inner: Dp = 2.dp): Shape =
	RoundedCornerShape(
		topStart = if (row == 0 && col == 0) outer else inner,
		topEnd = if (row == 0 && col == cols - 1) outer else inner,
		bottomEnd = if (row == rows - 1 && col == cols - 1) outer else inner,
		bottomStart = if (row == rows - 1 && col == 0) outer else inner,
	)

/** A fixed-column grid of equal-width cells with 4 spacing, the layout every bento card uses. */
@Composable
fun BentoGrid(count: Int, columns: Int, modifier: Modifier = Modifier, spacing: Dp = 4.dp, cell: @Composable (index: Int, cellModifier: Modifier) -> Unit) {
	Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(spacing)) {
		for (rowStart in 0 until count step columns) {
			Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(spacing)) {
				for (col in 0 until columns) {
					val index = rowStart + col
					if (index < count) cell(index, Modifier.weight(1f)) else Spacer(Modifier.weight(1f))
				}
			}
		}
	}
}

/** Pulsing placeholder tiles matching the bento grids the real content renders. */
@Composable
fun SkeletonTiles(rows: Int, cols: Int) {
	Pulsing {
		BentoGrid(rows * cols, cols) { index, cellModifier ->
			Box(cellModifier.height(100.dp).background(MainTheme.tile, bentoShape(index / cols, index % cols, rows, cols)))
		}
	}
}

/**
 * Pull to refresh over a tab's scrolling content. The indicator sits [indicatorTop] below
 * the top edge, under the header controls that overlay every tab.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PullToRefresh(onRefresh: suspend () -> Unit, indicatorTop: Dp, modifier: Modifier = Modifier, content: @Composable BoxScope.() -> Unit) {
	val scope = rememberCoroutineScope()
	var refreshing by remember { mutableStateOf(false) }
	val state = rememberPullToRefreshState()
	PullToRefreshBox(
		isRefreshing = refreshing,
		onRefresh = {
			scope.launch {
				refreshing = true
				try {
					onRefresh()
				} finally {
					refreshing = false
				}
			}
		},
		modifier = modifier.fillMaxSize(),
		state = state,
		indicator = {
			PullToRefreshDefaults.Indicator(
				state,
				refreshing,
				Modifier.align(Alignment.TopCenter).padding(top = indicatorTop),
				containerColor = MainTheme.sheetRow,
				color = Color.White,
			)
		},
		content = content,
	)
}

// ── Sheets and settings lists ──

/**
 * iOS's sheet: it rises no higher than the bottom of the status bar, with 38 corners and the
 * sheet background, and its grabber overlays the content 5 below the top edge instead of
 * taking a row above it. A [floating] sheet is iOS's partial-height one, which sits 8 inside
 * the screen's sides and bottom with every corner rounded. Content pads the navigation bar
 * itself.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PageSheet(
	onDismissRequest: () -> Unit,
	sheetState: SheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
	floating: Boolean = false,
	content: @Composable () -> Unit,
) {
	ModalBottomSheet(
		onDismissRequest = onDismissRequest,
		// Outside the sheet's surface, so these are gaps rather than sheet-colored padding.
		modifier = if (floating) Modifier.padding(start = 8.dp, end = 8.dp, bottom = 8.dp) else Modifier.statusBarsPadding(),
		sheetState = sheetState,
		shape = if (floating) RoundedCornerShape(38.dp) else RoundedCornerShape(topStart = 38.dp, topEnd = 38.dp),
		containerColor = MainTheme.sheet,
		dragHandle = null,
		contentWindowInsets = { WindowInsets(0) },
	) {
		Box {
			content()
			Box(
				Modifier
					.align(Alignment.TopCenter)
					.padding(top = 5.dp)
					.size(36.dp, 5.dp)
					.background(SheetGrabber, CircleShape),
			)
		}
	}
}

private val SheetGrabber = Color(0xFF616168)

/** iOS's medium sheet detent, which measures 451 of the iPhone's 874-point screen. */
@Composable
fun mediumSheetHeight(): Dp = with(LocalDensity.current) { (LocalWindowInfo.current.containerSize.height * 451f / 874f).toDp() }

/** A sheet's top bar: a close control at the leading edge and an inline title. */
@Composable
fun SheetToolbar(title: String, onClose: (() -> Unit)?, modifier: Modifier = Modifier, onBack: (() -> Unit)? = null) {
	// iOS centers a sheet's navigation bar 38 below the sheet's top edge, and the bar ends 70
	// below it.
	Box(modifier.fillMaxWidth().padding(top = 6.dp).height(64.dp).padding(horizontal = 16.dp), contentAlignment = Alignment.Center) {
		val leading = onBack ?: onClose
		if (leading != null) {
			Box(
				Modifier
					.align(Alignment.CenterStart)
					.size(44.dp)
					.clip(CircleShape)
					.glassControl(CircleShape)
					.clickable(role = Role.Button, onClick = leading),
				contentAlignment = Alignment.Center,
			) {
				// Sized so the glyphs match iOS's toolbar chevron (11 × 19) and xmark (17 × 17).
				if (onBack != null) {
					Icon(Symbols.ArrowBackIosNewSemibold, contentDescription = "Back", tint = Color.White, modifier = Modifier.size(22.dp))
				} else {
					Icon(Symbols.Close, contentDescription = "Close", tint = Color.White, modifier = Modifier.size(28.dp))
				}
			}
		}
		Text(title, style = AppleType.headline, color = Color.White, maxLines = 1, modifier = Modifier.padding(horizontal = 52.dp))
	}
}

/** A gray section header above a rounded #2C2C2E card of rows. */
@Composable
fun SettingsSection(title: String, modifier: Modifier = Modifier, badge: String? = null, content: @Composable () -> Unit) {
	Column(modifier.padding(vertical = 10.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
		Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
			Text(title, style = AppleType.subheadline, fontWeight = FontWeight.Medium, color = MainTheme.gray)
			if (badge != null) {
				Text(
					badge,
					style = AppleType.caption2,
					fontWeight = FontWeight.SemiBold,
					color = Color.White.copy(alpha = 0.55f),
					modifier = Modifier.background(Color.White.copy(alpha = 0.08f), CircleShape).padding(horizontal = 8.dp, vertical = 4.dp),
				)
			}
		}
		Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(20.dp)).background(MainTheme.sheetRow)) { content() }
	}
}

/** One settings row: icon, title, and a trailing accessory. */
@Composable
fun SettingsRow(icon: ImageVector, title: String, modifier: Modifier = Modifier, iconSize: Dp = 18.dp, trailing: @Composable () -> Unit) {
	Row(
		modifier.fillMaxWidth().padding(start = 8.dp, end = 12.dp, top = 12.dp, bottom = 12.dp),
		horizontalArrangement = Arrangement.spacedBy(4.dp),
		verticalAlignment = Alignment.CenterVertically,
	) {
		Box(Modifier.width(30.dp), contentAlignment = Alignment.Center) {
			Icon(icon, contentDescription = null, tint = Color.White.copy(alpha = 0.9f), modifier = Modifier.requiredSize(iconSize))
		}
		Text(title, style = AppleType.subheadline, fontWeight = FontWeight.Medium, color = Color.White.copy(alpha = 0.9f), modifier = Modifier.weight(1f))
		Spacer(Modifier.width(8.dp))
		trailing()
	}
}

@Composable
fun SettingsDivider() {
	HorizontalDivider(thickness = 1.dp, color = Color.White.copy(alpha = 0.06f))
}

/** A switch tinted with the wallpaper's brand color. */
@Composable
fun SettingsToggle(label: String, checked: Boolean, onCheckedChange: (Boolean) -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true) {
	Switch(
		checked = checked,
		onCheckedChange = onCheckedChange,
		enabled = enabled,
		modifier = modifier.semantics { contentDescription = label },
		colors = settingsSwitchColors(),
	)
}

/**
 * A settings row whose whole surface toggles its switch, the Android settings pattern. A
 * Material switch with its own handler grows to the 48 dp minimum touch target, which makes
 * the row taller than iOS's; with the row as the target the switch keeps its 32 dp height.
 */
@Composable
fun SettingsToggleRow(
	icon: ImageVector,
	title: String,
	checked: Boolean,
	onCheckedChange: (Boolean) -> Unit,
	enabled: Boolean = true,
	iconSize: Dp = 18.dp,
) {
	SettingsRow(
		icon,
		title,
		modifier = Modifier.toggleable(value = checked, enabled = enabled, role = Role.Switch, onValueChange = onCheckedChange),
		iconSize = iconSize,
	) {
		Switch(checked = checked, onCheckedChange = null, enabled = enabled, colors = settingsSwitchColors())
	}
}

@Composable
internal fun settingsSwitchColors() = LocalBrandColor.current.let { brand ->
	SwitchDefaults.colors(checkedTrackColor = brand, checkedThumbColor = Color.White, checkedBorderColor = brand)
}

/** A gray trailing value, optionally with a disclosure chevron. */
@Composable
fun SettingsValue(text: String, chevron: Boolean = false) {
	Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
		Text(text, style = AppleType.subheadline, fontWeight = FontWeight.Medium, color = MainTheme.gray)
		if (chevron) {
			Icon(Symbols.ArrowForwardIosMedium, contentDescription = null, tint = MainTheme.gray, modifier = Modifier.size(16.dp))
		}
	}
}

/** A plain-language explanation row for the information sheets. */
@Composable
fun InfoPageRow(icon: ImageVector, title: String, message: String, iconSize: Dp = 20.dp) {
	Row(Modifier.fillMaxWidth().padding(16.dp), horizontalArrangement = Arrangement.spacedBy(14.dp), verticalAlignment = Alignment.CenterVertically) {
		Box(Modifier.size(28.dp), contentAlignment = Alignment.Center) {
			Icon(icon, contentDescription = null, tint = Color.White.copy(alpha = 0.9f), modifier = Modifier.requiredSize(iconSize))
		}
		Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
			Text(title, style = AppleType.subheadline, fontWeight = FontWeight.SemiBold, color = Color.White)
			Text(message, style = AppleType.footnote, color = MainTheme.gray)
		}
	}
}

@Composable
fun InfoPageDivider() {
	HorizontalDivider(thickness = 1.dp, color = Color.White.copy(alpha = 0.08f))
}

// ── Formatting ──

/**
 * Matches umbrelOS's `formatStorageSize`: base-1000 SI units with one decimal place,
 * rounded to a whole number once the value has three digits, with no space (25GB, 2TB,
 * 12.4GB, 256GB). Rounds half to even and uses the locale's decimal separator, as
 * Apple's number formatter does.
 */
fun formatStorageSize(bytes: Double, locale: Locale = Locale.getDefault()): String {
	val units = listOf("B", "kB", "MB", "GB", "TB", "PB")
	var scaled = bytes
	var unit = 0
	while (scaled >= 1000 && unit < units.lastIndex) {
		scaled /= 1000
		unit++
	}
	val format = NumberFormat.getNumberInstance(locale).apply {
		isGroupingUsed = false
		minimumFractionDigits = 0
		maximumFractionDigits = if (scaled >= 100) 0 else 1
		roundingMode = RoundingMode.HALF_EVEN
	}
	return format.format(scaled) + units[unit]
}
