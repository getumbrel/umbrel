package com.umbrel.android.ui

import android.os.Build
import android.view.View
import androidx.activity.compose.BackHandler
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.GraphicsLayerScope
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.graphics.drawscope.ContentDrawScope
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.layout.LayoutCoordinates
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.paneTitle
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.dp
import androidx.compose.ui.util.lerp
import com.kyant.backdrop.Backdrop
import com.kyant.backdrop.backdrops.layerBackdrop
import com.kyant.backdrop.backdrops.rememberLayerBackdrop
import com.kyant.backdrop.drawBackdrop
import com.kyant.backdrop.effects.blur
import com.kyant.backdrop.effects.lens
import com.kyant.backdrop.effects.vibrancy

private val GlassMenuShape = RoundedCornerShape(26.dp)
private val GlassMenuTint = Color(0xFF1C1C1E).copy(alpha = 0.55f)

// Without blur the page would show through sharp, so the menu is opaque instead.
private val GlassMenuOpaque = Color(0xFF2C2C2E)

private class OpenMenu(
	val anchor: () -> LayoutCoordinates?,
	val onDismiss: () -> Unit,
	val content: @Composable ColumnScope.() -> Unit,
)

private class GlassMenuHostState(val view: View) {
	var open by mutableStateOf<OpenMenu?>(null)
}

private val LocalGlassMenuHost = staticCompositionLocalOf<GlassMenuHostState?> { null }

// False while a menu animates closed, so its items no longer take taps.
private val LocalMenuIsOpen = compositionLocalOf { true }

/**
 * Where the [GlassMenu]s opened inside [content] draw: over it, so they can show it blurred
 * through themselves as an iOS menu does. A menu outside any host, or in another window such
 * as a dialog, is a regular popup. An open menu is composed here rather than where it was
 * opened, so it sees this host's composition locals, not the ones around its button.
 */
@Composable
fun GlassMenuHost(modifier: Modifier = Modifier, content: @Composable () -> Unit) {
	val view = LocalView.current
	val host = remember(view) { GlassMenuHostState(view) }
	var shown by remember { mutableStateOf<OpenMenu?>(null) }
	val shownState = rememberUpdatedState(shown)
	// The content is only recorded for the glass while a menu shows it.
	val backdrop = rememberLayerBackdrop(onDraw = remember<ContentDrawScope.() -> Unit> { { if (shownState.value != null) drawContent() } })
	val progress = remember { Animatable(0f) }
	val open = host.open
	LaunchedEffect(open) {
		if (open != null) {
			shown = open
			progress.animateTo(1f, spring(dampingRatio = 0.8f, stiffness = 500f))
		} else {
			progress.animateTo(0f, tween(140))
			shown = null
		}
	}
	Box(modifier) {
		Box(
			Modifier
				.layerBackdrop(backdrop)
				.graphicsLayer()
				// An open menu is the only thing TalkBack reaches, as with a popup window.
				.then(if (open != null) Modifier.clearAndSetSemantics {} else Modifier),
		) {
			CompositionLocalProvider(LocalGlassMenuHost provides host) { content() }
		}
		shown?.let { menu ->
			MenuOverlay(menu, isOpen = open === menu, backdrop, progress = { progress.value }, Modifier.matchParentSize())
		}
	}
}

/**
 * A menu that opens from the button it's placed beside, in the same [Box], the way
 * Material's DropdownMenu does.
 */
@Composable
fun BoxScope.GlassMenu(expanded: Boolean, onDismissRequest: () -> Unit, content: @Composable ColumnScope.() -> Unit) {
	val host = LocalGlassMenuHost.current?.takeIf { it.view === LocalView.current }
	var anchor by remember { mutableStateOf<LayoutCoordinates?>(null) }
	Spacer(Modifier.matchParentSize().onGloballyPositioned { anchor = it })
	if (host == null) {
		DropdownMenu(
			expanded,
			onDismissRequest,
			shape = GlassMenuShape,
			containerColor = GlassMenuOpaque,
			border = BorderStroke(1.dp, GlintBrush),
		) { content() }
		return
	}
	val dismiss by rememberUpdatedState(onDismissRequest)
	val menuContent by rememberUpdatedState(content)
	DisposableEffect(expanded, host) {
		val menu = if (expanded) OpenMenu({ anchor }, { dismiss() }, { menuContent() }).also { host.open = it } else null
		onDispose { if (menu != null && host.open === menu) host.open = null }
	}
}

// The corner an open menu grows from, worked out when it's placed and read as it's drawn.
private class GrowOrigin {
	var value = TransformOrigin(0f, 0f)
}

@Composable
private fun MenuOverlay(menu: OpenMenu, isOpen: Boolean, backdrop: Backdrop, progress: () -> Float, modifier: Modifier) {
	BackHandler(enabled = isOpen, onBack = menu.onDismiss)
	val origin = remember { GrowOrigin() }
	val margin = 12.dp
	val gap = 6.dp
	Layout(
		// Once it's closing, taps go through to whatever is underneath.
		modifier = modifier.then(if (isOpen) Modifier.pointerInput(menu) { detectTapGestures { menu.onDismiss() } } else Modifier),
		content = {
			CompositionLocalProvider(LocalMenuIsOpen provides isOpen) {
				MenuPanel(menu, backdrop, progress, origin)
			}
		},
	) { measurables, constraints ->
		val placeable = measurables.single().measure(Constraints(maxWidth = constraints.maxWidth, maxHeight = constraints.maxHeight))
		layout(constraints.maxWidth, constraints.maxHeight) {
			val anchorCoordinates = menu.anchor()
			val here = coordinates
			val anchor = if (anchorCoordinates != null && here != null && anchorCoordinates.isAttached) {
				here.localBoundingBoxOf(anchorCoordinates, clipBounds = false)
			} else {
				Rect.Zero
			}
			val marginPx = margin.roundToPx()
			// Opens toward the middle of the screen from whichever side the button is on.
			// Placed in screen terms, so it lands under the button in either reading direction.
			val fromLeft = anchor.center.x < constraints.maxWidth / 2f
			val x = (if (fromLeft) anchor.left else anchor.right - placeable.width).toInt()
				.coerceIn(marginPx, (constraints.maxWidth - placeable.width - marginPx).coerceAtLeast(marginPx))
			val below = (anchor.bottom + gap.toPx()).toInt()
			val y = if (below + placeable.height <= constraints.maxHeight - marginPx) below else (anchor.top - gap.toPx() - placeable.height).toInt()
			origin.value = TransformOrigin(if (fromLeft) 0f else 1f, 0f)
			placeable.placeWithLayer(x, y.coerceAtLeast(marginPx)) {
				alpha = progress().coerceIn(0f, 1f)
			}
		}
	}
}

@Composable
private fun MenuPanel(menu: OpenMenu, backdrop: Backdrop, progress: () -> Float, origin: GrowOrigin) {
	val grow: GraphicsLayerScope.() -> Unit = {
		val scale = lerp(0.6f, 1f, progress())
		scaleX = scale
		scaleY = scale
		transformOrigin = origin.value
	}
	val surface = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
		Modifier.drawBackdrop(
			backdrop = backdrop,
			shape = { GlassMenuShape },
			effects = {
				vibrancy()
				blur(16.dp.toPx())
				lens(16.dp.toPx(), 24.dp.toPx())
			},
			// Scaled through the library, which keeps the page behind still while the panel grows.
			layerBlock = grow,
			shadow = null,
			onDrawSurface = { drawRect(GlassMenuTint) },
		)
	} else {
		Modifier.graphicsLayer(grow).background(GlassMenuOpaque, GlassMenuShape)
	}
	Column(
		Modifier
			.semantics { paneTitle = "Menu" }
			// Swallows its own taps so only taps outside close it.
			.pointerInput(Unit) { detectTapGestures { } }
			.width(IntrinsicSize.Max)
			.widthIn(min = 210.dp, max = 290.dp)
			.then(surface)
			.padding(vertical = 8.dp),
		content = menu.content,
	)
}

/** One item: its icon leading, as in iOS 26 menus. */
@Composable
fun GlassMenuItem(text: String, icon: ImageVector? = null, onClick: () -> Unit) {
	val interaction = remember { MutableInteractionSource() }
	val pressed by interaction.collectIsPressedAsState()
	Row(
		Modifier
			.fillMaxWidth()
			.padding(horizontal = 8.dp)
			.background(if (pressed) Color.White.copy(alpha = 0.12f) else Color.Transparent, RoundedCornerShape(18.dp))
			.clickable(interaction, indication = null, enabled = LocalMenuIsOpen.current, role = Role.Button, onClick = onClick)
			.heightIn(min = 48.dp)
			.padding(horizontal = 12.dp),
		verticalAlignment = Alignment.CenterVertically,
		horizontalArrangement = Arrangement.spacedBy(12.dp),
	) {
		if (icon != null) Icon(icon, contentDescription = null, tint = Color.White, modifier = Modifier.size(20.dp))
		Text(text, style = AppleType.body, color = Color.White, maxLines = 1)
	}
}

/** A hairline between groups of items. */
@Composable
fun GlassMenuDivider() {
	Box(
		Modifier
			.fillMaxWidth()
			.padding(horizontal = 20.dp, vertical = 6.dp)
			.height(1.dp)
			.background(Color.White.copy(alpha = 0.12f)),
	)
}
