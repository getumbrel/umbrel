package com.umbrel.kit.backup

import android.annotation.SuppressLint
import android.app.PendingIntent
import android.app.job.JobParameters
import android.app.job.JobService
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.annotation.RequiresApi
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

/**
 * The user-initiated data transfer job (Android 14+) that runs a transfer the user asked
 * for. It loops engine passes until the queue is empty, then leaves any remaining retries
 * to the automatic WorkManager passes. When the system stops it, the job asks to be
 * rescheduled and keeps its user-initiated exemptions; every pass resumes from the ledger.
 */
// Its job lives in its own JobScheduler namespace, so it can't collide with WorkManager's ids.
@SuppressLint("SpecifyJobSchedulerIdRange")
@RequiresApi(Build.VERSION_CODES.UPSIDE_DOWN_CAKE)
class PhotoBackupTransferService : JobService() {
	private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
	private var transfer: Job? = null

	override fun onStartJob(params: JobParameters): Boolean {
		// Required within 10 seconds of the start of a user-initiated job.
		setNotification(
			params,
			PhotoBackupNotifications.NOTIFICATION_ID,
			PhotoBackupNotifications.transfer(this, PhotoBackupPauseReceiver.intent(this)),
			JOB_END_NOTIFICATION_POLICY_REMOVE,
		)
		transfer = scope.launch {
			try {
				var outcome: PhotoBackupEngine.PassOutcome
				do {
					outcome = PhotoBackupRunner.runPass(applicationContext, PhotoBackupRunner.PASS_BUDGET_MS, userInitiated = true)
				} while (outcome == PhotoBackupEngine.PassOutcome.MoreWork)
				if (outcome == PhotoBackupEngine.PassOutcome.WaitingForNetwork) {
					// Rescheduling keeps the transfer user-initiated, and its network request holds
					// it until the default network qualifies again.
					jobFinished(params, true)
					return@launch
				}
				if (outcome == PhotoBackupEngine.PassOutcome.RetryLater || outcome is PhotoBackupEngine.PassOutcome.Failed) {
					PhotoBackupScheduler.requestPass(applicationContext)
				}
			} catch (cancelled: CancellationException) {
				// onStopJob cancelled the transfer; the job is already over.
				throw cancelled
			} catch (error: Exception) {
				// The automatic passes still run; the job must not outlive the transfer.
			}
			jobFinished(params, false)
		}
		return true
	}

	override fun onStopJob(params: JobParameters): Boolean {
		transfer?.cancel()
		return reschedulesAfterStop(params.stopReason)
	}

	override fun onDestroy() {
		scope.cancel()
		super.onDestroy()
	}
}

/**
 * A stop by the system (a lost network, thermal pressure, system health) is retried by the
 * system, and the retry keeps the job's user-initiated status. Pause cancels the job, and a
 * stop by the user would only come back demoted to a regular job; automatic backup carries
 * on in both cases.
 */
@RequiresApi(Build.VERSION_CODES.UPSIDE_DOWN_CAKE)
internal fun reschedulesAfterStop(stopReason: Int): Boolean =
	stopReason != JobParameters.STOP_REASON_CANCELLED_BY_APP && stopReason != JobParameters.STOP_REASON_USER

/** The notification's Pause action. */
class PhotoBackupPauseReceiver : BroadcastReceiver() {
	override fun onReceive(context: Context, intent: Intent) {
		if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
			PhotoBackupScheduler.transferJobs(context).cancel(PhotoBackupScheduler.TRANSFER_JOB_ID)
		}
	}

	companion object {
		fun intent(context: Context): PendingIntent = PendingIntent.getBroadcast(
			context,
			0,
			Intent(context, PhotoBackupPauseReceiver::class.java),
			PendingIntent.FLAG_IMMUTABLE,
		)
	}
}
