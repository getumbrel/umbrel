package com.umbrel.android.main

import com.umbrel.kit.Umbreld
import kotlinx.serialization.SerializationException
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import java.io.File
import java.io.IOException
import java.security.MessageDigest
import java.util.UUID

/** The data Home renders, cached per device and account. */
@Serializable
data class DeviceDataSnapshot(
	val apps: List<Umbreld.AppSummary>,
	val disk: Umbreld.DiskUsage? = null,
	val favoritePaths: List<String>,
	val updatableApps: List<String>,
)

/**
 * A stale-while-revalidate snapshot of the data Home renders, isolated by account. Written
 * after every load that changed it and read when a device opens, so Home paints its last
 * known content on the first frame, offline included, and skeletons only show when there
 * is no snapshot yet. The cache is disposable, so failures read as "no snapshot".
 */
class DeviceDataStore(private val directory: File) {
	private val json = Json {
		ignoreUnknownKeys = true
		explicitNulls = false
	}

	fun load(deviceId: String, accountId: String): DeviceDataSnapshot? = try {
		json.decodeFromString(DeviceDataSnapshot.serializer(), file(deviceId, accountId).readText())
	} catch (error: IOException) {
		null
	} catch (error: SerializationException) {
		null
	} catch (error: IllegalArgumentException) {
		null
	}

	/** Default app credentials stay on the Umbrel; launching an app always refetches them. */
	fun save(snapshot: DeviceDataSnapshot, deviceId: String, accountId: String) {
		val cached = snapshot.copy(apps = snapshot.apps.map { it.withoutCredentials })
		val target = file(deviceId, accountId)
		try {
			target.parentFile?.mkdirs()
			val temp = File(target.parentFile, ".${target.name}-${UUID.randomUUID()}.tmp")
			temp.writeText(json.encodeToString(DeviceDataSnapshot.serializer(), cached))
			if (!temp.renameTo(target)) temp.delete()
		} catch (error: IOException) {
			// A failed write leaves the previous snapshot, which the next load replaces.
		}
	}

	fun delete(deviceId: String) {
		File(directory, cacheKey(deviceId)).deleteRecursively()
	}

	private fun file(deviceId: String, accountId: String): File =
		File(File(directory, cacheKey(deviceId)), "${cacheKey(accountId)}.json")

	// Device and account ids arrive from a remote endpoint. Hashing gives every value one
	// flat, fixed-width file name instead of interpreting separators or dot segments.
	private fun cacheKey(value: String): String =
		MessageDigest.getInstance("SHA-256").digest(value.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }
}
