package com.umbrel.android.main

import android.content.Context
import android.provider.MediaStore
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.LocalTextStyle
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.RectangleShape
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.dp
import com.umbrel.android.ui.AppleType
import com.umbrel.android.ui.MainTheme
import com.umbrel.android.ui.PillButton
import com.umbrel.android.ui.SettingsSectionHeader
import com.umbrel.android.ui.Symbols
import com.umbrel.android.ui.bentoShape
import com.umbrel.kit.backup.PhotoBackupFailureReason
import com.umbrel.kit.backup.PhotoBackupLedger
import com.umbrel.kit.backup.PhotoBackupNotice
import com.umbrel.kit.backup.PhotoBackupStatus
import com.umbrel.kit.backup.PhotoLibraryAccess
import java.text.NumberFormat
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

// What the app says about the items that couldn't back up, and Profile's page of them.

internal val PhotoBackupFailureReason.title: String
	get() = when (this) {
		PhotoBackupFailureReason.UNREADABLE -> "Couldn’t read from this phone"
		PhotoBackupFailureReason.GENERAL -> "Couldn’t upload"
		PhotoBackupFailureReason.NOTHING_TO_UPLOAD -> "Can’t be backed up"
	}

/** Under the [count] items that couldn't back up for this reason. */
internal fun PhotoBackupFailureReason.note(count: Int, retriesByItself: Boolean): String {
	val one = count == 1
	return when (this) {
		PhotoBackupFailureReason.UNREADABLE ->
			"Android couldn’t open ${if (one) "this" else "these"} just now." +
				if (retriesByItself) " Umbrel tries ${if (one) "it" else "them"} again by itself." else ""
		PhotoBackupFailureReason.GENERAL -> "Something went wrong sending ${if (one) "this" else "these"} to your Umbrel."
		PhotoBackupFailureReason.NOTHING_TO_UPLOAD ->
			"${if (one) "This file is" else "These files are"} empty, so there’s nothing to upload. Nothing you need to do."
	}
}

/** About one item, in its Info. */
internal fun PhotoBackupFailureReason.detail(retriesByItself: Boolean): String = when (this) {
	PhotoBackupFailureReason.UNREADABLE -> "Android couldn’t open this just now." + if (retriesByItself) " Umbrel will try again by itself." else ""
	PhotoBackupFailureReason.GENERAL -> "Something went wrong sending this to your Umbrel."
	PhotoBackupFailureReason.NOTHING_TO_UPLOAD -> "This file is empty, so there’s nothing to upload."
}

/**
 * Try Again requeues what the Umbrel refused or kept failing on. An unreadable item is tried
 * on every pass anyway, and an empty file stays empty.
 */
internal val PhotoBackupFailureReason.offersRetry: Boolean get() = this == PhotoBackupFailureReason.GENERAL

/** Passes upload nothing while backup is paused or stopped, so nothing is tried again by itself then. */
internal fun backupRetriesFailuresByItself(status: PhotoBackupStatus): Boolean =
	status != PhotoBackupStatus.Paused && status != PhotoBackupStatus.Error

/**
 * What Try Again does about the items that couldn't back up. A backup that's paused for storage
 * or stopped has its own retry, the one its notice offers, which requeues them too. Any other
 * backup is fine, and they go straight back to the queue.
 */
internal enum class FailedUploadRetry { STORAGE, RECOVERY, REQUEUE }

internal fun failedUploadRetry(notice: PhotoBackupNotice?): FailedUploadRetry = when (notice?.action) {
	PhotoBackupNotice.Action.RETRY_STORAGE -> FailedUploadRetry.STORAGE
	PhotoBackupNotice.Action.RETRY_BACKUP -> FailedUploadRetry.RECOVERY
	else -> FailedUploadRetry.REQUEUE
}

/** A Try Again is under way: the items are being requeued, or backup is starting again or checking storage first. */
internal fun backupRetryInProgress(state: MainUiState): Boolean =
	state.backupFailureRetryInProgress || state.backupStatus == PhotoBackupStatus.SettingUp || state.backupStatus == PhotoBackupStatus.CheckingStorage

/**
 * What Profile shows of the items that couldn't back up: the count on its row and the sections
 * of its page, from one list so they can't disagree. It holds only the items the library still
 * shows. The ledger learns that one was deleted, or that the phone stopped letting the app see
 * it, on a later pass, and until then there'd be no thumbnail to show for it.
 *
 * [byReason] has a section's items newest first, in the order the reasons are listed, without
 * the reasons nothing failed for.
 */
internal class FailedUploads(val byReason: Map<PhotoBackupFailureReason, List<LocalMediaItem>>) {
	val count: Int get() = byReason.values.sumOf { it.size }

	companion object {
		val None = FailedUploads(emptyMap())

		fun of(assets: List<PhotoBackupLedger.FailedAsset>, library: List<LocalMediaItem>): FailedUploads {
			val failed = assets.mapTo(HashSet()) { it.localIdentifier }
			val shown = library.filter { it.localIdentifier in failed }.associateBy { it.localIdentifier }
			val byReason = sortedMapOf<PhotoBackupFailureReason, MutableList<LocalMediaItem>>()
			for (asset in assets) shown[asset.localIdentifier]?.let { byReason.getOrPut(asset.reason, ::ArrayList) += it }
			return FailedUploads(byReason)
		}
	}
}

/**
 * What the ledger's list of failed items is read again for: a change in how many it counts,
 * failed or unreadable, or in the backup they belong to. An item that moves from one to the
 * other changes both counts. An upload changes neither, so a backup in progress costs no reads.
 */
internal data class FailedUploadsVersion(val sourceId: String?, val failed: Long, val unreadable: Long) {
	val isEmpty: Boolean get() = failed + unreadable == 0L

	companion object {
		fun of(state: MainUiState): FailedUploadsVersion {
			val unreadable = (state.backupStatistics?.unreadableCount ?: 0).coerceAtMost(state.backupFailedCount)
			return FailedUploadsVersion(state.backupSourceId, state.backupFailedCount - unreadable, unreadable)
		}
	}
}

/**
 * Null until the ledger has been read. That is once when Profile opens and again when its
 * [FailedUploadsVersion] changes, so an item leaves when it's tried again and comes back if
 * that fails too. Both reads are off the main thread.
 */
@Composable
internal fun rememberFailedUploads(model: MainViewModel, state: MainUiState, library: PhotoLibraryAssets): FailedUploads? {
	var assets by remember { mutableStateOf<List<PhotoBackupLedger.FailedAsset>?>(null) }
	val version = FailedUploadsVersion.of(state)
	LaunchedEffect(version) {
		// Nothing to read while the ledger counts none. One that can't be read just now keeps what's shown.
		assets = if (version.isEmpty) emptyList() else model.failedBackups() ?: return@LaunchedEffect
	}
	return produceState<FailedUploads?>(null, assets, library) {
		val listed = assets ?: return@produceState
		value = if (listed.isEmpty()) FailedUploads.None else withContext(Dispatchers.Default) { FailedUploads.of(listed, library.items) }
	}.value
}

/**
 * Whether backup covers everything on the phone: photos and videos both, no folder skipped,
 * and access to all of them. With "Select photos" it covers only the selection.
 */
internal fun backsUpEverything(state: MainUiState, folders: List<LibraryFolder>): Boolean {
	val preference = state.backupPreference
	return preference.includesPhotos && preference.includesVideos &&
		state.photoLibraryAccess == PhotoLibraryAccess.FULL && skippedFolders(state, folders).isEmpty()
}

/**
 * The page's first line. "Backed up" rather than "on your Umbrel": an edited photo can have an
 * older copy there. With nothing left to list, only a backup that's up to date has backed
 * everything up: an item being tried again has left the list too, and the status says so.
 * Nor is it everything unless [backsUpEverything].
 */
internal fun failedUploadsLead(count: Int, status: PhotoBackupStatus, backsUpEverything: Boolean): String {
	val everythingElse = if (status == PhotoBackupStatus.UpToDateExceptFailures && backsUpEverything) " Everything else from this phone is backed up." else ""
	return when (count) {
		0 -> if (status == PhotoBackupStatus.UpToDate && backsUpEverything) "Everything from this phone is backed up." else status.text
		1 -> "This item isn’t backed up yet.$everythingElse"
		else -> "These ${NumberFormat.getIntegerInstance().format(count)} items aren’t backed up yet.$everythingElse"
	}
}

private const val COLUMNS = 3

/**
 * Profile's page of what couldn't back up, by why. Each row of thumbnails is its own lazy item,
 * so thousands of items cost only the rows on screen; a section's card is drawn by its rows and
 * the note that ends it. An item opens in the photo viewer on its Info, which names it and says
 * why it couldn't back up.
 */
@Composable
internal fun FailedUploadsPage(
	model: MainViewModel,
	library: PhotoLibraryViewModel,
	state: MainUiState,
	uploads: FailedUploads?,
	folders: List<LibraryFolder>,
) {
	var viewerItem by rememberSaveable { mutableStateOf<String?>(null) }
	// Before the list, which is read again after the screen turns: the viewer stays open meanwhile
	viewerItem?.let { id ->
		PhotoViewer(
			library,
			state,
			initialItem = id,
			// No zoom from the tile: the viewer opens on Info, with the photo moved up to make room
			tiles = null,
			onDismissed = { viewerItem = null },
			onRetryBackup = model::retryFailedBackups,
			showsInfo = true,
			backDescription = "Back",
		)
	}

	val shown = uploads ?: return
	val retriesByItself = backupRetriesFailuresByItself(state.backupStatus)
	LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(start = 20.dp, end = 20.dp, top = 20.dp, bottom = 32.dp)) {
		item(key = "lead") {
			Text(
				failedUploadsLead(shown.count, state.backupStatus, backsUpEverything(state, folders)),
				style = AppleType.subheadline,
				color = MainTheme.gray,
				modifier = Modifier.padding(bottom = 6.dp),
			)
		}
		for ((reason, failed) in shown.byReason) {
			val count = failed.size
			val rows = (count + COLUMNS - 1) / COLUMNS
			item(key = "header:$reason") {
				SettingsSectionHeader(reason.title, Modifier.padding(vertical = 10.dp), value = NumberFormat.getIntegerInstance().format(count))
			}
			items(rows, key = { "row:$reason:${failed[it * COLUMNS].localIdentifier}" }, contentType = { 0 }) { row ->
				Row(
					Modifier
						.fillMaxWidth()
						.background(MainTheme.sheetRow, if (row == 0) RoundedCornerShape(topStart = 20.dp, topEnd = 20.dp) else RectangleShape)
						.padding(start = 8.dp, end = 8.dp, top = if (row == 0) 8.dp else 4.dp),
					horizontalArrangement = Arrangement.spacedBy(4.dp),
				) {
					for (column in 0 until COLUMNS) {
						val item = failed.getOrNull(row * COLUMNS + column)
						if (item == null) {
							Spacer(Modifier.weight(1f))
						} else {
							// A single short row rounds its own last tile
							val shape = bentoShape(row, column, rows, minOf(COLUMNS, count))
							FailedUploadTile(item, shape, onOpen = { viewerItem = item.localIdentifier }, Modifier.weight(1f))
						}
					}
				}
			}
			item(key = "note:$reason") {
				val offersRetry = reason.offersRetry
				Column(
					Modifier
						.padding(bottom = 10.dp)
						.fillMaxWidth()
						.background(MainTheme.sheetRow, RoundedCornerShape(bottomStart = 20.dp, bottomEnd = 20.dp))
						// PillButton keeps a 7 dp margin under its capsule for its 44 dp tap target
						.padding(start = 16.dp, end = 16.dp, top = 12.dp, bottom = if (offersRetry) 5.dp else 12.dp),
					verticalArrangement = Arrangement.spacedBy(4.dp),
				) {
					Text(reason.note(count, retriesByItself), style = AppleType.footnote, fontWeight = FontWeight.Medium, color = MainTheme.gray)
					if (offersRetry) {
						PillButton("Try Again", isLoading = backupRetryInProgress(state), onClick = model::retryFailedBackups)
					}
				}
			}
		}
	}
}

/**
 * One item that couldn't back up, which opens in the viewer. One with no picture to show, like
 * an empty file, shows its file's name instead, so it can still be told apart.
 */
@Composable
private fun FailedUploadTile(item: LocalMediaItem, shape: Shape, onOpen: () -> Unit, modifier: Modifier = Modifier) {
	val context = LocalContext.current
	var hasNoPicture by remember(item.localIdentifier, item.generation) { mutableStateOf(false) }
	var fileName by remember(item.localIdentifier, item.generation) { mutableStateOf<String?>(null) }
	// Only read for a tile that has nothing else to show
	if (hasNoPicture) LaunchedEffect(item.localIdentifier, item.generation) { fileName = fileName(context, item) }
	Box(
		modifier
			.clickable(onClickLabel = "Open full screen", role = Role.Button, onClick = onOpen)
			.clearAndSetSemantics {
				// The file's name once the tile shows it, and until then what the library's grid calls the item
				contentDescription = "${fileName ?: accessibilityLabel(item)}, Couldn’t back up"
				role = Role.Button
			},
	) {
		// No mark: everything here couldn't back up
		AssetThumbnail(item, shape, receipts = null, onPicture = { hasNoPicture = !it })
		if (hasNoPicture) FileLabel(fileName, Modifier.matchParentSize())
	}
}

/** The file's name as MediaStore has it, or null when the item can't be read. */
private suspend fun fileName(context: Context, item: LocalMediaItem): String? = withContext(Dispatchers.IO) {
	try {
		context.contentResolver.query(item.uri, arrayOf(MediaStore.MediaColumns.DISPLAY_NAME), null, null, null)?.use {
			if (it.moveToFirst()) it.getString(0)?.takeIf(String::isNotEmpty) else null
		}
	} catch (error: SecurityException) {
		// Access to the item was taken away: the tile keeps its glyph.
		null
	}
}

private val FileNameStyle = AppleType.caption2.copy(fontWeight = FontWeight.Medium, textAlign = TextAlign.Center)

/** In place of a picture: a file glyph over the file's name, on up to two lines. */
@Composable
private fun FileLabel(name: String?, modifier: Modifier = Modifier) {
	Column(
		modifier.padding(horizontal = 8.dp),
		verticalArrangement = Arrangement.spacedBy(6.dp, Alignment.CenterVertically),
		horizontalAlignment = Alignment.CenterHorizontally,
	) {
		Icon(Symbols.Draft, contentDescription = null, tint = MainTheme.gray, modifier = Modifier.size(24.dp))
		if (name != null) {
			// Compose only leaves the middle out of a single line, so two lines are fitted here
			val style = LocalTextStyle.current.merge(FileNameStyle)
			val measurer = rememberTextMeasurer()
			BoxWithConstraints(Modifier.fillMaxWidth()) {
				val width = constraints.maxWidth
				val fitted = remember(name, width, style) {
					middleTruncated(name) { measurer.measure(it, style, constraints = Constraints(maxWidth = width)).lineCount <= 2 }
				}
				Text(fitted, style = style, color = MainTheme.gray, maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.fillMaxWidth())
			}
		}
	}
}

/**
 * [name] with as little of its middle left out as lets it fit: a file's name is told apart by
 * how it starts and how it ends. [fits] says whether a candidate has room, and is expected to
 * agree with itself: what fits still fits when shorter.
 */
internal fun middleTruncated(name: String, fits: (String) -> Boolean): String {
	if (fits(name)) return name
	// The most characters that can stay
	var low = 0
	var high = name.length - 1
	while (low < high) {
		val middle = (low + high + 1) / 2
		if (fits(keeping(name, middle))) low = middle else high = middle - 1
	}
	return keeping(name, low)
}

/** The start and the end of [name], [count] characters in all, around an ellipsis. Never half of a surrogate pair. */
private fun keeping(name: String, count: Int): String {
	var head = (count + 1) / 2
	var tail = count / 2
	if (head > 0 && name[head - 1].isHighSurrogate()) head--
	if (tail > 0 && name[name.length - tail].isLowSurrogate()) tail--
	return name.take(head) + "…" + name.takeLast(tail)
}
