package com.umbrel.android.main

import android.annotation.SuppressLint
import android.content.ClipData
import android.content.ClipDescription
import android.os.PersistableBundle
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.ColorMatrix
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.ClipEntry
import androidx.compose.ui.platform.LocalClipboard
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalWindowInfo
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.umbrel.android.ui.AppleEaseInOut
import com.umbrel.android.ui.AppleEaseOut
import com.umbrel.android.ui.AppleType
import com.umbrel.android.ui.MainTheme
import com.umbrel.android.ui.PageSheet
import com.umbrel.android.ui.Symbols
import com.umbrel.android.ui.isAccessibilityTextSize
import com.umbrel.android.ui.mediumSheetHeight
import com.umbrel.android.browser.browserSource
import com.umbrel.kit.Umbreld
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** SwiftUI's `brightness(-0.4)`: subtracts 0.4 from every colour channel. */
private val DimmedIcon = ColorFilter.colorMatrix(
	ColorMatrix(
		floatArrayOf(
			1f, 0f, 0f, 0f, -0.4f * 255,
			0f, 1f, 0f, 0f, -0.4f * 255,
			0f, 0f, 1f, 0f, -0.4f * 255,
			0f, 0f, 0f, 1f, 0f,
		),
	),
)

/**
 * An app icon and name. The Home card uses gray-3 labels; the Apps tab uses white, which
 * stays legible directly over the wallpaper.
 */
@Composable
fun AppTile(
	app: Umbreld.AppSummary,
	modifier: Modifier = Modifier,
	labelColor: Color = MainTheme.gray3,
	preparing: Boolean = false,
	iconModifier: Modifier = Modifier,
) {
	val title = app.name ?: app.id
	val presentation = AppTilePresentation.from(app.state)
	val dimmed = presentation.dimsIcon || preparing
	val dim by animateFloatAsState(if (dimmed) 1f else 0f, tween(200, easing = AppleEaseInOut), label = "iconDim")
	Column(
		modifier.clearAndSetSemantics {
			contentDescription = title
			stateDescription = if (preparing) "Opening" else presentation.accessibilityValue.orEmpty()
			role = Role.Button
		},
		horizontalAlignment = Alignment.CenterHorizontally,
		verticalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterVertically),
	) {
		Box(contentAlignment = Alignment.Center) {
			AppIconView(app.icon, iconModifier, colorFilter = if (dim > 0f) dimFilter(dim) else null)
			when {
				preparing -> CircularProgressIndicator(Modifier.size(20.dp), color = Color.White, strokeWidth = 2.dp)
				presentation is AppTilePresentation.InProgress -> AppStateProgressBar(presentation.reportedProgress(app.progress))
				else -> StateSymbol(presentation.symbol)
			}
		}
		AnimatedContent(
			presentation.label(title),
			transitionSpec = { fadeIn(tween(200, easing = AppleEaseInOut)) togetherWith fadeOut(tween(200, easing = AppleEaseInOut)) },
			label = "tileLabel",
		) { label ->
			Text(
				label,
				style = AppleType.caption2,
				fontWeight = FontWeight.Medium,
				color = labelColor,
				maxLines = 1,
				overflow = TextOverflow.Ellipsis,
				modifier = Modifier.padding(horizontal = 4.dp),
			)
		}
	}
}

/** The pause or warning glyph over a stopped or unavailable app, scaling in from 85%. */
@Composable
private fun StateSymbol(symbol: AppTilePresentation.Symbol?) {
	AnimatedVisibility(
		visible = symbol != null,
		enter = fadeIn(tween(200, easing = AppleEaseInOut)) + scaleIn(tween(200, easing = AppleEaseInOut), initialScale = 0.85f),
		exit = fadeOut(tween(200, easing = AppleEaseInOut)) + scaleOut(tween(200, easing = AppleEaseInOut), targetScale = 0.85f),
	) {
		val icon = if (symbol == AppTilePresentation.Symbol.PAUSED) Symbols.PauseCircleMedium else Symbols.WarningAmberMedium
		Icon(icon, contentDescription = null, tint = Color.White.copy(alpha = 0.9f), modifier = Modifier.size(28.dp))
	}
}

private fun dimFilter(amount: Float): ColorFilter = if (amount >= 1f) {
	DimmedIcon
} else {
	val offset = -0.4f * 255 * amount
	ColorFilter.colorMatrix(
		ColorMatrix(floatArrayOf(1f, 0f, 0f, 0f, offset, 0f, 1f, 0f, 0f, offset, 0f, 0f, 1f, 0f, offset, 0f, 0f, 0f, 1f, 0f)),
	)
}

/**
 * The compact lifecycle bar umbrelOS uses: reported progress for installs and updates, and
 * an indeterminate sweep for transitions without meaningful progress.
 */
@Composable
private fun AppStateProgressBar(progress: Double?) {
	val width = 34.dp
	val height = 3.5.dp
	Box(Modifier.size(width, height).clip(CircleShape).background(Color.White.copy(alpha = 0.4f))) {
		if (progress != null) {
			val fraction by animateFloatAsState((progress / 100).toFloat(), tween(350, easing = AppleEaseOut), label = "progress")
			Box(Modifier.fillMaxHeight().width(width * fraction).clip(CircleShape).background(Color.White.copy(alpha = 0.9f)))
		} else {
			val sweep by rememberInfiniteTransition(label = "sweep").animateFloat(
				initialValue = -0.3f,
				targetValue = 1f,
				animationSpec = infiniteRepeatable(tween(1_200, easing = LinearEasing), RepeatMode.Restart),
				label = "sweepOffset",
			)
			Box(
				Modifier
					.fillMaxHeight()
					.width(width * 0.3f)
					.graphicsLayer { translationX = width.toPx() * sweep }
					.clip(CircleShape)
					.background(Color.White.copy(alpha = 0.9f)),
			)
		}
	}
}

/**
 * A tappable app tile; [onClick] runs the launch flow in the view model with the tile's
 * icon as the place the app's page grows out of.
 */
@Composable
fun AppTileButton(app: Umbreld.AppSummary, preparing: Boolean, onClick: (source: Any) -> Unit, modifier: Modifier = Modifier, labelColor: Color = MainTheme.gray3) {
	val busy = AppLaunchDisposition.from(app.state) == AppLaunchDisposition.BUSY
	val enabled = !preparing && !busy
	val source = remember { Any() }
	AppTile(
		app,
		// As on iOS, a tile that can't be opened right now draws at half opacity, icon and label.
		modifier.alpha(if (enabled) 1f else 0.5f).clickable(enabled = enabled, role = Role.Button) { onClick(source) },
		labelColor = labelColor,
		preparing = preparing,
		iconModifier = Modifier.browserSource(source),
	)
}

/**
 * The "+N apps" tile: fanned mini icons of the first extra apps, the front one largest and
 * tilted left, shrinking, shifting right and tilting right toward the back.
 */
@Composable
fun OverflowTile(count: Int, sample: List<Umbreld.AppSummary>, modifier: Modifier = Modifier) {
	Column(modifier, horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterVertically)) {
		Box(Modifier.size(45.dp), contentAlignment = Alignment.Center) {
			for (slot in OverflowSlots) {
				val app = sample.getOrNull(slot.sampleIndex) ?: continue
				AppIconView(
					app.icon,
					size = slot.size.dp,
					corner = (slot.size * 0.25f).dp,
					modifier = Modifier
						.offset(slot.x.dp, slot.y.dp)
						.graphicsLayer { rotationZ = slot.rotation }
						.shadow(4.dp, RoundedCornerShape((slot.size * 0.25f).dp), ambientColor = Color.Black.copy(alpha = 0.25f), spotColor = Color.Black.copy(alpha = 0.25f)),
				)
			}
		}
		Text("+$count apps", style = AppleType.caption2, fontWeight = FontWeight.Medium, color = MainTheme.gray3)
	}
}

private class OverflowSlot(val size: Float, val rotation: Float, val x: Float, val y: Float, val sampleIndex: Int)

// Back to front, for correct stacking; the front-most slot shows the first extra app.
private val OverflowSlots = listOf(
	OverflowSlot(21.8f, 11.38f, 13.6f, 2.5f, 2),
	OverflowSlot(24.2f, 2.95f, 0.2f, 0.3f, 1),
	OverflowSlot(27.4f, -12.99f, -12.8f, 1.5f, 0),
)

// ── Launch alerts and sheets ──

/** The alerts and sheets an app tap can end in, driven by the view model's launch state. */
@Composable
fun AppLaunchDialogs(model: MainViewModel, state: MainUiState) {
	state.appLaunchAlert?.let { alert ->
		val destination = alert.ownerDestination(state.canManageApps)
		AlertDialog(
			onDismissRequest = model::dismissAppLaunchAlert,
			title = { Text(alert.title) },
			text = { Text(alert.message(state.canManageApps)) },
			confirmButton = {
				if (destination != null) {
					TextButton(onClick = {
						model.dismissAppLaunchAlert()
						model.openDashboard(destination)
					}) { Text("Open Umbrel") }
				} else {
					TextButton(onClick = model::dismissAppLaunchAlert) { Text("OK") }
				}
			},
			dismissButton = if (destination != null) {
				{ TextButton(onClick = model::dismissAppLaunchAlert) { Text("Cancel") } }
			} else {
				null
			},
		)
	}
	when (val sheet = state.appLaunchSheet) {
		is AppLaunchSheet.Credentials -> CredentialsSheet(sheet.app, onContinue = model::continueFromCredentials, onDismiss = model::dismissAppLaunchSheet)
		null -> Unit
	}
}

/**
 * The medium launch sheet for an app's credentials; full height at
 * accessibility text sizes, where the content needs the room.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun LaunchSheet(onDismiss: () -> Unit, content: @Composable ColumnScope.() -> Unit) {
	val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
	val fullHeight = isAccessibilityTextSize()
	val screenHeight = with(LocalDensity.current) { LocalWindowInfo.current.containerSize.height.toDp() }
	val height = if (fullHeight) screenHeight else mediumSheetHeight()
	PageSheet(onDismissRequest = onDismiss, sheetState = sheetState, floating = !fullHeight) {
		Column(
			Modifier.fillMaxWidth().height(height).navigationBarsPadding().padding(horizontal = 24.dp),
			horizontalAlignment = Alignment.CenterHorizontally,
		) {
			content()
		}
	}
}

/**
 * Shown before opening an app that ships default sign-in credentials, as umbrelOS does:
 * the user copies them, then continues into the app.
 */
@Composable
private fun CredentialsSheet(app: Umbreld.AppSummary, onContinue: (dontShowAgain: Boolean) -> Unit, onDismiss: () -> Unit) {
	var dontShowAgain by rememberSaveable { mutableStateOf(false) }
	LaunchSheet(onDismiss) {
		AppIconView(app.icon, size = 64.dp, corner = 16.dp, modifier = Modifier.padding(top = 40.dp))
		Text(app.name ?: app.id, style = AppleType.title3, fontWeight = FontWeight.SemiBold, color = Color.White, modifier = Modifier.padding(top = 16.dp))
		Text("Sign in to this app with its default credentials.", style = AppleType.subheadline, color = MainTheme.gray, textAlign = TextAlign.Center, modifier = Modifier.padding(top = 4.dp))
		val credentials = app.credentials
		Column(Modifier.padding(top = 24.dp).fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(MainTheme.sheetRow)) {
			credentials?.defaultUsername?.let { CredentialRow("Username", it) }
			if (credentials?.defaultUsername != null && credentials.defaultPassword != null) {
				HorizontalDivider(thickness = 1.dp, color = Color.White.copy(alpha = 0.06f))
			}
			credentials?.defaultPassword?.let { CredentialRow("Password", it) }
		}
		Row(Modifier.fillMaxWidth().padding(top = 20.dp).padding(horizontal = 4.dp), verticalAlignment = Alignment.CenterVertically) {
			Text("Don't show this again", style = AppleType.subheadline, color = MainTheme.gray, modifier = Modifier.weight(1f))
			Switch(
				checked = dontShowAgain,
				onCheckedChange = { dontShowAgain = it },
				colors = SwitchDefaults.colors(checkedTrackColor = MainTheme.toggleGreen, checkedThumbColor = Color.White, checkedBorderColor = MainTheme.toggleGreen),
			)
		}
		Spacer(Modifier.weight(1f))
		LaunchSheetButton("Open ${app.name ?: "app"}") { onContinue(dontShowAgain) }
	}
}

/**
 * Tap to copy, with a brief checkmark. The clip is marked sensitive so Android 13 and later
 * hide it in the copy preview and keyboard suggestions. iOS also expires the clip after two
 * minutes; Android's clipboard has no expiry, so the value stays until replaced.
 */
@SuppressLint("InlinedApi")
@Composable
private fun CredentialRow(label: String, value: String) {
	val clipboard = LocalClipboard.current
	val scope = rememberCoroutineScope()
	var copied by remember { mutableStateOf(false) }
	LaunchedEffect(copied) {
		if (!copied) return@LaunchedEffect
		delay(1_500)
		copied = false
	}
	Row(
		Modifier
			.fillMaxWidth()
			.defaultMinSize(minHeight = 52.dp)
			.clickable(role = Role.Button) {
				// EXTRA_IS_SENSITIVE is a string constant compiled into the app; earlier
				// releases ignore it and show no preview.
				val clip = ClipData.newPlainText(label, value).apply {
					description.extras = PersistableBundle().apply { putBoolean(ClipDescription.EXTRA_IS_SENSITIVE, true) }
				}
				scope.launch { clipboard.setClipEntry(ClipEntry(clip)) }
				copied = true
			}
			.padding(horizontal = 16.dp),
		horizontalArrangement = Arrangement.spacedBy(12.dp),
		verticalAlignment = Alignment.CenterVertically,
	) {
		Text(label, style = AppleType.subheadline, fontWeight = FontWeight.Medium, color = MainTheme.gray)
		// The value takes the remaining width, so a long one truncates before the copy icon.
		Text(
			value,
			style = AppleType.subheadline,
			fontWeight = FontWeight.Medium,
			color = Color.White,
			textAlign = TextAlign.End,
			maxLines = 1,
			overflow = TextOverflow.MiddleEllipsis,
			modifier = Modifier.weight(1f),
		)
		Icon(
			if (copied) Symbols.Check else Symbols.ContentCopy,
			contentDescription = if (copied) "Copied" else "Copy",
			tint = MainTheme.gray,
			modifier = Modifier.size(16.dp),
		)
	}
}

@Composable
private fun LaunchSheetButton(title: String, onClick: () -> Unit) {
	Box(
		Modifier
			.padding(bottom = 20.dp)
			.fillMaxWidth()
			.defaultMinSize(minHeight = 48.dp)
			.clip(CircleShape)
			.background(MainTheme.launchAction)
			.clickable(role = Role.Button, onClick = onClick),
		contentAlignment = Alignment.Center,
	) {
		Text(title, style = AppleType.headline, color = Color.White)
	}
}
