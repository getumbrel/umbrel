package com.umbrel.android.main

import com.umbrel.kit.Umbreld

/**
 * Maps umbreld lifecycle strings into the visual language used by umbrelOS. Unknown future
 * values degrade to the same unavailable treatment as `unknown`.
 */
sealed class AppTilePresentation {
	enum class Activity(val label: String?, val accessibilityValue: String) {
		INSTALLING(null, "Installing"),
		STARTING("Starting…", "Starting"),
		RUNNING(null, "Running"),
		STOPPING("Stopping…", "Stopping"),
		RESTARTING("Restarting…", "Restarting"),
		UNINSTALLING("Uninstalling…", "Uninstalling"),
		UPDATING("Updating…", "Updating");

		val usesReportedProgress: Boolean get() = this == INSTALLING || this == UPDATING
	}

	/** The state glyph drawn over a dimmed icon. */
	enum class Symbol { PAUSED, UNAVAILABLE }

	data object Available : AppTilePresentation()
	data object Stopped : AppTilePresentation()
	data object Unavailable : AppTilePresentation()
	data class InProgress(val activity: Activity) : AppTilePresentation()

	val dimsIcon: Boolean get() = this != Available

	val symbol: Symbol?
		get() = when (this) {
			Stopped -> Symbol.PAUSED
			Unavailable -> Symbol.UNAVAILABLE
			Available, is InProgress -> null
		}

	fun label(default: String): String = when (this) {
		Unavailable -> "Offline"
		is InProgress -> activity.label ?: default
		Available, Stopped -> default
	}

	val accessibilityValue: String?
		get() = when (this) {
			Available -> null
			Stopped -> "Stopped"
			Unavailable -> "Offline"
			is InProgress -> activity.accessibilityValue
		}

	/** Reported install or update progress clamped to 0…100, or null for an indeterminate sweep. */
	fun reportedProgress(progress: Double?): Double? {
		if (this !is InProgress || !activity.usesReportedProgress || progress == null || !progress.isFinite()) return null
		return progress.coerceIn(0.0, 100.0)
	}

	companion object {
		fun from(state: String?): AppTilePresentation = when (state) {
			"ready" -> Available
			"stopped" -> Stopped
			"installing" -> InProgress(Activity.INSTALLING)
			"starting" -> InProgress(Activity.STARTING)
			"running" -> InProgress(Activity.RUNNING)
			"stopping" -> InProgress(Activity.STOPPING)
			"restarting" -> InProgress(Activity.RESTARTING)
			"uninstalling" -> InProgress(Activity.UNINSTALLING)
			"updating" -> InProgress(Activity.UPDATING)
			else -> Unavailable
		}
	}
}

/**
 * Whether tapping a tile can open the app. Lifecycle management stays in umbrelOS, so a
 * paused or offline app hands off there, and an app in transition ignores taps.
 */
enum class AppLaunchDisposition {
	AVAILABLE, PAUSED, OFFLINE, BUSY;

	companion object {
		fun from(state: String?): AppLaunchDisposition = when (state) {
			"ready", "running" -> AVAILABLE
			"stopped" -> PAUSED
			"installing", "starting", "stopping", "restarting", "uninstalling", "updating" -> BUSY
			else -> OFFLINE
		}
	}
}

/** The alerts an app tap can end in. */
sealed class AppLaunchAlert {
	data class Blocked(val app: Umbreld.AppSummary, val paused: Boolean) : AppLaunchAlert()
	data class TorOnly(val app: Umbreld.AppSummary) : AppLaunchAlert()
	/** The Umbrel didn't answer, or answered as a different Umbrel ([identityChanged]). */
	data class Unavailable(val identityChanged: Boolean = false) : AppLaunchAlert()

	val title: String
		get() = when (this) {
			is Blocked -> "${app.name ?: app.id} is ${if (paused) "Paused" else "Offline"}"
			is TorOnly -> "${app.name ?: app.id} Uses Tor"
			is Unavailable -> if (identityChanged) "Umbrel Not Recognized" else "Can’t Reach Umbrel"
		}

	fun message(canManageApps: Boolean): String = when (this) {
		is Blocked -> when {
			canManageApps && paused -> "Open Umbrel to start this app."
			canManageApps -> "Open Umbrel to restart or troubleshoot this app."
			paused -> "Ask the Umbrel owner to start this app."
			else -> "Ask the Umbrel owner to restart this app."
		}
		is TorOnly ->
			if (canManageApps) "This app is only available over Tor. Open Umbrel to view your Umbrel’s Tor address."
			else "This app is only available over Tor. Ask the owner for your Umbrel’s Tor address, then open Umbrel in Tor Browser."
		is Unavailable ->
			if (identityChanged) "This usually happens after your Umbrel or its certificate is reset. Reconnect your Umbrel from Home to keep using it in this app."
			else "Check your connection and try again."
	}

	/** The dashboard path an owner's "Open Umbrel" button goes to, or null for an OK-only alert. */
	fun ownerDestination(canManageApps: Boolean): String? = when {
		!canManageApps -> null
		this is Blocked -> ""
		this is TorOnly -> "/settings/advanced/tor"
		else -> null
	}
}

/** The sheets an app tap can present before the app opens. */
sealed class AppLaunchSheet {
	abstract val app: Umbreld.AppSummary

	/** [source] is the tile the app opens from once the sheet is answered. */
	data class Credentials(override val app: Umbreld.AppSummary, val source: Any? = null) : AppLaunchSheet()
}
