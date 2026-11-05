package com.umbrel.android

import android.content.Context
import androidx.core.content.edit
import com.umbrel.android.main.DeviceConnectionSnapshots
import com.umbrel.kit.Config
import com.umbrel.kit.SavedDevice
import com.umbrel.kit.SecretStore
import com.umbrel.kit.Umbreld
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.getAndUpdate
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

/**
 * Saved devices, the non-secret "selected device" pointer and which devices hold a session:
 * the app's routing input. Saved devices and their sessions are deliberately separate:
 * signing out keeps the Umbrel for an immediate sign-in, while removing it is its own action.
 */
class DeviceStore(context: Context) {
	private val prefs = context.applicationContext.getSharedPreferences("umbrel", Context.MODE_PRIVATE)
	private var config: Config
	private val _issue = MutableStateFlow<Config.StorageIssue?>(null)
	private val _devices = MutableStateFlow<List<SavedDevice>>(emptyList())
	private val _selectedDeviceId = MutableStateFlow(prefs.getString(KEY_SELECTED, "") ?: "")
	private val _signedIn = MutableStateFlow<Map<String, Boolean>?>(null)
	private val sessionReads = Mutex()

	val devices: StateFlow<List<SavedDevice>> = _devices
	val selectedDeviceId: StateFlow<String> = _selectedDeviceId
	val issue: StateFlow<Config.StorageIssue?> = _issue

	/**
	 * Whether each saved Umbrel has a session, null until the first read. Sessions are sealed
	 * with an Android Keystore key, and every read is a Keystore operation plus a file read,
	 * so they run on the IO dispatcher rather than during composition.
	 */
	val signedIn: StateFlow<Map<String, Boolean>?> = _signedIn

	/** Last confirmed reachability per Umbrel, handed between the device list and Home. */
	val connections = DeviceConnectionSnapshots()

	/** Umbrels being removed. Held here rather than by a screen, so a recreated screen still waits. */
	internal val removals = SavedDeviceRemovals()

	init {
		val loaded = Config.load(context)
		config = loaded.config
		_issue.value = loaded.issue
		_devices.value = loaded.config.savedDevices.values.sortedBy { it.id }
		// With nothing saved there is nothing to read, so first-run routing never waits.
		if (_devices.value.isEmpty()) _signedIn.value = emptyMap()
	}

	fun device(id: String): SavedDevice? = config.savedDevices[id]

	fun save(device: SavedDevice) = mutate { config.save(device) }

	fun update(id: String, mutate: (SavedDevice) -> SavedDevice) = mutate { config.update(id, mutate) }

	fun remove(id: String) = mutate { config.remove(id) }

	/**
	 * Persists a sign-in from the sheet. Reconnecting an account must not move photo backup
	 * away from another Umbrel, so only the account presentation changes. A failure is
	 * thrown to the sheet, which rolls the session back and shows it, rather than alerting.
	 */
	fun saveSignIn(deviceId: String, session: Umbreld.Session, account: Umbreld.Account?) {
		if (device(deviceId) == null) throw Config.StorageException(Config.StorageIssue.SAVE_FAILED)
		mutate(reportsIssue = false) { config.update(deviceId) { it.signedIn(session, account) } }
	}

	private fun mutate(reportsIssue: Boolean = true, block: () -> Unit) {
		try {
			block()
		} catch (error: Config.StorageException) {
			if (reportsIssue) _issue.value = error.issue
			throw error
		} finally {
			_devices.value = config.savedDevices.values.sortedBy { it.id }
		}
	}

	fun dismissIssue() {
		_issue.value = null
	}

	fun select(id: String) {
		prefs.edit { putString(KEY_SELECTED, id) }
		_selectedDeviceId.value = id
	}

	/**
	 * Re-reads every saved Umbrel's session. Reads are serialized, so whichever finishes last
	 * also read last and reflects the newest stored state.
	 */
	suspend fun refreshSessions() {
		sessionReads.withLock {
			val ids = _devices.value.map { it.id }
			_signedIn.value = withContext(Dispatchers.IO) { ids.associateWith { SecretStore.readSession(it).isSignedIn } }
		}
	}

	/** Reads one Umbrel's session and publishes whether it is signed in. */
	suspend fun readSession(deviceId: String): SecretStore.SessionReadResult = sessionReads.withLock {
		val read = withContext(Dispatchers.IO) { SecretStore.readSession(deviceId) }
		_signedIn.update { it.orEmpty() + (deviceId to read.isSignedIn) }
		read
	}

	suspend fun refreshSession(deviceId: String): Boolean = readSession(deviceId).isSignedIn

	/** The session for a screen that is opening; a blocking read, like the rest of its setup. */
	fun session(deviceId: String): Umbreld.Session? = SecretStore.readSession(deviceId).sessionOrCached

	companion object {
		private const val KEY_SELECTED = "selectedDeviceId"
	}
}

/**
 * A transient secret-store failure must not masquerade as sign-out: Found and Unavailable
 * both count as signed in; only Missing and Invalid route to the sign-in sheet.
 */
internal val SecretStore.SessionReadResult.isSignedIn: Boolean
	get() = this is SecretStore.SessionReadResult.Found || this is SecretStore.SessionReadResult.Unavailable

/**
 * The account presentation after a sign-in: the account picked in the sheet when it is the
 * one that signed in, else the profile already saved for that account, else only the
 * picker preference.
 */
internal fun SavedDevice.signedIn(session: Umbreld.Session, account: Umbreld.Account?): SavedDevice {
	if (account != null && account.userId == session.accountId) {
		return saveAccountProfile(
			accountId = account.userId,
			name = account.name,
			wallpaperId = account.wallpaper.id,
			wallpaperBrandColorHsl = account.wallpaper.brandColorHsl,
			role = if (account.userId == "0") "owner" else "member",
		)
	}
	val profile = accountProfile(session.accountId) ?: return copy(lastAccountId = session.accountId)
	return saveAccountProfile(session.accountId, profile.name, profile.wallpaperId, profile.wallpaperBrandColorHsl, profile.role)
}

/** Removing one saved Umbrel, step by step, in the order [SavedDeviceRemovals.remove] runs them. */
internal interface SavedDeviceRemovalSteps {
	/** Writes the config without it. A [Config.StorageException] stops before anything else changes. */
	fun removeSaved()

	fun removeBackup()

	/** Ends its browser session on the Umbrel, which needs the pinned certificate. Best effort. */
	suspend fun signOutBrowser()

	/** Ends its native session on the Umbrel, which needs the pinned certificate. Best effort. */
	suspend fun logOut()

	suspend fun deleteSession()

	suspend fun forgetCertificate()

	suspend fun deleteData()

	/** Forgets its last connection check and the selection, as iOS does once it's removed. */
	fun deselect()
}

/**
 * Saved Umbrels being removed. One leaves the config first, but its sessions and pinned
 * certificate go after that, in the app's scope. Until they're gone it stays in
 * [State.removing], and as on iOS, the screen that asked keeps showing it. Adding it again
 * meanwhile would have the old removal delete the new pairing's session and certificate.
 */
internal class SavedDeviceRemovals {
	data class State(
		/** Each Umbrel being removed, as it was saved. */
		val removing: Map<String, SavedDevice> = emptyMap(),
		/** Reconnect removed its Umbrel: adding an Umbrel opens, once. */
		val addsDevice: Boolean = false,
	) {
		/** The saved Umbrels as the screens show them: one being removed stays until it's gone. */
		fun shown(devices: List<SavedDevice>): List<SavedDevice> {
			val leaving = removing.values.filter { removed -> devices.none { it.id == removed.id } }
			return if (leaving.isEmpty()) devices else (devices + leaving).sortedBy { it.id }
		}
	}

	private val _state = MutableStateFlow(State())
	val state: StateFlow<State> = _state

	/**
	 * Runs [steps] in order: the config first, then the sessions are revoked over the pinned
	 * certificate before it's forgotten. Everything after the config runs in [scope], so it
	 * finishes even if the screen that asked closes or is recreated; with [addsDevice], adding
	 * an Umbrel opens in the same update that ends the wait. The selection is cleared after
	 * that update, so the screen that asked never gives way to the list first. Returns false
	 * when the config couldn't be written, which DeviceStore reports as a storage issue;
	 * otherwise returns once every step has run, or when the caller is cancelled. A second
	 * request for an Umbrel already being removed returns straight away.
	 */
	suspend fun remove(device: SavedDevice, scope: CoroutineScope, addsDevice: Boolean, steps: SavedDeviceRemovalSteps): Boolean {
		val before = _state.getAndUpdate { if (device.id in it.removing) it else it.copy(removing = it.removing + (device.id to device)) }
		if (device.id in before.removing) return true
		try {
			steps.removeSaved()
		} catch (failure: Config.StorageException) {
			_state.update { it.copy(removing = it.removing - device.id) }
			return false
		}
		scope.launch {
			var removed = false
			try {
				steps.removeBackup()
				steps.signOutBrowser()
				steps.logOut()
				steps.deleteSession()
				steps.forgetCertificate()
				steps.deleteData()
				removed = true
			} finally {
				_state.update { State(it.removing - device.id, it.addsDevice || (removed && addsDevice)) }
			}
			steps.deselect()
		}.join()
		return true
	}

	/** Adding an Umbrel opened. */
	fun addDeviceOpened() {
		_state.update { it.copy(addsDevice = false) }
	}
}
