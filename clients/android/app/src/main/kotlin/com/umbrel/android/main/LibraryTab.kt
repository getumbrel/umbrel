package com.umbrel.android.main

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
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
import androidx.compose.ui.unit.dp
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
import com.umbrel.android.ui.bentoShape
import com.umbrel.android.ui.formatStorageSize
import com.umbrel.android.ui.frostBackground
import com.umbrel.android.ui.glassGlint
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

	Column(
		Modifier
			.fillMaxSize()
			.verticalScroll(rememberScrollState())
			.padding(contentPadding)
			.padding(horizontal = MainTheme.contentInset),
		verticalArrangement = Arrangement.spacedBy(24.dp),
	) {
		TitleBlock(state, showsLibrary, skippedFolders, onShowFolders = { showsFolders = true }, onLearnMore = { showsPhotoBackupInfo = true })
		if (showsLibrary && destination != null) PhotoBackupElsewhereNotice(model, state, destination)
		PhotoBackupNoticeCard(model, state)
		if (showsLibrary) {
			if (libraryState.access == PhotoLibraryAccess.SELECTED) SelectedPhotosCard(model, state)
			StatTiles(state.backupStatistics)
			ViewAllInPhotosButton(model)
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
						PhotoGridCard(libraryState.assets, library.receipts, gridState, tiles, onOpen = { viewerItem = it.localIdentifier })
					}
				},
				skeleton = { GridSkeleton() },
			)
		} else {
			PhotoBackupSetupCard(model, state, learnMore = { showsPhotoBackupInfo = true })
			// umbrelOS's Photos holds every device's backups, so it stays one tap away
			if (destination != null) ViewAllInPhotosButton(model)
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
					withStyle(SpanStyle(fontWeight = FontWeight.SemiBold)) { append("Learn\u00A0more\u00A0") }
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
						contentDescription = "$description Learn more about Photo Backup"
						role = Role.Button
					},
			)
		}
	}
}

private const val CHEVRON = "chevron"

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
 * How Photo Backup works, from the Library's "Learn more" and the setup card. [sourceName]
 * is null when the Umbrel may know this phone by a name the app doesn't have.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun PhotoBackupInfoSheet(sourceName: String?, onDismiss: () -> Unit) {
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
