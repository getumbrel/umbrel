package com.umbrel.android.main

import androidx.compose.animation.Crossfade
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.wrapContentHeight
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicText
import androidx.compose.foundation.text.TextAutoSize
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.max
import androidx.compose.ui.unit.min
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.umbrel.android.IdentityChange
import com.umbrel.android.ui.AppleEaseOut
import com.umbrel.android.ui.AppleType
import com.umbrel.android.ui.BentoGrid
import com.umbrel.android.ui.BrandColor
import com.umbrel.android.ui.EmptyStateCard
import com.umbrel.android.ui.LoadReveal
import com.umbrel.android.ui.MainTheme
import com.umbrel.android.ui.NoticeCard
import com.umbrel.android.ui.PullToRefresh
import com.umbrel.android.ui.Pulsing
import com.umbrel.android.ui.SectionCard
import com.umbrel.android.ui.SectionHeader
import com.umbrel.android.ui.SkeletonTiles
import com.umbrel.android.ui.StatusDot
import com.umbrel.android.ui.Symbols
import com.umbrel.android.ui.TrailingLabel
import com.umbrel.android.ui.WideLayout
import com.umbrel.android.ui.bentoShape
import com.umbrel.android.ui.formatStorageSize
import com.umbrel.android.ui.isAccessibilityTextSize
import com.umbrel.android.ui.isWideWindow
import com.umbrel.android.ui.rememberFoldTracker
import com.umbrel.kit.Umbreld
import com.umbrel.kit.backup.PhotoBackupStatus
import kotlin.math.ceil
import kotlin.math.max
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * The Home tab: the device title and connection status, the apps grid, favorite folders, a
 * window onto the photo library, and the storage breakdown, all over the wallpaper.
 */
@Composable
fun HomeTab(
	model: MainViewModel,
	library: PhotoLibraryViewModel,
	state: MainUiState,
	contentPadding: PaddingValues,
	onShowApps: () -> Unit,
	onShowLibrary: () -> Unit,
	onShowConnectionDetails: () -> Unit,
	onReconnect: suspend () -> Unit,
) {
	PullToRefresh(onRefresh = { model.refreshVisibleData(RefreshScope.HOME, force = true) }, indicatorTop = contentPadding.calculateTopPadding() - 8.dp) {
		BoxWithConstraints(Modifier.fillMaxSize()) {
			val width = max(0.dp, maxWidth - MainTheme.contentInset * 2)
			Column(
				Modifier
					.fillMaxSize()
					.verticalScroll(rememberScrollState())
					.padding(contentPadding)
					.padding(horizontal = MainTheme.contentInset),
				verticalArrangement = Arrangement.spacedBy(MainTheme.sectionGap),
			) {
				if (isWideWindow() && width >= WideLayout.homeTwoColumnMinWidth) {
					TwoColumnHome(model, library, state, width, onShowApps, onShowLibrary, onShowConnectionDetails, onReconnect)
				} else {
					TitleSection(state, onShowConnectionDetails)
					ConnectionIssueCard(state, onReconnect)
					PhotoBackupNoticeCard(model, state)
					AppsSection(model, state, onShowApps)
					FilesSection(model, state)
					LibraryPreviewSection(model, library, state, onShowLibrary)
					StorageSection(model, state)
				}
			}
		}
	}
}

/**
 * A wide window, like a foldable's inner screen or a tablet: the phone's four sections as a
 * 2×2, Apps and Files on the left and Photos and Storage beside them. Each card on the right
 * takes the height of the one beside it, so both rows line up, and with a foldable half open
 * the gutter sits on the hinge. Very wide windows center it at [WideLayout.homeMaxWidth].
 */
@Composable
private fun TwoColumnHome(
	model: MainViewModel,
	library: PhotoLibraryViewModel,
	state: MainUiState,
	availableWidth: Dp,
	onShowApps: () -> Unit,
	onShowLibrary: () -> Unit,
	onShowConnectionDetails: () -> Unit,
	onReconnect: suspend () -> Unit,
) {
	val density = LocalDensity.current
	val width = min(availableWidth, WideLayout.homeMaxWidth)
	val fold = rememberFoldTracker()
	val columns = WideLayout.twoColumns(width, MainTheme.sectionGap, fold = fold.band())
	// The left cards' heights, which the cards beside them match
	var appsCardHeight by remember { mutableStateOf<Dp?>(null) }
	var filesCardHeight by remember { mutableStateOf<Dp?>(null) }
	Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.TopCenter) {
		Column(Modifier.width(width), verticalArrangement = Arrangement.spacedBy(MainTheme.sectionGap)) {
			// The title belongs to the left column, so it shares that column's leading edge
			Box(Modifier.padding(start = columns[0].x)) { TitleSection(state, onShowConnectionDetails) }
			ConnectionIssueCard(state, onReconnect)
			PhotoBackupNoticeCard(model, state)
			Row(fold.modifier.fillMaxWidth()) {
				Spacer(Modifier.width(columns[0].x))
				Column(Modifier.width(columns[0].width), verticalArrangement = Arrangement.spacedBy(MainTheme.sectionGap)) {
					AppsSection(model, state, onShowApps, Modifier.onSizeChanged { appsCardHeight = with(density) { it.height.toDp() } })
					FilesSection(model, state, Modifier.onSizeChanged { filesCardHeight = with(density) { it.height.toDp() } })
				}
				Spacer(Modifier.width(columns[1].x - columns[0].x - columns[0].width))
				Column(Modifier.width(columns[1].width), verticalArrangement = Arrangement.spacedBy(MainTheme.sectionGap)) {
					LibraryPreviewSection(model, library, state, onShowLibrary, cardHeight = appsCardHeight)
					// Without favorites there's no Files card, and Storage keeps its own height
					StorageSection(model, state, filesCardHeight?.takeIf { showsFilesSection(state) }?.let { Modifier.heightIn(min = it) } ?: Modifier)
				}
			}
		}
	}
}

/** The device title, for example "Patrick’s Umbrel Pro", and the connection status. */
@Composable
private fun TitleSection(state: MainUiState, onShowConnectionDetails: () -> Unit) {
	Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
		// The name is normally right on the first frame; if it changes late, crossfade
		// rather than snapping the title wider.
		Crossfade(state.userName to state.deviceLabel, animationSpec = tween(300, easing = AppleEaseOut), label = "title") { (name, label) ->
			val title = buildAnnotatedString {
				if (!name.isNullOrEmpty()) {
					withStyle(SpanStyle(color = Color.White)) { append("$name’s ") }
					withStyle(SpanStyle(color = Color.White.copy(alpha = 0.75f))) { append(label) }
				} else {
					withStyle(SpanStyle(color = Color.White)) { append(label) }
				}
			}
			Text(title, style = AppleType.largeTitle, fontWeight = FontWeight.Bold, maxLines = 2, overflow = TextOverflow.Ellipsis)
		}
		ConnectionStatusLabel(state.connectionState, state.identityChanged, onShowConnectionDetails)
	}
}

@Composable
private fun ConnectionStatusLabel(connection: ConnectionState, identityChanged: Boolean, onClick: () -> Unit) {
	// A quick first check shows nothing; the spinner only appears if it takes a while.
	var showsProgress by remember { mutableStateOf(false) }
	LaunchedEffect(connection == ConnectionState.UNVERIFIED) {
		showsProgress = false
		if (connection != ConnectionState.UNVERIFIED) return@LaunchedEffect
		delay(400)
		showsProgress = true
	}
	val label = when (connection) {
		ConnectionState.UNVERIFIED -> "Checking connection"
		ConnectionState.CONNECTED -> "Connected"
		ConnectionState.UNAVAILABLE -> if (identityChanged) IdentityChange.STATUS else "Offline"
	}
	Row(
		Modifier
			.defaultMinSize(minHeight = 18.dp)
			.clickable(onClickLabel = "Show connection details", role = Role.Button, onClick = onClick)
			.clearAndSetSemantics { contentDescription = label },
		horizontalArrangement = Arrangement.spacedBy(6.dp),
		verticalAlignment = Alignment.CenterVertically,
	) {
		when (connection) {
			ConnectionState.UNVERIFIED -> CircularProgressIndicator(
				Modifier.size(16.dp).alpha(if (showsProgress) 1f else 0f),
				color = Color.White.copy(alpha = 0.7f),
				strokeWidth = 2.dp,
			)
			ConnectionState.CONNECTED -> {
				StatusDot(MainTheme.online)
				Text("Connected", style = AppleType.subheadline, fontWeight = FontWeight.Medium, color = Color.White)
			}
			ConnectionState.UNAVAILABLE -> {
				StatusDot(MainTheme.gray)
				Text(label, style = AppleType.subheadline, fontWeight = FontWeight.Medium, color = Color.White)
			}
		}
	}
}

@Composable
private fun ConnectionIssueCard(state: MainUiState, onReconnect: suspend () -> Unit) {
	if (state.connectionState != ConnectionState.UNAVAILABLE) return
	if (state.identityChanged) {
		ReconnectCard(onReconnect)
		return
	}
	NoticeCard(
		icon = Symbols.WifiAlertMedium,
		iconSize = 23.dp,
		title = "Can’t reach your Umbrel",
		message = if (state.hasTailscaleBrowserAddress) {
			"You’re viewing saved information. Make sure your Umbrel is turned on, then connect this phone to the same network or turn on Tailscale."
		} else {
			"You’re viewing saved information. Make sure your Umbrel is turned on and this phone is connected to the same network."
		},
	)
}

/**
 * The Umbrel answered as a different one, as after it or its certificate is reset. The app
 * never trusts a new certificate on its own: Reconnect removes this Umbrel and adds it again.
 */
@Composable
private fun ReconnectCard(onReconnect: suspend () -> Unit) {
	val scope = rememberCoroutineScope()
	var confirming by remember { mutableStateOf(false) }
	var reconnecting by remember { mutableStateOf(false) }
	NoticeCard(
		icon = Symbols.LockWarningMedium,
		iconSize = 24.dp,
		title = IdentityChange.TITLE,
		message = IdentityChange.MESSAGE,
		actionLabel = if (reconnecting) "Reconnecting…" else "Reconnect",
		onClick = { if (!reconnecting) confirming = true },
	)
	if (confirming) {
		AlertDialog(
			onDismissRequest = { confirming = false },
			title = { Text(IdentityChange.CONFIRM_TITLE) },
			text = { Text(IdentityChange.CONFIRM_MESSAGE) },
			dismissButton = { TextButton(onClick = { confirming = false }) { Text("Cancel") } },
			confirmButton = {
				TextButton(onClick = {
					confirming = false
					reconnecting = true
					scope.launch {
						try {
							onReconnect()
						} finally {
							reconnecting = false
						}
					}
				}) { Text("Reconnect") }
			},
		)
	}
}

// ── Apps ──

/** [cardModifier] measures the card, for the one beside it in a wide window to match. */
@Composable
private fun AppsSection(model: MainViewModel, state: MainUiState, onShowApps: () -> Unit, cardModifier: Modifier = Modifier) {
	val columns = if (isAccessibilityTextSize()) 2 else 3
	Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
		SectionHeader("Apps", showsChevron = true, onClick = onShowApps) {
			val updates = state.updateCount
			if (updates > 0) TrailingLabel(if (updates == 1) "1 update" else "$updates updates")
		}
		LoadReveal(
			state.didLoad,
			order = 0,
			modifier = cardModifier,
			content = {
				if (state.installedApps.isEmpty()) {
					EmptyStateCard(
						icon = Symbols.AppsDiamond,
						iconSize = 30.dp,
						title = "Install your first app",
						subtitle = "Open the Umbrel App Store to install apps",
						buttonTitle = "Open Umbrel App Store",
						onClick = { model.openDashboard("/app-store", reportUnavailable = false) },
					)
				} else {
					SectionCard { AppsGrid(model, state, columns, onShowApps) }
				}
			},
			skeleton = { SectionCard { SkeletonTiles(6 / columns, columns) } },
		)
	}
}

/** Six bento tiles: the first apps, with a "+N apps" tile in the last slot when more exist. */
@Composable
private fun AppsGrid(model: MainViewModel, state: MainUiState, columns: Int, onShowApps: () -> Unit) {
	val apps = state.installedApps
	val hasOverflow = apps.size > 6
	val visible = if (hasOverflow) apps.take(5) else apps.take(6)
	val overflow = apps.drop(5)
	val rows = 6 / columns
	BentoGrid(6, columns) { index, cellModifier ->
		val shape = bentoShape(index / columns, index % columns, rows, columns)
		val tile = cellModifier
			.height(100.dp)
			.clip(shape)
			.background(MainTheme.tile, shape)
			.border(1.dp, Color.White.copy(alpha = 0.07f), shape)
		when {
			hasOverflow && index == 5 -> OverflowTile(
				overflow.size,
				overflow.take(3),
				tile
					.clickable(onClickLabel = "View ${overflow.size} more apps", role = Role.Button, onClick = onShowApps)
					.clearAndSetSemantics { contentDescription = "View ${overflow.size} more apps" },
			)
			index < visible.size -> {
				val app = visible[index]
				AppTileButton(app, preparing = app.id in state.preparingAppIds, onClick = { source -> model.launchApp(app, source) }, modifier = tile)
			}
			else -> Box(tile)
		}
	}
}

// ── Files ──

/**
 * Reserve the Files section while loading; collapse it only once the load confirms there are
 * no favorites, which is rare since umbrelOS defaults to four.
 */
private fun showsFilesSection(state: MainUiState): Boolean = !(state.didLoad && state.favoritePaths.isEmpty())

/**
 * The umbrelOS files-favorites widget: the first four favorite folders, 2 by 2 when there
 * are four and a single row with fewer.
 */
@Composable
private fun FilesSection(model: MainViewModel, state: MainUiState, cardModifier: Modifier = Modifier) {
	if (!showsFilesSection(state)) return
	val paths = state.favoritePaths
	val brandColor = state.brandColor
	// /files resolves to the home of whichever umbrelOS account the browser uses.
	val onViewAll = { model.openDashboard("/files") }
	val onOpenPath = { path: String -> model.openDashboard("/files$path") }
	Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
		SectionHeader("Files", onClick = onViewAll) { TrailingLabel("View all") }
		LoadReveal(
			state.didLoad,
			order = 1,
			modifier = cardModifier,
			content = {
				SectionCard {
					val columns = if (paths.size == 4) 2 else max(1, paths.size)
					val rows = ceil(paths.size / columns.toDouble()).toInt()
					BentoGrid(paths.size, columns) { index, cellModifier ->
						val path = paths[index]
						val name = path.substringAfterLast('/')
						val shape = bentoShape(index / columns, index % columns, rows, columns)
						Column(
							cellModifier
								.height(100.dp)
								.clip(shape)
								.background(MainTheme.tile, shape)
								.border(1.dp, Color.White.copy(alpha = 0.07f), shape)
								.clickable(role = Role.Button) { onOpenPath(path) }
								.clearAndSetSemantics { contentDescription = "Open $name in Files" },
							horizontalAlignment = Alignment.CenterHorizontally,
							verticalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterVertically),
						) {
							FolderIconView(path, brandColor, Modifier.size(44.dp, 40.dp))
							Text(
								name,
								style = AppleType.caption2,
								fontWeight = FontWeight.Medium,
								color = MainTheme.gray3,
								maxLines = 1,
								overflow = TextOverflow.Ellipsis,
								modifier = Modifier.padding(horizontal = 4.dp),
							)
						}
					}
				}
			},
			skeleton = { SectionCard { SkeletonTiles(2, 2) } },
		)
	}
}

// ── Library preview ──

/** The backup status color shared by Home and Library. */
fun statusColor(status: PhotoBackupStatus): Color = when (status.tone) {
	PhotoBackupStatus.Tone.OFF -> MainTheme.gray
	PhotoBackupStatus.Tone.IN_PROGRESS -> MainTheme.syncing
	PhotoBackupStatus.Tone.GOOD -> MainTheme.online
	PhotoBackupStatus.Tone.PROBLEM -> MainTheme.red
}

/** In a wide window the card takes [cardHeight], the height of the Apps card beside it. */
@Composable
private fun LibraryPreviewSection(
	model: MainViewModel,
	library: PhotoLibraryViewModel,
	state: MainUiState,
	onShowLibrary: () -> Unit,
	cardHeight: Dp? = null,
) {
	val libraryState by library.state.collectAsStateWithLifecycle()
	Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
		// As in the Library tab: the photos, or the setup card in their place
		if (showsPhotoLibrary(libraryState.canReadLibrary, state)) {
			// The backup status sits in the header's trailing slot; header and card are one tap
			// target that opens the Library tab.
			val other = state.otherBackupDeviceName != null
			Column(
				Modifier.clickable(role = Role.Button, onClick = onShowLibrary),
				verticalArrangement = Arrangement.spacedBy(12.dp),
			) {
				SectionHeader("Photos", showsChevron = true) {
					val status = state.backupStatus
					TrailingLabel(if (other) "On another Umbrel" else status.text, dot = if (other) MainTheme.gray else statusColor(status))
				}
				LibraryMosaic(libraryState.assets, library.receipts, cardHeight)
			}
		} else {
			SectionHeader("Photos", showsChevron = true, onClick = onShowLibrary)
			PhotoBackupSetupCard(model, state, modifier = cardHeight?.let { Modifier.heightIn(min = it) } ?: Modifier)
		}
	}
}

/**
 * A window onto the newest rows of the phone's library, bottom-aligned in a fixed-height
 * card that crops at the top edge. With a small library the top shows plain frost. In a wide
 * window the card takes [cardHeight] instead.
 */
@Composable
private fun LibraryMosaic(assets: PhotoLibraryAssets, receipts: PhotoBackupReceipts, cardHeight: Dp?) {
	val columns = 3
	val items = assets.items.takeLast(9)
	val count = if (items.isEmpty()) 9 else items.size
	val rows = ceil(count / columns.toDouble()).toInt()
	SectionCard(Modifier.clip(RoundedCornerShape(MainTheme.cardRadius)), padding = 0.dp) {
		Box(Modifier.fillMaxWidth().padding(bottom = 8.dp).height(cardHeight?.minus(8.dp) ?: 252.dp).clipToBounds()) {
			BentoGrid(
				count,
				columns,
				Modifier
					.align(Alignment.BottomCenter)
					.wrapContentHeight(Alignment.Bottom, unbounded = true)
					.padding(horizontal = 8.dp),
			) { index, cellModifier ->
				// The bento frame is shifted down a row so no tile counts as the top row: the
				// top edge is cropped, so only the bottom corners round.
				val shape = bentoShape(index / columns + 1, index % columns, rows + 1, columns)
				val item = items.getOrNull(index)
				if (item != null) {
					AssetThumbnail(item, shape, receipts, cellModifier)
				} else {
					Box(cellModifier.aspectRatio(1f).background(MainTheme.tile, shape))
				}
			}
		}
	}
}

// ── Storage ──

@Composable
private fun StorageSection(model: MainViewModel, state: MainUiState, cardModifier: Modifier = Modifier) {
	val disk = state.disk
	val brandColorHsl = state.brandColorHsl
	val onViewLiveUsage = { model.openDashboard(query = listOf("dialog" to "live-usage", "live-usage-tab" to "storage")) }
	// Apps is the brand color; the other categories are successively whiter tints, so the
	// breakdown reads as one wallpaper-derived hue.
	val colors = listOf(0.0, 0.32, 0.58, 0.82).map { BrandColor.color(brandColorHsl, mixWhite = it) }
	val accessibility = isAccessibilityTextSize()
	Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
		SectionHeader("Storage", onClick = onViewLiveUsage) { TrailingLabel("View Live Usage") }
		LoadReveal(
			state.didLoad,
			order = 2,
			content = {
				SectionCard(cardModifier, padding = 24.dp, contentAlignment = Alignment.CenterStart) {
					StorageLayout(accessibility, chart = { DonutChart(disk, colors) }) {
						Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
							val used = disk?.let { formatStorageSize(it.totalUsed) } ?: "—"
							val total = disk?.let { formatStorageSize(it.size) } ?: "—"
							BasicText(
								buildAnnotatedString {
									withStyle(SpanStyle(color = Color.White)) { append(used) }
									withStyle(SpanStyle(color = Color.White.copy(alpha = 0.5f))) { append(" of $total used") }
								},
								style = AppleType.headline.copy(fontWeight = FontWeight.Bold),
								maxLines = 1,
								autoSize = TextAutoSize.StepBased(minFontSize = AppleType.headline.fontSize * 0.75f, maxFontSize = AppleType.headline.fontSize),
							)
							Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
								LegendRow("Apps", colors[0])
								LegendRow("Files", colors[1])
								if ((disk?.machinesUsed ?: 0.0) > 0) LegendRow("Machines", colors[2])
								LegendRow("System", colors[3])
							}
						}
					}
				}
			},
			skeleton = {
				SectionCard(cardModifier, padding = 24.dp, contentAlignment = Alignment.CenterStart) {
					Pulsing {
						StorageLayout(accessibility, chart = {
							Canvas(Modifier.size(103.dp)) {
								drawCircle(Color.White.copy(alpha = 0.08f), style = Stroke(12.dp.toPx()))
							}
						}) {
							Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
								Box(Modifier.size(150.dp, 18.dp).background(MainTheme.tile, RoundedCornerShape(4.dp)))
								Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
									repeat(3) { Box(Modifier.size(72.dp, 10.dp).background(MainTheme.tile, RoundedCornerShape(3.dp))) }
								}
							}
						}
					}
				}
			},
		)
	}
}

/** Chart beside the details, or stacked above them at accessibility text sizes. */
@Composable
private fun StorageLayout(accessibility: Boolean, chart: @Composable () -> Unit, details: @Composable () -> Unit) {
	if (accessibility) {
		Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(24.dp)) {
			Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) { chart() }
			details()
		}
	} else {
		Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(24.dp), verticalAlignment = Alignment.CenterVertically) {
			chart()
			Box(Modifier.weight(1f)) { details() }
		}
	}
}

@Composable
private fun LegendRow(label: String, color: Color) {
	Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
		Box(Modifier.size(14.dp, 5.dp).background(color, CircleShape))
		Text(label, style = AppleType.footnote, fontWeight = FontWeight.Medium, color = Color.White)
	}
}

/** Concentric donut of categorized usage over a faint free-space track. */
@Composable
private fun DonutChart(disk: Umbreld.DiskUsage?, colors: List<Color>) {
	Box(Modifier.size(103.dp), contentAlignment = Alignment.Center) {
		Canvas(Modifier.size(103.dp)) {
			val stroke = Stroke(12.dp.toPx(), cap = StrokeCap.Butt)
			drawCircle(Color.White.copy(alpha = 0.08f), style = Stroke(12.dp.toPx()))
			if (disk != null && disk.size > 0) {
				var cursor = 0.0
				for ((value, color) in listOf(disk.appsUsed, disk.files, disk.machinesUsed, disk.system).zip(colors)) {
					val fraction = value / disk.size
					if (fraction <= 0) continue
					drawArc(color, startAngle = (-90 + cursor * 360).toFloat(), sweepAngle = (fraction * 360).toFloat(), useCenter = false, style = stroke)
					cursor += fraction
				}
			}
		}
		Icon(Symbols.HardDrive, contentDescription = null, tint = Color.White.copy(alpha = 0.5f), modifier = Modifier.size(31.dp))
	}
}
