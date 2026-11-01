package com.umbrel.kit.backup

import com.umbrel.kit.Umbreld
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import java.io.EOFException
import java.io.IOException
import java.io.InterruptedIOException
import java.net.ConnectException
import java.net.NoRouteToHostException
import java.net.PortUnreachableException
import java.net.ProtocolException
import java.net.SocketException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import javax.net.ssl.SSLException

/**
 * What the backup worker uploads and where, shared by the app and the worker. The
 * destination is the saved Umbrel [deviceId]: each pass sends to whichever of its addresses
 * proves the pinned identity over HTTPS, so no address is stored here. A configuration from
 * an earlier build also stored a plain-HTTP Tailscale origin; decoding ignores that key and
 * keeps the source, so its ledger carries on.
 */
@Serializable
data class PhotoBackupConfiguration(
	val deviceId: String,
	val source: Umbreld.PhotoBackupSource,
	val includePhotos: Boolean,
	val includeVideos: Boolean,
	val allowsCellularAccess: Boolean,
	/** Folder keys to leave out, applied only with access to all photos ([PhotoBackupFolders.skipped]). */
	val skippedFolders: Set<String> = emptySet(),
)

@Serializable
enum class PhotoBackupPhase {
	@SerialName("disabled") DISABLED,
	@SerialName("waiting") WAITING,
	@SerialName("waitingForUmbrel") WAITING_FOR_UMBREL,
	@SerialName("uploading") UPLOADING,
	@SerialName("checkingStorage") CHECKING_STORAGE,
	@SerialName("upToDate") UP_TO_DATE,
	@SerialName("needsAttention") NEEDS_ATTENTION,
}

/** A small, stable issue code shared by the worker and the app. */
@Serializable
enum class PhotoBackupIssue {
	@SerialName("insufficientStorage") INSUFFICIENT_STORAGE,
	@SerialName("authenticationRequired") AUTHENTICATION_REQUIRED,

	/** Photo access was removed, by the user or by Android for an unused app. Backup resumes once it returns. */
	@SerialName("photoAccessRequired") PHOTO_ACCESS_REQUIRED,

	/** Android won't serve the location stored in photos and videos; see [PhotoBackupEngine]. */
	@SerialName("locationAccessRequired") LOCATION_ACCESS_REQUIRED,
	;

	companion object {
		const val ERROR_HEADER = "X-Umbrel-Photo-Backup-Error"

		/** Umbrel marks a full disk with a header as well as 507. */
		fun fromErrorHeader(value: String?): PhotoBackupIssue? = if (value == "insufficient-storage") INSUFFICIENT_STORAGE else null
	}
}

/**
 * The app has several independent inputs: remembered intent, which target owns that
 * intent, the worker's configuration, and the published snapshot. Reduce them once so
 * text and color can never disagree about whether backup is off, still being set up,
 * active, or failed during setup.
 */
enum class PhotoBackupPresentationMode {
	OFF, SETTING_UP, ACTIVE, FAILED;

	companion object {
		fun resolve(
			intentEnabled: Boolean,
			targetActive: Boolean,
			configurationMatchesTarget: Boolean,
			snapshotMatchesSource: Boolean,
			snapshotPhase: PhotoBackupPhase,
			setupInProgress: Boolean,
			setupFailed: Boolean,
		): PhotoBackupPresentationMode {
			if (!intentEnabled || !targetActive) return OFF
			if (setupFailed) return FAILED
			if (setupInProgress) return SETTING_UP
			if (!configurationMatchesTarget || !snapshotMatchesSource || snapshotPhase == PhotoBackupPhase.DISABLED) return SETTING_UP
			return ACTIVE
		}
	}
}

/**
 * Only errors that mean the destination is temporarily unreachable belong in the
 * automatic recovery loop. Protocol, server, and source-file errors need their own
 * handling and must never be hidden as ordinary time away from home. A TLS failure is a
 * failed route, like a reset, unless the certificate itself was refused (see
 * [isTrustFailure]).
 */
object PhotoBackupTransportFailure {
	/** A certificate the pinned CA doesn't vouch for, or one for another host: this route isn't the Umbrel. */
	fun isTrustFailure(error: IOException): Boolean = Umbreld.isServerTrustError(error)

	fun isConnectivityFailure(error: Throwable?): Boolean {
		if (error is IOException && isTrustFailure(error)) return false
		return connectivity(error)
	}

	private fun connectivity(error: Throwable?): Boolean = when (error) {
		null -> false
		is ProtocolException -> false
		is SSLException -> true
		is UnknownHostException, is SocketTimeoutException -> true
		is ConnectException, is NoRouteToHostException, is PortUnreachableException -> true
		// Connection reset, broken pipe, and an unreachable network all arrive as SocketException.
		is SocketException, is EOFException -> true
		// OkHttp reports its call and write timeouts this way; any other interruption is a cancellation.
		is InterruptedIOException -> error.message == "timeout"
		else -> error.cause !== error && connectivity(error.cause)
	}
}

enum class PhotoBackupStorageProbeOutcome { SUCCEEDED, CONNECTIVITY_FAILURE, INSUFFICIENT_STORAGE, PERMANENT_FAILURE }

/**
 * A pass can be stopped at any point and a fresh process started later. Keep source-level
 * recovery state derivable from the persisted snapshot so a new pass can't reopen the full
 * queue while the destination is full or unreachable.
 */
class PhotoBackupRecoveryState(snapshot: PhotoBackupSnapshot, sourceId: String, storageRetryRequested: Boolean) {
	var storageRetryRequested: Boolean
		private set
	var storageProbing: Boolean
		private set
	var storagePaused: Boolean
		private set
	var connectivityRecovering: Boolean
		private set

	init {
		val belongsToSource = snapshot.sourceId == sourceId
		val validStorageRetry = belongsToSource && storageRetryRequested && (
			snapshot.issue == PhotoBackupIssue.INSUFFICIENT_STORAGE ||
				snapshot.phase == PhotoBackupPhase.CHECKING_STORAGE ||
				snapshot.phase == PhotoBackupPhase.WAITING_FOR_UMBREL
			)
		this.storageRetryRequested = validStorageRetry
		storageProbing = validStorageRetry &&
			(snapshot.phase == PhotoBackupPhase.CHECKING_STORAGE || snapshot.phase == PhotoBackupPhase.WAITING_FOR_UMBREL)
		storagePaused = belongsToSource && snapshot.issue == PhotoBackupIssue.INSUFFICIENT_STORAGE && !storageProbing
		connectivityRecovering = belongsToSource && snapshot.phase == PhotoBackupPhase.WAITING_FOR_UMBREL && !storagePaused
	}

	val phase: PhotoBackupPhase
		get() = when {
			storagePaused -> PhotoBackupPhase.NEEDS_ATTENTION
			connectivityRecovering -> PhotoBackupPhase.WAITING_FOR_UMBREL
			storageProbing -> PhotoBackupPhase.CHECKING_STORAGE
			else -> PhotoBackupPhase.WAITING
		}

	val issue: PhotoBackupIssue?
		get() = when {
			connectivityRecovering -> null
			storagePaused || storageProbing -> PhotoBackupIssue.INSUFFICIENT_STORAGE
			else -> null
		}

	fun observeTerminalBatch(foundStorageFailure: Boolean, foundConnectivityFailure: Boolean, hasTerminalJobs: Boolean) {
		if (foundStorageFailure) {
			storagePaused = true
			connectivityRecovering = false
		} else if (foundConnectivityFailure) {
			// Any connection failure means reopening the whole queue is premature, even if an
			// earlier upload in the same pass succeeded.
			connectivityRecovering = true
		} else if (hasTerminalJobs) {
			// A clean result means the destination answered.
			connectivityRecovering = false
		}
	}

	fun finishStorageProbe(outcome: PhotoBackupStorageProbeOutcome) {
		if (!storageProbing) return
		when (outcome) {
			PhotoBackupStorageProbeOutcome.SUCCEEDED -> {
				storageRetryRequested = false
				storageProbing = false
				storagePaused = false
				connectivityRecovering = false
			}
			// Being away from the Umbrel doesn't answer the storage question. Keep the
			// one-resource capacity probe alive for a later pass.
			PhotoBackupStorageProbeOutcome.CONNECTIVITY_FAILURE -> connectivityRecovering = true
			PhotoBackupStorageProbeOutcome.INSUFFICIENT_STORAGE -> {
				storageRetryRequested = false
				storageProbing = false
				storagePaused = true
				connectivityRecovering = false
			}
			// Authentication and server failures are not evidence that storage is still full.
			PhotoBackupStorageProbeOutcome.PERMANENT_FAILURE -> {
				storageRetryRequested = false
				storageProbing = false
				storagePaused = false
				connectivityRecovering = false
			}
		}
	}

	fun beginStorageProbe() {
		if (!storagePaused || !storageRetryRequested) return
		storagePaused = false
		storageProbing = true
		connectivityRecovering = false
	}

	fun finishStorageProbeWithoutWork() {
		if (!storageProbing) return
		storageRetryRequested = false
		storageProbing = false
		storagePaused = false
		connectivityRecovering = false
	}

	fun finishConnectivityRecoveryWithoutWork() {
		connectivityRecovering = false
	}
}

/** Durable presentation totals the worker maintains, so the app never walks the library for status. */
@Serializable
data class PhotoBackupStatistics(
	val queuedCount: Long,
	val preparedCount: Long,
	val uploadedPhotoCount: Long,
	val uploadedVideoCount: Long,
	val failedCount: Long,
	val uploadedBytes: Long,
	/** Items MediaStore still lists that couldn't be read; passes try them again. */
	val unreadableCount: Long = 0,
	/** When the most recent item finished uploading. Snapshots written before it existed have none. */
	val lastUploadedAtMs: Long? = null,
	/** The part of the uploaded counts that is in skipped folders: backed up before the folder was skipped. */
	val uploadedSkippedPhotoCount: Long = 0,
	val uploadedSkippedVideoCount: Long = 0,
) {
	val uploadedCount: Long get() = uploadedPhotoCount + uploadedVideoCount

	/**
	 * Whether every item still to back up is one that failed. Those are items the Umbrel
	 * refused or kept failing on after other uploads got through, so there's nothing the
	 * user can do about them yet.
	 */
	fun onlyFailuresRemain(remainingCount: Long): Boolean = failedCount > 0 && remainingCount <= failedCount

	/**
	 * Assets the inventory hasn't reached yet are correctly remaining: they are in the
	 * library count but not in the ledger's uploaded count. Both sides leave out skipped
	 * folders, or earlier uploads from a skipped folder would cancel out items still waiting.
	 */
	fun remainingCount(library: PhotoLibraryCounts, includePhotos: Boolean, includeVideos: Boolean, skippedFolders: Set<String>): Long {
		val included = (if (includePhotos) library.photoCount(skippedFolders) else 0) +
			(if (includeVideos) library.videoCount(skippedFolders) else 0)
		val uploaded = (if (includePhotos) uploadedPhotoCount - uploadedSkippedPhotoCount else 0) +
			(if (includeVideos) uploadedVideoCount - uploadedSkippedVideoCount else 0)
		return maxOf(0, included - uploaded)
	}
}

/** How many photos and videos the library has in each folder, keyed by [PhotoBackupFolders.key]. */
data class PhotoLibraryCounts(val photos: Map<String, Long> = emptyMap(), val videos: Map<String, Long> = emptyMap()) {
	fun photoCount(skippedFolders: Set<String> = emptySet()): Long = photos.entries.sumOf { (folder, count) -> if (folder in skippedFolders) 0 else count }

	fun videoCount(skippedFolders: Set<String> = emptySet()): Long = videos.entries.sumOf { (folder, count) -> if (folder in skippedFolders) 0 else count }
}

@Serializable
data class PhotoBackupSnapshot(
	val phase: PhotoBackupPhase,
	val issue: PhotoBackupIssue? = null,
	val lastError: String? = null,
	val updatedAtMs: Long = 0,
	val sourceId: String? = null,
	val statistics: PhotoBackupStatistics? = null,
) {
	companion object {
		val DISABLED = PhotoBackupSnapshot(PhotoBackupPhase.DISABLED)
	}
}
