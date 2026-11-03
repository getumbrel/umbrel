package com.umbrel.kit.backup

import java.text.NumberFormat

/** User-facing status shared by Home, Library, and Profile. */
sealed class PhotoBackupStatus {
	enum class Tone { OFF, IN_PROGRESS, GOOD, PROBLEM }

	data object Off : PhotoBackupStatus()
	data object SettingUp : PhotoBackupStatus()

	/** The user restricted background usage, so Android won't run backup jobs while the app is closed. */
	data object BackgroundRestricted : PhotoBackupStatus()
	data object WaitingForUmbrel : PhotoBackupStatus()

	/** Items are queued, mobile data is off, and the default network is mobile data, metered or missing. */
	data object WaitingForWiFi : PhotoBackupStatus()
	data object CheckingStorage : PhotoBackupStatus()
	data object Paused : PhotoBackupStatus()
	data object Error : PhotoBackupStatus()
	data class BackingUp(val remaining: Long?) : PhotoBackupStatus()
	data object UpToDate : PhotoBackupStatus()

	/**
	 * Only failed items remain: ones the Umbrel refused or kept failing on after other uploads
	 * got through. Until the app can list them there's nothing for the user to do, and the
	 * photo viewer still marks each one.
	 */
	data object UpToDateExceptFailures : PhotoBackupStatus()

	/** Nothing is waiting, but the library has items in folders the user skipped, so "All backed up" would overclaim. */
	data object UpToDateExceptSkipped : PhotoBackupStatus()

	val text: String
		get() = when (this) {
			Off -> "Backup off"
			SettingUp -> "Starting backup…"
			BackgroundRestricted -> "Backup paused"
			WaitingForUmbrel -> "Waiting for Umbrel"
			WaitingForWiFi -> "Waiting for Wi-Fi"
			CheckingStorage -> "Checking storage…"
			Paused -> "Backup paused"
			Error -> "Backup needs attention"
			is BackingUp -> remaining?.let { "${NumberFormat.getIntegerInstance().format(it)} ${if (it == 1L) "item" else "items"} queued" } ?: "Checking backup…"
			UpToDate -> "All backed up"
			UpToDateExceptFailures, UpToDateExceptSkipped -> "Up to date"
		}

	val tone: Tone
		get() = when (this) {
			Off -> Tone.OFF
			BackgroundRestricted, Error, Paused -> Tone.PROBLEM
			UpToDate, UpToDateExceptFailures, UpToDateExceptSkipped -> Tone.GOOD
			SettingUp, WaitingForUmbrel, WaitingForWiFi, CheckingStorage, is BackingUp -> Tone.IN_PROGRESS
		}
}

/** The notice cards for states the user can act on. */
enum class PhotoBackupNotice(val title: String, val message: String, val action: Action?, val actionLabel: String?) {
	BACKGROUND_RESTRICTED(
		"Background usage is restricted",
		"Allow background usage for Umbrel in Settings so Android can back up in the background.",
		null,
		null,
	),
	WAITING_FOR_UMBREL(
		"Waiting for your Umbrel",
		"Backup resumes when this phone is on the same network as your Umbrel. Set up Tailscale to back up from anywhere.",
		Action.SET_UP_TAILSCALE,
		null,
	),
	WAITING_FOR_WIFI("Waiting for Wi-Fi", "Backup resumes on Wi-Fi. You can allow mobile data and hotspots in Profile.", null, null),
	CHECKING_STORAGE("Checking storage…", "Backup will resume automatically if enough space is available.", null, null),
	INSUFFICIENT_STORAGE("Photo backup paused", "Free up storage on your Umbrel, then try again.", Action.RETRY_STORAGE, "Try Again"),
	LOCATION_ACCESS_REQUIRED(
		"Photo backup paused",
		"Allow access to photo locations so your backups keep where each photo was taken.",
		Action.ALLOW_LOCATION_ACCESS,
		"Allow",
	),
	RECONNECT("Reconnect photo backup", "Umbrel needs to reconnect photo backup. Your existing backups are safe.", Action.RETRY_BACKUP, "Reconnect"),
	NEEDS_ATTENTION(
		"Photo backup needs attention",
		"Backup couldn’t continue. Try again. If this keeps happening, contact Umbrel Support.",
		Action.RETRY_BACKUP,
		"Try Again",
	),
	UNREADABLE_ITEMS("Some items couldn’t be read", "Backup will try them again automatically.", null, null),

	/**
	 * Setup stopped before a new source would store the account's phone backups again. The
	 * screens name that source with [mayBackUpTwiceMessage]; this message stands in for it.
	 */
	MAY_BACK_UP_TWICE("Photos may be backed up twice", mayBackUpTwice("another phone"), Action.BACK_UP_ANYWAY, "Review"),
	;

	enum class Action { SET_UP_TAILSCALE, RETRY_STORAGE, RETRY_BACKUP, ALLOW_LOCATION_ACCESS, BACK_UP_ANYWAY }

	companion object {
		/** The new-phone question, shared by its notice and both of its alerts. */
		fun mayBackUpTwiceMessage(existing: String): String = mayBackUpTwice(existing)
	}
}

// Top level, because enum entries are built before their companion object
private fun mayBackUpTwice(existing: String) =
	"This account already has photos from “$existing”. If this phone was restored from it, backing up stores your photos again."

/**
 * Everything the screens show about backup for one account, reduced from the same inputs
 * the iOS app uses.
 */
data class PhotoBackupPresentation(
	val status: PhotoBackupStatus,
	val notice: PhotoBackupNotice?,
	/** The source whose receipts and totals belong to this account, kept after backup is turned off. */
	val sourceId: String?,
	val statistics: PhotoBackupStatistics?,
	/** The name this phone has in Photos on the Umbrel, known only while backup is set up. */
	val sourceName: String? = null,
	/** The existing source the unanswered new-phone question names. */
	val newSourceQuestion: String? = null,
	/**
	 * Whether [sourceId] could be read. While secure storage can't be read, a missing id isn't
	 * proof that this account has no backups here.
	 */
	val sourceResolved: Boolean = true,
) {
	data class Inputs(
		val libraryAccess: PhotoLibraryAccess,
		/** Whether ACCESS_MEDIA_LOCATION is granted; without it backup pauses rather than upload redacted bytes. */
		val locationAccess: Boolean,
		/** Saved intent for this account, effective only while the account is the active target. */
		val preference: PhotoBackupPreference,
		val targetActive: Boolean,
		/** The worker configuration, only when it belongs to this account. */
		val configuration: PhotoBackupConfiguration?,
		val snapshot: PhotoBackupSnapshot,
		val sourceId: String?,
		val ledgerStatistics: PhotoBackupStatistics?,
		val setupInProgress: Boolean,
		val setupFailed: Boolean,
		val storageRetryRequested: Boolean,
		val recoveryRetryRequested: Boolean,
		val backgroundRestricted: Boolean,
		/** The library's photos and videos per folder; remaining work is measured against it. */
		val library: PhotoLibraryCounts,
		/** The app's default network, which uploads use; null when there is none. */
		val defaultNetwork: PhotoBackupNetwork.Traits?,
		/**
		 * Setup stopped before starting a new source because the account already has phone
		 * backups: the existing source's name, until the user answers.
		 */
		val newSourceQuestion: String? = null,
		val sourceResolved: Boolean = true,
	)

	companion object {
		fun resolve(inputs: Inputs): PhotoBackupPresentation {
			val snapshot = presentationSnapshot(inputs)
			val status = status(inputs, snapshot)
			return PhotoBackupPresentation(
				status,
				notice(inputs, status, snapshot),
				inputs.sourceId,
				snapshot.statistics,
				inputs.configuration?.source?.name,
				inputs.newSourceQuestion,
				inputs.sourceResolved,
			)
		}

		/** A snapshot written for another source never describes this account's backup. */
		private fun presentationSnapshot(inputs: Inputs): PhotoBackupSnapshot {
			val matchesSource = inputs.snapshot.sourceId == inputs.sourceId
			val configured = inputs.configuration != null
			return PhotoBackupSnapshot(
				phase = if (!configured) PhotoBackupPhase.DISABLED else if (matchesSource) inputs.snapshot.phase else PhotoBackupPhase.WAITING,
				issue = inputs.snapshot.issue.takeIf { configured && matchesSource },
				lastError = inputs.snapshot.lastError.takeIf { configured && matchesSource },
				updatedAtMs = inputs.snapshot.updatedAtMs,
				sourceId = inputs.sourceId,
				statistics = inputs.ledgerStatistics ?: inputs.snapshot.statistics.takeIf { matchesSource },
			)
		}

		private fun status(inputs: Inputs, snapshot: PhotoBackupSnapshot): PhotoBackupStatus {
			val intentEnabled = inputs.targetActive && inputs.preference.isEnabled
			if (!intentEnabled) return PhotoBackupStatus.Off
			// Losing access pauses backup rather than turning it off. The setup card, shown
			// wherever the library can't be read, offers the way back.
			if (!inputs.libraryAccess.canReadLibrary) return PhotoBackupStatus.Paused
			if (inputs.newSourceQuestion != null) return PhotoBackupStatus.Paused
			if (inputs.recoveryRetryRequested) return PhotoBackupStatus.SettingUp
			// The folder choice is on screen; setup starts when the user confirms it.
			if (inputs.configuration == null && !inputs.preference.foldersChosen && inputs.libraryAccess == PhotoLibraryAccess.FULL) {
				return PhotoBackupStatus.SettingUp
			}
			// Setup work is described first; once setup is idle, the system restriction is the
			// most immediate reason backup can't run.
			if (!inputs.setupInProgress && !inputs.setupFailed && inputs.backgroundRestricted) return PhotoBackupStatus.BackgroundRestricted
			// Enabled intent without a configuration waits for a reachable Umbrel; it is not
			// perpetual setup.
			if (inputs.configuration == null && !inputs.setupInProgress && !inputs.setupFailed) return PhotoBackupStatus.WaitingForUmbrel
			val mode = PhotoBackupPresentationMode.resolve(
				intentEnabled = true,
				targetActive = inputs.targetActive,
				configurationMatchesTarget = inputs.configuration != null,
				snapshotMatchesSource = inputs.configuration?.source?.id == snapshot.sourceId,
				snapshotPhase = snapshot.phase,
				setupInProgress = inputs.setupInProgress,
				setupFailed = inputs.setupFailed,
			)
			return when (mode) {
				PhotoBackupPresentationMode.OFF -> PhotoBackupStatus.Off
				PhotoBackupPresentationMode.SETTING_UP -> PhotoBackupStatus.SettingUp
				PhotoBackupPresentationMode.FAILED -> PhotoBackupStatus.Error
				PhotoBackupPresentationMode.ACTIVE -> {
					val checkingStorage = inputs.storageRetryRequested || snapshot.phase == PhotoBackupPhase.CHECKING_STORAGE
					// Photo access is read live, so the worker's pause for it is never an error here.
					// Failed items alone aren't an error: they're either refused or kept failing
					// after other uploads got through.
					val runtimeError = !checkingStorage && (
						(snapshot.issue != null && snapshot.issue != PhotoBackupIssue.PHOTO_ACCESS_REQUIRED) ||
							(snapshot.phase == PhotoBackupPhase.NEEDS_ATTENTION && snapshot.lastError != null)
						)
					val failures = (snapshot.statistics?.failedCount ?: 0) > 0
					val configuration = inputs.configuration!!
					val skippedFolders = PhotoBackupFolders.skipped(configuration.skippedFolders, inputs.libraryAccess)
					val remaining = snapshot.statistics?.remainingCount(inputs.library, configuration.includePhotos, configuration.includeVideos, skippedFolders)
					val skipsItems = skippedFolders.any { folder ->
						(if (configuration.includePhotos) inputs.library.photos[folder] ?: 0L else 0L) +
							(if (configuration.includeVideos) inputs.library.videos[folder] ?: 0L else 0L) > 0
					}
					when {
						checkingStorage -> PhotoBackupStatus.CheckingStorage
						snapshot.issue == PhotoBackupIssue.INSUFFICIENT_STORAGE -> PhotoBackupStatus.Paused
						snapshot.issue == PhotoBackupIssue.AUTHENTICATION_REQUIRED -> PhotoBackupStatus.Error
						locationPaused(inputs, snapshot) -> PhotoBackupStatus.Paused
						// Mobile data being off is the first thing standing between the queue and the
						// Umbrel, so it's named before an Umbrel this network can't reach.
						!configuration.allowsCellularAccess && remaining != null && remaining > 0 &&
							snapshot.statistics?.onlyFailuresRemain(remaining) != true &&
							!PhotoBackupNetwork.qualifies(inputs.defaultNetwork, allowsMobileData = false, userInitiated = false) -> PhotoBackupStatus.WaitingForWiFi
						snapshot.phase == PhotoBackupPhase.WAITING_FOR_UMBREL -> PhotoBackupStatus.WaitingForUmbrel
						runtimeError -> PhotoBackupStatus.Error
						remaining != null && snapshot.statistics?.onlyFailuresRemain(remaining) == true -> PhotoBackupStatus.UpToDateExceptFailures
						remaining != null && remaining > 0 -> PhotoBackupStatus.BackingUp(remaining)
						remaining != null -> if (skipsItems) PhotoBackupStatus.UpToDateExceptSkipped else PhotoBackupStatus.UpToDate
						snapshot.phase == PhotoBackupPhase.UP_TO_DATE ->
							if (failures) PhotoBackupStatus.UpToDateExceptFailures else PhotoBackupStatus.UpToDate
						else -> PhotoBackupStatus.BackingUp(null)
					}
				}
			}
		}

		/**
		 * The permission is the live answer. The worker's issue also covers a device that
		 * refuses the original although the permission is granted, until its next pass.
		 */
		private fun locationPaused(inputs: Inputs, snapshot: PhotoBackupSnapshot): Boolean =
			!inputs.locationAccess || snapshot.issue == PhotoBackupIssue.LOCATION_ACCESS_REQUIRED

		private fun notice(inputs: Inputs, status: PhotoBackupStatus, snapshot: PhotoBackupSnapshot): PhotoBackupNotice? {
			if (!inputs.libraryAccess.canReadLibrary || !inputs.targetActive || !inputs.preference.isEnabled) return null
			if (inputs.newSourceQuestion != null) return PhotoBackupNotice.MAY_BACK_UP_TWICE
			return when (status) {
				PhotoBackupStatus.BackgroundRestricted -> PhotoBackupNotice.BACKGROUND_RESTRICTED
				PhotoBackupStatus.WaitingForUmbrel -> PhotoBackupNotice.WAITING_FOR_UMBREL
				PhotoBackupStatus.WaitingForWiFi -> PhotoBackupNotice.WAITING_FOR_WIFI
				PhotoBackupStatus.CheckingStorage -> PhotoBackupNotice.CHECKING_STORAGE
				PhotoBackupStatus.Paused -> when {
					snapshot.issue == PhotoBackupIssue.INSUFFICIENT_STORAGE -> PhotoBackupNotice.INSUFFICIENT_STORAGE
					locationPaused(inputs, snapshot) -> PhotoBackupNotice.LOCATION_ACCESS_REQUIRED
					else -> null
				}
				PhotoBackupStatus.Error ->
					if (snapshot.issue == PhotoBackupIssue.AUTHENTICATION_REQUIRED) PhotoBackupNotice.RECONNECT else PhotoBackupNotice.NEEDS_ATTENTION
				is PhotoBackupStatus.BackingUp, PhotoBackupStatus.UpToDate, PhotoBackupStatus.UpToDateExceptFailures, PhotoBackupStatus.UpToDateExceptSkipped ->
					PhotoBackupNotice.UNREADABLE_ITEMS.takeIf { (snapshot.statistics?.unreadableCount ?: 0) > 0 }
				PhotoBackupStatus.Off, PhotoBackupStatus.SettingUp -> null
			}
		}
	}
}
