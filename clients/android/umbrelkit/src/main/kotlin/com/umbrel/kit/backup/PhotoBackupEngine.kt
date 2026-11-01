package com.umbrel.kit.backup

import android.webkit.MimeTypeMap
import com.umbrel.kit.SecretStore
import com.umbrel.kit.Umbreld
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import java.io.FileNotFoundException
import java.io.IOException
import java.security.MessageDigest

/**
 * The state machine PhotoKit's background upload extension runs on iOS. Android has no
 * system uploader, so each pass here does the same work in order: ingest library changes
 * into the ledger, apply the app's retry requests, then upload the newest pending assets
 * until the pass deadline. Every step is durable before the next, so a pass can be
 * stopped at any point and the next one resumes.
 */
class PhotoBackupEngine(
	private val preferences: PhotoBackupPreferences,
	private val ledger: PhotoBackupLedger,
	private val library: PhotoBackupLibrary,
	private val server: PhotoBackupServer,
	private val secrets: PhotoBackupSecrets,
	/** The saved Umbrel a configuration's device id names, with every address it may be reached at. */
	private val targets: (deviceId: String) -> Umbreld.Target?,
	private val clock: () -> Long = System::currentTimeMillis,
) {
	sealed class PassOutcome {
		/** Nothing left to do, or backup isn't configured. */
		data object Completed : PassOutcome()

		/** Inventory or uploads remain; run another pass now. */
		data object MoreWork : PassOutcome()

		/** The Umbrel couldn't be reached, or answered with a temporary error; retry with backoff. */
		data object RetryLater : PassOutcome()

		/** Paused until the user acts: storage, authentication, or photo access. */
		data object WaitingForUser : PassOutcome()

		/** A local failure that a later pass may not hit, such as an unavailable Keystore. */
		data class Failed(val message: String) : PassOutcome()

		/** The default network stopped qualifying mid-pass; the next pass waits for one that does. */
		data object WaitingForNetwork : PassOutcome()
	}

	private enum class Ingestion { COMPLETE, MORE_WORK, TOKEN_RESET }

	private enum class AssetOutcome {
		UPLOADED, SKIPPED, UNREADABLE, FAILED, TRANSIENT, INSUFFICIENT_STORAGE, AUTHENTICATION_REQUIRED,
		PHOTO_ACCESS_REQUIRED, LOCATION_ACCESS_REQUIRED, CONNECTIVITY, UNTRUSTED,
	}

	private class AssetResult(val outcome: AssetOutcome, val transientFailure: TransientFailure? = null)

	/** A server answer that may not be the item's fault, held until the pass shows whether it was. */
	private class TransientFailure(val resourceKey: String, val message: String)

	/** Runs until the work is done or [deadlineMs] (wall clock) passes. */
	suspend fun runPass(deadlineMs: Long): PassOutcome = withContext(Dispatchers.IO) {
		val configuration = when (val read = preferences.configurationRead()) {
			is PhotoBackupPreferences.ConfigurationRead.Found -> read.configuration
			is PhotoBackupPreferences.ConfigurationRead.Missing -> return@withContext PassOutcome.Completed
			is PhotoBackupPreferences.ConfigurationRead.Unavailable -> return@withContext PassOutcome.Failed("Backup configuration is unavailable")
		}
		val sourceId = configuration.source.id
		val target = targets(configuration.deviceId) ?: run {
			publish(PhotoBackupPhase.NEEDS_ATTENTION, sourceId, error = UMBREL_NOT_SAVED)
			return@withContext PassOutcome.Failed("The Umbrel for this backup isn’t saved")
		}
		// Losing photo access pauses backup; the next pass after access returns resumes it.
		if (!library.access.canReadLibrary) {
			pauseForPhotoAccess(sourceId)
			return@withContext PassOutcome.WaitingForUser
		}

		val initialSnapshot = preferences.snapshot
		val recoveryRetryRequested = preferences.recoveryRetryRequested(sourceId)
		val storedStorageRetry = preferences.storageRetryRequested(sourceId)
		val recovery = PhotoBackupRecoveryState(initialSnapshot, sourceId, storedStorageRetry)
		var authenticationRequired = initialSnapshot.sourceId == sourceId && initialSnapshot.issue == PhotoBackupIssue.AUTHENTICATION_REQUIRED
		if (storedStorageRetry && !recovery.storageRetryRequested) preferences.clearStorageRetryRequest()
		fun publishRecovery(statistics: PhotoBackupStatistics? = null) = publish(
			if (authenticationRequired) PhotoBackupPhase.NEEDS_ATTENTION else recovery.phase,
			sourceId,
			statistics,
			recovery.issue ?: PhotoBackupIssue.AUTHENTICATION_REQUIRED.takeIf { authenticationRequired },
		)
		publishRecovery()

		val grant = when (val read = secrets.grant(configuration.deviceId, configuration.source.accountId)) {
			is SecretStore.TokenReadResult.Found -> read.value
			is SecretStore.TokenReadResult.Missing -> {
				if (recoveryRetryRequested) preferences.clearRecoveryRetryRequest(sourceId)
				publish(PhotoBackupPhase.NEEDS_ATTENTION, sourceId, issue = recovery.issue ?: PhotoBackupIssue.AUTHENTICATION_REQUIRED)
				return@withContext PassOutcome.WaitingForUser
			}
			is SecretStore.TokenReadResult.Unavailable -> {
				if (recoveryRetryRequested) preferences.clearRecoveryRetryRequest(sourceId)
				val issue = recovery.issue
				if (issue != null) {
					publish(PhotoBackupPhase.NEEDS_ATTENTION, sourceId, issue = issue)
				} else {
					publish(PhotoBackupPhase.NEEDS_ATTENTION, sourceId, error = "secure-storage-unavailable")
				}
				return@withContext PassOutcome.Failed("Secure storage is unavailable")
			}
		}

		try {
			val ingestion = ingestLibraryChanges(sourceId)
			if (ingestion == Ingestion.TOKEN_RESET) {
				publishRecovery()
				return@withContext PassOutcome.MoreWork
			}

			if (recoveryRetryRequested) {
				ledger.requeueFailedAssets(sourceId, configuration.includePhotos, configuration.includeVideos)
				preferences.clearRecoveryRetryRequest(sourceId)
				authenticationRequired = false
				publish(recovery.phase, sourceId, statistics(configuration), recovery.issue)
			}
			// An explicit storage retry requeues the failed resources and sends one of them as a
			// capacity probe. Only a successful probe reopens the whole queue.
			if (recovery.storagePaused && recovery.storageRetryRequested) {
				ledger.requeueFailedAssets(sourceId, configuration.includePhotos, configuration.includeVideos)
				recovery.beginStorageProbe()
				publish(recovery.phase, sourceId, statistics(configuration), recovery.issue)
			}

			var uploadedAny = false
			val outcome = when {
				authenticationRequired || recovery.storagePaused -> null
				!library.canReadLocation -> AssetOutcome.LOCATION_ACCESS_REQUIRED
				else -> uploadPending(configuration, target, grant, recovery, deadlineMs, onUploaded = { uploadedAny = true })
			}
			when (outcome) {
				AssetOutcome.AUTHENTICATION_REQUIRED -> authenticationRequired = true
				AssetOutcome.LOCATION_ACCESS_REQUIRED -> {
					pauseForLocationAccess(sourceId, statistics(configuration))
					return@withContext PassOutcome.WaitingForUser
				}
				AssetOutcome.PHOTO_ACCESS_REQUIRED -> {
					pauseForPhotoAccess(sourceId)
					return@withContext PassOutcome.WaitingForUser
				}
				// An address answered with another identity, so no grant was sent. Until one
				// proves the pinned identity again, the Umbrel needs the user's attention.
				AssetOutcome.UNTRUSTED -> {
					publish(PhotoBackupPhase.NEEDS_ATTENTION, sourceId, statistics(configuration), error = UNTRUSTED_UMBREL)
					return@withContext PassOutcome.Failed("This Umbrel’s identity couldn’t be verified")
				}
				AssetOutcome.CONNECTIVITY -> {
					publishRecovery(statistics(configuration))
					return@withContext PassOutcome.RetryLater
				}
				// A storage probe stays open. Otherwise the items stay queued and the next pass
				// retries them, so there's nothing for the user to do: backup reads as waiting, not
				// as needing attention. A pass that got uploads through goes on at once: the Umbrel
				// is accepting uploads and only had a bad moment, and a growing backoff would stall
				// a large backup on errors that come in bursts. Only a pass that got nothing through
				// backs off.
				AssetOutcome.TRANSIENT -> {
					val statistics = statistics(configuration)
					if (recovery.storageProbing) {
						publish(recovery.phase, sourceId, statistics, recovery.issue)
					} else {
						publish(PhotoBackupPhase.WAITING, sourceId, statistics)
					}
					return@withContext if (uploadedAny) PassOutcome.MoreWork else PassOutcome.RetryLater
				}
				else -> Unit
			}

			val statistics = statistics(configuration)
			val hasQueuedWork = statistics.queuedCount > 0 || statistics.preparedCount > 0
			val phase = when {
				authenticationRequired -> PhotoBackupPhase.NEEDS_ATTENTION
				recovery.storagePaused || recovery.connectivityRecovering || recovery.storageProbing -> recovery.phase
				ingestion == Ingestion.MORE_WORK || hasQueuedWork || statistics.unreadableCount > 0 -> PhotoBackupPhase.WAITING
				else -> PhotoBackupPhase.UP_TO_DATE
			}
			publish(phase, sourceId, statistics, recovery.issue ?: PhotoBackupIssue.AUTHENTICATION_REQUIRED.takeIf { authenticationRequired })
			when {
				authenticationRequired || recovery.storagePaused -> PassOutcome.WaitingForUser
				ingestion == Ingestion.MORE_WORK || hasQueuedWork -> PassOutcome.MoreWork
				else -> PassOutcome.Completed
			}
		} catch (cancelled: CancellationException) {
			throw cancelled
		} catch (error: Exception) {
			if (recoveryRetryRequested) preferences.clearRecoveryRetryRequest(sourceId)
			val issue = recovery.issue ?: PhotoBackupIssue.AUTHENTICATION_REQUIRED.takeIf { authenticationRequired }
			if (issue != null) {
				publish(PhotoBackupPhase.NEEDS_ATTENTION, sourceId, issue = issue)
			} else {
				publish(PhotoBackupPhase.NEEDS_ATTENTION, sourceId, error = error::class.java.simpleName)
			}
			PassOutcome.Failed(error.message ?: error::class.java.simpleName)
		}
	}

	// ── Inventory ──

	/**
	 * Without a committed change token, run (or resume) a full inventory of both media
	 * types; the ledger filters disabled types at upload time, so turning one on later
	 * needs no new scan. With a token, read only rows whose MediaStore generation advanced.
	 * MediaStore keeps no record of permanent deletions, so a library smaller than the
	 * ledger's present count starts a fresh full inventory.
	 */
	private suspend fun ingestLibraryChanges(sourceId: String): Ingestion {
		val current = library.changeToken()
		val stored = ledger.changeToken(sourceId)?.let(LibraryChangeToken::decode)
		if (stored == null) return inventory(sourceId, current)
		// Selecting more photos under Android 14's partial access adds grants, which never
		// change an item's generation; any MediaStore change rereads the selection in full.
		val selectionMayHaveChanged = current.access == PhotoLibraryAccess.SELECTED && current.volumes != stored.volumes
		if (!current.continues(stored) || selectionMayHaveChanged) {
			ledger.clearChangeToken(sourceId)
			return Ingestion.TOKEN_RESET
		}
		val context = currentCoroutineContext()
		for ((volume, state) in stored.volumes) {
			for (mediaType in MEDIA_TYPES) {
				library.changes(volume, mediaType, state.generation) { changes ->
					for (batch in changes.chunked(INVENTORY_BATCH_SIZE)) {
						context.ensureActive()
						ledger.applyChanges(
							upserted = batch.filterIsInstance<LibraryChange.Upsert>().map { it.candidate },
							deleted = batch.filterIsInstance<LibraryChange.Removal>().map { it.localIdentifier }.toSet(),
							sourceId = sourceId,
							changeToken = null,
						)
					}
				}
			}
		}
		ledger.applyChanges(emptyList(), emptySet(), sourceId, current.encoded())
		if (MEDIA_TYPES.any { ledger.presentAssetCount(sourceId, it) > library.count(it) }) {
			ledger.clearChangeToken(sourceId)
			return Ingestion.TOKEN_RESET
		}
		return Ingestion.COMPLETE
	}

	/**
	 * Pages through each media type by descending MediaStore id, checkpointing the cursor
	 * with every page, so a scan spread over several passes reads each row once and a
	 * deletion during the scan can't make it skip a row that is still there.
	 */
	private suspend fun inventory(sourceId: String, current: LibraryChangeToken): Ingestion {
		val scan = ledger.startInventoryScan(sourceId, current.encoded())
		val context = currentCoroutineContext()
		var recorded = 0
		for (mediaType in MEDIA_TYPES) {
			var cursor = scan.cursor(mediaType)
			while (cursor != PhotoBackupLedger.INVENTORY_FINISHED) {
				context.ensureActive()
				if (recorded >= INVENTORY_TARGET_PER_PASS) return Ingestion.MORE_WORK
				val page = library.assets(mediaType, cursor, INVENTORY_BATCH_SIZE)
				ledger.recordInventoryBatch(page.candidates, sourceId, scan.generation, mediaType, page.next)
				recorded += page.candidates.size
				cursor = page.next ?: PhotoBackupLedger.INVENTORY_FINISHED
			}
		}
		ledger.finishInventoryScan(sourceId, scan.generation)
		return Ingestion.COMPLETE
	}

	// ── Upload ──

	/**
	 * Uploads newest first until the deadline. While a storage probe or connectivity
	 * recovery is open, only one asset is attempted before the queue reopens. Returns the
	 * outcome that ended the pass early, if any.
	 *
	 * Only a 401 ends the grant and only a full disk pauses for storage. Server errors, rate
	 * limits, and answers lost after the whole file was sent are temporary: the item stays
	 * queued, and two in a row end the pass. Such an error counts against the item only once
	 * another upload in the same pass succeeds, which shows the Umbrel was accepting uploads;
	 * after [MAX_ITEM_ATTEMPTS] the item needs Try Again.
	 */
	private suspend fun uploadPending(
		configuration: PhotoBackupConfiguration,
		target: Umbreld.Target,
		grant: String,
		recovery: PhotoBackupRecoveryState,
		deadlineMs: Long,
		onUploaded: () -> Unit,
	): AssetOutcome? {
		val sourceId = configuration.source.id
		var endpoint: UploadEndpoint? = null
		var attempted = false
		var accepted = false
		var consecutiveTransient = 0
		val unattributed = mutableListOf<TransientFailure>()
		fun countAttempt(failure: TransientFailure) {
			ledger.recordResourceAttempt(failure.resourceKey, failure.message, MAX_ITEM_ATTEMPTS)
		}
		val seen = HashSet<String>()
		while (clock() < deadlineMs) {
			val limit = if (recovery.storageProbing || recovery.connectivityRecovering) 1 else UPLOAD_BATCH_SIZE
			// An asset still queued after its attempt waits for the next pass instead of being
			// retried in a loop.
			val candidates = ledger.nextAssets(sourceId, configuration.includePhotos, configuration.includeVideos, limit + seen.size, skippedFolders(configuration))
				.filter { "${it.localIdentifier}#${it.revision}" !in seen }
				.take(limit)
			if (candidates.isEmpty()) break
			candidates.forEach { seen.add("${it.localIdentifier}#${it.revision}") }
			// An address must prove the pinned identity over HTTPS before the grant is sent to
			// it; the local network and Tailscale are equally untrusted routes until then.
			if (endpoint == null) {
				when (val resolution = server.resolveEndpoint(target)) {
					is EndpointResolution.Resolved -> endpoint = resolution.endpoint
					EndpointResolution.Unreachable -> {
						recovery.observeTerminalBatch(foundStorageFailure = false, foundConnectivityFailure = true, hasTerminalJobs = true)
						recovery.finishStorageProbe(PhotoBackupStorageProbeOutcome.CONNECTIVITY_FAILURE)
						return AssetOutcome.CONNECTIVITY
					}
					is EndpointResolution.Refused -> return AssetOutcome.UNTRUSTED
				}
				publish(PhotoBackupPhase.UPLOADING, sourceId, statistics(configuration), recovery.issue)
			}
			// Uploads run one at a time, by design. Each is a single request that can't resume,
			// so files sharing a slow link would each take longer and could all miss the pass's
			// deadline, leaving nothing finished. In turn, every pass completes the files it
			// starts. Speed comes from the Umbrel answering once a file is stored and keeping
			// the connection open between files, not from parallel requests.
			for (work in candidates) {
				currentCoroutineContext().ensureActive()
				if (clock() >= deadlineMs) break
				ledger.uploadStarted(sourceId, work.localIdentifier)
				val result = uploadAsset(configuration, endpoint, grant, work)
				ledger.uploadFinished(sourceId, work.localIdentifier)
				val outcome = result.outcome
				// Only an answer from the Umbrel resolves a storage probe or connectivity recovery.
				if (outcome != AssetOutcome.SKIPPED && outcome != AssetOutcome.UNREADABLE) attempted = true
				val probing = recovery.storageProbing
				when (outcome) {
					AssetOutcome.INSUFFICIENT_STORAGE -> {
						recovery.observeTerminalBatch(foundStorageFailure = true, foundConnectivityFailure = false, hasTerminalJobs = true)
						if (probing) finishStorageProbe(recovery, PhotoBackupStorageProbeOutcome.INSUFFICIENT_STORAGE)
						return outcome
					}
					AssetOutcome.AUTHENTICATION_REQUIRED -> {
						recovery.observeTerminalBatch(foundStorageFailure = false, foundConnectivityFailure = false, hasTerminalJobs = true)
						if (probing) finishStorageProbe(recovery, PhotoBackupStorageProbeOutcome.PERMANENT_FAILURE)
						return outcome
					}
					// Every later item would be refused the same way; nothing was sent.
					AssetOutcome.LOCATION_ACCESS_REQUIRED, AssetOutcome.PHOTO_ACCESS_REQUIRED, AssetOutcome.UNTRUSTED -> return outcome
					AssetOutcome.CONNECTIVITY -> {
						recovery.observeTerminalBatch(foundStorageFailure = false, foundConnectivityFailure = true, hasTerminalJobs = true)
						if (probing) recovery.finishStorageProbe(PhotoBackupStorageProbeOutcome.CONNECTIVITY_FAILURE)
						return outcome
					}
					AssetOutcome.TRANSIENT -> {
						// The Umbrel answered, so it is reachable, but a server error says nothing
						// about storage: an open probe stays open.
						if (!probing) recovery.observeTerminalBatch(foundStorageFailure = false, foundConnectivityFailure = false, hasTerminalJobs = true)
						val failure = result.transientFailure!!
						if (accepted) countAttempt(failure) else unattributed += failure
						if (++consecutiveTransient >= TRANSIENT_FAILURES_PER_PASS || probing) return outcome
					}
					AssetOutcome.UPLOADED -> {
						recovery.observeTerminalBatch(foundStorageFailure = false, foundConnectivityFailure = false, hasTerminalJobs = true)
						if (probing) finishStorageProbe(recovery, PhotoBackupStorageProbeOutcome.SUCCEEDED)
						accepted = true
						onUploaded()
						consecutiveTransient = 0
						unattributed.forEach(::countAttempt)
						unattributed.clear()
					}
					AssetOutcome.FAILED -> {
						recovery.observeTerminalBatch(foundStorageFailure = false, foundConnectivityFailure = false, hasTerminalJobs = true)
						if (probing) finishStorageProbe(recovery, PhotoBackupStorageProbeOutcome.PERMANENT_FAILURE)
						consecutiveTransient = 0
					}
					AssetOutcome.SKIPPED, AssetOutcome.UNREADABLE -> Unit
				}
				publish(PhotoBackupPhase.UPLOADING, sourceId, statistics(configuration), recovery.issue)
				// A probe or recovery attempt answered; refill with the normal batch size.
				if (limit == 1) break
			}
		}
		if (!attempted && recovery.storageProbing) {
			// The failed resource may have been removed or excluded while backup was paused.
			preferences.clearStorageRetryRequest()
			recovery.finishStorageProbeWithoutWork()
		}
		if (!attempted && recovery.connectivityRecovering) recovery.finishConnectivityRecoveryWithoutWork()
		// Nothing in this pass showed the Umbrel accepting uploads after its error.
		return if (unattributed.isNotEmpty()) AssetOutcome.TRANSIENT else null
	}

	/** A storage or grant problem outlives the pause, so it isn't replaced. */
	private fun pauseForPhotoAccess(sourceId: String) {
		val kept = preferences.snapshot.takeIf { it.sourceId == sourceId }?.issue
			?.takeIf { it == PhotoBackupIssue.INSUFFICIENT_STORAGE || it == PhotoBackupIssue.AUTHENTICATION_REQUIRED }
		publish(PhotoBackupPhase.NEEDS_ATTENTION, sourceId, issue = kept ?: PhotoBackupIssue.PHOTO_ACCESS_REQUIRED)
	}

	/**
	 * The decision for photos and videos whose location Android would remove: backup pauses
	 * until ACCESS_MEDIA_LOCATION is granted and uploads nothing. Uploading the redacted bytes
	 * would record items as backed up without their location, and nothing would send the
	 * originals later. The alternative is to upload them, mark those receipts as redacted, and
	 * send each original again as a new revision once access is granted; adopting it means
	 * replacing this pause and the [LocationAccessRequiredException] it handles.
	 */
	private fun pauseForLocationAccess(sourceId: String, statistics: PhotoBackupStatistics) =
		publish(PhotoBackupPhase.NEEDS_ATTENTION, sourceId, statistics, PhotoBackupIssue.LOCATION_ACCESS_REQUIRED)

	private fun finishStorageProbe(recovery: PhotoBackupRecoveryState, outcome: PhotoBackupStorageProbeOutcome) {
		val hadRequest = recovery.storageRetryRequested
		recovery.finishStorageProbe(outcome)
		if (hadRequest && !recovery.storageRetryRequested) preferences.clearStorageRetryRequest()
	}

	private suspend fun uploadAsset(
		configuration: PhotoBackupConfiguration,
		endpoint: UploadEndpoint,
		grant: String,
		work: PhotoBackupLedger.AssetWork,
	): AssetResult {
		val sourceId = configuration.source.id
		val resource = when (val lookup = library.resource(work.localIdentifier)) {
			is ResourceLookup.Found -> lookup.resource
			ResourceLookup.Removed -> {
				ledger.markDeleted(sourceId, work.localIdentifier)
				return AssetResult(AssetOutcome.SKIPPED)
			}
			ResourceLookup.Unavailable -> return unreadable(sourceId, work, UNREADABLE_MESSAGE)
		}
		// Android stores one file per MediaStore row; a motion photo's video is embedded in
		// its JPEG and uploads as part of it.
		val role = if (work.mediaType == PhotoBackupLedger.MEDIA_TYPE_VIDEO) "video" else "photo"
		val resourceKey = resourceKey(sourceId, work.localIdentifier, work.revision, work.contentSize, work.contentGeneration, role)
		val fileExtension = validFileExtension(resource.displayName.substringAfterLast('.', "").lowercase())
			?: validFileExtension(MimeTypeMap.getSingleton().getExtensionFromMimeType(resource.mimeType).orEmpty().lowercase())
			?: "bin"
		val plan = PhotoBackupLedger.ResourcePlan(resourceKey, resource.displayName, "$sourceId/$resourceKey.$fileExtension")
		ledger.prepareAsset(sourceId, work.localIdentifier, work.revision, listOf(plan))
		val pending = ledger.resources(sourceId, work.localIdentifier, work.revision)
			.filter { it.state == PhotoBackupLedger.RESOURCE_PENDING && it.resourceKey == resourceKey }
		if (pending.isEmpty()) return AssetResult(AssetOutcome.SKIPPED)
		val upload = PhotoUpload(resourceKey, fileExtension, resource.displayName, resource.mimeType, resource.takenAtMs)

		val result = when (val attempt = send(endpoint, grant, work, upload)) {
			is Attempt.Gone -> {
				ledger.markDeleted(sourceId, work.localIdentifier)
				return AssetResult(AssetOutcome.SKIPPED)
			}
			is Attempt.Unreadable -> return unreadable(sourceId, work, attempt.message)
			is Attempt.LocationRedacted -> {
				ledger.recordResourcePending(resourceKey)
				return AssetResult(AssetOutcome.LOCATION_ACCESS_REQUIRED)
			}
			// The file changed or failed while it was being read: the item's own problem, but
			// one a later pass may not hit.
			is Attempt.Interrupted -> {
				if (ledger.recordResourceAttempt(resourceKey, attempt.message, MAX_ITEM_ATTEMPTS)) return AssetResult(AssetOutcome.FAILED)
				ledger.markAssetUnreadable(sourceId, work.localIdentifier, work.revision, attempt.message)
				return AssetResult(AssetOutcome.UNREADABLE)
			}
			is Attempt.Failed -> {
				ledger.recordResourceFailed(resourceKey, attempt.message)
				return AssetResult(AssetOutcome.FAILED)
			}
			is Attempt.Sent -> attempt.result
		}
		return when (result) {
			is PhotoUploadResult.Succeeded -> {
				ledger.recordResourceSucceeded(resourceKey, result.bytes)
				AssetResult(AssetOutcome.UPLOADED)
			}
			is PhotoUploadResult.Rejected -> when {
				result.issue == PhotoBackupIssue.AUTHENTICATION_REQUIRED -> {
					// The grant, not the item, was refused; the item stays queued for Reconnect.
					ledger.recordResourcePending(resourceKey)
					AssetResult(AssetOutcome.AUTHENTICATION_REQUIRED)
				}
				result.issue == PhotoBackupIssue.INSUFFICIENT_STORAGE -> {
					ledger.recordResourceFailed(resourceKey, "Umbrel rejected the upload (${result.status})")
					AssetResult(AssetOutcome.INSUFFICIENT_STORAGE)
				}
				result.status in 500..599 || result.status == 408 || result.status == 429 -> {
					ledger.recordResourcePending(resourceKey)
					AssetResult(AssetOutcome.TRANSIENT, TransientFailure(resourceKey, "Umbrel couldn’t save this item (${result.status})"))
				}
				// Umbrel refused this file. It stays refused until the user's Try Again, so the
				// same bytes are never sent again on their own.
				else -> {
					ledger.recordResourceFailed(resourceKey, "Umbrel rejected the upload (${result.status})")
					AssetResult(AssetOutcome.FAILED)
				}
			}
			is PhotoUploadResult.TransportFailed -> when {
				// The Umbrel received the whole file; only its answer is missing.
				result.afterBody -> {
					ledger.recordResourcePending(resourceKey)
					AssetResult(AssetOutcome.TRANSIENT, TransientFailure(resourceKey, "Umbrel didn’t confirm this item"))
				}
				// A lost connection says nothing about the asset; it stays queued. A certificate the
				// pin refuses means this address isn't the Umbrel: the next pass verifies them
				// all again and reports a changed identity only if none proves it.
				PhotoBackupTransportFailure.isConnectivityFailure(result.error) || PhotoBackupTransportFailure.isTrustFailure(result.error) -> {
					ledger.recordResourcePending(resourceKey)
					AssetResult(AssetOutcome.CONNECTIVITY)
				}
				else -> {
					ledger.recordResourcePending(resourceKey)
					AssetResult(AssetOutcome.TRANSIENT, TransientFailure(resourceKey, result.error.message ?: "The upload failed"))
				}
			}
		}
	}

	/** Access removed mid-pass makes every item unreadable; that pauses backup instead. */
	private fun unreadable(sourceId: String, work: PhotoBackupLedger.AssetWork, message: String): AssetResult {
		if (!library.access.canReadLibrary) return AssetResult(AssetOutcome.PHOTO_ACCESS_REQUIRED)
		ledger.markAssetUnreadable(sourceId, work.localIdentifier, work.revision, message)
		return AssetResult(AssetOutcome.UNREADABLE)
	}

	private sealed class Attempt {
		data class Sent(val result: PhotoUploadResult) : Attempt()

		/** MediaStore confirmed the item is gone, trashed, or still being written. */
		data object Gone : Attempt()

		/** Still listed but couldn't be opened right now; a later pass tries again. */
		data class Unreadable(val message: String) : Attempt()

		/** MediaStore would only serve the bytes with their location removed. */
		data object LocationRedacted : Attempt()

		/** Reading failed or the file changed during the upload. */
		data class Interrupted(val message: String) : Attempt()

		/** Nothing a later pass would change, such as an empty file. */
		data class Failed(val message: String) : Attempt()
	}

	private suspend fun send(endpoint: UploadEndpoint, grant: String, work: PhotoBackupLedger.AssetWork, upload: PhotoUpload): Attempt {
		val length = try {
			library.open(work.localIdentifier).use { it.length }
		} catch (error: LocationAccessRequiredException) {
			return Attempt.LocationRedacted
		} catch (error: FileNotFoundException) {
			return unopenable(work)
		} catch (error: SecurityException) {
			return unopenable(work)
		} catch (error: IOException) {
			return Attempt.Unreadable(error.message ?: UNREADABLE_MESSAGE)
		}
		if (length <= 0) return Attempt.Failed("This item has no uploadable data")
		return try {
			Attempt.Sent(server.upload(endpoint, grant, upload, UploadSource(length) { library.open(work.localIdentifier) }))
		} catch (error: PhotoBackupSourceException) {
			Attempt.Interrupted(error.message ?: UNREADABLE_MESSAGE)
		}
	}

	/**
	 * A failed open alone never proves deletion: a provider restart, a card error, or access
	 * changing mid-pass look the same. Only MediaStore's own answer removes the item.
	 */
	private fun unopenable(work: PhotoBackupLedger.AssetWork): Attempt =
		if (library.resource(work.localIdentifier) == ResourceLookup.Removed) Attempt.Gone else Attempt.Unreadable(UNREADABLE_MESSAGE)

	private fun statistics(configuration: PhotoBackupConfiguration) =
		ledger.statistics(configuration.source.id, configuration.includePhotos, configuration.includeVideos, skippedFolders(configuration))

	private fun skippedFolders(configuration: PhotoBackupConfiguration) = PhotoBackupFolders.skipped(configuration.skippedFolders, library.access)

	private fun publish(
		phase: PhotoBackupPhase,
		sourceId: String,
		statistics: PhotoBackupStatistics? = null,
		issue: PhotoBackupIssue? = null,
		error: String? = null,
	) {
		val previous = preferences.snapshot
		preferences.publish(
			PhotoBackupSnapshot(
				phase = phase,
				issue = issue,
				lastError = error,
				updatedAtMs = clock(),
				sourceId = sourceId,
				statistics = statistics ?: previous.statistics.takeIf { previous.sourceId == sourceId },
			),
		)
	}

	companion object {
		const val INVENTORY_BATCH_SIZE = 256
		const val INVENTORY_TARGET_PER_PASS = 4096
		private const val UPLOAD_BATCH_SIZE = 16

		/** Item-specific failures across passes before an item needs the user's Try Again. */
		const val MAX_ITEM_ATTEMPTS = 5

		/** Temporary server failures in a row that end a pass. */
		private const val TRANSIENT_FAILURES_PER_PASS = 2

		/** The snapshot error while no address of the Umbrel proves its pinned identity. */
		const val UNTRUSTED_UMBREL = "untrusted-umbrel"

		/** The snapshot error when the configured Umbrel is no longer saved on this phone. */
		const val UMBREL_NOT_SAVED = "umbrel-not-saved"
		private const val UNREADABLE_MESSAGE = "Couldn’t read this item"
		private val MEDIA_TYPES = listOf(PhotoBackupLedger.MEDIA_TYPE_IMAGE, PhotoBackupLedger.MEDIA_TYPE_VIDEO)

		/**
		 * iOS derives the key from PhotoKit's modification date. Android has no equivalent
		 * that tracks content, so the key comes from the content version the ledger tracks:
		 * the size, the MediaStore generation at which that content was first seen, and the
		 * revision, which only grows. A new version never reuses an earlier key, and retries
		 * of one version keep the same key, which umbreld treats as the same upload.
		 */
		fun resourceKey(sourceId: String, localIdentifier: String, revision: Long, size: Long, generation: Long, role: String): String {
			val material = listOf("umbrel-photo-resource-android-v2", sourceId, localIdentifier, revision, size, generation, role)
				.joinToString(0.toChar().toString())
			return MessageDigest.getInstance("SHA-256").digest(material.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }
		}

		fun validFileExtension(candidate: String): String? =
			candidate.takeIf { it.length in 1..16 && it.all { c -> c in '0'..'9' || c in 'a'..'z' } }
	}
}
