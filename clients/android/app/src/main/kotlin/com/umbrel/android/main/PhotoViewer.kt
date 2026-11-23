package com.umbrel.android.main

import android.content.Context
import android.view.Window
import androidx.activity.BackEventCompat
import androidx.activity.compose.BackHandler
import androidx.activity.compose.PredictiveBackHandler
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.AnimationState
import androidx.compose.animation.core.animateDecay
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.animateTo
import androidx.compose.animation.core.calculateTargetValue
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.rememberSplineBasedDecay
import androidx.compose.foundation.ScrollState
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.awaitVerticalTouchSlopOrCancellation
import androidx.compose.foundation.gestures.calculateCentroid
import androidx.compose.foundation.gestures.calculatePan
import androidx.compose.foundation.gestures.calculateZoom
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsIgnoringVisibility
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.MutableState
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.RoundRect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.geometry.isSpecified
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.graphics.drawscope.clipPath
import androidx.compose.ui.graphics.drawscope.withTransform
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.positionChanged
import androidx.compose.ui.input.pointer.util.VelocityTracker
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionOnScreen
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.scrollBy
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.toSize
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.compose.ui.window.DialogWindowProvider
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import coil3.compose.AsyncImage
import coil3.compose.AsyncImagePainter
import coil3.memory.MemoryCache
import coil3.request.ImageRequest
import com.kyant.backdrop.backdrops.layerBackdrop
import com.kyant.backdrop.backdrops.rememberLayerBackdrop
import com.umbrel.android.ui.AppleEaseInOut
import com.umbrel.android.ui.AppleEaseOut
import com.umbrel.android.ui.AppleType
import com.umbrel.android.ui.CircleIconButton
import com.umbrel.android.ui.CircleIconButtonSize
import com.umbrel.android.ui.LocalGlassBackdrop
import com.umbrel.android.ui.MainTheme
import com.umbrel.android.ui.Symbols
import com.umbrel.android.ui.glassControl
import com.umbrel.android.ui.glassSurface
import com.umbrel.android.ui.isWideWindow
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch
import kotlin.math.abs
import kotlin.math.min
import kotlin.math.roundToInt

// SwiftUI's default spring (0.5 s, no bounce), which its zoom transition uses.
private val ZoomSpring = spring<Float>(dampingRatio = 1f, stiffness = 157.9f)

/**
 * The full-screen viewer, the port of iOS's PhotoViewer: pages through the whole library,
 * zooms photos, plays videos, and shows each item's details and backup status. iOS presents it as a
 * full-screen cover zooming from the tapped tile; Android's modal equivalent is a
 * full-screen dialog window, which also keeps TalkBack inside it. The zoom between tile and
 * photo is drawn here, since a dialog is a separate window from the grid.
 */
@Composable
fun PhotoViewer(
	library: PhotoLibraryViewModel,
	state: MainUiState,
	initialItem: String,
	// Where the grid's tiles are, to zoom from and back to. Without them the viewer fades.
	tiles: PhotoTileLocator?,
	onDismissed: () -> Unit,
	// Try Again on an item that couldn't back up.
	onRetryBackup: () -> Unit = {},
	// Opens with Info already showing, for an item opened to see which it is.
	showsInfo: Boolean = false,
	// What TalkBack calls the button that closes it, which says where that leads.
	backDescription: String = "Back to Photos",
) {
	Dialog(
		onDismissRequest = {},
		properties = DialogProperties(
			// Back runs the viewer's own dismissal so it can zoom back to the grid.
			dismissOnBackPress = false,
			dismissOnClickOutside = false,
			usePlatformDefaultWidth = false,
			decorFitsSystemWindows = false,
		),
	) {
		val window = (LocalView.current.parent as? DialogWindowProvider)?.window
		// The dialog's content composes before Compose shows its window, so this applies
		// before the first frame: the grid stays visible behind the zoom instead of the
		// default dim, and the zoom replaces the window animation.
		SideEffect {
			window?.setDimAmount(0f)
			window?.setWindowAnimations(0)
		}
		PhotoViewerContent(library, state, initialItem, tiles, window, onDismissed, onRetryBackup, showsInfo, backDescription)
	}
}

@Composable
private fun PhotoViewerContent(
	library: PhotoLibraryViewModel,
	state: MainUiState,
	initialItem: String,
	tiles: PhotoTileLocator?,
	window: Window?,
	onDismissed: () -> Unit,
	onRetryBackup: () -> Unit,
	showsInfo: Boolean,
	backDescription: String,
) {
	val libraryState by library.state.collectAsStateWithLifecycle()
	val assets = libraryState.assets
	val pager = rememberPagerState(initialPage = remember { assets.indexOf(initialItem).coerceAtLeast(0) }) { assets.size }
	val current = assets.items.getOrNull(pager.currentPage.coerceAtMost(assets.size - 1))
	val scope = rememberCoroutineScope()
	val density = LocalDensity.current
	var showsControls by remember { mutableStateOf(true) }
	// Shared by every page, so Info stays open while swiping between photos, like Photos'.
	// Saved, so it also stays open when the screen turns or a foldable changes screens.
	val infoShown = rememberSaveable { mutableStateOf(showsInfo) }
	// A wide window keeps the top bar, and Info's button in it, while Info is open: iOS does
	// the same on iPhone Duo, and it keeps the button off a foldable's hinge.
	val wide = isWideWindow()
	var playing by remember { mutableStateOf<LocalMediaItem?>(null) }
	var zoomed by remember { mutableStateOf(false) }
	val presentation = remember { Animatable(0f) }
	// A photo that opens moved up for Info doesn't match its tile, so it fades in.
	var source by remember { mutableStateOf(if (showsInfo) null else tiles?.bounds(initialItem)) }
	var origin by remember { mutableStateOf(Offset.Unspecified) }
	var drag by remember { mutableStateOf(Offset.Zero) }
	var dragScale by remember { mutableFloatStateOf(1f) }
	var exiting by remember { mutableStateOf(false) }
	var settle by remember { mutableStateOf<Job?>(null) }
	val currentItem by rememberUpdatedState(current)
	// The photos either side are read ahead, so a swipe lands on a status that's known. Read
	// again when the backup changes, watched here rather than by the whole viewer.
	val currentAssets by rememberUpdatedState(assets)
	LaunchedEffect(pager.currentPage) {
		val page = pager.currentPage
		snapshotFlow { library.receipts.generation }.collectLatest {
			for (neighbor in listOf(page - 1, page + 1)) {
				currentAssets.items.getOrNull(neighbor)?.let { launch { library.receipts.receipt(it) } }
			}
		}
	}

	fun dismiss() {
		if (exiting) return
		exiting = true
		scope.launch {
			// A zoomed photo, or one moved up for Info, no longer matches its tile, so it fades instead.
			source = currentItem?.takeIf { !zoomed && !infoShown.value }?.let { tiles?.bounds(it.localIdentifier) }
			presentation.animateTo(0f, ZoomSpring)
			onDismissed()
		}
	}

	LaunchedEffect(Unit) { presentation.animateTo(1f, ZoomSpring) }
	LaunchedEffect(assets.size) { if (assets.size == 0) dismiss() }
	// Video controls are the play button, so a video page always shows them.
	LaunchedEffect(current?.localIdentifier) { if (current?.isVideo == true) showsControls = true }
	// Swiping up opens Info even with the controls hidden, and its button closes it.
	LaunchedEffect(infoShown.value) { if (infoShown.value) showsControls = true }
	// Like Photos, Info takes the top bar's place and leaves its own button to close it.
	val showsTopBar = showsControls && (!infoShown.value || wide)
	StatusBarVisibility(window, visible = showsTopBar)

	PredictiveBackHandler(enabled = !exiting) { progress ->
		try {
			progress.collect { event ->
				// Android's in-app back preview: the surface shrinks toward 90% and shifts
				// away from the edge being swiped.
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

	BackHandler(enabled = infoShown.value && !exiting) { infoShown.value = false }

	val glassBackdrop = rememberLayerBackdrop()
	val navigationBar = WindowInsets.navigationBars.asPaddingValues().calculateBottomPadding()
	var pageHeight by remember { mutableFloatStateOf(1f) }
	Box(
		Modifier.fillMaxSize().onGloballyPositioned {
			origin = it.positionOnScreen()
			pageHeight = it.size.height.toFloat().coerceAtLeast(1f)
		},
	) {
		val dragFraction = min(1f, abs(drag.y) / with(density) { 400.dp.toPx() })
		val item = current
		val tile = source?.takeIf { origin.isSpecified }?.translate(-origin)
		val morphs = item != null && tile != null && item.width > 0 && item.height > 0
		// The photos, captured for the glass controls over them to draw through.
		Box(Modifier.fillMaxSize().layerBackdrop(glassBackdrop)) {
			Box(
				Modifier
					.fillMaxSize()
					.graphicsLayer { alpha = presentation.value * (1f - dragFraction) }
					.background(Color.Black),
			)
			HorizontalPager(
				state = pager,
				modifier = Modifier
					.fillMaxSize()
					.graphicsLayer { alpha = if (morphs) 1f else presentation.value }
					.drawWithContent {
						val fit = item?.let { fitRect(it.width, it.height, size) }
						val full = fit?.let { dragged(it, drag, dragScale) }
						// Once the zoom has landed the page draws whole: the frame would clip Info's cards.
						if (tile == null || fit == null || full == null || !morphs || presentation.value >= 1f) {
							withTransform({
								translate(drag.x, drag.y)
								scale(dragScale, dragScale)
							}) { this@drawWithContent.drawContent() }
							return@drawWithContent
						}
						val frame = ZoomFrame.of(presentation.value, tile, full)
						val scale = frame.image.width / fit.width
						val corner = with(density) { 2.dp.toPx() } * (1f - presentation.value)
						val clip = Path().apply { addRoundRect(RoundRect(frame.clip, CornerRadius(corner))) }
						clipPath(clip) {
							withTransform({
								translate(frame.image.left - fit.left * scale, frame.image.top - fit.top * scale)
								scale(scale, scale, Offset.Zero)
							}) { this@drawWithContent.drawContent() }
						}
					},
				userScrollEnabled = !zoomed && !exiting,
				key = { assets.items.getOrNull(it)?.localIdentifier ?: it },
			) { page ->
				val pageItem = assets.items[page]
				PhotoViewerPage(
					pageItem,
					isActive = page == pager.currentPage,
					infoShown = infoShown,
					// The cards end clear of the navigation bar, and of Info's button above it on a phone.
					bottomInset = navigationBar + if (wide) 0.dp else InfoButtonSpace,
					gesturesEnabled = !exiting,
					onTap = { if (!infoShown.value) showsControls = !showsControls },
					onPlay = { playing = pageItem },
					onZoomChange = { if (page == pager.currentPage) zoomed = it },
					onDismissDrag = { offset ->
						settle?.cancel()
						drag = offset
						dragScale = 1f - 0.25f * min(1f, abs(offset.y) / pageHeight)
					},
					onDismissDragEnd = { offset, velocity ->
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
				) {
					PhotoViewerInfo(
						pageItem,
						library,
						state,
						onRetryBackup = onRetryBackup,
					)
				}
			}
		}
		CompositionLocalProvider(LocalGlassBackdrop provides glassBackdrop) {
			val controlsAlpha = Modifier.graphicsLayer { alpha = presentation.value * (1f - dragFraction) }
			val fadesIn = fadeIn(tween(180, easing = AppleEaseInOut))
			val fadesOut = fadeOut(tween(180, easing = AppleEaseInOut))
			val infoButton: @Composable () -> Unit = {
				CircleIconButton(
					if (infoShown.value) Symbols.InfoFilledMedium else Symbols.InfoMedium,
					contentDescription = "Photo information",
					iconSize = 24.dp,
					onClick = { infoShown.value = !infoShown.value },
				)
			}
			AnimatedVisibility(visible = showsTopBar && item != null, modifier = controlsAlpha, enter = fadesIn, exit = fadesOut) {
				if (item != null) {
					// Info's own card says the status.
					ViewerTopBar(item, library, state, showsStatus = !infoShown.value, backDescription = backDescription, onBack = ::dismiss, trailing = infoButton.takeIf { wide })
				}
			}
			// Where Photos has Info on a phone: in the bottom bar.
			AnimatedVisibility(
				visible = showsControls && item != null && !wide,
				modifier = controlsAlpha.align(Alignment.BottomCenter).navigationBarsPadding().padding(bottom = InfoButtonInset),
				enter = fadesIn,
				exit = fadesOut,
			) { infoButton() }
		}
	}

	playing?.let { VideoPlayer(it, onDismiss = { playing = null }) }
}

// Info's button and the space around it at the bottom of a phone.
private val InfoButtonInset = 8.dp
private val InfoButtonSpace = CircleIconButtonSize + InfoButtonInset * 2

/** Hides the status bar with the controls, as iOS does; a swipe from the edge shows it briefly. */
@Composable
private fun StatusBarVisibility(window: Window?, visible: Boolean) {
	val view = LocalView.current
	DisposableEffect(window, visible) {
		if (window != null) {
			val controller = WindowCompat.getInsetsController(window, view)
			controller.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
			controller.isAppearanceLightStatusBars = false
			if (visible) controller.show(WindowInsetsCompat.Type.statusBars()) else controller.hide(WindowInsetsCompat.Type.statusBars())
		}
		onDispose {}
	}
}

/** Back and the item's backup status over the top of the photo, with Info's button in a wide window. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ViewerTopBar(
	item: LocalMediaItem,
	library: PhotoLibraryViewModel,
	state: MainUiState,
	showsStatus: Boolean,
	backDescription: String,
	onBack: () -> Unit,
	trailing: (@Composable () -> Unit)?,
) {
	Box(
		Modifier
			.fillMaxWidth()
			// Laid out as if the status bar were showing, so hiding it never moves the controls.
			.windowInsetsPadding(WindowInsets.statusBarsIgnoringVisibility)
			.padding(top = 8.dp)
			.padding(horizontal = MainTheme.contentInset),
	) {
		if (showsStatus) BackupStatusCapsule(item, library, state, Modifier.align(Alignment.Center))
		Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
			CircleIconButton(Symbols.ArrowBackIosNewMedium, contentDescription = backDescription, iconSize = 18.dp, onClick = onBack)
			Spacer(Modifier.weight(1f))
			trailing?.invoke()
		}
	}
}

/** The item's receipt, read again whenever the backup state or the item changes. */
@Composable
internal fun rememberBackupReceipt(item: LocalMediaItem, library: PhotoLibraryViewModel): BackupReceipt? {
	// Usually known already (the grid asked as it showed the item, and the viewer asks for
	// its neighbors), so the pill shows from the first frame rather than blinking out
	// between photos.
	var receipt by remember(item.localIdentifier) { mutableStateOf(library.receipts.cached(item)) }
	LaunchedEffect(item.localIdentifier, item.generation, library.receipts.generation) {
		receipt = library.receipts.receipt(item)
	}
	return receipt
}

@Composable
internal fun rememberBackupStatus(item: LocalMediaItem, library: PhotoLibraryViewModel, state: MainUiState): ViewerBackupStatus? =
	rememberBackupReceipt(item, library)?.let { ViewerBackupStatus.of(it, backupIncludes(state, item)) }

// Semibold in the status pill, as iOS draws it.
private val ViewerBackupStatus.pillIcon: ImageVector
	get() = when (this) {
		ViewerBackupStatus.BACKED_UP -> Symbols.CheckCircleSemibold
		ViewerBackupStatus.WAITING -> Symbols.ScheduleSemibold
		ViewerBackupStatus.NOT_BACKED_UP -> Symbols.RemoveCircleOutlineSemibold
		ViewerBackupStatus.FAILED -> Symbols.WarningSemibold
	}

@Composable
private fun BackupStatusCapsule(item: LocalMediaItem, library: PhotoLibraryViewModel, state: MainUiState, modifier: Modifier = Modifier) {
	val status = rememberBackupStatus(item, library, state)
	if (status == null) {
		Spacer(modifier.size(1.dp, 38.dp))
		return
	}
	Row(
		modifier
			.defaultMinSize(minHeight = 38.dp)
			.glassSurface(CircleShape)
			.padding(horizontal = 14.dp),
		horizontalArrangement = Arrangement.spacedBy(8.dp),
		verticalAlignment = Alignment.CenterVertically,
	) {
		val color = Color.White.copy(alpha = 0.9f)
		Icon(status.pillIcon, contentDescription = null, tint = color, modifier = Modifier.size(16.dp))
		Text(status.text, style = AppleType.footnote, fontWeight = FontWeight.SemiBold, color = color)
	}
}

// ── Pages ──


// SwiftUI's snappy spring (0.5 s, a little bounce), which moves the page when Info's button is tapped.
private val SnappySpring = spring<Float>(dampingRatio = 0.85f, stiffness = 157.9f)

// Where a released swipe settles: critically damped, carrying on from the finger's speed.
private val SettleSpring = spring<Float>(dampingRatio = 1f, stiffness = 220f)

/**
 * One page of the viewer. Like Photos, Info isn't a sheet: it sits under the photo on the
 * same page, and opening it scrolls the photo up to make room.
 */
@Composable
private fun PhotoViewerPage(
	item: LocalMediaItem,
	isActive: Boolean,
	infoShown: MutableState<Boolean>,
	bottomInset: Dp,
	gesturesEnabled: Boolean,
	onTap: () -> Unit,
	onPlay: () -> Unit,
	onZoomChange: (Boolean) -> Unit,
	onDismissDrag: (Offset) -> Unit,
	onDismissDragEnd: (offset: Offset, velocity: Float) -> Unit,
	infoContent: @Composable () -> Unit,
) {
	val context = LocalContext.current
	val request = remember(item.localIdentifier, item.generation) { fullImageRequest(context, item) }
	var loading by remember(item.localIdentifier) { mutableStateOf(true) }
	// MediaStore doesn't always know a photo's size; the decoded image says its shape then.
	var decoded by remember(item.localIdentifier) { mutableStateOf(IntSize.Zero) }
	val onState: (AsyncImagePainter.State) -> Unit = {
		loading = it is AsyncImagePainter.State.Loading && it.painter == null
		if (it is AsyncImagePainter.State.Success) {
			val size = it.painter.intrinsicSize
			if (size.isSpecified && size.width > 0 && size.height > 0) decoded = IntSize(size.width.roundToInt(), size.height.roundToInt())
		}
	}
	BoxWithConstraints(Modifier.fillMaxSize()) {
		val known = item.width > 0 && item.height > 0
		val photoWidth = if (known) item.width else decoded.width
		val photoHeight = if (known) item.height else decoded.height
		val layout = remember(constraints.maxWidth, constraints.maxHeight, photoWidth, photoHeight) {
			PhotoViewerInfoLayout(Size(constraints.maxWidth.toFloat(), constraints.maxHeight.toFloat()), photoWidth, photoHeight)
		}
		val pageWidth = maxWidth
		val pageHeight = maxHeight
		val scope = rememberCoroutineScope()
		val decay = rememberSplineBasedDecay<Float>()
		// A page swiped to while Info is open arrives with it open. Not saved with the page:
		// one swiped away and back follows Info as it is now, not as the page was left.
		val scroll = remember { ScrollState(initial = if (infoShown.value) layout.openOffset.roundToInt() else 0) }
		// Where this page is resting or heading, which a scroll in flight doesn't show yet.
		var restsOnInfo by remember { mutableStateOf(infoShown.value) }
		val isInfoInView by remember { derivedStateOf { scroll.value > 0 } }
		// The details are only read once Info starts to show, not for every page swiped past.
		var loadsInfo by remember { mutableStateOf(infoShown.value) }
		var isZoomed by remember { mutableStateOf(false) }
		val active by rememberUpdatedState(isActive)
		val currentLayout by rememberUpdatedState(layout)
		val dismissDrag by rememberUpdatedState(onDismissDrag)
		val dismissDragEnd by rememberUpdatedState(onDismissDragEnd)

		// The one thing moving the page when no finger is: cancelled the moment one lands, so
		// nothing fights the drag and the drag starts from where the page really is.
		var motion by remember { mutableStateOf<Job?>(null) }
		fun move(block: suspend () -> Unit) {
			motion?.cancel()
			motion = scope.launch { block() }
		}

		// Only where the page comes to rest decides whether Info is open: partway through, the
		// offset says nothing reliable.
		fun rest() {
			restsOnInfo = scroll.value > currentLayout.openOffset / 2
			if (active) infoShown.value = restsOnInfo
		}

		LaunchedEffect(isInfoInView) { if (isInfoInView) loadsInfo = true }
		LaunchedEffect(infoShown.value) {
			if (restsOnInfo == infoShown.value) return@LaunchedEffect
			restsOnInfo = infoShown.value
			val target = if (infoShown.value) layout.openOffset.roundToInt() else 0
			move { if (active) scroll.animateScrollTo(target, SnappySpring) else scroll.scrollTo(target) }
		}
		// A page dragged while it was still arriving settled before it was the one in front.
		LaunchedEffect(isActive) { if (isActive && motion?.isActive != true) infoShown.value = restsOnInfo }
		// The screen turned or folded: the page keeps to whichever of the two it rested on.
		LaunchedEffect(layout.openOffset) {
			restsOnInfo = infoShown.value
			if (infoShown.value) scroll.scrollTo(layout.openOffset.roundToInt())
		}

		fun settle(start: Float, velocity: Float, flick: Float) = move {
			val openOffset = currentLayout.openOffset
			val from = scroll.value.toFloat()
			val target = infoSnapTarget(start, decay.calculateTargetValue(from, velocity), velocity, openOffset, restsOnInfo, flick)
			var last = from
			val state = AnimationState(from, velocity)
			if (target == null) {
				state.animateDecay(decay) {
					val moved = scroll.dispatchRawDelta(value - last)
					// The end of the cards: nothing is left to coast through.
					if (abs(value - last - moved) > 0.5f) cancelAnimation()
					last = value
				}
			} else {
				state.animateTo(target, SettleSpring) {
					scroll.dispatchRawDelta(value - last)
					last = value
				}
			}
			rest()
		}

		Column(
			Modifier
				.fillMaxSize()
				.pointerInput(gesturesEnabled) {
					if (!gesturesEnabled) return@pointerInput
					// Under this a release is a slow drag, not a flick.
					val flick = 100.dp.toPx()
					awaitEachGesture {
						val down = awaitFirstDown(requireUnconsumed = false)
						// A touch catches a page in flight, which then settles from where it was caught.
						val caught = motion?.isActive == true
						motion?.cancel()
						val start = scroll.value.toFloat()
						// A zoomed photo pans, and the pager keeps horizontal drags: whichever
						// axis passes the touch slop first owns the gesture.
						val slop = awaitVerticalTouchSlopOrCancellation(down.id) { change, _ -> change.consume() }
						if (slop == null || isZoomed) {
							if (caught) settle(start, 0f, flick)
							return@awaitEachGesture
						}
						val tracker = VelocityTracker()
						tracker.addPosition(down.uptimeMillis, down.position)
						tracker.addPosition(slop.uptimeMillis, slop.position)
						// Pulling an unopened photo down drags it away to dismiss, as iOS's zoom
						// transition allows. Anything else scrolls the page.
						val dismisses = start <= 0f && slop.position.y > down.position.y
						var offset = slop.position - down.position
						if (dismisses) dismissDrag(offset)
						while (true) {
							val event = awaitPointerEvent()
							val change = event.changes.firstOrNull { it.id == down.id } ?: break
							if (!change.pressed) break
							if (change.positionChanged()) {
								val delta = change.position - change.previousPosition
								offset += delta
								tracker.addPosition(change.uptimeMillis, change.position)
								change.consume()
								if (dismisses) dismissDrag(offset) else scroll.dispatchRawDelta(-delta.y)
							}
						}
						val velocity = tracker.calculateVelocity().y
						if (dismisses) dismissDragEnd(offset, velocity) else settle(start, -velocity, flick)
					}
				}
				.verticalScroll(scroll, enabled = false)
				// The page moves by its own gesture above, so the scroll modifier offers
				// accessibility services nothing to scroll with. This does, and rests like a swipe.
				.semantics {
					scrollBy { _, y ->
						move {
							val openOffset = currentLayout.openOffset
							val target = (scroll.value + y).coerceIn(0f, scroll.maxValue.toFloat())
							scroll.animateScrollTo((if (target < openOffset) (if (y > 0) openOffset else 0f) else target).roundToInt())
							rest()
						}
						true
					}
				},
		) {
			Box(
				Modifier.size(pageWidth, pageHeight).clipToBounds(),
				contentAlignment = Alignment.Center,
			) {
				// Follows the scroll in the draw phase, without recomposing the page as it moves.
				Box(
					Modifier.fillMaxSize().graphicsLayer {
						val progress = layout.progress(scroll.value.toFloat())
						scaleX = layout.scale(progress)
						scaleY = scaleX
						translationY = layout.shift(progress)
					},
					contentAlignment = Alignment.Center,
				) {
					if (item.isVideo) {
						Box(
							Modifier
								.fillMaxSize()
								.clickable(interactionSource = null, indication = null, enabled = !isInfoInView, role = Role.Button, onClick = onPlay)
								.semantics { contentDescription = "Play video" },
							contentAlignment = Alignment.Center,
						) {
							AsyncImage(request, contentDescription = null, contentScale = ContentScale.Fit, onState = onState, modifier = Modifier.fillMaxSize())
							if (!loading) {
								val playAlpha by animateFloatAsState(if (isInfoInView) 0f else 1f, tween(150, easing = AppleEaseOut))
								Box(
									Modifier.graphicsLayer { alpha = playAlpha }.size(72.dp).clip(CircleShape).glassControl(CircleShape),
									contentAlignment = Alignment.Center,
								) {
									Icon(Symbols.PlayArrowSemibold, contentDescription = null, tint = Color.White, modifier = Modifier.size(30.dp))
								}
							}
						}
					} else {
						ZoomablePhoto(
							request,
							allowsZoom = !isInfoInView,
							onTap = onTap,
							onZoomChange = {
								isZoomed = it
								onZoomChange(it)
							},
							onState = onState,
						)
					}
				}
				if (loading) CircularProgressIndicator(color = Color.White, modifier = Modifier.size(28.dp), strokeWidth = 2.5.dp)
			}
			Box(
				Modifier.fillMaxWidth().heightIn(min = with(LocalDensity.current) { layout.openOffset.toDp() }),
				contentAlignment = Alignment.TopCenter,
			) {
				if (loadsInfo) {
					Box(
						Modifier
							.padding(start = 16.dp, top = 16.dp, end = 16.dp, bottom = 16.dp + bottomInset)
							.widthIn(max = PhotoViewerInfoMaxWidth),
					) { infoContent() }
				}
			}
		}
	}
}

/**
 * The full photo at the page's size, from the original file. The grid's thumbnail stands in
 * from memory while it decodes, and edits invalidate both through MediaStore's generation.
 */
private fun fullImageRequest(context: Context, item: LocalMediaItem): ImageRequest =
	ImageRequest.Builder(context)
		.data(item.uri)
		.memoryCacheKeyExtra("generation", item.generation.toString())
		.placeholderMemoryCacheKey(MemoryCache.Key(thumbnailCacheKey(item)))
		.build()

@Composable
private fun ZoomablePhoto(
	request: ImageRequest,
	allowsZoom: Boolean,
	onTap: () -> Unit,
	onZoomChange: (Boolean) -> Unit,
	onState: (AsyncImagePainter.State) -> Unit,
) {
	val scope = rememberCoroutineScope()
	var zoom by remember { mutableStateOf(PageZoom()) }
	val animation = remember { Animatable(0f) }
	val currentOnTap by rememberUpdatedState(onTap)
	val zooms by rememberUpdatedState(allowsZoom)
	fun animateZoom(target: PageZoom) {
		val start = zoom
		scope.launch {
			animation.snapTo(0f)
			animation.animateTo(1f, tween(300, easing = AppleEaseInOut)) {
				zoom = PageZoom(
					start.scale + (target.scale - start.scale) * value,
					start.offset + (target.offset - start.offset) * value,
				)
			}
		}
	}
	LaunchedEffect(zoom.isZoomed) { onZoomChange(zoom.isZoomed) }
	// Info opened from its button while zoomed: the photo goes back to fit under it.
	LaunchedEffect(allowsZoom) { if (!allowsZoom && zoom.isZoomed) animateZoom(PageZoom()) }
	Box(
		Modifier
			.fillMaxSize()
			.pointerInput(Unit) {
				detectTapGestures(
					onDoubleTap = { point -> if (zooms) animateZoom(zoom.toggled(point, size.toSize())) },
					onTap = { currentOnTap() },
				)
			}
			.pointerInput(Unit) {
				awaitEachGesture {
					awaitFirstDown(requireUnconsumed = false)
					do {
						val event = awaitPointerEvent()
						val fingers = event.changes.count { it.pressed }
						// One finger on an unzoomed photo belongs to paging, Info and dismissal.
						if (zooms && (fingers >= 2 || zoom.isZoomed)) {
							val centroid = event.calculateCentroid(useCurrent = true)
							if (centroid.isSpecified) {
								if (animation.isRunning) scope.launch { animation.stop() }
								zoom = zoom.transformed(centroid, event.calculatePan(), event.calculateZoom(), size.toSize())
							}
							event.changes.forEach { if (it.positionChanged()) it.consume() }
						}
					} while (event.changes.any { it.pressed })
				}
			}
			.graphicsLayer {
				scaleX = zoom.scale
				scaleY = zoom.scale
				translationX = zoom.offset.x
				translationY = zoom.offset.y
				transformOrigin = TransformOrigin(0f, 0f)
			},
	) {
		AsyncImage(request, contentDescription = null, contentScale = ContentScale.Fit, onState = onState, modifier = Modifier.fillMaxSize())
	}
}
