package com.umbrel.android.main

import androidx.compose.foundation.layout.Row
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.umbrel.android.ui.EmptyStateCard
import com.umbrel.android.ui.MainTheme
import com.umbrel.android.ui.NoticeCard
import com.umbrel.android.ui.NoticeIconSize
import com.umbrel.android.ui.Symbols
import com.umbrel.kit.SavedDevice
import com.umbrel.kit.backup.PhotoBackupNotice
import com.umbrel.kit.backup.PhotoBackupTarget
import com.umbrel.kit.backup.PhotoLibraryCounts
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

// What the Library and the Home library card read from and report to photo backup lives in
// this file, so a new backup API needs rewiring here only.

/**
 * The ledger reads behind the grid badges, and the library counts backup measures its
 * remaining work against.
 */
class LibraryBackupReader(private val model: MainViewModel) {
	private val reads = Mutex()

	/** Emits whenever receipts may have changed. */
	val revisions: Flow<Any> = model.state.map { it.backupReceiptRevision to it.backupSourceId }.distinctUntilChanged()

	/** The identifiers among [items] whose current version has a completed upload receipt. */
	suspend fun backedUp(items: List<LocalMediaItem>): Set<String> = reads.withLock {
		withContext(Dispatchers.IO) {
			items.filter(model::isBackedUp).mapTo(HashSet()) { it.localIdentifier }
		}
	}

	fun libraryChanged(counts: PhotoLibraryCounts) = model.libraryChanged(counts)

	/** What Library leaves out while backup is on; emits on every change. */
	val filters: Flow<LibraryFilter?> = model.state.map { LibraryFilter.of(it) }.distinctUntilChanged()
}

// ── Presentation ──

/** Library's status row: how backup is going, or that it goes to another Umbrel, as on Home. */
fun libraryBackupStatusText(state: MainUiState): String =
	if (state.otherBackupDeviceName != null) "On another Umbrel" else state.backupStatus.text

fun libraryBackupStatusColor(state: MainUiState): Color =
	if (state.otherBackupDeviceName != null) MainTheme.gray else statusColor(state.backupStatus)

/**
 * The explainer under Library's status. Android, not the app, schedules background uploads.
 * While backup goes elsewhere the notice below the title says where instead.
 */
fun libraryBackupDescription(state: MainUiState): String =
	if (!state.backupPreference.isEnabled) {
		"Photos and videos already backed up remain on your Umbrel."
	} else {
		"Android schedules uploads in the background, even when this app is closed."
	}

/**
 * Backup goes to another Umbrel and this one has nothing from this phone. Unknown totals count
 * as something, so the Library never hides backups that are there.
 */
fun backupIsOnlyElsewhere(state: MainUiState): Boolean {
	if (state.otherBackupDeviceName == null || !state.backupSourceResolved) return false
	if (state.backupSourceId == null) return true
	return state.backupStatistics?.uploadedCount == 0L
}

/**
 * The Library shows this phone's photos marked with this Umbrel's backups. Without photo
 * access, or with nothing from this phone here while it backs up elsewhere, the setup card
 * takes its place, on Home as in the Library.
 */
fun showsPhotoLibrary(canReadLibrary: Boolean, state: MainUiState): Boolean = canReadLibrary && !backupIsOnlyElsewhere(state)

/**
 * Switching needs photo access, all of the library or a selection, which Android backs up
 * alike, or the chance to ask for it, as on iOS. Once Android no longer shows its request,
 * Settings is the way in.
 */
internal fun canSwitchBackupHere(access: PhotoAccess): Boolean = access != PhotoAccess.BLOCKED

/** Which card the setup card is, decided apart from drawing it. */
internal enum class PhotoBackupSetupCardKind {
	SET_UP,

	/** Backup goes to another Umbrel, and this one offers to take it over. */
	SWITCH,

	/** Backup goes to another Umbrel, and switching needs photo access granted in Settings. */
	SWITCH_NEEDS_SETTINGS,
}

internal fun photoBackupSetupCardKind(state: MainUiState, access: PhotoAccess): PhotoBackupSetupCardKind = when {
	state.otherBackupDeviceName == null -> PhotoBackupSetupCardKind.SET_UP
	canSwitchBackupHere(access) -> PhotoBackupSetupCardKind.SWITCH
	else -> PhotoBackupSetupCardKind.SWITCH_NEEDS_SETTINGS
}

/**
 * A confirmed switch to this Umbrel is under way: its check, then setup here. Setup's progress
 * is shared by every Umbrel, so it counts only once this account owns backup.
 */
fun backupSwitchInProgress(state: MainUiState): Boolean =
	state.backupSwitchChecking || (state.backupSetupInProgress && state.backupPreference.isEnabled)

/** What a confirmed switch came back needing, kept in the view model until it's answered. */
sealed class BackupSwitchPrompt {
	/** The account already has backups from [existing]; nothing has changed yet. */
	data class NewSource(val destination: String, val existing: String, val canRequestAccess: Boolean) : BackupSwitchPrompt()

	/** The Umbrel couldn't be asked, and backup is still on for [destination]. */
	data class CouldNotCheck(val destination: String) : BackupSwitchPrompt()

	/** Backup moved here before photo access was granted, so Android's request comes next. */
	data object AccessRequest : BackupSwitchPrompt()
}

/**
 * How the screens name the Umbrel backup goes to. Two Umbrels of the same model and owner read
 * alike, so the other one is named by its host when that differs, or as another account on
 * this one.
 */
internal fun backupDestinationName(target: PhotoBackupTarget, saved: SavedDevice?, current: SavedDevice, currentAccountId: String): String {
	if (saved == null) return "another Umbrel"
	val label = backupDestinationLabel(saved, target.accountId)
	if (label != backupDestinationLabel(current, currentAccountId)) return label
	return when {
		target.deviceId == current.id -> "another account on this Umbrel"
		!saved.host.equals(current.host, ignoreCase = true) -> saved.host
		else -> "your other ${saved.model ?: saved.name}"
	}
}

private fun backupDestinationLabel(device: SavedDevice, accountId: String): String {
	val accountName = device.accountProfile(accountId)?.name
	return if (!accountName.isNullOrEmpty()) "$accountName’s ${device.model ?: device.name}" else device.displayName
}

/**
 * The name this phone has in Photos on the Umbrel. A source registered earlier keeps its
 * saved name, which the app only knows while backup is set up; with no source yet, it's
 * the name the first setup will suggest.
 */
internal fun backupSourceName(sourceName: String?, sourceId: String?, current: () -> String): String? =
	sourceName ?: if (sourceId == null) current() else null

/** Whether backup is on for this item's media type, for the viewer's per-item status. */
fun backupIncludes(state: MainUiState, item: LocalMediaItem): Boolean =
	if (item.isVideo) state.backupPreference.includesVideos else state.backupPreference.includesPhotos

/**
 * The backup notice, shared by Home and Library so neither shows a warning the other can't
 * explain or repair. The whole card is the action when one is offered.
 */
@Composable
fun PhotoBackupNoticeCard(model: MainViewModel, state: MainUiState) {
	// Unlike iOS, which waits only for Tailscale and so shows this only while the Umbrel is
	// reachable, Android waits for any route: the notice matters most while the Umbrel isn't.
	val notice = state.backupNotice ?: return
	val requests = rememberPhotoAccessRequests(model, state)
	var reviewingNewSource by remember(notice) { mutableStateOf(false) }
	val action: (() -> Unit)? = when (notice.action) {
		PhotoBackupNotice.Action.SET_UP_TAILSCALE -> model::presentTailscaleSetup
		PhotoBackupNotice.Action.RETRY_STORAGE -> model::retryBackupAfterStorage
		PhotoBackupNotice.Action.RETRY_BACKUP -> model::retryBackupAfterError
		// Location belongs to the photo permission group, so asking again grants it without a
		// dialog when photo access is already allowed; Settings is the way in once it's blocked.
		PhotoBackupNotice.Action.ALLOW_LOCATION_ACCESS -> { { requests.requestLibraryAccess(false) } }
		// Backing up again can store a whole library a second time, so a tap only opens the
		// choice, unlike the notices whose action just retries
		PhotoBackupNotice.Action.BACK_UP_ANYWAY -> { { reviewingNewSource = true } }
		null -> null
	}
	NoticeCard(
		noticeIcon(notice),
		notice.title,
		backupNoticeMessage(notice, state),
		actionLabel = notice.actionLabel,
		onClick = action,
		iconSize = noticeIconSize(notice),
	)
	if (reviewingNewSource) {
		AlertDialog(
			onDismissRequest = { reviewingNewSource = false },
			title = { Text("Back up as a new phone?") },
			text = { Text(backupNoticeMessage(notice, state)) },
			confirmButton = {
				TextButton(onClick = {
					reviewingNewSource = false
					model.backUpAsNewSource()
				}) { Text("Back Up Anyway") }
			},
			dismissButton = {
				Row {
					TextButton(onClick = { reviewingNewSource = false }) { Text("Cancel") }
					TextButton(onClick = {
						reviewingNewSource = false
						model.turnOffBackup()
					}) { Text("Turn Off Backup") }
				}
			},
		)
	}
}

/**
 * The notice's message. Once the Umbrel has a Tailscale address, Tailscale is set up there,
 * so waiting names both ways back, as Connection details does: Android can't say whether
 * Tailscale is switched on here or the Umbrel is off. The new-phone question names the
 * account's existing source.
 */
internal fun backupNoticeMessage(notice: PhotoBackupNotice, state: MainUiState): String = when {
	notice == PhotoBackupNotice.WAITING_FOR_UMBREL && state.device.tailscaleAddress != null ->
		connectionMessage(ConnectionState.UNAVAILABLE, null, hasKnownTailscaleAddress = true)
	notice == PhotoBackupNotice.MAY_BACK_UP_TWICE -> PhotoBackupNotice.mayBackUpTwiceMessage(state.backupNewSourceQuestion.orEmpty())
	else -> notice.message
}

/** The iOS notice symbols, as their closest Material icons. */
private fun noticeIcon(notice: PhotoBackupNotice): ImageVector = when (notice) {
	PhotoBackupNotice.BACKGROUND_RESTRICTED -> Symbols.RefreshCircleMedium
	PhotoBackupNotice.WAITING_FOR_UMBREL -> Symbols.LanguageMedium
	PhotoBackupNotice.WAITING_FOR_WIFI -> Symbols.WifiMedium
	PhotoBackupNotice.CHECKING_STORAGE -> Symbols.DriveQuestionMedium
	PhotoBackupNotice.INSUFFICIENT_STORAGE -> Symbols.DriveExclamationMedium
	PhotoBackupNotice.LOCATION_ACCESS_REQUIRED -> Symbols.LocationOnMedium
	PhotoBackupNotice.RECONNECT -> Symbols.KeyHorizontalMedium
	PhotoBackupNotice.NEEDS_ATTENTION, PhotoBackupNotice.UNREADABLE_ITEMS -> Symbols.WarningAmberMedium
	PhotoBackupNotice.MAY_BACK_UP_TWICE -> Symbols.ContentCopyMedium
}

// Sized so each draws as large as its SF Symbol does; the badged drives are wider than the
// card's icon column, as on iOS.
private fun noticeIconSize(notice: PhotoBackupNotice): Dp = when (notice) {
	PhotoBackupNotice.CHECKING_STORAGE, PhotoBackupNotice.INSUFFICIENT_STORAGE -> 29.dp
	PhotoBackupNotice.RECONNECT -> 24.dp
	else -> NoticeIconSize
}

/**
 * Backup setup, shared by Home and Library and shown in place of the library: while the app
 * can't read it, and while backup goes to another Umbrel that has nothing from this phone
 * ([showsPhotoLibrary]). Then it says where backup goes and offers to switch it here.
 * "Set up backup" saves the choice and asks for photo access; once Android no longer shows
 * its dialog, Settings is the way in. A selection of photos counts as access on Android, so
 * this card never asks a user with partial access to upgrade. When backup is on, access was
 * lost and backup is paused: the card asks for access back, and backup resumes on its own.
 */
@Composable
fun PhotoBackupSetupCard(model: MainViewModel, state: MainUiState, learnMore: (() -> Unit)? = null) {
	val requests = rememberPhotoAccessRequests(model, state)
	val other = state.otherBackupDeviceName
	when (photoBackupSetupCardKind(state, requests.access)) {
		PhotoBackupSetupCardKind.SET_UP -> Unit
		PhotoBackupSetupCardKind.SWITCH -> {
			val switching = backupSwitchInProgress(state)
			PhotoBackupSwitchConfirmation(model, other.orEmpty(), requests.access) { confirm ->
				EmptyStateCard(
					icon = Symbols.PhotoLibrary,
					title = "Photo Backup is on for $other",
					subtitle = "This phone can back up to one Umbrel at a time.",
					buttonTitle = if (switching) "Switching backup…" else "Back Up to This Umbrel",
					buttonLoading = switching,
					onClick = confirm,
				)
			}
			return
		}
		PhotoBackupSetupCardKind.SWITCH_NEEDS_SETTINGS -> {
			EmptyStateCard(
				icon = Symbols.PhotoLibrary,
				title = "Photo Backup is on for $other",
				subtitle = "This phone can back up to one Umbrel at a time. Allow photo access to back up to this Umbrel instead.",
				buttonTitle = "Open Settings",
				onClick = requests.openSettings,
			)
			return
		}
	}
	val needsSettings = requests.access == PhotoAccess.BLOCKED
	val paused = state.backupPreference.isEnabled
	EmptyStateCard(
		icon = Symbols.PhotoLibrary,
		title = when {
			needsSettings -> "Full Photos access required"
			paused -> "Photo backup paused"
			else -> "Back up your photos"
		},
		subtitle = when {
			needsSettings -> "Allow access to all photos and videos to view your library and use automatic backup. Existing backups remain on your Umbrel."
			paused -> "Allow access to your photos and videos to resume backup. Existing backups remain on your Umbrel."
			else -> "Back up this phone’s photos and videos to your Umbrel, even when the app is closed."
		},
		buttonTitle = when {
			needsSettings -> "Open Settings"
			paused -> "Allow Access"
			state.backupSetupInProgress -> "Starting backup…"
			else -> "Set up backup"
		},
		buttonLoading = state.backupSetupInProgress && !paused,
		learnMore = learnMore,
		onClick = {
			when {
				needsSettings -> requests.openSettings()
				paused -> requests.requestLibraryAccess(false)
				else -> {
					model.enableBackup()
					requests.requestLibraryAccess(true)
				}
			}
		},
	)
}

/**
 * Backup goes to another Umbrel while this one holds older backups from this phone, so the
 * library stays and this offers the way to move backup here. Photo access exists here, so the
 * switch is always possible.
 */
@Composable
fun PhotoBackupElsewhereNotice(model: MainViewModel, state: MainUiState, destination: String) {
	val switching = backupSwitchInProgress(state)
	PhotoBackupSwitchConfirmation(model, destination, PhotoAccess.FULL) { confirm ->
		NoticeCard(
			icon = Symbols.PhotoLibraryMedium,
			title = "Photo Backup is on for $destination",
			message = "This phone can back up to one Umbrel at a time.",
			actionLabel = if (switching) "Switching backup…" else "Back Up Here",
			// Busy while switching, as the setup card's button is
			onClick = if (switching) ({}) else confirm,
		)
	}
}

/**
 * Switching stops backup for the other Umbrel, so it's always confirmed first. [content] gets
 * the action that opens the confirmation. What the switch comes back needing shows from
 * [PhotoBackupSwitchDialogs].
 */
@Composable
internal fun PhotoBackupSwitchConfirmation(model: MainViewModel, destination: String, access: PhotoAccess, content: @Composable (confirm: () -> Unit) -> Unit) {
	var confirming by rememberSaveable { mutableStateOf(false) }
	content { confirming = true }
	if (confirming) {
		AlertDialog(
			onDismissRequest = { confirming = false },
			title = { Text("Back up to this Umbrel instead?") },
			text = { Text("Photo Backup will stop for $destination and start for this Umbrel. Photos already backed up to $destination stay there.") },
			confirmButton = {
				TextButton(onClick = {
					confirming = false
					model.backUpToThisUmbrel(asNewSource = false, canRequestAccess = access.canRequest)
				}) { Text("Back Up to This Umbrel") }
			},
			dismissButton = { TextButton(onClick = { confirming = false }) { Text("Cancel") } },
		)
	}
}

/**
 * What a confirmed switch came back needing. The view model keeps it, so changing tab, turning
 * the phone or closing Profile during the check doesn't lose it. The new-phone question is asked
 * before anything stops, so Cancel leaves backup where it is.
 */
@Composable
fun PhotoBackupSwitchDialogs(model: MainViewModel, state: MainUiState) {
	val requests = rememberPhotoAccessRequests(model, state)
	when (val prompt = state.backupSwitchPrompt) {
		is BackupSwitchPrompt.NewSource -> AlertDialog(
			onDismissRequest = model::dismissBackupSwitchPrompt,
			title = { Text("Back up as a new phone?") },
			text = { Text(PhotoBackupNotice.mayBackUpTwiceMessage(prompt.existing)) },
			confirmButton = {
				TextButton(onClick = { model.backUpToThisUmbrel(asNewSource = true, canRequestAccess = prompt.canRequestAccess) }) { Text("Back Up Anyway") }
			},
			dismissButton = { TextButton(onClick = model::dismissBackupSwitchPrompt) { Text("Cancel") } },
		)
		is BackupSwitchPrompt.CouldNotCheck -> AlertDialog(
			onDismissRequest = model::dismissBackupSwitchPrompt,
			title = { Text("Couldn’t check this Umbrel") },
			text = { Text("Photo Backup is still on for ${prompt.destination}. Try again in a moment.") },
			confirmButton = { TextButton(onClick = model::dismissBackupSwitchPrompt) { Text("OK") } },
		)
		// As when backup is turned on: a refusal turns it back off
		BackupSwitchPrompt.AccessRequest -> LaunchedEffect(prompt) {
			model.dismissBackupSwitchPrompt()
			requests.requestLibraryAccess(true)
		}
		null -> Unit
	}
}
