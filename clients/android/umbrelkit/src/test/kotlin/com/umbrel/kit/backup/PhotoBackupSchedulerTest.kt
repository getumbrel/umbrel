package com.umbrel.kit.backup

import android.app.job.JobParameters
import android.content.Context
import android.net.NetworkCapabilities
import android.util.Log
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.work.Configuration
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.ListenableWorker
import androidx.work.WorkInfo
import androidx.work.WorkManager
import androidx.work.WorkerFactory
import androidx.work.WorkerParameters
import androidx.work.testing.WorkManagerTestInitHelper
import com.umbrel.kit.Umbreld
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.Executors

@RunWith(AndroidJUnit4::class)
class PhotoBackupSchedulerTest {
	private lateinit var context: Context
	private lateinit var workManager: WorkManager

	/** Stands in for the engine so a pass can be held in RUNNING. */
	class HeldPassWorker(context: Context, parameters: WorkerParameters) : CoroutineWorker(context, parameters) {
		override suspend fun doWork(): Result {
			started.complete(Unit)
			release.await()
			return Result.success()
		}

		companion object {
			var started = CompletableDeferred<Unit>()
			var release = CompletableDeferred<Unit>()
		}
	}

	@Before
	fun setUp() {
		context = ApplicationProvider.getApplicationContext()
		context.getSharedPreferences(PhotoBackupPreferences.FILE_NAME, Context.MODE_PRIVATE).edit().clear().commit()
		PhotoBackupPreferences(context).save(configuration(allowsCellular = false))
		HeldPassWorker.started = CompletableDeferred()
		HeldPassWorker.release = CompletableDeferred()
		val factory = object : WorkerFactory() {
			override fun createWorker(appContext: Context, workerClassName: String, workerParameters: WorkerParameters): ListenableWorker? =
				if (workerClassName == PhotoBackupWorker::class.java.name) HeldPassWorker(appContext, workerParameters) else null
		}
		val configuration = Configuration.Builder()
			.setMinimumLoggingLevel(Log.DEBUG)
			.setExecutor(Executors.newSingleThreadExecutor())
			.setWorkerFactory(factory)
			.build()
		WorkManagerTestInitHelper.initializeTestWorkManager(context, configuration)
		workManager = WorkManager.getInstance(context)
	}

	@Test
	fun theChainPolicyAppendsBehindARunningPassAndReplacesAWaitingOne() {
		assertEquals(ExistingWorkPolicy.REPLACE, PhotoBackupScheduler.passPolicy(emptyList()))
		assertEquals(ExistingWorkPolicy.REPLACE, PhotoBackupScheduler.passPolicy(listOf(WorkInfo.State.ENQUEUED)))
		assertEquals(ExistingWorkPolicy.REPLACE, PhotoBackupScheduler.passPolicy(listOf(WorkInfo.State.SUCCEEDED)))
		assertEquals(ExistingWorkPolicy.APPEND_OR_REPLACE, PhotoBackupScheduler.passPolicy(listOf(WorkInfo.State.RUNNING)))
		assertNull(PhotoBackupScheduler.passPolicy(listOf(WorkInfo.State.RUNNING, WorkInfo.State.BLOCKED)))
	}

	// A request that arrives while a pass runs, including the running pass asking for its own
	// follow-up, must not be dropped, and passes must never overlap.
	@Test
	fun aRequestDuringARunningPassQueuesExactlyOneFollowUp() = runBlocking {
		PhotoBackupScheduler.requestPass(context)
		val first = passes().single()
		WorkManagerTestInitHelper.getTestDriver(context)!!.setAllConstraintsMet(first.id)
		withTimeout(5_000) { HeldPassWorker.started.await() }
		awaitStates { it == listOf(WorkInfo.State.RUNNING) }

		PhotoBackupScheduler.requestPass(context)
		PhotoBackupScheduler.requestPass(context)
		assertEquals(listOf(WorkInfo.State.RUNNING, WorkInfo.State.BLOCKED), passes().map { it.state }.sorted())

		HeldPassWorker.release.complete(Unit)
		awaitStates { it == listOf(WorkInfo.State.ENQUEUED, WorkInfo.State.SUCCEEDED) }
	}

	@Test
	fun aRequestReplacesAWaitingPassWithCurrentConstraints() = runBlocking {
		PhotoBackupScheduler.requestPass(context)
		val waiting = passes().single().constraints.requiredNetworkRequest!!
		assertTrue(waiting.hasTransport(NetworkCapabilities.TRANSPORT_WIFI))

		PhotoBackupPreferences(context).save(configuration(allowsCellular = true))
		PhotoBackupScheduler.requestPass(context)

		val current = passes().filter { !it.state.isFinished }
		assertEquals(1, current.size)
		val request = current.single().constraints.requiredNetworkRequest!!
		assertFalse(request.hasTransport(NetworkCapabilities.TRANSPORT_WIFI))
		assertTrue(request.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_ROAMING))
		assertTrue(current.single().constraints.requiresBatteryNotLow())
	}

	// A LAN whose internet is down is never VALIDATED, but the Umbrel is reachable on it. A VPN
	// such as Tailscale over Wi-Fi carries Wi-Fi among its transports.
	@Test
	fun theNetworkRequestNeverRequiresValidationAndAllowsAVpn() {
		for (allowsCellular in listOf(false, true)) for (userInitiated in listOf(false, true)) {
			val request = PhotoBackupScheduler.networkRequest(allowsCellular, userInitiated)
			assertFalse(request.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED))
			assertFalse(request.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_VPN))
		}
		val wifiOnly = PhotoBackupScheduler.networkRequest(allowsCellular = false, userInitiated = false)
		assertTrue(wifiOnly.hasTransport(NetworkCapabilities.TRANSPORT_WIFI))
		assertTrue(wifiOnly.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET))
		assertFalse(wifiOnly.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR))
		// A phone hotspot is Wi-Fi but metered.
		assertTrue(wifiOnly.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED))
		assertFalse(PhotoBackupScheduler.networkRequest(allowsCellular = true, userInitiated = false).hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED))
		// Roaming is refused only for automatic passes; a transfer the user starts may roam.
		assertTrue(PhotoBackupScheduler.networkRequest(allowsCellular = true, userInitiated = false).hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_ROAMING))
		assertFalse(PhotoBackupScheduler.networkRequest(allowsCellular = true, userInitiated = true).hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_ROAMING))
	}

	@Test
	fun theTransferJobUsesTheSameNetworkRequest() {
		val job = PhotoBackupScheduler.transferJob(context, configuration(allowsCellular = false))

		assertEquals(PhotoBackupScheduler.networkRequest(allowsCellular = false, userInitiated = true), job.requiredNetwork)
	}

	@Test
	fun withoutAConfigurationNothingIsScheduled() = runBlocking {
		context.getSharedPreferences(PhotoBackupPreferences.FILE_NAME, Context.MODE_PRIVATE).edit().clear().commit()

		PhotoBackupScheduler.requestPass(context)
		PhotoBackupScheduler.armWatcher(context)
		PhotoBackupScheduler.ensurePass(context)

		assertTrue(passes().isEmpty())
		assertTrue(watchers().isEmpty())
	}

	// A process start may have cost the change that caused it, so it queues a pass and makes
	// sure a watcher is armed.
	@Test
	fun aProcessStartQueuesAPassAndArmsTheWatcher() = runBlocking {
		PhotoBackupScheduler.ensurePass(context)

		assertEquals(WorkInfo.State.ENQUEUED, passes().single().state)
		assertEquals(1, watchers().size)
	}

	// The waiting pass may be the job that started the process; replacing it would stop it.
	@Test
	fun aProcessStartLeavesAWaitingPassAlone() = runBlocking {
		PhotoBackupScheduler.requestPass(context)
		val waiting = passes().single().id

		PhotoBackupScheduler.ensurePass(context)

		assertEquals(listOf(waiting), passes().filter { !it.state.isFinished }.map { it.id })
	}

	@Test
	fun theWatcherIsArmedOnceWithContentTriggers() = runBlocking {
		PhotoBackupScheduler.armWatcher(context)
		PhotoBackupScheduler.armWatcher(context)

		val watcher = watchers().single()
		assertEquals(2, watcher.constraints.contentUriTriggers.size)
	}

	// A successor in the same unique chain would wait, unarmed, until the running watcher
	// finished. Under the other name it is scheduled while the watcher still runs.
	@Test
	fun aRunningWatcherArmsItsSuccessorUnderTheOtherName() = runBlocking {
		PhotoBackupScheduler.armWatcher(context)
		val first = PhotoBackupScheduler.WATCH_WORK.first()

		PhotoBackupScheduler.armNextWatcher(context, first)

		val successor = workManager.getWorkInfosForUniqueWork(PhotoBackupScheduler.WATCH_WORK.last()).get().single()
		assertEquals(WorkInfo.State.ENQUEUED, successor.state)
		assertEquals(2, successor.constraints.contentUriTriggers.size)

		// The successor's own successor takes the first name again.
		PhotoBackupScheduler.armNextWatcher(context, PhotoBackupScheduler.WATCH_WORK.last())
		assertEquals(1, workManager.getWorkInfosForUniqueWork(first).get().count { it.state == WorkInfo.State.ENQUEUED })
	}

	@Test
	fun aUserInitiatedPassIsExpeditedWithoutTheBatteryConstraint() {
		val request = PhotoBackupScheduler.passRequest(configuration(allowsCellular = false), userInitiated = true)

		assertTrue(request.workSpec.expedited)
		assertFalse(request.workSpec.constraints.requiresBatteryNotLow())
		assertTrue(request.workSpec.input.getBoolean(PhotoBackupWorker.KEY_USER_INITIATED, false))
	}

	// A system stop is retried by the system with the job's user-initiated exemptions kept; a
	// reboot doesn't end the transfer either.
	@Test
	fun aUserStartedTransferSurvivesSystemStopsAndReboots() {
		val job = PhotoBackupScheduler.transferJob(context, configuration(allowsCellular = false))

		assertTrue(job.isUserInitiated)
		assertTrue(job.isPersisted)
		assertTrue(reschedulesAfterStop(JobParameters.STOP_REASON_CONSTRAINT_CONNECTIVITY))
		assertTrue(reschedulesAfterStop(JobParameters.STOP_REASON_DEVICE_STATE))
		assertTrue(reschedulesAfterStop(JobParameters.STOP_REASON_SYSTEM_PROCESSING))
		assertFalse(reschedulesAfterStop(JobParameters.STOP_REASON_CANCELLED_BY_APP))
		assertFalse(reschedulesAfterStop(JobParameters.STOP_REASON_USER))
	}

	private fun passes(): List<WorkInfo> = workManager.getWorkInfosForUniqueWork("photo-backup-pass").get()

	private fun watchers(): List<WorkInfo> =
		PhotoBackupScheduler.WATCH_WORK.flatMap { workManager.getWorkInfosForUniqueWork(it).get() }.filter { !it.state.isFinished }

	private suspend fun awaitStates(predicate: (List<WorkInfo.State>) -> Boolean) {
		withTimeout(5_000) {
			while (!predicate(passes().map { it.state }.sorted())) kotlinx.coroutines.delay(20)
		}
	}

	private fun configuration(allowsCellular: Boolean) = PhotoBackupConfiguration(
		"umbrel",
		Umbreld.PhotoBackupSource("source", "0", "Android phone"),
		includePhotos = true,
		includeVideos = true,
		allowsCellularAccess = allowsCellular,
	)
}
