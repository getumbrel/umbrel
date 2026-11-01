package com.umbrel.android.browser

import android.content.Intent
import android.view.View
import android.view.Window
import androidx.activity.BackEventCompat
import androidx.activity.compose.BackHandler
import androidx.activity.compose.PredictiveBackHandler
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.awaitVerticalTouchSlopOrCancellation
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsTopHeight
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.RoundRect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.geometry.isSpecified
import androidx.compose.ui.geometry.lerp
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.graphics.CompositingStrategy
import androidx.compose.ui.graphics.Outline
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.positionChanged
import androidx.compose.ui.input.pointer.util.VelocityTracker
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInWindow
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.compose.ui.window.DialogWindowProvider
import androidx.compose.ui.zIndex
import androidx.core.view.WindowCompat
import com.kyant.backdrop.backdrops.layerBackdrop
import com.kyant.backdrop.backdrops.rememberLayerBackdrop
import com.umbrel.android.R
import com.umbrel.android.main.AppIconView
import com.umbrel.android.ui.AppleType
import com.umbrel.android.ui.GlassMenu
import com.umbrel.android.ui.GlassMenuDivider
import com.umbrel.android.ui.GlassMenuHost
import com.umbrel.android.ui.GlassMenuItem
import com.umbrel.android.ui.LocalBrandColor
import com.umbrel.android.ui.LocalGlassBackdrop
import com.umbrel.android.ui.MainTheme
import com.umbrel.android.ui.PillButton
import com.umbrel.android.ui.PrimaryActionButton
import com.umbrel.android.ui.Symbols
import com.umbrel.android.ui.glassControl
import com.umbrel.android.ui.openUrl
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** The height of the title bar over an app's page, and of the header umbrelOS starts beneath. */
internal val BrowserBarHeight = 50.dp

// SwiftUI's default spring (0.5 s, no bounce), which its zoom transition uses.
private val ZoomSpring = spring<Float>(dampingRatio = 1f, stiffness = 157.9f)

// ── umbrelOS in place ──

/**
 * umbrelOS, in place. The app and umbrelOS share one wallpaper, so opening umbrelOS is not
 * presented as a page at all: the wallpaper and the header hold perfectly still, the native
 * screen dissolves from between them, and umbrelOS's interface arrives in its place.
 */
@Composable
internal fun UmbrelOSLayer(page: BrowserPage, isShown: Boolean, modifier: Modifier = Modifier) {
	val isReady = page.isRevealed && page.failure == null
	// Arrives a touch larger than life and settles, the reverse of how it leaves.
	val shown by animateFloatAsState(
		if (isShown) 1f else 0f,
		if (isShown) spring(dampingRatio = 0.88f, stiffness = 224f) else tween(160, easing = { it * it }),
		label = "umbrelOS",
	)
	val ready by animateFloatAsState(if (isReady) 1f else 0f, tween(300), label = "umbrelOS ready")
	var showsProgress by remember { mutableStateOf(false) }
	// Hidden, umbrelOS can't be touched or read: it stays laid out only to be ready.
	LaunchedEffect(page.webView, isShown) {
		page.webView.importantForAccessibility =
			if (isShown) View.IMPORTANT_FOR_ACCESSIBILITY_AUTO else View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS
	}
	LaunchedEffect(page.isRevealed) {
		// Only admit to loading if it takes long enough to notice.
		showsProgress = false
		if (page.isRevealed) return@LaunchedEffect
		delay(500)
		showsProgress = true
	}

	Column(
		modifier
			.fillMaxSize()
			// Above the tabs while it's on screen or leaving; beneath everything otherwise, kept
			// laid out at full size so it's ready the moment it's opened.
			.zIndex(if (isShown || shown > 0f) 1f else -1f)
			.graphicsLayer {
				alpha = shown
				val scale = 1.04f - 0.04f * shown
				scaleX = scale
				scaleY = scale
			},
	) {
		// The app's header stays put above; umbrelOS begins beneath it.
		Spacer(Modifier.windowInsetsTopHeight(WindowInsets.statusBars))
		Spacer(Modifier.height(BrowserBarHeight))
		Box(Modifier.fillMaxWidth().weight(1f).navigationBarsPadding().imePadding()) {
			BrowserWebView(
				page.webView,
				Modifier
					.fillMaxSize()
					.graphicsLayer {
						alpha = ready
						// The page's top and bottom edges are feathered so umbrelOS's dimming and
						// sheets fade out there instead of ending in a line.
						compositingStrategy = CompositingStrategy.Offscreen
					}
					.drawWithContent {
						drawContent()
						val top = 14.dp.toPx() / size.height
						val bottom = 1f - 10.dp.toPx() / size.height
						drawRect(
							Brush.verticalGradient(0f to Color.Transparent, top to Color.Black, bottom to Color.Black, 1f to Color.Transparent),
							blendMode = BlendMode.DstIn,
						)
					},
			)
			val failure = page.failure
			if (failure != null) {
				FailureCard(failure, onTryAgain = page::reload)
			} else if (!page.isRevealed && showsProgress) {
				CircularProgressIndicator(Modifier.align(Alignment.Center).size(28.dp), color = Color.White, strokeWidth = 2.5.dp)
			}
		}
	}
	PageEffects(page, isShown)
}

@Composable
private fun FailureCard(failure: BrowserPage.Failure, onTryAgain: () -> Unit) {
	Column(
		Modifier.fillMaxSize().padding(horizontal = 36.dp),
		verticalArrangement = Arrangement.Center,
		horizontalAlignment = Alignment.CenterHorizontally,
	) {
		Icon(Symbols.WifiAlertMedium, contentDescription = null, tint = Color.White.copy(alpha = 0.7f), modifier = Modifier.padding(bottom = 16.dp).size(39.dp))
		Text(failure.title, style = AppleType.title3.copy(fontWeight = FontWeight.SemiBold), color = Color.White, textAlign = TextAlign.Center)
		Text(failure.message, style = AppleType.subheadline, color = Color.White.copy(alpha = 0.7f), textAlign = TextAlign.Center, modifier = Modifier.padding(top = 8.dp))
		PillButton("Try Again", Modifier.padding(top = 16.dp), onClick = onTryAgain)
	}
}

// ── An app's page ──

/**
 * Presents the app page over everything, so a page opened from a sheet covers it. The page
 * grows out of the icon that was tapped and settles back into it when closed. Only a drag
 * that starts on the title bar closes it: everything below belongs to the page.
 */
@Composable
internal fun PresentedBrowser(browser: Browser) {
	val page = browser.page ?: return
	if (!browser.showsPresentation) return
	Dialog(
		onDismissRequest = {},
		properties = DialogProperties(
			dismissOnBackPress = false,
			dismissOnClickOutside = false,
			usePlatformDefaultWidth = false,
			decorFitsSystemWindows = false,
		),
	) {
		val window = (LocalView.current.parent as? DialogWindowProvider)?.window
		// The zoom replaces the window animation, and whatever is behind stays visible
		// through it instead of the default dim.
		SideEffect {
			window?.setDimAmount(0f)
			window?.setWindowAnimations(0)
		}
		PresentedPage(browser, page, window)
	}
}

@Composable
private fun PresentedPage(browser: Browser, page: BrowserPage, window: Window?) {
	val scope = rememberCoroutineScope()
	val density = LocalDensity.current
	val context = LocalContext.current
	val presentation = remember { Animatable(0f) }
	var origin by remember { mutableStateOf(Offset.Unspecified) }
	var drag by remember { mutableStateOf(Offset.Zero) }
	var dragScale by remember { mutableFloatStateOf(1f) }
	var settle by remember { mutableStateOf<Job?>(null) }
	val currentPage by rememberUpdatedState(page)

	fun dismiss() {
		if (browser.isPresented) browser.close()
	}

	LaunchedEffect(Unit) { presentation.animateTo(1f, ZoomSpring) }
	LaunchedEffect(browser.isPresented) {
		if (browser.isPresented) return@LaunchedEffect
		presentation.animateTo(0f, ZoomSpring)
		browser.didDismiss()
	}

	BackHandler(enabled = currentPage.canGoBack && currentPage.fullScreen == null) { currentPage.goBack() }
	PredictiveBackHandler(enabled = !currentPage.canGoBack && browser.isPresented && currentPage.fullScreen == null) { progress ->
		try {
			progress.collect { event ->
				// Android's in-app back preview: the page shrinks toward 90% and shifts away
				// from the edge being swiped.
				val direction = if (event.swipeEdge == BackEventCompat.EDGE_LEFT) 1 else -1
				dragScale = 1f - 0.1f * event.progress
				drag = Offset(direction * with(density) { 8.dp.toPx() } * event.progress, 0f)
			}
			dismiss()
		} catch (cancelled: CancellationException) {
			drag = Offset.Zero
			dragScale = 1f
			throw cancelled
		}
	}

	BoxWithConstraints(Modifier.fillMaxSize().onGloballyPositioned { origin = it.positionInWindow() }) {
		val full = with(density) { Rect(0f, 0f, maxWidth.toPx(), maxHeight.toPx()) }
		val source = browser.sources.bounds(browser.sourceId)?.takeIf { origin.isSpecified }?.translate(-origin)
		val dragFraction = min(1f, abs(drag.y) / with(density) { 400.dp.toPx() })
		Box(Modifier.fillMaxSize().graphicsLayer { alpha = presentation.value * (1f - dragFraction) }.background(Color.Black))
		Box(
			Modifier
				.fillMaxSize()
				.graphicsLayer {
					val target = dragged(full, drag, dragScale)
					val progress = presentation.value
					if (source == null) {
						// Nothing on screen to grow out of: fade and settle instead.
						alpha = progress
						val scale = (0.9f + 0.1f * progress) * (target.width / full.width)
						scaleX = scale
						scaleY = scale
						translationX = target.left
						translationY = target.top
						transformOrigin = TransformOrigin(0.5f, 0.5f)
						return@graphicsLayer
					}
					val frame = zoomFrame(progress, source, target)
					val scale = frame.image.width / full.width
					transformOrigin = TransformOrigin(0f, 0f)
					scaleX = scale
					scaleY = scale
					translationX = frame.image.left
					translationY = frame.image.top
					clip = true
					val corner = with(density) { 14.dp.toPx() } * (1f - progress)
					shape = LocalRectShape(
						Rect(
							(frame.clip.left - frame.image.left) / scale,
							(frame.clip.top - frame.image.top) / scale,
							(frame.clip.right - frame.image.left) / scale,
							(frame.clip.bottom - frame.image.top) / scale,
						),
						corner / scale,
					)
				},
		) {
			BrowserPageView(
				page,
				onClose = ::dismiss,
				onOpenInBrowser = {
					scope.launch { browser.browserUrlForOpening(page)?.let(context::openUrl) }
				},
				window = window,
				barDrag = Modifier.pointerInput(page) {
					detectBarDrag(
						onDrag = { offset ->
							settle?.cancel()
							drag = offset
							dragScale = 1f - 0.25f * min(1f, abs(offset.y) / size.height.toFloat())
						},
						onEnd = { offset, velocity ->
							if (offset.y > with(density) { 100.dp.toPx() } || velocity > with(density) { 1000.dp.toPx() }) {
								dismiss()
							} else {
								settle = scope.launch {
									val start = drag
									val startScale = dragScale
									Animatable(0f).animateTo(1f, spring(stiffness = 400f)) {
										drag = start * (1f - value)
										dragScale = startScale + (1f - startScale) * value
									}
								}
							}
						},
					)
				},
			)
		}
	}
}

/** [rect] moved by [offset] and scaled by [scale] about its center: a page being dragged away. */
private fun dragged(rect: Rect, offset: Offset, scale: Float): Rect {
	val size = rect.size * scale
	return Rect(rect.center + offset - Offset(size.width / 2, size.height / 2), size)
}

/** One frame of the zoom between an icon and the page: the page scaled to cover the icon, clipped to it. */
private data class ZoomFrame(val image: Rect, val clip: Rect)

private fun zoomFrame(progress: Float, source: Rect, full: Rect): ZoomFrame {
	val aspect = full.width / full.height
	val width = max(source.width, source.height * aspect)
	val height = width / aspect
	val cover = Rect(Offset(source.center.x - width / 2, source.center.y - height / 2), Size(width, height))
	return ZoomFrame(lerp(cover, full, progress), lerp(source, full, progress))
}

/** A rounded rectangle at a fixed place inside the layer, for clipping a scaled layer to a smaller frame. */
private class LocalRectShape(private val rect: Rect, private val corner: Float) : Shape {
	override fun createOutline(size: Size, layoutDirection: LayoutDirection, density: Density): Outline =
		Outline.Rounded(RoundRect(rect, CornerRadius(corner)))
}

/**
 * A vertical drag that starts on the title bar pulls the page away to close it, as iOS's zoom
 * transition allows from the bar. The bar's buttons keep their taps.
 */
private suspend fun androidx.compose.ui.input.pointer.PointerInputScope.detectBarDrag(
	onDrag: (Offset) -> Unit,
	onEnd: (offset: Offset, velocity: Float) -> Unit,
) {
	awaitEachGesture {
		val down = awaitFirstDown(requireUnconsumed = false)
		val start = awaitVerticalTouchSlopOrCancellation(down.id) { change, _ -> change.consume() } ?: return@awaitEachGesture
		val tracker = VelocityTracker()
		tracker.addPosition(start.uptimeMillis, start.position)
		var offset = start.position - down.position
		onDrag(offset)
		while (true) {
			val event = awaitPointerEvent()
			val change = event.changes.firstOrNull { it.id == down.id } ?: break
			if (!change.pressed) break
			if (change.positionChanged()) {
				offset += change.position - change.previousPosition
				tracker.addPosition(change.uptimeMillis, change.position)
				change.consume()
				onDrag(offset)
			}
		}
		onEnd(offset, tracker.calculateVelocity().y)
	}
}

/**
 * One page with its title bar: a slim bar that takes on the page's own color, and the page.
 * No address bar, no tabs: this is the Umbrel, not the web. Shared by the main browser and
 * by first-time setup, which is immersive: the page fills the screen and the bar's two
 * controls float over it as glass.
 */
@Composable
internal fun BrowserPageView(
	page: BrowserPage,
	onClose: () -> Unit,
	onOpenInBrowser: (() -> Unit)?,
	window: Window?,
	modifier: Modifier = Modifier,
	isImmersive: Boolean = false,
	barDrag: Modifier = Modifier,
) {
	val ready = page.isRevealed && page.failure == null
	// Until the page has painted, the chrome stays black like the launch screen.
	val barColor by animateColorAsState(page.barColor?.takeIf { ready } ?: Color.Black, tween(250), label = "bar")
	val pageColor by animateColorAsState(page.pageColor?.takeIf { ready } ?: Color.Black, tween(250), label = "page")
	val barIsLight = ready && (page.barColor?.luminance() ?: 0f) > 0.6f
	val foreground = if (barIsLight) Color.Black else Color.White
	val view = LocalView.current
	DisposableEffect(window, barIsLight, isImmersive) {
		window?.let { WindowCompat.getInsetsController(it, view).isAppearanceLightStatusBars = barIsLight && !isImmersive }
		onDispose {}
	}

	// The page's menu draws over the page, blurring it the way an iOS menu does.
	GlassMenuHost(modifier) {
		if (isImmersive) {
			val underControls = rememberLayerBackdrop()
			Box(Modifier.fillMaxSize().background(Color.Black)) {
				PageContent(page, Modifier.fillMaxSize().imePadding().layerBackdrop(underControls))
				// The bar's controls on their own, as glass, tucked into the top corners of the
				// card umbrelOS floats 20 in from the edges of its window.
				CompositionLocalProvider(LocalGlassBackdrop provides underControls) {
					Row(Modifier.fillMaxWidth().statusBarsPadding().padding(horizontal = 28.dp).padding(top = 28.dp)) {
						PageMenu(page, onOpenInBrowser, foreground = Color.White, isImmersive = true)
						Spacer(Modifier.weight(1f))
						BarButton(Symbols.CloseSemibold, "Close", Color.White, isImmersive = true, onClick = onClose)
					}
				}
			}
		} else {
			Column(
				Modifier
					.fillMaxSize()
					// The bar's color runs up behind the status bar; the page's own background runs
					// down behind the navigation bar, so the page looks edge to edge.
					.drawWithContent {
						drawRect(pageColor)
						drawRect(barColor, size = Size(size.width, size.height / 2))
						drawContent()
					},
			) {
				Box(Modifier.fillMaxWidth().background(barColor).statusBarsPadding().then(barDrag)) {
					Box(Modifier.fillMaxWidth().height(BrowserBarHeight).padding(horizontal = 12.dp), contentAlignment = Alignment.Center) {
						PageTitle(page, foreground)
						Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
							PageMenu(page, onOpenInBrowser, foreground, isImmersive = false)
							Spacer(Modifier.weight(1f))
							BarButton(Symbols.CloseSemibold, "Close", foreground, isImmersive = false, onClick = onClose)
						}
					}
					ProgressLine(page, Modifier.align(Alignment.BottomStart))
				}
				PageContent(page, Modifier.fillMaxWidth().weight(1f).navigationBarsPadding().imePadding())
			}
		}
	}
	PageEffects(page, isShown = true)
}

@Composable
private fun PageContent(page: BrowserPage, modifier: Modifier) {
	val ready = page.isRevealed && page.failure == null
	val revealed by animateFloatAsState(if (ready) 1f else 0f, tween(300), label = "revealed")
	Box(modifier) {
		BrowserWebView(page.webView, Modifier.fillMaxSize().graphicsLayer { alpha = revealed })
		AnimatedVisibility(page.failure != null, enter = fadeIn(tween(200)), exit = fadeOut(tween(200))) {
			page.failure?.let { FailureView(it, onTryAgain = page::reload) }
		}
		AnimatedVisibility(page.failure == null && !page.isRevealed, enter = fadeIn(tween(300)), exit = fadeOut(tween(300))) {
			LaunchScreen(page.identity)
		}
	}
}

@Composable
private fun PageTitle(page: BrowserPage, foreground: Color) {
	val outsideHost = page.outsideHost
	Row(
		Modifier.padding(horizontal = 52.dp).semantics(mergeDescendants = true) { heading() },
		verticalAlignment = Alignment.CenterVertically,
		horizontalArrangement = Arrangement.spacedBy(8.dp),
	) {
		when {
			outsideHost != null -> Icon(Symbols.LanguageMedium, contentDescription = null, tint = foreground, modifier = Modifier.size(20.dp))
			page.identity.isUmbrel -> Image(
				painterResource(R.drawable.umbrel_mark),
				contentDescription = null,
				colorFilter = ColorFilter.tint(foreground),
				modifier = Modifier.size(20.dp),
			)
			else -> AppIconView(page.identity.iconUrl, size = 24.dp, corner = 6.dp)
		}
		Text(
			outsideHost ?: page.identity.name,
			style = AppleType.subheadline.copy(fontWeight = FontWeight.SemiBold),
			color = foreground,
			maxLines = 1,
			overflow = TextOverflow.Ellipsis,
		)
	}
}

@Composable
private fun BarButton(icon: ImageVector, description: String, foreground: Color, isImmersive: Boolean, onClick: () -> Unit) {
	Box(
		Modifier.size(44.dp).clickable(role = Role.Button, onClick = onClick).semantics { contentDescription = description },
		contentAlignment = Alignment.Center,
	) {
		val circle = if (isImmersive) {
			Modifier.size(40.dp).clip(CircleShape).glassControl(CircleShape)
		} else {
			Modifier.size(34.dp).background(foreground.copy(alpha = 0.12f), CircleShape)
		}
		Box(circle, contentAlignment = Alignment.Center) {
			Icon(icon, contentDescription = null, tint = foreground.copy(alpha = if (isImmersive) 1f else 0.9f), modifier = Modifier.size(20.dp))
		}
	}
}

@Composable
private fun PageMenu(page: BrowserPage, onOpenInBrowser: (() -> Unit)?, foreground: Color, isImmersive: Boolean) {
	val context = LocalContext.current
	var expanded by remember { mutableStateOf(false) }
	Box {
		BarButton(Symbols.MoreHorizSemibold, "More", foreground, isImmersive) { expanded = true }
		GlassMenu(expanded, onDismissRequest = { expanded = false }) {
			if (page.canGoBack) GlassMenuItem("Back", Symbols.ArrowBackIosNew) { expanded = false; page.goBack() }
			if (page.canGoForward) GlassMenuItem("Forward", Symbols.ArrowForwardIos) { expanded = false; page.goForward() }
			GlassMenuItem("Reload", Symbols.Refresh) { expanded = false; page.reload() }
			GlassMenuDivider()
			page.currentUrl?.let { url ->
				GlassMenuItem("Share…", Symbols.Share) {
					expanded = false
					val share = Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, url.toString())
					context.startActivity(Intent.createChooser(share, null))
				}
			}
			if (onOpenInBrowser != null) GlassMenuItem("Open in Browser", Symbols.OpenInNew) { expanded = false; onOpenInBrowser() }
		}
	}
}

/** A hairline that fills as the page loads, then gets out of the way. */
@Composable
private fun ProgressLine(page: BrowserPage, modifier: Modifier) {
	val brand = LocalBrandColor.current
	val progress by animateFloatAsState(max(0.08f, page.progress), tween(250), label = "progress")
	val visible by animateFloatAsState(if (page.isLoading) 1f else 0f, tween(350, delayMillis = if (page.isLoading) 0 else 150), label = "loading")
	Box(modifier.fillMaxWidth().height(2.dp).graphicsLayer { alpha = visible }) {
		Box(Modifier.fillMaxHeight().fillMaxWidth(progress).background(brand, CircleShape))
	}
}

@Composable
private fun FailureView(failure: BrowserPage.Failure, onTryAgain: () -> Unit) {
	Column(
		Modifier.fillMaxSize().background(Color.Black).padding(horizontal = 28.dp),
		horizontalAlignment = Alignment.CenterHorizontally,
	) {
		Spacer(Modifier.weight(1f))
		Icon(Symbols.WifiAlertMedium, contentDescription = null, tint = Color.White.copy(alpha = 0.6f), modifier = Modifier.padding(bottom = 20.dp).size(44.dp))
		Text(failure.title, style = AppleType.title3.copy(fontWeight = FontWeight.SemiBold), color = Color.White, textAlign = TextAlign.Center)
		Text(failure.message, style = AppleType.subheadline, color = MainTheme.gray, textAlign = TextAlign.Center, modifier = Modifier.padding(top = 8.dp))
		Spacer(Modifier.weight(1f))
		PrimaryActionButton("Try Again", Modifier.padding(bottom = 12.dp), onClick = onTryAgain)
	}
}

/**
 * What an app looks like in the moment before its page arrives: its own icon, on black, the
 * way an app's launch screen holds the place of its first frame.
 */
@Composable
private fun LaunchScreen(identity: BrowserPage.Identity) {
	val breathing by rememberInfiniteTransition(label = "launch").animateFloat(
		1f,
		1.04f,
		infiniteRepeatable(tween(1_100), RepeatMode.Reverse),
		label = "breathing",
	)
	Box(
		Modifier.fillMaxSize().background(Color.Black).semantics { contentDescription = "Opening ${identity.name}" },
		contentAlignment = Alignment.Center,
	) {
		Box(Modifier.graphicsLayer { scaleX = breathing; scaleY = breathing }) {
			if (identity.isUmbrel) {
				Image(painterResource(R.drawable.umbrel_mark), contentDescription = null, modifier = Modifier.width(64.dp))
			} else {
				AppIconView(identity.iconUrl, size = 84.dp, corner = 21.dp)
			}
		}
	}
}
