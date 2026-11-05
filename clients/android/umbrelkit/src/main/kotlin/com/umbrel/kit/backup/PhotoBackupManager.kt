package com.umbrel.kit.backup

import android.app.ActivityManager
import android.content.Context
import android.content.SharedPreferences
import com.umbrel.kit.SavedDevice
import com.umbrel.kit.SecretStore
import com.umbrel.kit.Umbreld
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import java.io.File
import java.util.UUID

/**
 * App-wide owner of photo backup intent and setup, a port of the backup half of the iOS
 * MainModel. Toggles are durable intent: turning backup on is saved immediately, then
 * setup waits for photo access and a reachable Umbrel, so a temporary outage never flips a
 * switch. One account on one Umbrel owns backup at a time. Unlike iOS, Android could
 * upload to more, but each would cost the phone another upload of the whole library; a
 * second copy is better made by the Umbrel. Setup operations are serialized, and a newer
 * request makes an older one stale.
 */
class PhotoBackupManager internal constructor(
	val preferences: PhotoBackupPreferences,
	private val ledgerFile: File,
	private val server: PhotoBackupServer,
	private val secrets: PhotoBackupSecrets,
	private val work: Work,
	private val libraryAccess: () -> PhotoLibraryAccess,
	private val locationAccess: () -> Boolean,
	private val backgroundRestricted: () -> Boolean,
	private val defaultNetwork: () -> PhotoBackupNetwork.Traits?,
	private val suggestedName: () -> String,
	private val scope: CoroutineScope,
	private val ioDispatcher: CoroutineDispatcher,
	private val clock: () -> Long = System::currentTimeMillis,
) {
	constructor(context: Context) : this(
		preferences = PhotoBackupPreferences(context),
		ledgerFile = PhotoBackupRunner.ledgerFile(context.applicationContext),
		server = UmbrelPhotoBackupServer(),
		secrets = SecretStorePhotoBackupSecrets,
		work = SchedulerWork(context.applicationContext),
		libraryAccess = { MediaStoreLibrary.libraryAccess(context.applicationContext) },
		locationAccess = { MediaStoreLibrary.locationAccess(context.applicationContext) },
		// The user's "Restricted" battery setting stops jobs while the app is in the background.
		backgroundRestricted = { context.getSystemService(ActivityManager::class.java).isBackgroundRestricted },
		defaultNetwork = { PhotoBackupNetwork.current(context.applicationContext) },
		suggestedName = { PhotoBackupSourceName.current(context.applicationContext) },
		scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate),
		ioDispatcher = Dispatchers.IO,
	)

	/** The scheduling the manager drives; a seam for JVM tests. */
	internal interface Work {
		fun start(configuration: PhotoBackupConfiguration)
		fun cancel()
		suspend fun requestPass()
		suspend fun startUserInitiatedTransfer()
	}

	private class SchedulerWork(private val context: Context) : Work {
		override fun start(configuration: PhotoBackupConfiguration) = PhotoBackupScheduler.start(context, configuration)
		override fun cancel() = PhotoBackupScheduler.cancelAll(context)
		override suspend fun requestPass() = PhotoBackupScheduler.requestPass(context)
		override suspend fun startUserInitiatedTransfer() = PhotoBackupScheduler.startUserInitiatedTransfer(context)
	}

	/** Setup state that lives only in this process. */
	data class State(
		val setupInProgress: Boolean = false,
		val setupFailure: String? = null,
		/** Changes whenever stored backup state or the worker's snapshot changes, so screens re-read them. */
		val revision: Long = 0,
	)

	private val _state = MutableStateFlow(State())
	val state: StateFlow<State> = _state

	private val operations = Mutex()
	private var setupRevision = 0
	private var deviceLookup: (String) -> SavedDevice? = { null }

	// Each account's phone source names from its last check, so a new source isn't given the
	// name of an existing one
	private val knownPhoneSourceNames = HashMap<PhotoBackupTarget, List<String>>()

	// The listener must stay strongly referenced; SharedPreferences holds it weakly.
	private val listener = SharedPreferences.OnSharedPreferenceChangeListener { _, _ -> bump() }

	init {
		preferences.configuration?.let { preferences.reconcileActiveTarget(it.deviceId, it.source.accountId) }
		preferences.registerListener(listener)
	}

	/** Lets revocation find the saved Umbrel a configuration points at. */
	fun setDeviceLookup(lookup: (String) -> SavedDevice?) {
		deviceLookup = lookup
	}

	// ── Reads ──

	fun libraryAccess(): PhotoLibraryAccess = libraryAccess.invoke()

	fun libraryPermissions(): Array<String> = MediaStoreLibrary.permissions()

	/**
	 * Whether photo access was ever requested. The rationale check is false both before the
	 * first request and after a permanent denial, so this tells the two apart across launches.
	 */
	val libraryPermissionRequested: Boolean get() = preferences.libraryPermissionRequested

	fun noteLibraryPermissionRequested() {
		preferences.libraryPermissionRequested = true
	}

	/** The preference the toggles show: media choices only while this account owns backup. */
	fun preference(deviceId: String, accountId: String): PhotoBackupPreference {
		val saved = preferences.preference(deviceId, accountId)
		return if (preferences.isActive(deviceId, accountId)) saved else saved.copy(includesPhotos = false, includesVideos = false)
	}

	/**
	 * Another account or Umbrel that owns backup. This account's controls are hidden, and only
	 * the user's confirmed switch ([switchHere]) moves backup here.
	 */
	fun otherTarget(deviceId: String, accountId: String): PhotoBackupTarget? {
		val target = PhotoBackupTarget(deviceId, accountId)
		val configuration = preferences.configuration
		if (configuration != null) return PhotoBackupTarget(configuration.deviceId, configuration.source.accountId).takeIf { it != target }
		return preferences.activeTarget?.takeIf { it != target }
	}

	/**
	 * Switching needs photo access, all of the library or a selection, which Android backs up
	 * alike, or the chance to ask for it, as on iOS. Without either it would stop the other
	 * target and start nothing. Android asks from the app, so the caller says whether its
	 * request can still show ([canRequestAccess]).
	 */
	fun canSwitchHere(canRequestAccess: Boolean = false): Boolean = canRequestAccess || libraryAccess().canReadLibrary

	/**
	 * Reduces everything into what the screens show. Reads secure storage and [ledger], so
	 * call it off the main thread. Totals come from the ledger, which is current even before
	 * the worker publishes its next snapshot.
	 */
	fun presentation(
		device: SavedDevice,
		accountId: String,
		library: PhotoLibraryCounts,
		ledger: PhotoBackupLedger?,
	): PhotoBackupPresentation {
		val configuration = configuration(device.id, accountId)
		// Turning backup off keeps the account's history visible through its stored source id.
		val storedSource = if (configuration == null) secrets.sourceId(device.id, accountId) else null
		val sourceId = configuration?.source?.id ?: (storedSource as? SecretStore.TokenReadResult.Found)?.value
		val skippedFolders = PhotoBackupFolders.skipped(configuration?.skippedFolders ?: emptySet(), libraryAccess())
		val ledgerStatistics = if (sourceId == null || ledger == null) null else try {
			ledger.statistics(sourceId, configuration?.includePhotos ?: true, configuration?.includeVideos ?: true, skippedFolders)
		} catch (error: Exception) {
			null
		}
		val state = _state.value
		return PhotoBackupPresentation.resolve(
			PhotoBackupPresentation.Inputs(
				libraryAccess = libraryAccess(),
				locationAccess = locationAccess(),
				preference = preferences.preference(device.id, accountId),
				targetActive = preferences.isActive(device.id, accountId),
				configuration = configuration,
				snapshot = preferences.snapshot,
				sourceId = sourceId,
				ledgerStatistics = ledgerStatistics,
				setupInProgress = state.setupInProgress,
				setupFailed = state.setupFailure != null,
				storageRetryRequested = configuration?.let { preferences.storageRetryRequested(it.source.id) } == true,
				recoveryRetryRequested = configuration?.let { preferences.recoveryRetryRequested(it.source.id) } == true,
				backgroundRestricted = backgroundRestricted(),
				library = library,
				defaultNetwork = defaultNetwork(),
				// A question left unanswered shows straight away, not after setup asks again
				newSourceQuestion = preferences.newSourceQuestion(device.id, accountId).takeIf { storedSource is SecretStore.TokenReadResult.Missing },
				sourceResolved = storedSource !is SecretStore.TokenReadResult.Unavailable,
			),
		)
	}

	fun openLedger(): PhotoBackupLedger = PhotoBackupLedger(ledgerFile)

	private fun configuration(deviceId: String, accountId: String): PhotoBackupConfiguration? =
		preferences.configuration?.takeIf { it.deviceId == deviceId && it.source.accountId == accountId }

	// ── Intent ──

	/**
	 * Saves the user's choice immediately. Without photo access the caller asks for it and
	 * then reports the result through [libraryAccessChanged].
	 */
	fun setPreference(device: SavedDevice, session: Umbreld.Session, preference: PhotoBackupPreference) {
		if (otherTarget(device.id, session.accountId) != null) return
		preferences.save(preference, device.id, session.accountId, activate = true)
		bump()
		if (preference.isEnabled && !libraryAccess().canReadLibrary) return
		sync(device, session, userInitiated = true)
	}

	/** The library card's "Set up backup": both media types on. */
	fun enableBackup(device: SavedDevice, session: Umbreld.Session) {
		val current = preferences.preference(device.id, session.accountId)
		setPreference(device, session, current.copy(includesPhotos = true, includesVideos = true))
	}

	sealed class SwitchOutcome {
		data object Done : SwitchOutcome()

		/**
		 * The account already has phone backups, so switching would start a new source that
		 * stores them again. Nothing has changed yet.
		 */
		data class AskNewSource(val existing: String) : SwitchOutcome()

		/** The Umbrel couldn't be asked whether this would store photos twice. Nothing has changed. */
		data object CouldNotCheck : SwitchOutcome()
	}

	/**
	 * Moves backup here from the target it's set up for, including an Umbrel this app can no
	 * longer open or an account that has signed out, so there's always a way to switch. Only
	 * on the user's confirmed request: opening or signing in to another Umbrel never moves it.
	 * Backups already on the other Umbrel stay there. When the switch would start a new source
	 * on an account with phone backups, it asks before anything is stopped, and [asNewSource]
	 * is the answer. The caller shows the check in progress: the setup state here belongs to
	 * the target that owns backup until the switch.
	 */
	suspend fun switchHere(device: SavedDevice, session: Umbreld.Session, asNewSource: Boolean = false, canRequestAccess: Boolean = false): SwitchOutcome {
		val accountId = session.accountId
		if (otherTarget(device.id, accountId) == null || !canSwitchHere(canRequestAccess)) return SwitchOutcome.Done
		var check: Umbreld.NewPhotoBackupSourceCheck = Umbreld.NewPhotoBackupSourceCheck.Proceed
		if (withContext(ioDispatcher) { secrets.sourceId(device.id, accountId) } is SecretStore.TokenReadResult.Missing) {
			if (asNewSource) {
				if (!withContext(ioDispatcher) { secrets.setSourceId(newSourceId(), device.id, accountId) }) return SwitchOutcome.CouldNotCheck
			} else {
				check = checkNewSource(device, session)
			}
		}
		// The account may have signed out, or the destination changed, during the storage calls
		// or the check
		val signedIn = withContext(ioDispatcher) { secrets.session(device.id) }.sessionOrCached?.accountId == accountId
		if (!signedIn || otherTarget(device.id, accountId) == null) return SwitchOutcome.Done
		when (check) {
			Umbreld.NewPhotoBackupSourceCheck.Proceed -> Unit
			is Umbreld.NewPhotoBackupSourceCheck.Ask -> return SwitchOutcome.AskNewSource(check.existing.first())
			Umbreld.NewPhotoBackupSourceCheck.Wait, is Umbreld.NewPhotoBackupSourceCheck.Fail -> return SwitchOutcome.CouldNotCheck
		}
		claimBackup(device, session, canRequestAccess)
		return SwitchOutcome.Done
	}

	private fun claimBackup(device: SavedDevice, session: Umbreld.Session, canRequestAccess: Boolean) {
		val accountId = session.accountId
		val other = otherTarget(device.id, accountId) ?: return
		if (!canSwitchHere(canRequestAccess)) return
		// Turn backup off for every other target, the configured one and the stored active one,
		// keeping their other choices such as mobile data, so nothing else can claim backup, even
		// after a relaunch
		val current = PhotoBackupTarget(device.id, accountId)
		for (target in listOfNotNull(other, preferences.activeTarget).distinct()) {
			if (target == current) continue
			val preference = preferences.preference(target.deviceId, target.accountId)
			preferences.save(preference.copy(includesPhotos = false, includesVideos = false), target.deviceId, target.accountId, activate = false)
		}
		// Claim backup here before any network wait, so the screens show backup starting and an
		// interrupted switch resumes here instead of leaving it off
		val preference = preferences.preference(device.id, accountId)
		preferences.save(preference.copy(includesPhotos = true, includesVideos = true), device.id, accountId, activate = true)
		val revision = ++setupRevision
		setSetup(inProgress = true, failure = null)
		enqueue(revision) {
			// Stops the other target's uploads, if it's set up, and revokes its grant when that
			// Umbrel can be reached
			disable(revokeServerGrant = true)
			if (revision != setupRevision) return@enqueue
			// Setup then runs as it does when backup is turned on, after the folder choice when
			// there is one. Without photo access the app asks for it next, and the answer comes
			// back through libraryAccessChanged.
			if (libraryAccess().canReadLibrary) sync(device, session, userInitiated = true) else setSetup(inProgress = false, failure = null)
		}
	}

	/**
	 * The user chose to back up this phone as a new source. Its identity is created now, in
	 * secure storage that never moves to another phone, so a reinstall or a new phone asks
	 * again instead of carrying this answer along.
	 */
	suspend fun backUpAsNewSource(device: SavedDevice, session: Umbreld.Session) {
		val accountId = session.accountId
		val created = withContext(ioDispatcher) {
			secrets.sourceId(device.id, accountId) !is SecretStore.TokenReadResult.Missing || secrets.setSourceId(newSourceId(), device.id, accountId)
		}
		if (!created) return
		setNewSourceQuestion(null, device.id, accountId)
		sync(device, session, userInitiated = true)
	}

	fun turnOffBackup(device: SavedDevice, session: Umbreld.Session) {
		setNewSourceQuestion(null, device.id, session.accountId)
		val current = preferences.preference(device.id, session.accountId)
		setPreference(device, session, current.copy(includesPhotos = false, includesVideos = false))
	}

	/**
	 * "Start Backup" after the folder choice that comes with turning backup on. The choice's
	 * switches save as they change, like any other preference, so this only lets setup start.
	 */
	fun confirmFolderChoice(device: SavedDevice, session: Umbreld.Session) {
		val current = preferences.preference(device.id, session.accountId)
		if (current.foldersChosen) return
		setPreference(device, session, current.copy(foldersChosen = true))
	}

	/**
	 * Setup with access to all photos waits for the folder choice, which the app shows once
	 * access is granted, so nothing uploads before a folder could be skipped. Backup that is
	 * already set up keeps running.
	 */
	private fun awaitsFolderChoice(preference: PhotoBackupPreference, configured: Boolean): Boolean =
		!configured && preference.isEnabled && !preference.foldersChosen && libraryAccess() == PhotoLibraryAccess.FULL

	/**
	 * Losing photo access pauses backup and never turns it off: Android revokes the
	 * permissions of an app left unused for months, so the loss often isn't the user's
	 * choice, and backup resumes once access returns. iOS turns backup off instead, because
	 * its access only changes when the user changes it. The one exception is a refusal in
	 * answer to turning backup on ([deniedTurnsOff]), which turns it back off.
	 */
	fun libraryAccessChanged(device: SavedDevice, session: Umbreld.Session, userInitiated: Boolean, deniedTurnsOff: Boolean = false) {
		val accountId = session.accountId
		if (libraryAccess().canReadLibrary) {
			sync(device, session, userInitiated)
			return
		}
		if (!intentEnabled(device.id, accountId)) return
		if (deniedTurnsOff) {
			val preference = preferences.preference(device.id, accountId)
			preferences.save(preference.copy(includesPhotos = false, includesVideos = false), device.id, accountId, activate = false)
		}
		bump()
		// While paused the worker stays configured and armed; its passes report the pause and
		// resume once access returns.
		sync(device, session, userInitiated = false)
	}

	/**
	 * Starts or stops backup to match the saved intent. Backup follows the account it was
	 * enabled for: viewing or signing in to another Umbrel never moves the destination. Only
	 * the user's confirmed switch ([switchHere]) does, by turning the configured target off first.
	 */
	fun sync(device: SavedDevice, session: Umbreld.Session, userInitiated: Boolean) {
		val accountId = session.accountId
		val current = preferences.configuration
		val belongsToAccount = current?.deviceId == device.id && current.source.accountId == accountId
		if (current != null && !belongsToAccount) {
			setSetup(inProgress = false, failure = null)
			return
		}
		if (!preferences.isActive(device.id, accountId)) {
			setSetup(inProgress = false, failure = null)
			setNewSourceQuestion(null, device.id, accountId)
			if (belongsToAccount) {
				val revision = ++setupRevision
				enqueue(revision) { disable(revokeServerGrant = true) }
			}
			return
		}
		// An unanswered new-phone question waits for the user. Only their own action asks the
		// Umbrel again, so returning to the app or reaching the Umbrel doesn't.
		if (!userInitiated && newSourceQuestionPending(device.id, accountId)) {
			setSetup(inProgress = false, failure = null)
			return
		}
		val preference = preferences.preference(device.id, accountId)
		if (awaitsFolderChoice(preference, configured = belongsToAccount)) {
			setSetup(inProgress = false, failure = null)
			return
		}
		val storedSourceId = (secrets.sourceId(device.id, accountId) as? SecretStore.TokenReadResult.Found)?.value
		val desired = current?.takeIf { it.source.id == storedSourceId }?.copy(
			includePhotos = preference.includesPhotos,
			includeVideos = preference.includesVideos,
			allowsCellularAccess = preference.allowsCellular,
			skippedFolders = preference.skippedFolders,
		)
		if (desired != null && current == desired &&
			preferences.snapshot.phase != PhotoBackupPhase.DISABLED &&
			secrets.grant(device.id, accountId) is SecretStore.TokenReadResult.Found
		) {
			setSetup(inProgress = false, failure = null)
			work.start(desired)
			scope.launch { if (userInitiated) work.startUserInitiatedTransfer() else work.requestPass() }
			return
		}
		val revision = ++setupRevision
		setSetup(inProgress = true, failure = null)
		enqueue(revision) { apply(device, session, preference, revision, userInitiated) }
	}

	/**
	 * Setup that couldn't reach the Umbrel waits without failing. Called once the app
	 * reaches it again; starts that setup and returns whether it did.
	 */
	fun resumeWaitingSetup(device: SavedDevice, session: Umbreld.Session): Boolean {
		val state = _state.value
		if (!intentEnabled(device.id, session.accountId) || state.setupInProgress || state.setupFailure != null) return false
		if (configuration(device.id, session.accountId) != null) return false
		if (awaitsFolderChoice(preferences.preference(device.id, session.accountId), configured = false)) return false
		if (newSourceQuestionPending(device.id, session.accountId)) return false
		sync(device, session, userInitiated = false)
		return true
	}

	/**
	 * Storage exhaustion is never retried automatically: a retry could resend the whole
	 * queue to a full Umbrel. One explicit request sends a single probe upload.
	 */
	fun retryAfterInsufficientStorage() {
		val configuration = preferences.configuration ?: return
		val snapshot = preferences.snapshot
		if (snapshot.sourceId != configuration.source.id || snapshot.issue != PhotoBackupIssue.INSUFFICIENT_STORAGE) return
		if (!preferences.isActive(configuration.deviceId, configuration.source.accountId)) return
		if (!preferences.requestStorageRetry(configuration.source.id)) return
		bump()
		scope.launch { work.startUserInitiatedTransfer() }
	}

	/** Try Again for a failed setup or failed uploads; Reconnect when the grant was rejected. */
	fun retryAfterError(device: SavedDevice, session: Umbreld.Session) {
		val setupHadFailed = _state.value.setupFailure != null
		setSetup(inProgress = _state.value.setupInProgress, failure = null)
		val configuration = configuration(device.id, session.accountId)
		if (configuration == null || setupHadFailed) {
			sync(device, session, userInitiated = true)
			return
		}
		if (!preferences.requestRecoveryRetry(configuration.source.id)) return
		bump()
		if (preferences.snapshot.issue == PhotoBackupIssue.AUTHENTICATION_REQUIRED) {
			// The upload grant is separate from the app session. Setup issues a fresh grant
			// before the worker runs again.
			secrets.deleteGrant(configuration.deviceId, configuration.source.accountId)
			sync(device, session, userInitiated = true)
		} else {
			scope.launch { work.startUserInitiatedTransfer() }
		}
	}

	/**
	 * Sign-out and a revoked session stop backup on this phone but keep the saved
	 * preference, so signing in again resumes it. New work never starts without a grant.
	 */
	fun disableLocally(deviceId: String) {
		setupRevision++
		setSetup(inProgress = false, failure = null)
		val configuration = preferences.configuration
		if (configuration == null || configuration.deviceId != deviceId) return
		work.cancel()
		preferences.clearConfiguration()
		secrets.deleteGrant(configuration.deviceId, configuration.source.accountId)
	}

	/**
	 * Only one account can be signed in to an Umbrel on this phone. A configuration for
	 * another account on it was left by an interrupted handoff, so it stops instead of
	 * uploading for an account that is no longer signed in.
	 */
	fun releaseStaleConfiguration(deviceId: String, signedInAccountId: String?) {
		val configuration = preferences.configuration ?: return
		if (configuration.deviceId != deviceId || configuration.source.accountId == signedInAccountId) return
		work.cancel()
		preferences.clearConfiguration()
		secrets.deleteGrant(configuration.deviceId, configuration.source.accountId)
	}

	/**
	 * Removing a saved Umbrel clears its backup intent as well. The source id and local
	 * receipts stay so a future enable resumes the same folder without duplicates.
	 */
	fun removeDevice(deviceId: String) {
		val configuration = preferences.configuration
		if (configuration?.deviceId == deviceId) {
			setupRevision++
			work.cancel()
			preferences.clearConfiguration()
			secrets.deleteGrant(configuration.deviceId, configuration.source.accountId)
		}
		preferences.removeDevice(deviceId)
	}

	/**
	 * A resource can reach Umbrel while its response is lost. While the app is open, ask
	 * Umbrel about the bounded set of prepared resources and record exact receipts.
	 */
	suspend fun reconcileServerReceipts(device: SavedDevice, session: Umbreld.Session) {
		val configuration = configuration(device.id, session.accountId) ?: return
		try {
			withContext(ioDispatcher) {
				PhotoBackupLedger(ledgerFile).use { ledger ->
					val pending = ledger.unconfirmedResourceReceipts(configuration.source.id, configuration.includePhotos, configuration.includeVideos)
					if (pending.isEmpty()) return@use
					val receipts = server.confirmedResources(
						device.nativeTarget,
						session,
						configuration.source.id,
						pending.map { Umbreld.PhotoBackupResourceQuery(it.resourceKey, it.fileExtension) },
					)
					if (preferences.configuration != configuration) return@use
					val requested = pending.map { it.resourceKey }.toSet()
					val confirmed = receipts
						.filter { it.resourceKey in requested && PhotoBackupLedger.isValidResourceByteCount(it.bytes) }
						.map { PhotoBackupLedger.ResourceReceipt(it.resourceKey, it.bytes) }
					if (confirmed.isEmpty()) return@use
					ledger.recordConfirmedResources(confirmed)
					val snapshot = preferences.snapshot
					if (snapshot.sourceId == configuration.source.id) {
						val statistics = ledger.statistics(
							configuration.source.id,
							configuration.includePhotos,
							configuration.includeVideos,
							PhotoBackupFolders.skipped(configuration.skippedFolders, libraryAccess()),
						)
						preferences.publish(snapshot.copy(statistics = statistics, updatedAtMs = clock()))
					}
				}
			}
		} catch (cancelled: CancellationException) {
			throw cancelled
		} catch (error: Exception) {
			// Opportunistic: the worker's queue stays authoritative when Umbrel can't answer.
		}
	}

	// ── Setup ──

	private fun intentEnabled(deviceId: String, accountId: String) =
		preferences.isActive(deviceId, accountId) && preferences.preference(deviceId, accountId).isEnabled

	private fun isCurrent(revision: Int, deviceId: String, accountId: String) =
		revision == setupRevision && intentEnabled(deviceId, accountId)

	private fun enqueue(revision: Int, operation: suspend () -> Unit): Job =
		scope.launch {
			operations.withLock {
				if (revision == setupRevision) operation()
			}
		}

	private class SetupException(message: String) : Exception(message)

	private suspend fun apply(device: SavedDevice, session: Umbreld.Session, preference: PhotoBackupPreference, revision: Int, userInitiated: Boolean) {
		if (revision != setupRevision) return
		val accountId = session.accountId
		if (!preference.isEnabled) {
			disable(revokeServerGrant = true)
			return
		}
		if (!isCurrent(revision, device.id, accountId)) return

		var previous = preferences.configuration
		if (previous != null && (previous.deviceId != device.id || previous.source.accountId != accountId)) {
			disable(revokeServerGrant = true)
			if (!isCurrent(revision, device.id, accountId)) return
			previous = null
		}

		// Without a backup identity for this account, setup would start a new source. On a new or
		// reinstalled phone that stores the whole library again, because umbrelOS keys backups by
		// source, so when the account already has phone backups it asks first.
		if (withContext(ioDispatcher) { secrets.sourceId(device.id, accountId) } is SecretStore.TokenReadResult.Missing) {
			val check = checkNewSource(device, session)
			if (!isCurrent(revision, device.id, accountId)) return
			when (check) {
				// The old source may have been removed since the question was asked
				Umbreld.NewPhotoBackupSourceCheck.Proceed -> setNewSourceQuestion(null, device.id, accountId)
				is Umbreld.NewPhotoBackupSourceCheck.Ask -> {
					setSetup(inProgress = false, failure = null)
					setNewSourceQuestion(check.existing.first(), device.id, accountId)
					return
				}
				Umbreld.NewPhotoBackupSourceCheck.Wait -> {
					// This is setup's first request, so an Umbrel it can't reach waits, as turning
					// backup on away from it does, and the check runs again once the app reaches it.
					// One that still answers, as when it takes longer than the check allows to total
					// a large library, would be asked again on every refresh, so setup fails and Try
					// Again asks again.
					val reachable = server.resolveEndpoint(device.nativeTarget) is EndpointResolution.Resolved
					if (!isCurrent(revision, device.id, accountId)) return
					return if (previous == null && !reachable) waitForUmbrel(revision) else failed("Couldn’t reach your Umbrel", revision)
				}
				is Umbreld.NewPhotoBackupSourceCheck.Fail -> return failed(check.message, revision)
			}
		}

		var issuedGrant = false
		var shouldRevokeIssuedGrant = false
		var canRestorePrevious = true
		var committed = false
		try {
			val sourceId = when (val read = withContext(ioDispatcher) { secrets.sourceId(device.id, accountId) }) {
				is SecretStore.TokenReadResult.Found -> read.value
				is SecretStore.TokenReadResult.Missing -> newSourceId().also {
					if (!withContext(ioDispatcher) { secrets.setSourceId(it, device.id, accountId) }) {
						throw SetupException("The photo backup identity couldn’t be saved")
					}
				}
				// A temporarily unreadable id is not proof there is none; minting a new one
				// would create a second source and upload the library again.
				is SecretStore.TokenReadResult.Unavailable -> throw SetupException("The photo backup identity is temporarily unavailable")
			}
			val storedGrant = when (val read = withContext(ioDispatcher) { secrets.grant(device.id, accountId) }) {
				is SecretStore.TokenReadResult.Found -> read.value
				is SecretStore.TokenReadResult.Missing -> null
				is SecretStore.TokenReadResult.Unavailable -> throw SetupException("Secure storage is temporarily unavailable")
			}
			val source: Umbreld.PhotoBackupSource
			val grantToken: String
			if (previous != null && previous.source.id == sourceId && storedGrant != null) {
				// Preference changes keep the existing account and source capability.
				source = previous.source
				grantToken = storedGrant
			} else {
				// After a relaunch, or Back Up Anyway, setup skips the check that reads the
				// account's sources, so read the names here. umbrelOS ignores the name for a source
				// it already has. An account with no phone sources has an empty list, which is
				// an answer too.
				val target = PhotoBackupTarget(device.id, accountId)
				if (target !in knownPhoneSourceNames) {
					val sources = try {
						server.photoSources(device.nativeTarget, session)
					} catch (cancelled: CancellationException) {
						throw cancelled
					} catch (error: Exception) {
						null
					}
					if (sources != null) {
						knownPhoneSourceNames[target] = sources.filter { it.isPhone }.map { it.name }
						if (!isCurrent(revision, device.id, accountId)) return
					}
				}
				val name = PhotoBackupSourceName.unique(suggestedName(), knownPhoneSourceNames[target].orEmpty())
				val grant = server.createGrant(device.nativeTarget, session, sourceId, name)
				issuedGrant = true
				shouldRevokeIssuedGrant = storedGrant == null
				source = grant.source
				grantToken = grant.token
				if (storedGrant != null && storedGrant != grant.token) {
					// A replacement capability invalidates the old one, so the old configuration
					// can't be restored if setup fails from here.
					shouldRevokeIssuedGrant = true
					canRestorePrevious = false
				}
			}
			if (source.accountId != accountId) {
				withContext(ioDispatcher) { secrets.deleteGrant(device.id, accountId) }
				revokeQuietly(device, session)
				issuedGrant = false
				throw SetupException("The photo backup identity belongs to a different Umbrel account")
			}
			if (storedGrant != grantToken && !withContext(ioDispatcher) { secrets.setGrant(grantToken, device.id, accountId) }) {
				if (issuedGrant && storedGrant == null) revokeQuietly(device, session)
				throw SetupException("The upload grant couldn’t be saved")
			}
			if (!isCurrent(revision, device.id, accountId)) {
				val newerSetupForSameTarget = _state.value.setupInProgress && intentEnabled(device.id, accountId)
				if (issuedGrant && !newerSetupForSameTarget) {
					withContext(ioDispatcher) { secrets.deleteGrant(device.id, accountId) }
					revokeQuietly(device, session)
				}
				return
			}

			val configuration = PhotoBackupConfiguration(
				deviceId = device.id,
				source = source,
				includePhotos = preference.includesPhotos,
				includeVideos = preference.includesVideos,
				allowsCellularAccess = preference.allowsCellular,
				skippedFolders = preference.skippedFolders,
			)
			val previousSnapshot = preferences.snapshot
			val storagePaused = previousSnapshot.sourceId == source.id && previousSnapshot.issue == PhotoBackupIssue.INSUFFICIENT_STORAGE
			if (previous != configuration && !storagePaused) {
				withContext(ioDispatcher) {
					PhotoBackupLedger(ledgerFile).use { it.requeueFailedAssets(source.id, preference.includesPhotos, preference.includesVideos) }
				}
			}
			if (!isCurrent(revision, device.id, accountId)) return
			if (!preferences.save(configuration)) throw SetupException("The backup configuration couldn’t be saved")
			committed = true
			val repairing = previousSnapshot.phase == PhotoBackupPhase.NEEDS_ATTENTION && previousSnapshot.issue != PhotoBackupIssue.INSUFFICIENT_STORAGE
			// An unchanged foreground refresh must not overwrite the worker's phase.
			if (previous != configuration || previousSnapshot.phase == PhotoBackupPhase.DISABLED || repairing) {
				preferences.publish(
					PhotoBackupSnapshot(
						phase = if (storagePaused) PhotoBackupPhase.NEEDS_ATTENTION else PhotoBackupPhase.WAITING,
						issue = PhotoBackupIssue.INSUFFICIENT_STORAGE.takeIf { storagePaused },
						updatedAtMs = clock(),
						sourceId = source.id,
						statistics = previousSnapshot.statistics.takeIf { previousSnapshot.sourceId == source.id },
					),
				)
			}
			work.start(configuration)
			if (userInitiated) work.startUserInitiatedTransfer() else work.requestPass()
			setSetup(inProgress = false, failure = null)
		} catch (cancelled: CancellationException) {
			throw cancelled
		} catch (error: Exception) {
			if (committed) {
				if (canRestorePrevious && previous != null) preferences.save(previous) else preferences.clearConfiguration()
			} else if (!canRestorePrevious) {
				preferences.clearConfiguration()
			}
			if (issuedGrant && shouldRevokeIssuedGrant) {
				withContext(ioDispatcher) { secrets.deleteGrant(device.id, accountId) }
				revokeQuietly(device, session)
			}
			if (!isCurrent(revision, device.id, accountId)) return
			// Turning backup on away from the Umbrel waits for it, as the worker does.
			if ((error as? Umbreld.Error)?.isConnectivityFailure == true && previous == null) return waitForUmbrel(revision)
			failed(error.message ?: "Photo backup couldn’t be set up", revision)
		}
	}

	private suspend fun disable(revokeServerGrant: Boolean) {
		val configuration = preferences.configuration
		val boundDevice = configuration?.let { deviceLookup(it.deviceId) }
		val boundSession = configuration?.let { configuration ->
			withContext(ioDispatcher) { secrets.session(configuration.deviceId) }.sessionOrCached?.takeIf { it.accountId == configuration.source.accountId }
		}
		work.cancel()
		preferences.clearConfiguration()
		if (configuration != null) withContext(ioDispatcher) { secrets.deleteGrant(configuration.deviceId, configuration.source.accountId) }
		if (revokeServerGrant && boundDevice != null && boundSession != null) revokeQuietly(boundDevice, boundSession)
		bump()
	}

	private suspend fun checkNewSource(device: SavedDevice, session: Umbreld.Session): Umbreld.NewPhotoBackupSourceCheck {
		val sources = try {
			Result.success(server.photoSources(device.nativeTarget, session))
		} catch (cancelled: CancellationException) {
			throw cancelled
		} catch (error: Exception) {
			Result.failure(error)
		}
		sources.onSuccess { list -> knownPhoneSourceNames[PhotoBackupTarget(device.id, session.accountId)] = list.filter { it.isPhone }.map { it.name } }
		return Umbreld.NewPhotoBackupSourceCheck.resolve(sources)
	}

	private fun newSourceQuestionPending(deviceId: String, accountId: String): Boolean =
		preferences.newSourceQuestion(deviceId, accountId) != null && secrets.sourceId(deviceId, accountId) is SecretStore.TokenReadResult.Missing

	private fun setNewSourceQuestion(existing: String?, deviceId: String, accountId: String) {
		if (preferences.newSourceQuestion(deviceId, accountId) == existing) return
		preferences.setNewSourceQuestion(existing, deviceId, accountId)
		bump()
	}

	private fun newSourceId(): String = UUID.randomUUID().toString().lowercase()

	private suspend fun revokeQuietly(device: SavedDevice, session: Umbreld.Session) {
		try {
			server.revokeGrant(device.nativeTarget, session)
		} catch (cancelled: CancellationException) {
			throw cancelled
		} catch (error: Exception) {
			// Best effort: the server also drops a grant whose source is removed.
		}
	}

	private fun failed(message: String, revision: Int) {
		if (revision != setupRevision) return
		setSetup(inProgress = false, failure = message)
		preferences.configuration?.let { preferences.clearRecoveryRetryRequest(it.source.id) }
	}

	/** Away from the Umbrel isn't a failure: setup resumes through [resumeWaitingSetup]. */
	private fun waitForUmbrel(revision: Int) {
		if (revision != setupRevision) return
		setSetup(inProgress = false, failure = null)
	}

	private fun setSetup(inProgress: Boolean, failure: String?) =
		_state.update { it.copy(setupInProgress = inProgress, setupFailure = failure, revision = it.revision + 1) }

	private fun bump() = _state.update { it.copy(revision = it.revision + 1) }
}
