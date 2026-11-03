package com.umbrel.android.main

import android.content.Context
import android.view.Window
import androidx.activity.BackEventCompat
import androidx.activity.compose.PredictiveBackHandler
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
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
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsIgnoringVisibility
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.RoundRect
import androidx.compose.ui.geometry.isSpecified
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.graphics.drawscope.clipPath
import androidx.compose.ui.graphics.drawscope.withTransform
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.pointer.PointerInputScope
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
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
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
import com.umbrel.android.ui.AppleType
import com.umbrel.android.ui.CircleIconButton
import com.umbrel.android.ui.LocalBrandColor
import com.umbrel.android.ui.LocalGlassBackdrop
import com.umbrel.android.ui.MainTheme
import com.umbrel.android.ui.PageSheet
import com.umbrel.android.ui.SettingsDivider
import com.umbrel.android.ui.SettingsSection
import com.umbrel.android.ui.SheetToolbar
import com.umbrel.android.ui.Symbols
import com.umbrel.android.ui.glassControl
import com.umbrel.android.ui.glassSurface
import com.umbrel.android.ui.mediumSheetHeight
import com.umbrel.kit.backup.PhotoBackupFolders
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch
import java.text.DateFormat
import java.util.Date
import kotlin.math.abs
import kotlin.math.min

// SwiftUI's default spring (0.5 s, no bounce), which its zoom transition uses.
private val ZoomSpring = spring<Float>(dampingRatio = 1f, stiffness = 157.9f)

/**
 * The full-screen viewer, the port of iOS's PhotoViewer: pages through the whole library,
 * zooms photos, plays videos, and shows each item's backup status. iOS presents it as a
 * full-screen cover zooming from the tapped tile; Android's modal equivalent is a
 * full-screen dialog window, which also keeps TalkBack inside it. The zoom between tile and
 * photo is drawn here, since a dialog is a separate window from the grid.
 */
@Composable
fun PhotoViewer(
	library: PhotoLibraryViewModel,
	state: MainUiState,
	initialItem: String,
	tiles: PhotoTileLocator,
	onDismissed: () -> Unit,
	// Offered while this phone backs up with access to all its photos.
	onSkipFolder: ((LibraryFolder) -> Unit)? = null,
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
		PhotoViewerContent(library, state, initialItem, tiles, window, onDismissed, onSkipFolder)
	}
}

@Composable
private fun PhotoViewerContent(
	library: PhotoLibraryViewModel,
	state: MainUiState,
	initialItem: String,
	tiles: PhotoTileLocator,
	window: Window?,
	onDismissed: () -> Unit,
	onSkipFolder: ((LibraryFolder) -> Unit)?,
) {
	val libraryState by library.state.collectAsStateWithLifecycle()
	val assets = libraryState.assets
	val pager = rememberPagerState(initialPage = remember { assets.indexOf(initialItem).coerceAtLeast(0) }) { assets.size }
	val current = assets.items.getOrNull(pager.currentPage.coerceAtMost(assets.size - 1))
	val scope = rememberCoroutineScope()
	val density = LocalDensity.current
	var showsControls by remember { mutableStateOf(true) }
	var showsInfo by remember { mutableStateOf(false) }
	var playing by remember { mutableStateOf<LocalMediaItem?>(null) }
	var zoomed by remember { mutableStateOf(false) }
	val presentation = remember { Animatable(0f) }
	var source by remember { mutableStateOf(tiles.bounds(initialItem)) }
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
				currentAssets.items.getOrNull(neighbor)?.let { launch { library.receipts.isBackedUp(it) } }
			}
		}
	}

	fun dismiss() {
		if (exiting) return
		exiting = true
		scope.launch {
			// A zoomed photo no longer matches its tile, so it fades instead.
			source = currentItem?.takeIf { !zoomed }?.let { tiles.bounds(it.localIdentifier) }
			presentation.animateTo(0f, ZoomSpring)
			onDismissed()
		}
	}

	LaunchedEffect(Unit) { presentation.animateTo(1f, ZoomSpring) }
	LaunchedEffect(assets.size) { if (assets.size == 0) dismiss() }
	// Video controls are the play button, so a video page always shows them.
	LaunchedEffect(current?.localIdentifier) { if (current?.isVideo == true) showsControls = true }
	StatusBarVisibility(window, visible = showsControls)

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

	val glassBackdrop = rememberLayerBackdrop()
	Box(Modifier.fillMaxSize().onGloballyPositioned { origin = it.positionOnScreen() }) {
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
						if (tile == null || fit == null || full == null || !morphs) {
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
					}
					.pointerInput(zoomed, exiting) {
						if (zoomed || exiting) return@pointerInput
						detectDismissDrag(
							onDrag = { offset ->
								settle?.cancel()
								drag = offset
								dragScale = 1f - 0.25f * min(1f, abs(offset.y) / size.height)
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
				userScrollEnabled = !zoomed && !exiting,
				key = { assets.items.getOrNull(it)?.localIdentifier ?: it },
			) { page ->
				val pageItem = assets.items[page]
				PhotoViewerPage(
					pageItem,
					onTap = { showsControls = !showsControls },
					onPlay = { playing = pageItem },
					onZoomChange = { if (page == pager.currentPage) zoomed = it },
				)
			}
		}
		CompositionLocalProvider(LocalGlassBackdrop provides glassBackdrop) {
			AnimatedVisibility(
				visible = showsControls && item != null,
				modifier = Modifier.graphicsLayer { alpha = presentation.value * (1f - dragFraction) },
				enter = fadeIn(tween(180, easing = AppleEaseInOut)),
				exit = fadeOut(tween(180, easing = AppleEaseInOut)),
			) {
				if (item != null) {
					ViewerControls(
						item,
						library,
						state,
						onBack = ::dismiss,
						onInfo = { showsInfo = true },
					)
				}
			}
		}
	}

	val infoItem = current
	if (showsInfo && infoItem != null) {
		PhotoViewerInfoSheet(
			infoItem,
			library,
			state,
			folder = libraryState.folders.firstOrNull { it.key == infoItem.folder },
			onSkipFolder = onSkipFolder,
			onDismiss = { showsInfo = false },
		)
	}
	playing?.let { VideoPlayer(it, onDismiss = { playing = null }) }
}

/**
 * A vertical drag on an unzoomed page pulls the photo away to dismiss, as iOS's zoom
 * transition allows. The pager keeps horizontal drags; whichever axis passes the touch slop
 * first owns the gesture.
 */
private suspend fun PointerInputScope.detectDismissDrag(
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

/** Back, the item's backup status, and info, over the top of the photo. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ViewerControls(item: LocalMediaItem, library: PhotoLibraryViewModel, state: MainUiState, onBack: () -> Unit, onInfo: () -> Unit) {
	Box(
		Modifier
			.fillMaxWidth()
			// Laid out as if the status bar were showing, so hiding it never moves the controls.
			.windowInsetsPadding(WindowInsets.statusBarsIgnoringVisibility)
			.padding(top = 8.dp)
			.padding(horizontal = MainTheme.contentInset),
	) {
		BackupStatusCapsule(item, library, state, Modifier.align(Alignment.Center))
		Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
			CircleIconButton(Symbols.ArrowBackIosNewMedium, contentDescription = "Back to Photos", iconSize = 18.dp, onClick = onBack)
			Spacer(Modifier.weight(1f))
			CircleIconButton(Symbols.InfoIMedium, contentDescription = "Photo information", iconSize = 21.dp, onClick = onInfo)
		}
	}
}

/** The item's backup status, read again whenever the backup state or the item changes. */
@Composable
private fun rememberBackupStatus(item: LocalMediaItem, library: PhotoLibraryViewModel, state: MainUiState): ViewerBackupStatus? {
	val enabled = backupIncludes(state, item)
	// Usually known already (the grid asked as it showed the item, and the viewer asks for
	// its neighbors), so the pill shows from the first frame rather than blinking out
	// between photos.
	var status by remember(item.localIdentifier) {
		mutableStateOf(library.receipts.cachedBackedUp(item)?.let { ViewerBackupStatus.of(it, enabled) })
	}
	LaunchedEffect(item.localIdentifier, item.generation, library.receipts.generation, enabled) {
		status = ViewerBackupStatus.of(library.receipts.isBackedUp(item), enabled)
	}
	return status
}

// Semibold in the status pill and regular in the Info sheet, as iOS draws them.
private val ViewerBackupStatus.pillIcon: ImageVector
	get() = when (this) {
		ViewerBackupStatus.BACKED_UP -> Symbols.CheckCircleSemibold
		ViewerBackupStatus.WAITING -> Symbols.ScheduleSemibold
		ViewerBackupStatus.NOT_BACKED_UP -> Symbols.RemoveCircleOutlineSemibold
	}

private val ViewerBackupStatus.sheetIcon: ImageVector
	get() = when (this) {
		ViewerBackupStatus.BACKED_UP -> Symbols.CheckCircle
		ViewerBackupStatus.WAITING -> Symbols.Schedule
		ViewerBackupStatus.NOT_BACKED_UP -> Symbols.RemoveCircleOutline
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

@Composable
private fun PhotoViewerPage(item: LocalMediaItem, onTap: () -> Unit, onPlay: () -> Unit, onZoomChange: (Boolean) -> Unit) {
	val context = LocalContext.current
	val request = remember(item.localIdentifier, item.generation) { fullImageRequest(context, item) }
	var loading by remember(item.localIdentifier) { mutableStateOf(true) }
	val onState: (AsyncImagePainter.State) -> Unit = { loading = it is AsyncImagePainter.State.Loading && it.painter == null }
	Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
		if (item.isVideo) {
			Box(
				Modifier
					.fillMaxSize()
					.clickable(interactionSource = null, indication = null, role = Role.Button, onClick = onPlay)
					.semantics { contentDescription = "Play video" },
				contentAlignment = Alignment.Center,
			) {
				AsyncImage(request, contentDescription = null, contentScale = ContentScale.Fit, onState = onState, modifier = Modifier.fillMaxSize())
				if (!loading) {
					Box(Modifier.size(72.dp).clip(CircleShape).glassControl(CircleShape), contentAlignment = Alignment.Center) {
						Icon(Symbols.PlayArrowSemibold, contentDescription = null, tint = Color.White, modifier = Modifier.size(30.dp))
					}
				}
			}
		} else {
			ZoomablePhoto(request, onTap, onZoomChange, onState)
		}
		if (loading) CircularProgressIndicator(color = Color.White, modifier = Modifier.size(28.dp), strokeWidth = 2.5.dp)
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
private fun ZoomablePhoto(request: ImageRequest, onTap: () -> Unit, onZoomChange: (Boolean) -> Unit, onState: (AsyncImagePainter.State) -> Unit) {
	val scope = rememberCoroutineScope()
	var zoom by remember { mutableStateOf(PageZoom()) }
	val animation = remember { Animatable(0f) }
	val currentOnTap by rememberUpdatedState(onTap)
	LaunchedEffect(zoom.isZoomed) { onZoomChange(zoom.isZoomed) }
	Box(
		Modifier
			.fillMaxSize()
			.pointerInput(Unit) {
				detectTapGestures(
					onDoubleTap = { point ->
						val start = zoom
						val target = start.toggled(point, size.toSize())
						scope.launch {
							animation.snapTo(0f)
							animation.animateTo(1f, tween(300, easing = AppleEaseInOut)) {
								zoom = PageZoom(
									start.scale + (target.scale - start.scale) * value,
									start.offset + (target.offset - start.offset) * value,
								)
							}
						}
					},
					onTap = { currentOnTap() },
				)
			}
			.pointerInput(Unit) {
				awaitEachGesture {
					awaitFirstDown(requireUnconsumed = false)
					do {
						val event = awaitPointerEvent()
						val fingers = event.changes.count { it.pressed }
						// One finger on an unzoomed photo belongs to paging and dismissal.
						if (fingers >= 2 || zoom.isZoomed) {
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

// ── Info ──

/** The item's metadata and backup status, at about half the screen like iOS's medium detent. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun PhotoViewerInfoSheet(
	item: LocalMediaItem,
	library: PhotoLibraryViewModel,
	state: MainUiState,
	folder: LibraryFolder?,
	onSkipFolder: ((LibraryFolder) -> Unit)?,
	onDismiss: () -> Unit,
) {
	val context = LocalContext.current
	val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
	var confirmingSkip by remember { mutableStateOf(false) }
	val status = rememberBackupStatus(item, library, state)
	val details by produceState<LocalMediaDetails?>(null, item.localIdentifier) { value = PhotoLibrary.details(context, item) }
	PageSheet(onDismissRequest = onDismiss, sheetState = sheetState, floating = true) {
		Column(Modifier.height(mediumSheetHeight()).navigationBarsPadding()) {
			SheetToolbar("Info", onClose = null)
			Column(Modifier.verticalScroll(rememberScrollState()).padding(horizontal = 20.dp).padding(bottom = 16.dp)) {
				SettingsSection("Backup") {
					InfoRow {
						Icon(
							status?.sheetIcon ?: Symbols.Schedule,
							contentDescription = null,
							tint = Color.White,
							modifier = Modifier.size(22.dp),
						)
						Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
							Text(status?.text ?: "Checking backup", style = AppleType.body, color = Color.White)
							if (status == ViewerBackupStatus.NOT_BACKED_UP) {
								Text(
									if (item.isVideo) "Video backup is turned off." else "Photo backup is turned off.",
									style = AppleType.subheadline,
									color = MainTheme.gray,
								)
							}
						}
					}
					if (folder != null && onSkipFolder != null) {
						SettingsDivider()
						InfoRow(Modifier.clickable(role = Role.Button) { confirmingSkip = true }) {
							Text("Skip This Folder", style = AppleType.body, color = LocalBrandColor.current)
						}
					}
				}
				SettingsSection("Details") {
					val rows = buildList {
						if (item.takenAtMs > 0) {
							add("Captured" to DateFormat.getDateTimeInstance(DateFormat.LONG, DateFormat.SHORT).format(Date(item.takenAtMs)))
						}
						details?.displayName?.let { add("Filename" to it) }
						add("Folder" to (folder?.name ?: PhotoBackupFolders.name(item.folderPath)))
						add("Type" to if (item.isVideo) "Video" else "Photo")
						if (item.width > 0 && item.height > 0) add("Dimensions" to "${item.width} × ${item.height}")
						item.durationMs?.let { add("Duration" to PhotoLibrary.formatLongDuration(it)) }
					}
					rows.forEachIndexed { index, (label, value) ->
						if (index > 0) SettingsDivider()
						LabeledRow(label, value, middleTruncates = label == "Filename")
					}
				}
				details?.location?.let { (latitude, longitude) ->
					SettingsSection("Location") { LabeledRow("Coordinates", formatCoordinates(latitude, longitude), middleTruncates = false) }
				}
			}
		}
	}
	if (confirmingSkip && folder != null && onSkipFolder != null) {
		AlertDialog(
			onDismissRequest = { confirmingSkip = false },
			title = { Text("Skip ${folder.name}?") },
			text = {
				Text("${LibraryFolders.contents(folder.photoCount, folder.videoCount, separator = " and ")} in this folder won’t be backed up. Anything already on your Umbrel stays there.")
			},
			confirmButton = {
				TextButton(onClick = {
					confirmingSkip = false
					onSkipFolder(folder)
				}) { Text("Skip Folder") }
			},
			dismissButton = { TextButton(onClick = { confirmingSkip = false }) { Text("Cancel") } },
		)
	}
}

@Composable
private fun InfoRow(modifier: Modifier = Modifier, content: @Composable RowScope.() -> Unit) {
	Row(
		modifier.fillMaxWidth().defaultMinSize(minHeight = 44.dp).padding(horizontal = 16.dp, vertical = 11.dp),
		horizontalArrangement = Arrangement.spacedBy(12.dp),
		verticalAlignment = Alignment.CenterVertically,
		content = content,
	)
}

/** iOS's LabeledContent: the label leading, the value trailing in gray. */
@Composable
private fun LabeledRow(label: String, value: String, middleTruncates: Boolean) {
	InfoRow {
		Text(label, style = AppleType.body, color = Color.White)
		Text(
			value,
			style = AppleType.body,
			color = MainTheme.gray,
			textAlign = TextAlign.End,
			maxLines = if (middleTruncates) 1 else Int.MAX_VALUE,
			overflow = if (middleTruncates) TextOverflow.MiddleEllipsis else TextOverflow.Clip,
			modifier = Modifier.weight(1f),
		)
	}
}
