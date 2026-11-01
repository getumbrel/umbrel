package com.umbrel.android.main

import android.content.Context
import android.net.Uri
import android.os.CancellationSignal
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyGridState
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.RoundRect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Outline
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.PointerInputScope
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.onPlaced
import androidx.compose.ui.layout.positionInParent
import androidx.compose.ui.layout.positionOnScreen
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.semantics.ProgressBarRangeInfo
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.progressBarRangeInfo
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.setProgress
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.unit.toOffset
import androidx.compose.ui.unit.toSize
import coil3.ImageLoader
import coil3.asImage
import coil3.compose.AsyncImage
import coil3.decode.DataSource
import coil3.fetch.FetchResult
import coil3.fetch.Fetcher
import coil3.fetch.ImageFetchResult
import coil3.request.ImageRequest
import coil3.request.Options
import coil3.size.Dimension
import com.umbrel.android.ui.AppleEaseOut
import com.umbrel.android.ui.MainTheme
import com.umbrel.android.ui.SectionCard
import com.umbrel.android.ui.Symbols
import com.umbrel.android.ui.bentoShape
import com.umbrel.android.ui.glassGlint
import com.umbrel.android.ui.interFor
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch
import java.text.DateFormat
import java.text.NumberFormat
import java.util.Date
import kotlin.math.ceil
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

private const val COLUMNS = 3
private val Spacing = 4.dp

/**
 * The Library card's grid size, in pixels: three columns of whole-pixel square cells with
 * 4 gaps. Beyond four rows the card has a fixed height of 4.6 rows plus 24 (the bled layout,
 * where the cropped row signals that older photos are a scroll away); smaller libraries
 * shrink to their exact height.
 */
internal data class PhotoGridLayout(val cell: Float, val rows: Int, val bleeds: Boolean, val viewport: Float) {
	companion object {
		fun of(count: Int, width: Float, spacing: Float, bleedExtra: Float): PhotoGridLayout {
			val cell = max(1f, floor((width - spacing * (COLUMNS - 1)) / COLUMNS))
			val rows = ceil(count / COLUMNS.toDouble()).toInt()
			val bleeds = rows > 4
			val viewport = if (bleeds) 4.6f * cell + bleedExtra else rows * cell + max(0, rows - 1) * spacing
			return PhotoGridLayout(cell, rows, bleeds, viewport)
		}
	}
}

/**
 * Scroll positions in the grid, in pixels. Every cell is the same square, so the offset of
 * any row is known without measuring it, the way UICollectionView reports contentOffset.
 */
internal data class PhotoGridGeometry(
	val count: Int,
	val cell: Float,
	val spacing: Float,
	val viewport: Float,
	val bottomInset: Float,
) {
	val rows: Int get() = ceil(count / COLUMNS.toDouble()).toInt()
	private val pitch: Float get() = cell + spacing

	// The rows alone, without the bottom inset.
	val contentHeight: Float get() = if (rows == 0) 0f else rows * cell + (rows - 1) * spacing
	val maxOffset: Float get() = max(0f, contentHeight + bottomInset - viewport)
	val isScrollable: Boolean get() = maxOffset > 1f

	fun offset(firstVisibleItemIndex: Int, firstVisibleItemScrollOffset: Int): Float =
		(firstVisibleItemIndex / COLUMNS) * pitch + firstVisibleItemScrollOffset

	fun progress(offset: Float): Float = if (maxOffset > 0f) (offset / maxOffset).coerceIn(0f, 1f) else 1f

	/** The first item of the row at [offset] and how far that row is scrolled past the top. */
	fun position(offset: Float): Pair<Int, Int> {
		val clamped = offset.coerceIn(0f, maxOffset)
		val row = min(floor(clamped / pitch).toInt(), max(0, rows - 1))
		return row * COLUMNS to (clamped - row * pitch).roundToInt()
	}

	/** Within three quarters of a screen (at least [minimum]) of the newest row: hides Jump to Latest. */
	fun isNearLatest(offset: Float, minimum: Float): Boolean =
		max(0f, contentHeight - (offset + viewport)) < max(minimum, viewport * 0.75f)

	/** At the newest row, give or take [minimum]: new items keep the grid pinned there. */
	fun isNearBottom(offset: Float, minimum: Float): Boolean =
		contentHeight - (offset + viewport) <= max(minimum, viewport * 0.05f)
}

/** The fast scroller's thumb: at least 36 tall, proportional to the visible share, inset 8 from the ends. */
internal data class ScrollThumb(val top: Float, val height: Float, val travel: Float, val inset: Float) {
	/** The progress that centers the thumb on a finger at [y] in the viewport. */
	fun progressAt(y: Float): Float = ((y - inset - height / 2) / max(1f, travel)).coerceIn(0f, 1f)

	companion object {
		fun of(progress: Float, viewport: Float, content: Float, inset: Float, minimum: Float): ScrollThumb {
			val track = max(0f, viewport - inset * 2)
			val height = min(max(minimum, track * min(1f, viewport / max(1f, content))), track)
			val travel = max(0f, track - height)
			return ScrollThumb(inset + travel * progress, height, travel, inset)
		}
	}
}

/** Where each visible grid tile is on screen, for the viewer's zoom from and back to its tile. */
class PhotoTileLocator(private val gridState: LazyGridState) {
	internal var origin = Offset.Zero
	internal var viewport = Rect.Zero

	fun bounds(localIdentifier: String): Rect? {
		val info = gridState.layoutInfo.visibleItemsInfo.firstOrNull { it.key == localIdentifier } ?: return null
		val rect = Rect(origin + info.offset.toOffset(), info.size.toSize())
		return rect.takeIf { it.overlaps(viewport) }
	}
}

/**
 * The whole library in chronological order inside the Library card, opened at the newest
 * row. Lazy layout composes only the visible cells however large the library grows.
 */
@Composable
internal fun PhotoGridCard(
	assets: PhotoLibraryAssets,
	receipts: PhotoBackupReceipts,
	gridState: LazyGridState,
	tiles: PhotoTileLocator,
	onOpen: (LocalMediaItem) -> Unit,
) {
	val density = LocalDensity.current
	BoxWithConstraints(Modifier.fillMaxWidth()) {
		val spacing = with(density) { Spacing.toPx() }
		val layout = PhotoGridLayout.of(assets.size, constraints.maxWidth - with(density) { 16.dp.toPx() }, spacing, with(density) { 24.dp.toPx() })
		val bottomInset = if (layout.bleeds) 8.dp else 0.dp
		val geometry = PhotoGridGeometry(assets.size, layout.cell, spacing, layout.viewport, with(density) { bottomInset.toPx() })
		FollowLatest(assets, gridState, geometry)
		// Bled: the viewport reaches through the card's top and bottom padding so rows crop
		// at the card's edges, while the sides keep the card's 8 insets.
		SectionCard(padding = 0.dp) {
			Box(
				Modifier
					.padding(horizontal = 8.dp, vertical = if (layout.bleeds) 0.dp else 8.dp)
					.fillMaxWidth()
					.height(with(density) { layout.viewport.toDp() })
					.clip(if (layout.bleeds) CardBoundaryCrop else RoundedCornerShape(16.dp))
					.onGloballyPositioned { tiles.viewport = Rect(it.positionOnScreen(), it.size.toSize()) },
			) {
				LazyVerticalGrid(
					columns = PixelCells(layout.cell.roundToInt()),
					state = gridState,
					modifier = Modifier.fillMaxSize().onGloballyPositioned { tiles.origin = it.positionOnScreen() },
					contentPadding = PaddingValues(bottom = bottomInset),
					horizontalArrangement = Arrangement.spacedBy(Spacing),
					verticalArrangement = Arrangement.spacedBy(Spacing),
				) {
					items(assets.size, key = { assets.items[it].localIdentifier }, contentType = { 0 }) { index ->
						val item = assets.items[index]
						AssetThumbnail(
							item,
							bentoShape(index / COLUMNS, index % COLUMNS, layout.rows, COLUMNS, outer = if (layout.bleeds) 16.dp else 2.dp),
							receipts,
							Modifier
								.animateItem()
								.clickable(onClickLabel = "Open full screen", role = Role.Button) { onOpen(item) }
								.clearAndSetSemantics {
									contentDescription = accessibilityLabel(item)
									role = Role.Button
								},
						)
					}
				}
				FastScroller(gridState, geometry)
				JumpToLatest(visible = layout.bleeds, gridState, geometry)
			}
		}
	}
}

/**
 * Opens the grid at the newest row and keeps it there as items arrive, unless the user has
 * scrolled away. The handled revision is saved with the grid's scroll state, so returning
 * to the tab keeps the user's position.
 */
@Composable
private fun FollowLatest(assets: PhotoLibraryAssets, gridState: LazyGridState, geometry: PhotoGridGeometry) {
	var handledRevision by rememberSaveable { mutableIntStateOf(-1) }
	var handledCount by rememberSaveable { mutableIntStateOf(0) }
	val minimum = with(LocalDensity.current) { 24.dp.toPx() }
	LaunchedEffect(assets.revision) {
		if (assets.revision == handledRevision) return@LaunchedEffect
		val previous = geometry.copy(count = handledCount)
		val atBottom = handledRevision == -1 ||
			previous.isNearBottom(previous.offset(gridState.firstVisibleItemIndex, gridState.firstVisibleItemScrollOffset), minimum)
		handledRevision = assets.revision
		handledCount = assets.size
		if (atBottom && assets.size > 0) gridState.scrollToItem(assets.size - 1)
	}
}

/** Three columns of the given whole-pixel width, like UICollectionView's pixel-floored items. */
private data class PixelCells(private val cell: Int) : GridCells {
	override fun Density.calculateCrossAxisCellSizes(availableSize: Int, spacing: Int): List<Int> = List(COLUMNS) { cell }
}

/**
 * The card's rounded boundary in the bled viewport's coordinates: the viewport sits 8 in
 * from the card's sides and spans its full height, so mid-scroll rows get a straight cut at
 * the top and bottom with only the outermost corners shaved by the card's curve.
 */
private object CardBoundaryCrop : Shape {
	override fun createOutline(size: Size, layoutDirection: LayoutDirection, density: Density): Outline {
		val inset = with(density) { 8.dp.toPx() }
		val radius = with(density) { MainTheme.cardRadius.toPx() }
		return Outline.Rounded(RoundRect(-inset, 0f, size.width + inset, size.height, CornerRadius(radius)))
	}
}

private fun accessibilityLabel(item: LocalMediaItem): String {
	val kind = if (item.isVideo) "Video" else "Photo"
	if (item.takenAtMs <= 0) return kind
	return "$kind, ${DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT).format(Date(item.takenAtMs))}"
}

/**
 * A photo-library thumbnail shared by Home and Library: MediaStore's own thumbnail sized to
 * the cell, the video length, and one badge with one meaning, a completed upload receipt
 * for the item's current version.
 */
@Composable
fun AssetThumbnail(item: LocalMediaItem, shape: Shape, receipts: PhotoBackupReceipts, modifier: Modifier = Modifier) {
	val context = LocalContext.current
	var backedUp by remember(item.localIdentifier) { mutableStateOf(false) }
	LaunchedEffect(item.localIdentifier, item.generation, receipts.generation) { backedUp = receipts.isBackedUp(item) }
	Box(modifier.aspectRatio(1f).clip(shape).background(Color.White.copy(alpha = 0.06f))) {
		AsyncImage(
			model = remember(item.localIdentifier, item.generation) { thumbnailRequest(context, item) },
			contentDescription = null,
			contentScale = ContentScale.Crop,
			modifier = Modifier.fillMaxSize(),
		)
		item.durationMs?.let {
			Text(
				PhotoLibrary.formatDuration(it),
				style = TextStyle(fontFamily = interFor(10.sp), fontSize = 10.sp, fontWeight = FontWeight.SemiBold),
				color = Color.White,
				modifier = Modifier
					.align(Alignment.BottomStart)
					.padding(6.dp)
					.background(Color.Black.copy(alpha = 0.55f), CircleShape)
					.padding(horizontal = 5.dp, vertical = 3.dp),
			)
		}
		if (backedUp) {
			Icon(
				Symbols.CheckCircleSemibold,
				contentDescription = "Backed up",
				tint = Color.White.copy(alpha = 0.8f),
				modifier = Modifier
					.align(Alignment.BottomEnd)
					.padding(6.dp)
					.shadow(2.dp, CircleShape, ambientColor = Color.Black.copy(alpha = 0.55f), spotColor = Color.Black.copy(alpha = 0.55f))
					.size(20.dp),
			)
		}
	}
}

// ── Thumbnails ──

/** The memory-cache key of an item's grid thumbnail; the viewer shows it while the full image loads. */
internal fun thumbnailCacheKey(item: LocalMediaItem): String = "thumbnail:${item.localIdentifier}@${item.generation}"

internal fun thumbnailRequest(context: Context, item: LocalMediaItem): ImageRequest =
	ImageRequest.Builder(context)
		.data(MediaStoreThumbnail(item.uri))
		.fetcherFactory(MediaStoreThumbnail.Factory)
		.memoryCacheKey(thumbnailCacheKey(item))
		.build()

/**
 * Coil's content-URI fetcher decodes the original file, so a grid of 12-megapixel photos
 * would decode every one. ContentResolver.loadThumbnail returns MediaStore's cached
 * thumbnail instead, at least the requested size, already rotated, for images and videos.
 */
internal class MediaStoreThumbnail(val uri: Uri) {
	object Factory : Fetcher.Factory<MediaStoreThumbnail> {
		override fun create(data: MediaStoreThumbnail, options: Options, imageLoader: ImageLoader): Fetcher = object : Fetcher {
			override suspend fun fetch(): FetchResult {
				val width = (options.size.width as? Dimension.Pixels)?.px ?: DEFAULT_SIZE
				val height = (options.size.height as? Dimension.Pixels)?.px ?: DEFAULT_SIZE
				val signal = CancellationSignal()
				// Coil runs fetchers on its IO context. A thumbnail for a cell that scrolled
				// away is cancelled in MediaStore too, not only abandoned.
				val bitmap = coroutineScope {
					val watcher = launch {
						try {
							awaitCancellation()
						} finally {
							signal.cancel()
						}
					}
					try {
						options.context.contentResolver.loadThumbnail(data.uri, android.util.Size(width, height), signal)
					} finally {
						watcher.cancel()
					}
				}
				return ImageFetchResult(bitmap.asImage(), isSampled = true, dataSource = DataSource.DISK)
			}
		}
	}

	private companion object {
		const val DEFAULT_SIZE = 512
	}
}

// ── Scrolling controls ──

/**
 * A Photos-style fast scrubber: the grid's position as a thumb on the right edge. A drag
 * that begins on the thumb scrubs; touches anywhere else keep scrolling or opening photos.
 */
@Composable
private fun BoxScope.FastScroller(gridState: LazyGridState, geometry: PhotoGridGeometry) {
	if (!geometry.isScrollable) return
	val density = LocalDensity.current
	val haptics = LocalHapticFeedback.current
	val inset = with(density) { 8.dp.toPx() }
	val progress by remember(geometry) {
		derivedStateOf { geometry.progress(geometry.offset(gridState.firstVisibleItemIndex, gridState.firstVisibleItemScrollOffset)) }
	}
	val thumb = ScrollThumb.of(progress, geometry.viewport, geometry.contentHeight + geometry.bottomInset, inset, with(density) { 36.dp.toPx() })
	var dragging by remember { mutableStateOf(false) }
	var placedTop by remember { mutableFloatStateOf(0f) }
	val currentGeometry by rememberUpdatedState(geometry)
	val currentThumb by rememberUpdatedState(thumb)

	fun scrub(toProgress: Float) {
		val (index, offset) = currentGeometry.position(toProgress * currentGeometry.maxOffset)
		gridState.requestScrollToItem(index, offset)
	}

	Box(
		Modifier
			.align(Alignment.TopEnd)
			.offset { IntOffset(0, (thumb.top - inset).roundToInt()) }
			.size(32.dp, with(density) { (thumb.height + inset * 2).toDp() })
			.onPlaced { placedTop = it.positionInParent().y }
			.pointerInput(Unit) {
				detectScrub(
					onStart = {
						dragging = true
						haptics.performHapticFeedback(HapticFeedbackType.GestureThresholdActivate)
					},
					onMove = { y -> scrub(currentThumb.progressAt(placedTop + y)) },
					onEnd = { dragging = false },
				)
			}
			.semantics {
				contentDescription = "Photo library position"
				stateDescription = NumberFormat.getPercentInstance().format(progress)
				progressBarRangeInfo = ProgressBarRangeInfo(progress, 0f..1f)
				setProgress { target ->
					scrub(target.coerceIn(0f, 1f))
					true
				}
			},
	) {
		val width = if (dragging) 6.dp else 4.dp
		Box(
			Modifier
				.align(Alignment.TopEnd)
				.padding(top = 8.dp, end = 3.dp)
				.size(width, with(density) { thumb.height.toDp() })
				.background(Color.White.copy(alpha = if (dragging) 0.95f else 0.72f), RoundedCornerShape(width / 2)),
		)
	}
}

/** One press-and-drag on the thumb: it starts scrubbing at once, with no long-press delay. */
private suspend fun PointerInputScope.detectScrub(
	onStart: () -> Unit,
	onMove: (Float) -> Unit,
	onEnd: () -> Unit,
) {
	awaitEachGesture {
		val down = awaitFirstDown()
		down.consume()
		onStart()
		onMove(down.position.y)
		try {
			while (true) {
				val event = awaitPointerEvent()
				val change = event.changes.firstOrNull { it.id == down.id } ?: break
				if (!change.pressed) break
				change.consume()
				onMove(change.position.y)
			}
		} finally {
			onEnd()
		}
	}
}

/** "Jump to Latest": shown in the bled layout once the newest rows are out of reach. */
@Composable
private fun BoxScope.JumpToLatest(visible: Boolean, gridState: LazyGridState, geometry: PhotoGridGeometry) {
	val scope = rememberCoroutineScope()
	val minimum = with(LocalDensity.current) { 100.dp.toPx() }
	val nearLatest by remember(geometry) {
		derivedStateOf { geometry.isNearLatest(geometry.offset(gridState.firstVisibleItemIndex, gridState.firstVisibleItemScrollOffset), minimum) }
	}
	AnimatedVisibility(
		visible = visible && !nearLatest,
		modifier = Modifier.align(Alignment.BottomCenter).padding(bottom = 4.dp),
		enter = fadeIn(tween(180, easing = AppleEaseOut)) + scaleIn(tween(180, easing = AppleEaseOut), initialScale = 0.9f),
		exit = fadeOut(tween(180, easing = AppleEaseOut)) + scaleOut(tween(180, easing = AppleEaseOut), targetScale = 0.9f),
	) {
		Box(
			Modifier
				.size(56.dp)
				.clickable(role = Role.Button) {
					scope.launch { if (geometry.count > 0) gridState.animateScrollToItem(geometry.count - 1) }
				}
				.semantics { contentDescription = "Jump to Latest" },
			contentAlignment = Alignment.Center,
		) {
			// Android can't blur the grid behind a sibling, so this uses the opaque fill iOS
			// uses for its material when Reduce Transparency is on.
			Box(
				Modifier
					.size(40.dp)
					.background(Color(0xFF3A3A3C), CircleShape)
					.glassGlint(CircleShape),
				contentAlignment = Alignment.Center,
			) {
				Icon(Symbols.SouthSemibold, contentDescription = null, tint = Color.White, modifier = Modifier.size(17.dp))
			}
		}
	}
}
