package com.umbrel.kit

import android.content.Context
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import java.io.File
import java.io.IOException
import java.util.UUID

/**
 * Saved devices persist as JSON in the app's private files directory. Native grants live
 * in [SecretStore], never in this file.
 */
class Config private constructor(
	savedDevices: Map<String, SavedDevice>,
	private val file: File,
	private val allowsWrites: Boolean = true,
) {
	enum class StorageIssue(val title: String, val description: String) {
		UNREADABLE(
			"Saved Umbrels Couldn’t Be Loaded",
			"Umbrel couldn’t read its saved-device settings and won’t overwrite them. Check that this device has available storage, then reopen the app.",
		),
		CORRUPT_QUARANTINED(
			"Saved Umbrels Couldn’t Be Loaded",
			"The damaged settings file was moved aside instead of being replaced. You can reconnect your Umbrels safely.",
		),
		CORRUPT_NOT_QUARANTINED(
			"Saved Umbrels Couldn’t Be Loaded",
			"Umbrel found a damaged settings file but couldn’t move it aside, so it won’t overwrite it. Check that this device has available storage, then reopen the app.",
		),
		SAVE_FAILED(
			"Umbrel Settings Couldn’t Be Saved",
			"Your change wasn’t saved. Check that this device has available storage, then try again.",
		),
	}

	class StorageException(val issue: StorageIssue) : Exception(issue.description)

	data class LoadResult(val config: Config, val issue: StorageIssue?)

	@Serializable
	private data class FileShape(val savedDevices: Map<String, SavedDevice> = emptyMap())

	private val lock = Any()

	@Volatile
	var savedDevices: Map<String, SavedDevice> = savedDevices
		private set

	fun save(device: SavedDevice) {
		synchronized(lock) {
			val updated = savedDevices + (device.id to device)
			flush(updated)
			savedDevices = updated
		}
	}

	fun remove(id: String) {
		synchronized(lock) {
			if (id !in savedDevices) return
			val updated = savedDevices - id
			flush(updated)
			savedDevices = updated
		}
	}

	/** Apply a mutation to a saved device, skipping the disk write when nothing changed. */
	fun update(id: String, mutate: (SavedDevice) -> SavedDevice) {
		synchronized(lock) {
			val device = savedDevices[id] ?: return
			val mutated = mutate(device)
			if (mutated == device) return
			val updated = savedDevices + (id to mutated)
			flush(updated)
			savedDevices = updated
		}
	}

	private fun flush(savedDevices: Map<String, SavedDevice>) {
		if (!allowsWrites) throw StorageException(StorageIssue.SAVE_FAILED)
		try {
			file.parentFile?.mkdirs()
			val json = json.encodeToString(FileShape.serializer(), FileShape(savedDevices.toSortedMap()))
			// Write to a sibling temp file and rename it into place so a crash mid-write
			// can't leave a truncated config behind.
			val temp = File(file.parentFile, ".config-${UUID.randomUUID()}.tmp")
			temp.writeText(json)
			if (!temp.renameTo(file)) {
				temp.delete()
				throw IOException("rename failed")
			}
		} catch (error: IOException) {
			throw StorageException(StorageIssue.SAVE_FAILED)
		} catch (error: SecurityException) {
			throw StorageException(StorageIssue.SAVE_FAILED)
		}
	}

	companion object {
		internal val json = Json {
			ignoreUnknownKeys = true
			encodeDefaults = false
			explicitNulls = false
			prettyPrint = true
		}

		fun defaultFile(context: Context): File = File(File(context.filesDir, "umbrel"), "config.json")

		fun load(context: Context): LoadResult = load(defaultFile(context))

		fun load(file: File): LoadResult {
			if (!file.exists()) return LoadResult(Config(emptyMap(), file), null)
			val text = try {
				file.readText()
			} catch (error: IOException) {
				return LoadResult(Config(emptyMap(), file, allowsWrites = false), StorageIssue.UNREADABLE)
			}
			return try {
				val shape = json.decodeFromString(FileShape.serializer(), text)
				LoadResult(Config(shape.savedDevices, file), null)
			} catch (error: IllegalArgumentException) {
				val quarantine = File(file.parentFile, "config.corrupt-${UUID.randomUUID()}.json")
				if (file.renameTo(quarantine)) {
					LoadResult(Config(emptyMap(), file), StorageIssue.CORRUPT_QUARANTINED)
				} else {
					LoadResult(Config(emptyMap(), file, allowsWrites = false), StorageIssue.CORRUPT_NOT_QUARANTINED)
				}
			}
		}
	}
}
