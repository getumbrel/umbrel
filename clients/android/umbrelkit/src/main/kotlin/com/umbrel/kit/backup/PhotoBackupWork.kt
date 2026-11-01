package com.umbrel.kit.backup

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.job.JobInfo
import android.app.job.JobScheduler
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.os.Build
import android.provider.MediaStore
import androidx.annotation.RequiresApi
import androidx.core.app.NotificationCompat
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.ForegroundInfo
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.OutOfQuotaPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkInfo
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import androidx.work.await
import androidx.work.workDataOf
import com.umbrel.kit.Config
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import java.util.concurrent.TimeUnit

/**
 * Serializes engine passes. WorkManager passes share one unique chain, but a
 * user-initiated transfer job on Android 14+ runs outside it in the same process.
 */
object PhotoBackupRunner {
	private val mutex = Mutex()

	suspend fun runPass(context: Context, budgetMs: Long, userInitiated: Boolean): PhotoBackupEngine.PassOutcome = mutex.withLock {
		val appContext = context.applicationContext
		val ledger = try {
			withContext(Dispatchers.IO) { PhotoBackupLedger(ledgerFile(appContext)) }
		} catch (cancelled: CancellationException) {
			throw cancelled
		} catch (error: Exception) {
			return@withLock PhotoBackupEngine.PassOutcome.Failed("The backup ledger couldn’t be opened")
		}
		ledger.use {
			val preferences = PhotoBackupPreferences(appContext)
			val engine = PhotoBackupEngine(
				preferences,
				it,
				MediaStoreLibrary(appContext),
				UmbrelPhotoBackupServer(),
				SecretStorePhotoBackupSecrets,
				// The worker reads the saved Umbrel the way the app persists it, so a pass
				// always tries the addresses the app last learned.
				targets = { deviceId -> Config.load(appContext).config.savedDevices[deviceId]?.nativeTarget },
			)
			val allowsMobileData = preferences.configuration?.allowsCellularAccess ?: false
			whileNetworkQualifies(PhotoBackupNetwork.defaultNetwork(appContext), allowsMobileData, userInitiated) {
				engine.runPass(System.currentTimeMillis() + budgetMs)
			}
		}
	}

	/**
	 * Runs [pass], stopping it once the default network has stopped qualifying for
	 * [NETWORK_GRACE_MS]. JobScheduler starts a job only on a qualifying default network, but
	 * keeps a running job going while its first network stays connected, even after the
	 * default moves elsewhere, as it does to mobile data when Wi-Fi turns weak. Uploads use
	 * the default network, so the rest of the pass would go over it. The grace period rides
	 * out a VPN reconnecting. A stopped upload doesn't count against its item.
	 */
	internal suspend fun whileNetworkQualifies(
		network: Flow<PhotoBackupNetwork.Traits?>,
		allowsMobileData: Boolean,
		userInitiated: Boolean,
		pass: suspend () -> PhotoBackupEngine.PassOutcome,
	): PhotoBackupEngine.PassOutcome = coroutineScope {
		var networkLeft = false
		val running = async { pass() }
		val watch = launch {
			network.collectLatest { current ->
				if (!PhotoBackupNetwork.qualifies(current, allowsMobileData, userInitiated)) {
					delay(NETWORK_GRACE_MS)
					networkLeft = true
					running.cancel()
				}
			}
		}
		try {
			running.await()
		} catch (cancelled: CancellationException) {
			if (!networkLeft) throw cancelled
			PhotoBackupEngine.PassOutcome.WaitingForNetwork
		} finally {
			watch.cancel()
		}
	}

	fun ledgerFile(context: Context) = context.getDatabasePath("photo-backup.sqlite")

	/**
	 * Regular jobs are stopped after 10 minutes. A pass stops starting uploads after this
	 * budget so the upload in flight can usually finish; the next pass continues.
	 */
	const val PASS_BUDGET_MS = 7 * 60_000L

	private const val NETWORK_GRACE_MS = 3_000L
}

/**
 * One engine pass in the background. Automatic backup (library changes, the periodic
 * safety net, follow-up chunks) runs as ordinary WorkManager work bounded under the
 * 10-minute job limit, the documented choice for sync that isn't user-initiated. On
 * Android 11 to 13 a pass the user started runs as a long-running worker with a dataSync
 * foreground service instead, the documented fallback for user-initiated data transfer
 * jobs, which need Android 14.
 */
class PhotoBackupWorker(context: Context, parameters: WorkerParameters) : CoroutineWorker(context, parameters) {
	override suspend fun doWork(): Result {
		val userInitiated = inputData.getBoolean(KEY_USER_INITIATED, false)
		val longRunning = userInitiated && Build.VERSION.SDK_INT < Build.VERSION_CODES.UPSIDE_DOWN_CAKE && promoteToForeground()
		while (true) {
			when (PhotoBackupRunner.runPass(applicationContext, PhotoBackupRunner.PASS_BUDGET_MS, userInitiated)) {
				PhotoBackupEngine.PassOutcome.MoreWork -> if (!longRunning) {
					PhotoBackupScheduler.requestPass(applicationContext)
					return Result.success()
				}
				// The follow-up's network request holds it until the default network qualifies.
				PhotoBackupEngine.PassOutcome.WaitingForNetwork -> {
					PhotoBackupScheduler.requestPass(applicationContext)
					return Result.success()
				}
				PhotoBackupEngine.PassOutcome.Completed, PhotoBackupEngine.PassOutcome.WaitingForUser -> return Result.success()
				// Backoff retries are how a pass resumes once the Umbrel is reachable again or its
				// errors clear; the app also requests a pass whenever it returns to the foreground.
				PhotoBackupEngine.PassOutcome.RetryLater -> return Result.retry()
				is PhotoBackupEngine.PassOutcome.Failed -> return if (runAttemptCount < MAX_FAILED_ATTEMPTS) Result.retry() else Result.success()
			}
		}
	}

	/**
	 * Android 12+ refuses to start a foreground service from the background
	 * (ForegroundServiceStartNotAllowedException, an IllegalStateException). The pass then
	 * runs as ordinary bounded work.
	 */
	private suspend fun promoteToForeground(): Boolean = try {
		setForeground(getForegroundInfo())
		true
	} catch (error: IllegalStateException) {
		false
	}

	override suspend fun getForegroundInfo(): ForegroundInfo = ForegroundInfo(
		PhotoBackupNotifications.NOTIFICATION_ID,
		PhotoBackupNotifications.transfer(applicationContext, WorkManager.getInstance(applicationContext).createCancelPendingIntent(id)),
		ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC,
	)

	companion object {
		const val KEY_USER_INITIATED = "userInitiated"
		private const val MAX_FAILED_ATTEMPTS = 5
	}
}

/**
 * Wakes when the media library changes. Content URI triggers apply only to one-time work,
 * and a trigger job collects changes only while it is scheduled. The watcher therefore
 * arms its successor under the other of two names first, which schedules it at once, and
 * only then requests the pass. A change made before the successor was armed is read by
 * that pass, which captures MediaStore's generation when it starts, after this request;
 * any later change fires the successor. No change falls between the two.
 */
class PhotoBackupWatchWorker(context: Context, parameters: WorkerParameters) : CoroutineWorker(context, parameters) {
	override suspend fun doWork(): Result {
		PhotoBackupScheduler.armNextWatcher(applicationContext, inputData.getString(KEY_NAME))
		try {
			PhotoBackupScheduler.requestPass(applicationContext)
		} catch (cancelled: CancellationException) {
			throw cancelled
		} catch (error: Exception) {
			// The successor is armed; the periodic safety net requests the pass later.
		}
		return Result.success()
	}

	companion object {
		const val KEY_NAME = "watchName"
	}
}

/** A safety net in case a content trigger is missed. It only requests a pass. */
class PhotoBackupPeriodicWorker(context: Context, parameters: WorkerParameters) : CoroutineWorker(context, parameters) {
	override suspend fun doWork(): Result {
		PhotoBackupScheduler.armWatcher(applicationContext)
		PhotoBackupScheduler.requestPass(applicationContext)
		return Result.success()
	}
}

/** Enqueues and cancels the work that drives backup. */
object PhotoBackupScheduler {
	private const val PASS_WORK = "photo-backup-pass"
	// A running watcher arms its successor under the other name, so the successor is
	// scheduled while the watcher still runs instead of waiting behind it in one chain.
	internal val WATCH_WORK = listOf("photo-backup-watch", "photo-backup-watch-next")
	private const val PERIODIC_WORK = "photo-backup-periodic"
	internal const val JOB_NAMESPACE = "com.umbrel.kit.photo-backup"
	internal const val TRANSFER_JOB_ID = 1

	private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

	/**
	 * Arms the library watcher and the periodic safety net for a configured backup. The
	 * safety net runs hourly: it also resets a pass waiting out its backoff, so backup
	 * resumes within the hour of the Umbrel becoming reachable again, and a pass with nothing
	 * to do is a local check that makes no network request.
	 */
	fun start(context: Context, configuration: PhotoBackupConfiguration) {
		val manager = WorkManager.getInstance(context)
		val periodic = PeriodicWorkRequestBuilder<PhotoBackupPeriodicWorker>(1, TimeUnit.HOURS).build()
		manager.enqueueUniquePeriodicWork(PERIODIC_WORK, ExistingPeriodicWorkPolicy.UPDATE, periodic)
		val appContext = context.applicationContext
		scope.launch { armWatcher(appContext) }
	}

	/**
	 * Called as the app's process starts. That start can cost the library change that caused
	 * it: after the app was swiped away or updated, WorkManager re-registers its jobs as it
	 * starts, which stops the watcher that was woken for the change and re-arms it for later
	 * changes only. A pass reads everything changed since the last one, so one is queued here.
	 * KEEP leaves a pass that's already waiting alone, since it may be the job that started
	 * this process; WorkManager runs these requests in order with its own startup work.
	 */
	fun catchUp(context: Context) {
		val appContext = context.applicationContext
		scope.launch {
			try {
				ensurePass(appContext)
			} catch (cancelled: CancellationException) {
				throw cancelled
			} catch (error: Exception) {
				// The watcher and the hourly safety net still request passes.
			}
		}
	}

	/** Arms the watcher and queues a pass unless one is already waiting or running. */
	internal suspend fun ensurePass(context: Context) {
		val configuration = PhotoBackupPreferences(context).configuration ?: return
		armWatcher(context)
		WorkManager.getInstance(context).enqueueUniqueWork(PASS_WORK, ExistingWorkPolicy.KEEP, passRequest(configuration, userInitiated = false)).await()
	}

	fun cancelAll(context: Context) {
		val manager = WorkManager.getInstance(context)
		manager.cancelUniqueWork(PASS_WORK)
		WATCH_WORK.forEach(manager::cancelUniqueWork)
		manager.cancelUniqueWork(PERIODIC_WORK)
		if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) transferJobs(context).cancel(TRANSFER_JOB_ID)
	}

	/** Arms a watcher unless one is already armed, or running and about to arm its successor. */
	suspend fun armWatcher(context: Context) {
		if (PhotoBackupPreferences(context).configuration == null) return
		val manager = WorkManager.getInstance(context)
		val armed = WATCH_WORK.any { name -> manager.getWorkInfosForUniqueWorkFlow(name).first().any { !it.state.isFinished } }
		if (!armed) manager.enqueueUniqueWork(WATCH_WORK.first(), ExistingWorkPolicy.KEEP, watchRequest(WATCH_WORK.first())).await()
	}

	/**
	 * Called by the watcher running as [current]; its successor takes the other name and is
	 * scheduled, so collecting changes, when this returns.
	 */
	internal suspend fun armNextWatcher(context: Context, current: String?) {
		if (PhotoBackupPreferences(context).configuration == null) return
		val next = if (current == WATCH_WORK.last()) WATCH_WORK.first() else WATCH_WORK.last()
		WorkManager.getInstance(context).enqueueUniqueWork(next, ExistingWorkPolicy.REPLACE, watchRequest(next)).await()
	}

	private fun watchRequest(name: String) = OneTimeWorkRequestBuilder<PhotoBackupWatchWorker>()
		.setConstraints(
			Constraints.Builder()
				.addContentUriTrigger(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, true)
				.addContentUriTrigger(MediaStore.Video.Media.EXTERNAL_CONTENT_URI, true)
				.setTriggerContentUpdateDelay(10, TimeUnit.SECONDS)
				.setTriggerContentMaxDelay(5, TimeUnit.MINUTES)
				.build(),
		)
		.setInputData(workDataOf(PhotoBackupWatchWorker.KEY_NAME to name))
		.build()

	/**
	 * Ensures a pass runs after any pass in progress. Passes share one unique chain so they
	 * never overlap: a request while a pass runs appends one follow-up (KEEP would drop it),
	 * and a request while a pass is only waiting replaces it, which resets its backoff and
	 * applies current constraints.
	 */
	suspend fun requestPass(context: Context, userInitiated: Boolean = false) {
		val configuration = PhotoBackupPreferences(context).configuration ?: return
		val manager = WorkManager.getInstance(context)
		val policy = passPolicy(manager.getWorkInfosForUniqueWorkFlow(PASS_WORK).first().map { it.state }) ?: return
		manager.enqueueUniqueWork(PASS_WORK, policy, passRequest(configuration, userInitiated)).await()
	}

	/** Null when a follow-up is already queued behind the running pass. */
	internal fun passPolicy(states: List<WorkInfo.State>): ExistingWorkPolicy? {
		val running = WorkInfo.State.RUNNING in states
		val waiting = states.any { it == WorkInfo.State.ENQUEUED || it == WorkInfo.State.BLOCKED }
		return when {
			running && waiting -> null
			running -> ExistingWorkPolicy.APPEND_OR_REPLACE
			else -> ExistingWorkPolicy.REPLACE
		}
	}

	/**
	 * The network a pass may use, [PhotoBackupNetwork]'s rule as a request rather than one of
	 * JobScheduler's network types: those always require a VALIDATED network, and Wi-Fi
	 * whose internet is down is never validated although the Umbrel is right there on it. A
	 * VPN is allowed either way. JobScheduler checks the request against the app's default
	 * network only.
	 */
	internal fun networkRequest(allowsCellular: Boolean, userInitiated: Boolean): NetworkRequest =
		NetworkRequest.Builder()
			.addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
			.removeCapability(NetworkCapabilities.NET_CAPABILITY_NOT_VPN)
			.removeCapability(NetworkCapabilities.NET_CAPABILITY_NOT_RESTRICTED)
			.apply {
				if (!allowsCellular) {
					addTransportType(NetworkCapabilities.TRANSPORT_WIFI)
					addTransportType(NetworkCapabilities.TRANSPORT_ETHERNET)
					addCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED)
				} else if (!userInitiated) {
					addCapability(NetworkCapabilities.NET_CAPABILITY_NOT_ROAMING)
				}
			}
			.build()

	internal fun passRequest(configuration: PhotoBackupConfiguration, userInitiated: Boolean) =
		OneTimeWorkRequestBuilder<PhotoBackupWorker>()
			.setConstraints(
				Constraints.Builder()
					// The network type applies only below API 28, under this module's minimum.
					.setRequiredNetworkRequest(
						networkRequest(configuration.allowsCellularAccess, userInitiated),
						if (configuration.allowsCellularAccess) NetworkType.CONNECTED else NetworkType.UNMETERED,
					)
					// Expedited work accepts only network and storage constraints.
					.setRequiresBatteryNotLow(!userInitiated)
					.build(),
			)
			.setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 1, TimeUnit.MINUTES)
			.setInputData(workDataOf(PhotoBackupWorker.KEY_USER_INITIATED to userInitiated))
			.apply { if (userInitiated) setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST) }
			.build()

	/**
	 * A transfer the user just asked for (turning backup on, Try Again, Reconnect). Android
	 * 14+ runs it as a user-initiated data transfer job, which is exempt from job quotas and
	 * the 10-minute limit; it can only be scheduled while the app is visible. Earlier
	 * versions use the long-running worker.
	 */
	suspend fun startUserInitiatedTransfer(context: Context) {
		val configuration = PhotoBackupPreferences(context).configuration ?: return
		if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
			if (scheduleTransferJob(context, configuration)) return
			requestPass(context)
		} else {
			requestPass(context, userInitiated = true)
		}
	}

	@RequiresApi(Build.VERSION_CODES.UPSIDE_DOWN_CAKE)
	private fun scheduleTransferJob(context: Context, configuration: PhotoBackupConfiguration): Boolean {
		val scheduler = transferJobs(context)
		// Scheduling the same id again would stop a running transfer.
		if (scheduler.getPendingJobReason(TRANSFER_JOB_ID) == JobScheduler.PENDING_JOB_REASON_EXECUTING) return true
		return try {
			scheduler.schedule(transferJob(context, configuration)) == JobScheduler.RESULT_SUCCESS
		} catch (error: SecurityException) {
			false
		}
	}

	/** Persisted, so a transfer the user started continues after a reboot. */
	@RequiresApi(Build.VERSION_CODES.UPSIDE_DOWN_CAKE)
	internal fun transferJob(context: Context, configuration: PhotoBackupConfiguration): JobInfo =
		JobInfo.Builder(TRANSFER_JOB_ID, ComponentName(context, PhotoBackupTransferService::class.java))
			.setUserInitiated(true)
			.setPersisted(true)
			.setRequiredNetwork(networkRequest(configuration.allowsCellularAccess, userInitiated = true))
			.build()

	/** A separate namespace keeps the transfer job's id clear of WorkManager's job ids. */
	@RequiresApi(Build.VERSION_CODES.UPSIDE_DOWN_CAKE)
	internal fun transferJobs(context: Context): JobScheduler =
		context.getSystemService(JobScheduler::class.java).forNamespace(JOB_NAMESPACE)
}

internal object PhotoBackupNotifications {
	const val CHANNEL_ID = "photo-backup"
	const val NOTIFICATION_ID = 1001

	/** Shown only while a user-initiated transfer runs; automatic passes are silent. */
	fun transfer(context: Context, pause: PendingIntent): Notification {
		val manager = context.getSystemService(NotificationManager::class.java)
		manager.createNotificationChannel(
			NotificationChannel(CHANNEL_ID, "Photo backup", NotificationManager.IMPORTANCE_LOW).apply {
				description = "Progress of photo and video backup to your Umbrel"
			},
		)
		val open = context.packageManager.getLaunchIntentForPackage(context.packageName)?.let {
			PendingIntent.getActivity(context, 0, it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK), PendingIntent.FLAG_IMMUTABLE)
		}
		return NotificationCompat.Builder(context, CHANNEL_ID)
			.setContentTitle("Backing up to Umbrel")
			.setContentText("Uploading photos and videos")
			.setSmallIcon(android.R.drawable.stat_sys_upload)
			.setContentIntent(open)
			.setOngoing(true)
			.setOnlyAlertOnce(true)
			// Pausing stops this transfer; automatic backup resumes with the next library change.
			.addAction(android.R.drawable.ic_media_pause, "Pause", pause)
			.build()
	}
}
