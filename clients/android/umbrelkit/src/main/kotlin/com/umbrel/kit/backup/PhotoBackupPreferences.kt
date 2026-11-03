package com.umbrel.kit.backup

import android.content.Context
import android.content.SharedPreferences
import androidx.core.content.edit
import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/**
 * User intent can outlive a session, but it belongs to one account on one Umbrel. The
 * worker's configuration stays singular; the active target records which saved
 * preference is currently allowed to drive it.
 */
@Serializable
data class PhotoBackupTarget(val deviceId: String, val accountId: String)

@Serializable
data class PhotoBackupPreference(
	val includesPhotos: Boolean = false,
	val includesVideos: Boolean = false,
	val allowsCellular: Boolean = false,
	/** Folder keys from [PhotoBackupFolders.key]; any folder not listed is backed up. */
	val skippedFolders: Set<String> = emptySet(),
	/**
	 * Whether the user has been through the folder choice that comes with turning backup on.
	 * Until then, backup with access to all photos waits, so nothing uploads before a folder
	 * could be skipped.
	 */
	val foldersChosen: Boolean = false,
) {
	val isEnabled: Boolean get() = includesPhotos || includesVideos
}

/**
 * Backup intent, the worker's pinned configuration, its last published snapshot, and the
 * one-shot retry requests the app hands to the worker. Stored as JSON in a private
 * SharedPreferences file that is excluded from device backups (the ledger it describes
 * holds device-specific MediaStore ids). Grants and source ids live in SecretStore.
 */
class PhotoBackupPreferences(context: Context) {
	private val prefs: SharedPreferences = context.applicationContext.getSharedPreferences(FILE_NAME, Context.MODE_PRIVATE)

	sealed class ConfigurationRead {
		data class Found(val configuration: PhotoBackupConfiguration) : ConfigurationRead()
		data object Missing : ConfigurationRead()
		data object Unavailable : ConfigurationRead()
	}

	@Serializable
	private data class State(
		val preferences: Map<String, Map<String, PhotoBackupPreference>> = emptyMap(),
		val activeTarget: PhotoBackupTarget? = null,
		/** The new-phone question left unanswered, per Umbrel and account: the existing source it names. */
		val newSourceQuestions: Map<String, Map<String, String>> = emptyMap(),
	)

	// ── Intent ──

	fun preference(deviceId: String, accountId: String): PhotoBackupPreference =
		state().preferences[deviceId]?.get(accountId) ?: PhotoBackupPreference()

	/** Enabling with [activate] claims the active target; disabling the active target releases it. */
	fun save(preference: PhotoBackupPreference, deviceId: String, accountId: String, activate: Boolean) {
		val state = state()
		val accounts = (state.preferences[deviceId] ?: emptyMap()) + (accountId to preference)
		val target = PhotoBackupTarget(deviceId, accountId)
		val active = when {
			activate && preference.isEnabled -> target
			!preference.isEnabled && state.activeTarget == target -> null
			else -> state.activeTarget
		}
		write(state.copy(preferences = state.preferences + (deviceId to accounts), activeTarget = active))
	}

	fun isActive(deviceId: String, accountId: String): Boolean = state().activeTarget == PhotoBackupTarget(deviceId, accountId)

	val activeTarget: PhotoBackupTarget?
		get() = state().activeTarget

	/**
	 * A live configuration proves which account currently owns the worker. Repair only that
	 * pointer after an interrupted handoff; the saved media choices stay untouched.
	 */
	fun reconcileActiveTarget(deviceId: String, accountId: String) {
		val state = state()
		val target = PhotoBackupTarget(deviceId, accountId)
		if (state.preferences[deviceId]?.get(accountId)?.isEnabled != true || state.activeTarget == target) return
		write(state.copy(activeTarget = target))
	}

	fun removeDevice(deviceId: String) {
		val state = state()
		write(
			state.copy(
				preferences = state.preferences - deviceId,
				activeTarget = state.activeTarget?.takeIf { it.deviceId != deviceId },
				newSourceQuestions = state.newSourceQuestions - deviceId,
			),
		)
	}

	/**
	 * Setup stopped before starting a new source because the account already has phone
	 * backups. The question is kept until answered, so every launch gives the same reason.
	 */
	fun newSourceQuestion(deviceId: String, accountId: String): String? = state().newSourceQuestions[deviceId]?.get(accountId)

	fun setNewSourceQuestion(existing: String?, deviceId: String, accountId: String) {
		val state = state()
		val accounts = state.newSourceQuestions[deviceId] ?: emptyMap()
		if (accounts[accountId] == existing) return
		val updated = if (existing != null) accounts + (accountId to existing) else accounts - accountId
		write(state.copy(newSourceQuestions = if (updated.isEmpty()) state.newSourceQuestions - deviceId else state.newSourceQuestions + (deviceId to updated)))
	}

	private fun state(): State = decode(State.serializer(), prefs.getString(KEY_PREFERENCES, null)) ?: State()

	private fun write(state: State) {
		prefs.edit { putString(KEY_PREFERENCES, json.encodeToString(State.serializer(), state)) }
	}

	// ── Worker configuration ──

	fun configurationRead(): ConfigurationRead {
		val stored = prefs.getString(KEY_CONFIGURATION, null) ?: return ConfigurationRead.Missing
		val configuration = decode(PhotoBackupConfiguration.serializer(), stored) ?: return ConfigurationRead.Unavailable
		return ConfigurationRead.Found(configuration)
	}

	val configuration: PhotoBackupConfiguration?
		get() = (configurationRead() as? ConfigurationRead.Found)?.configuration

	/** Written synchronously. */
	fun save(configuration: PhotoBackupConfiguration): Boolean =
		prefs.edit().putString(KEY_CONFIGURATION, json.encodeToString(PhotoBackupConfiguration.serializer(), configuration)).commit()

	/**
	 * Turning backup off must not make completed backup history disappear, so the disabled
	 * snapshot keeps the source-scoped totals.
	 */
	fun clearConfiguration() {
		val previous = snapshot
		prefs.edit(commit = true) {
			remove(KEY_CONFIGURATION)
			remove(KEY_STORAGE_RETRY)
			remove(KEY_RECOVERY_RETRY)
		}
		publish(PhotoBackupSnapshot(PhotoBackupPhase.DISABLED, updatedAtMs = System.currentTimeMillis(), sourceId = previous.sourceId, statistics = previous.statistics))
	}

	// ── Snapshot ──

	val snapshot: PhotoBackupSnapshot
		get() = decode(PhotoBackupSnapshot.serializer(), prefs.getString(KEY_SNAPSHOT, null)) ?: PhotoBackupSnapshot.DISABLED

	fun publish(snapshot: PhotoBackupSnapshot) {
		prefs.edit { putString(KEY_SNAPSHOT, json.encodeToString(PhotoBackupSnapshot.serializer(), snapshot)) }
	}

	// ── One-shot requests from the app to the worker ──

	/** Insufficient storage is retried only after an explicit request, never automatically. */
	fun requestStorageRetry(sourceId: String): Boolean = prefs.edit().putString(KEY_STORAGE_RETRY, sourceId).commit()

	fun storageRetryRequested(sourceId: String): Boolean = prefs.getString(KEY_STORAGE_RETRY, null) == sourceId

	fun clearStorageRetryRequest() = prefs.edit(commit = true) { remove(KEY_STORAGE_RETRY) }

	/** The worker acknowledges this source-scoped request after it requeues failed resources. */
	fun requestRecoveryRetry(sourceId: String): Boolean = prefs.edit().putString(KEY_RECOVERY_RETRY, sourceId).commit()

	fun recoveryRetryRequested(sourceId: String): Boolean = prefs.getString(KEY_RECOVERY_RETRY, null) == sourceId

	/** Clears the request only if it still belongs to [sourceId]. */
	fun clearRecoveryRetryRequest(sourceId: String): Boolean {
		if (prefs.getString(KEY_RECOVERY_RETRY, null) != sourceId) return false
		return prefs.edit().remove(KEY_RECOVERY_RETRY).commit()
	}

	/**
	 * Android stops showing the permission dialog after repeated denials. Together with
	 * shouldShowRequestPermissionRationale this tells a first request from one that needs
	 * Settings.
	 */
	var libraryPermissionRequested: Boolean
		get() = prefs.getBoolean(KEY_LIBRARY_PERMISSION_REQUESTED, false)
		set(value) = prefs.edit { putBoolean(KEY_LIBRARY_PERMISSION_REQUESTED, value) }

	fun registerListener(listener: SharedPreferences.OnSharedPreferenceChangeListener) =
		prefs.registerOnSharedPreferenceChangeListener(listener)

	fun unregisterListener(listener: SharedPreferences.OnSharedPreferenceChangeListener) =
		prefs.unregisterOnSharedPreferenceChangeListener(listener)

	private fun <T> decode(serializer: KSerializer<T>, value: String?): T? {
		if (value == null) return null
		// SerializationException is an IllegalArgumentException.
		return try {
			json.decodeFromString(serializer, value)
		} catch (error: IllegalArgumentException) {
			null
		}
	}

	companion object {
		const val FILE_NAME = "photo_backup"
		const val KEY_PREFERENCES = "photoBackupPreferences.v1"
		const val KEY_CONFIGURATION = "photoBackupConfiguration.v1"
		const val KEY_SNAPSHOT = "photoBackupSnapshot.v1"
		const val KEY_STORAGE_RETRY = "photoBackupStorageRetry.v1"
		const val KEY_RECOVERY_RETRY = "photoBackupRecoveryRetry.v1"
		const val KEY_LIBRARY_PERMISSION_REQUESTED = "photoLibraryPermissionRequested.v1"

		private val json = Json { ignoreUnknownKeys = true; explicitNulls = false }
	}
}
