package com.umbrel.android.main

import androidx.compose.foundation.ScrollState
import androidx.compose.foundation.background
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
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.grid.rememberLazyGridState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.InlineTextContent
import androidx.compose.foundation.text.appendInlineContent
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shadow
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.Placeholder
import androidx.compose.ui.text.PlaceholderVerticalAlign
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withLink
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.max
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.umbrel.android.ui.AppleType
import com.umbrel.android.ui.BentoGrid
import com.umbrel.android.ui.InfoPageDivider
import com.umbrel.android.ui.InfoPageRow
import com.umbrel.android.ui.LoadReveal
import com.umbrel.android.ui.MainTheme
import com.umbrel.android.ui.NoticeCard
import com.umbrel.android.ui.PageSheet
import com.umbrel.android.ui.Pulsing
import com.umbrel.android.ui.SectionCard
import com.umbrel.android.ui.SheetToolbar
import com.umbrel.android.ui.StatusDot
import com.umbrel.android.ui.Symbols
import com.umbrel.android.ui.WideLayout
import com.umbrel.android.ui.bentoShape
import com.umbrel.android.ui.formatStorageSize
import com.umbrel.android.ui.frostBackground
import com.umbrel.android.ui.glassGlint
import com.umbrel.android.ui.isWideWindow
import com.umbrel.android.ui.rememberFoldTracker
import com.umbrel.kit.backup.PhotoBackupStatistics
import com.umbrel.kit.backup.PhotoLibraryAccess
import java.util.Locale
import kotlin.math.max

/**
 * The Library tab: the phone's own photo library with Umbrel backup state layered on top.
 * Backup receipts never decide which items are visible. Before photo access exists, the
 * setup card is the only content, as it is while backup goes to another Umbrel that has
 * nothing from this phone; otherwise the library (or the user's selection) stays visible
 * whether backup is on or off.
 */
@Composable
fun LibraryTab(model: MainViewModel, library: PhotoLibraryViewModel, state: MainUiState, contentPadding: PaddingValues) {
	val libraryState by library.state.collectAsStateWithLifecycle()
	val gridState = rememberLazyGridState(initialFirstVisibleItemIndex = max(0, libraryState.assets.size - 1))
	val tiles = remember(gridState) { PhotoTileLocator(gridState) }
	var viewerItem by rememberSaveable { mutableStateOf<String?>(null) }
	var showsPhotoBackupInfo by rememberSaveable { mutableStateOf(false) }
	var showsFolders by rememberSaveable { mutableStateOf(false) }
	val showsLibrary = showsPhotoLibrary(libraryState.canReadLibrary, state)
	val skippedFolders = skippedFolders(state, libraryState.folders).size
	val destination = state.otherBackupDeviceName

	// One scroll position for both layouts, so it survives a fold, unfold or resize
	val scroll = rememberScrollState()
	val title = @Composable { TitleBlock(state, showsLibrary, skippedFolders, onShowFolders = { showsFolders = true }, onLearnMore = { showsPhotoBackupInfo = true }) }
	val notices = @Composable {
		if (showsLibrary && destination != null) PhotoBackupElsewhereNotice(model, state, destination)
		PhotoBackupNoticeCard(model, state)
	}
	val backupDetails = @Composable {
		PauseIfUnusedCard(model, state)
		if (libraryState.access == PhotoLibraryAccess.SELECTED) SelectedPhotosCard(model, state)
		StatTiles(state.backupStatistics)
		ViewAllInPhotosButton(model)
	}
	val photoGrid = @Composable { columns: Int, fillHeight: Dp? ->
		LoadReveal(
			libraryState.loaded,
			content = {
				if (libraryState.assets.size == 0) {
					SectionCard {
						Text(
							"No photos or videos",
							style = AppleType.footnote,
							fontWeight = FontWeight.Medium,
							color = Color.White.copy(alpha = 0.6f),
							textAlign = TextAlign.Center,
							modifier = Modifier.fillMaxWidth().padding(vertical = 32.dp),
						)
					}
				} else {
					PhotoGridCard(libraryState.assets, library.receipts, gridState, tiles, onOpen = { viewerItem = it.localIdentifier }, columns, fillHeight)
				}
			},
			skeleton = { GridSkeleton() },
		)
	}

	BoxWithConstraints(Modifier.fillMaxSize()) {
		val width = max(0.dp, maxWidth - MainTheme.contentInset * 2)
		val wide = isWideWindow()
		// The library pairs with the backup details; without it there's one card, so it stays
		// a single column. So does a short window, like a tablet split top and bottom, where
		// the grid beside the details would be a sliver.
		if (wide && width >= WideLayout.twoColumnMinWidth && maxHeight >= TwoColumnMinHeight && showsLibrary) {
			TwoColumnLibrary(width, contentPadding, scroll, title, notices, backupDetails, photoGrid)
		} else {
			Column(
				Modifier
					.fillMaxSize()
					.verticalScroll(scroll)
					.padding(contentPadding)
					.padding(horizontal = MainTheme.contentInset),
				verticalArrangement = Arrangement.spacedBy(24.dp),
			) {
				title()
				notices()
				if (showsLibrary) {
					backupDetails()
					photoGrid(if (wide) WideLayout.columns(width - 16.dp, phone = 3) else 3, null)
				} else {
					PhotoBackupSetupCard(model, state, learnMore = { showsPhotoBackupInfo = true })
					// umbrelOS's Photos holds every device's backups, so it stays one tap away
					if (destination != null) ViewAllInPhotosButton(model)
				}
			}
		}
	}

	viewerItem?.let { id ->
		PhotoViewer(
			library,
			state,
			initialItem = id,
			tiles = tiles,
			onDismissed = { viewerItem = null },
			// Skipping hides the folder's items from Library, this one included, so the viewer closes.
			onSkipFolder = if (canChooseFolders(state)) {
				{ folder ->
					viewerItem = null
					model.setFolderSkipped(folder.key, skipped = true)
				}
			} else {
				null
			},
		)
	}
	if (showsPhotoBackupInfo) PhotoBackupInfoSheet(state.backupSourceName, onDismiss = { showsPhotoBackupInfo = false })
	if (showsFolders) FoldersSheet(model, state, libraryState.folders, onDismiss = { showsFolders = false })
}

private val TwoColumnMinHeight = 560.dp

/**
 * A wide window: the backup details on the left and the library filling the pane on the
 * right. The title and any notice span both columns above them, so the stat tiles and the
 * photo card start on one line. With a foldable half open, the columns sit either side of
 * the hinge.
 */
@Composable
private fun TwoColumnLibrary(
	width: Dp,
	contentPadding: PaddingValues,
	scroll: ScrollState,
	title: @Composable () -> Unit,
	notices: @Composable () -> Unit,
	backupDetails: @Composable () -> Unit,
	photoGrid: @Composable (columns: Int, fillHeight: Dp?) -> Unit,
) {
	val fold = rememberFoldTracker()
	val columns = WideLayout.twoColumns(width, MainTheme.sectionGap, leadingFraction = 0.4f, fold = fold.band())
	Column(
		Modifier
			.fillMaxSize()
			.padding(contentPadding)
			.padding(horizontal = MainTheme.contentInset),
		verticalArrangement = Arrangement.spacedBy(24.dp),
	) {
		Column(Modifier.padding(start = columns[0].x), verticalArrangement = Arrangement.spacedBy(24.dp)) {
			title()
			notices()
		}
		Row(fold.modifier.fillMaxWidth().weight(1f)) {
			Spacer(Modifier.width(columns[0].x))
			Column(
				Modifier.width(columns[0].width).fillMaxHeight().verticalScroll(scroll),
				verticalArrangement = Arrangement.spacedBy(24.dp),
			) {
				backupDetails()
			}
			Spacer(Modifier.width(columns[1].x - columns[0].x - columns[0].width))
			BoxWithConstraints(Modifier.width(columns[1].width).fillMaxHeight()) {
				photoGrid(WideLayout.columns(columns[1].width - 16.dp, phone = 3), maxHeight)
			}
		}
	}
}

/** "Photos", the backup status row, and a one-line explainer that opens the info sheet. */
@Composable
private fun TitleBlock(state: MainUiState, showsLibrary: Boolean, skippedFolders: Int, onShowFolders: () -> Unit, onLearnMore: () -> Unit) {
	Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
		Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
			Text("Photos", style = AppleType.largeTitle, fontWeight = FontWeight.Bold, color = Color.White)
			if (showsLibrary) {
				Row(horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.CenterVertically) {
					StatusDot(libraryBackupStatusColor(state))
					Text(
						buildAnnotatedString {
							append(libraryBackupStatusText(state))
							// The grid leaves skipped folders out, so the status says why they're missing.
							if (skippedFolders > 0) {
								append("\u00A0· ")
								withLink(LinkAnnotation.Clickable("folders", TextLinkStyles(SpanStyle(color = Color.White))) { onShowFolders() }) {
									append(skippedFoldersText(skippedFolders).replace(' ', '\u00A0') + "\u00A0")
									appendInlineContent(CHEVRON)
								}
							}
						},
						inlineContent = mapOf(
							CHEVRON to InlineTextContent(Placeholder(13.sp, 13.sp, PlaceholderVerticalAlign.TextCenter)) {
								Icon(Symbols.ArrowForwardIosSemibold, contentDescription = null, tint = Color.White)
							},
						),
						style = AppleType.subheadline,
						fontWeight = FontWeight.Medium,
						color = Color.White,
						maxLines = 2,
						overflow = TextOverflow.Ellipsis,
					)
				}
			}
		}
		// While backup goes elsewhere, the notice below says where and offers the switch
		if (showsLibrary && state.otherBackupDeviceName == null) {
			val description = libraryBackupDescription(state)
			Text(
				buildAnnotatedString {
					append("$description ")
					withStyle(SpanStyle(fontWeight = FontWeight.SemiBold)) { append("How\u00A0it\u00A0works\u00A0") }
					appendInlineContent(CHEVRON)
				},
				inlineContent = mapOf(
					// The glyph is 10 tall, like SF's 10-point chevron.
					CHEVRON to InlineTextContent(Placeholder(12.sp, 12.sp, PlaceholderVerticalAlign.TextCenter)) {
						Icon(Symbols.ArrowForwardIosSemibold, contentDescription = null, tint = Color.White.copy(alpha = 0.8f))
					},
				),
				style = AppleType.footnote,
				fontWeight = FontWeight.Medium,
				color = Color.White.copy(alpha = 0.8f),
				modifier = Modifier
					.clickable(role = Role.Button, onClick = onLearnMore)
					.clearAndSetSemantics {
						contentDescription = "$description How Photo Backup works"
						role = Role.Button
					},
			)
		}
	}
}

private const val CHEVRON = "chevron"

/**
 * Asks to turn off "Pause app activity if unused" while backup is on, as Android's guidance for
 * apps that sync in the background suggests. It shows once setup is done, so it doesn't add to
 * setup, and goes away once the switch is off.
 */
@Composable
private fun PauseIfUnusedCard(model: MainViewModel, state: MainUiState) {
	val requests = rememberPhotoAccessRequests(model, state)
	if (!backupIsSetUp(state) || requests.pauseIfUnused != PauseIfUnused.ON) return
	NoticeCard(
		icon = Symbols.PauseCircleMedium,
		title = "Keep backing up when you don’t open Umbrel",
		message = "Android pauses apps that aren’t opened for a few months, which stops backup. Turn off “${PauseIfUnused.settingName}” in Settings.",
		onClick = requests.changePauseIfUnused,
	)
}

/**
 * Android 14 and later can share only the photos the user selected; backup then covers the
 * selection. Android's guidance is to let the user change it from the app: the card offers
 * selecting more photos or allowing all, as the Photo Library Access row does.
 */
@Composable
private fun SelectedPhotosCard(model: MainViewModel, state: MainUiState) {
	val requests = rememberPhotoAccessRequests(model, state)
	LimitedAccessChoices(
		requests.allPhotosNeedSettings,
		selectMore = { requests.requestLibraryAccess(false) },
		openSettings = requests.openSettings,
	) { choose, menu ->
		Box {
			NoticeCard(
				icon = Symbols.PhotoLibraryMedium,
				title = "Backing up selected photos",
				message = "Umbrel backs up only the photos and videos you selected, so new ones aren’t backed up until you add them. Allow access to all photos to back up your whole library.",
				onClick = choose,
			)
			menu()
		}
	}
}

/**
 * The Library screens show this phone's library. Everything on the Umbrel, from every device
 * and album, lives in umbrelOS's Photos, one tap away on the same wallpaper.
 */
@Composable
fun ViewAllInPhotosButton(model: MainViewModel, modifier: Modifier = Modifier) {
	Box(modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
		Row(
			Modifier
				.defaultMinSize(minHeight = 52.dp)
				.clip(CircleShape)
				// Same stable wallpaper frost as the cards it sits among.
				.frostBackground(CircleShape)
				.glassGlint(CircleShape)
				.clickable(role = Role.Button) { model.openDashboard("/photos") }
				.padding(horizontal = 18.dp),
			horizontalArrangement = Arrangement.spacedBy(6.dp),
			verticalAlignment = Alignment.CenterVertically,
		) {
			Icon(Symbols.PhotoLibrarySemibold, contentDescription = null, tint = Color.White, modifier = Modifier.size(16.dp))
			Text("View All in Photos", style = AppleType.footnote, fontWeight = FontWeight.SemiBold, color = Color.White)
		}
	}
}

/** Totals the uploader keeps in its ledger, so this row never walks the whole library. */
@Composable
private fun StatTiles(statistics: PhotoBackupStatistics?) {
	Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
		StatTile(Symbols.PhotoLibrary, formatCount(statistics?.uploadedPhotoCount ?: 0), "Photos", Modifier.weight(1f))
		StatTile(Symbols.Videocam, formatCount(statistics?.uploadedVideoCount ?: 0), "Videos", Modifier.weight(1f))
		StatTile(Symbols.CloudDone, formatStorageSize((statistics?.uploadedBytes ?: 0).toDouble()), "Storage", Modifier.weight(1f))
	}
}

@Composable
private fun StatTile(icon: ImageVector, value: String, label: String, modifier: Modifier = Modifier) {
	val glow = with(LocalDensity.current) { 2.dp.toPx() }
	SectionCard(modifier, padding = 0.dp) {
		Column(
			Modifier.fillMaxWidth().heightIn(min = 114.dp),
			horizontalAlignment = Alignment.CenterHorizontally,
			verticalArrangement = Arrangement.spacedBy(10.dp, Alignment.CenterVertically),
		) {
			Icon(icon, contentDescription = null, tint = Color.White, modifier = Modifier.size(24.dp))
			Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(2.dp)) {
				Text(
					value,
					style = AppleType.footnote.copy(shadow = Shadow(Color.White.copy(alpha = 0.25f), blurRadius = glow)),
					fontWeight = FontWeight.SemiBold,
					color = Color.White,
				)
				Text(label, style = AppleType.footnote, fontWeight = FontWeight.SemiBold, color = Color.White)
			}
		}
	}
}

/** "1234" as "1.2k", with whole thousands as "2k". */
internal fun formatCount(count: Long): String {
	if (count < 1000) return count.toString()
	val thousands = String.format(Locale.ROOT, "%.1f", count / 1000.0).replace(".0", "")
	return "${thousands}k"
}

/** The grid card's shape while the first MediaStore query runs. */
@Composable
private fun GridSkeleton() {
	SectionCard {
		Pulsing {
			BentoGrid(12, 3) { index, cellModifier ->
				Box(cellModifier.aspectRatio(1f).background(MainTheme.tile, bentoShape(index / 3, index % 3, 4, 3, outer = 2.dp)))
			}
		}
	}
}

/**
 * How Photo Backup works, from the Library's "How it works", the setup card and Profile's
 * "How it works". [sourceName] is null when the Umbrel may know this phone by a name the
 * app doesn't have.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun PhotoBackupInfoSheet(sourceName: String?, onDismiss: () -> Unit) {
	val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
	PageSheet(onDismissRequest = onDismiss, sheetState = sheetState) {
		Column(Modifier.fillMaxHeight().navigationBarsPadding()) {
			SheetToolbar("Photo Backup", onClose = onDismiss)
			Column(
				Modifier
					.verticalScroll(rememberScrollState())
					.padding(horizontal = 20.dp)
					.padding(top = 20.dp, bottom = 32.dp),
				horizontalAlignment = Alignment.CenterHorizontally,
				verticalArrangement = Arrangement.spacedBy(24.dp),
			) {
				Column(
					Modifier.padding(horizontal = 12.dp),
					horizontalAlignment = Alignment.CenterHorizontally,
					verticalArrangement = Arrangement.spacedBy(14.dp),
				) {
					Box(Modifier.size(76.dp).background(Color.White.copy(alpha = 0.08f), CircleShape), contentAlignment = Alignment.Center) {
						Icon(Symbols.PhotoLibrarySemibold, contentDescription = null, tint = Color.White, modifier = Modifier.size(40.dp))
					}
					Text("How Photo Backup works", style = AppleType.title2, fontWeight = FontWeight.Bold, color = Color.White, textAlign = TextAlign.Center)
					Text(
						"Automatically back up this phone’s photos and videos directly to your Umbrel.",
						style = AppleType.subheadline,
						color = MainTheme.gray,
						textAlign = TextAlign.Center,
					)
				}
				Column(Modifier.fillMaxWidth().background(MainTheme.sheetRow, RoundedCornerShape(20.dp))) {
					// Android, not the app, decides when background work runs. An app it sees as
					// rarely used gets a few background runs a day; charging, or the app being
					// open, lifts that limit. The battery setting that can stop it entirely is the
					// app's background usage.
					InfoPageRow(
						Symbols.MoonZzzMedium,
						"Works in the background",
						"Android decides when uploads run. New photos and videos back up within a few minutes while your phone is charging or this app is open, and otherwise may wait several hours. Background usage must be allowed, but this app doesn’t need to stay open.",
						iconSize = 23.dp,
					)
					InfoPageDivider()
					InfoPageRow(
						Symbols.LanguageMedium,
						"Works at home and away",
						"Uploads go to your Umbrel over an encrypted connection on the same network, or through Tailscale when you’re away. If neither is available, backup waits. You can allow mobile data in Profile.",
					)
					InfoPageDivider()
					InfoPageRow(
						Symbols.PhotoCheckMedium,
						"Needs access to all photos and videos",
						"Access to all photos and videos lets this app find your existing library and detect changes in the background. In Profile, choose whether to back up photos, videos, or both, and skip any folders you don’t need.",
						iconSize = 23.dp,
					)
					if (sourceName != null) {
						InfoPageDivider()
						InfoPageRow(
							Symbols.SmartphoneMedium,
							"Your phone on Umbrel",
							"This phone shows as “$sourceName” in Photos on your Umbrel.",
						)
					}
					InfoPageDivider()
					InfoPageRow(
						Symbols.AutoFixHighMedium,
						"Keeps up with edits",
						"After you edit a photo or video, the version you see in your gallery is backed up again. Photo Backup saves the latest version, not a full history of every edit.",
					)
					InfoPageDivider()
					InfoPageRow(
						Symbols.PauseCircleMedium,
						"Turning backup off",
						"Turning backup off stops uploads. Anything already backed up remains on your Umbrel.",
					)
				}
			}
		}
	}
}
