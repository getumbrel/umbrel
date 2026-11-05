package com.umbrel.kit.backup

import android.Manifest
import android.content.ContentResolver
import android.content.ContentUris
import android.content.Context
import android.content.pm.PackageManager
import android.database.Cursor
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.MediaStore
import androidx.core.content.ContextCompat
import androidx.core.net.toUri
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import java.io.Closeable
import java.io.FileNotFoundException
import java.io.IOException
import java.io.InputStream

/**
 * What the photo permission currently allows. Android 14 lets the user grant only the
 * photos and videos they select; MediaStore then returns just that selection.
 */
enum class PhotoLibraryAccess {
	NONE, SELECTED, FULL;

	val canReadLibrary: Boolean get() = this != NONE
}

/**
 * MediaStore's change cursor: an opaque version and a monotonically increasing generation
 * per external volume, plus the photo access that decided which rows were visible. A
 * changed version (or a volume appearing or disappearing) means the generations were
 * reset. Access changes make rows visible or hidden without changing their generation.
 * Either one requires a full inventory.
 */
@Serializable
data class LibraryChangeToken(
	val volumes: Map<String, Volume>,
	val access: PhotoLibraryAccess = PhotoLibraryAccess.NONE,
	/** The granted permissions that decide visibility, so a newly granted video permission counts too. */
	val permissions: Set<String> = emptySet(),
) {
	@Serializable
	data class Volume(val version: String, val generation: Long)

	/** Whether rows changed since [stored] can be read incrementally from its generations. */
	fun continues(stored: LibraryChangeToken): Boolean =
		access == stored.access && permissions == stored.permissions && volumes.keys == stored.volumes.keys &&
			volumes.all { (name, volume) -> stored.volumes[name]?.version == volume.version }

	fun encoded(): String = json.encodeToString(serializer(), this)

	companion object {
		private val json = Json { ignoreUnknownKeys = true }

		fun decode(value: String): LibraryChangeToken? = try {
			json.decodeFromString(serializer(), value)
		} catch (error: IllegalArgumentException) {
			null
		}
	}
}

sealed class LibraryChange {
	data class Upsert(val candidate: PhotoBackupLedger.AssetCandidate) : LibraryChange()

	/** Deleted, trashed, or still being written by its owner: not something to back up. */
	data class Removal(val localIdentifier: String) : LibraryChange()
}

class LibraryResource(val displayName: String, val mimeType: String, val takenAtMs: Long?)

/** What MediaStore reports for one item when it is looked up by id. */
sealed class ResourceLookup {
	data class Found(val resource: LibraryResource) : ResourceLookup()

	/** MediaStore has no row for the item, or the row is trashed or still being written. */
	data object Removed : ResourceLookup()

	/** MediaStore couldn't answer, for example while photo access is changing. */
	data object Unavailable : ResourceLookup()
}

/** One page of a full inventory. [next] is the id the following page starts below, null after the last page. */
class InventoryPage(val candidates: List<PhotoBackupLedger.AssetCandidate>, val next: Long?)

/** MediaStore refused the original bytes because ACCESS_MEDIA_LOCATION isn't granted. */
class LocationAccessRequiredException : IOException("Location access is required to read the original")

/** An open source file with its real length, read from the descriptor rather than the MediaStore row. */
class OpenedResource(val length: Long, val stream: InputStream) : Closeable {
	override fun close() = stream.close()
}

/** The MediaStore surface the engine uses; a seam so JVM tests can supply a library. */
interface PhotoBackupLibrary {
	val access: PhotoLibraryAccess

	/** Whether MediaStore serves the location stored in photos and videos (ACCESS_MEDIA_LOCATION). */
	val canReadLocation: Boolean

	fun changeToken(): LibraryChangeToken

	/** Up to [limit] visible items of [mediaType] with ids below [before] (or any id when null), highest id first. */
	fun assets(mediaType: Long, before: Long?, limit: Int): InventoryPage

	/** Items of [mediaType] on [volume] added or modified after [generation], including trashed and pending ones. */
	fun <T> changes(volume: String, mediaType: Long, generation: Long, block: (Sequence<LibraryChange>) -> T): T

	fun count(mediaType: Long): Long

	/**
	 * Looks the item up including trashed and pending rows, so only [ResourceLookup.Removed]
	 * is evidence that it left the library.
	 */
	fun resource(localIdentifier: String): ResourceLookup

	/**
	 * Opens the original bytes, never a copy with the location removed. Throws
	 * [LocationAccessRequiredException] when MediaStore won't serve the original, and
	 * [FileNotFoundException] or [SecurityException] when the item can't be read.
	 */
	fun open(localIdentifier: String): OpenedResource
}

/**
 * Backup sees only what is on this phone. Items Google Photos removed with "Free up space",
 * or that were only ever in Google Photos, aren't in MediaStore, and since March 2025 Google's
 * Photos API lets other apps read only items the user picks. A whole library would come
 * from a Google Takeout import on the Umbrel.
 */
class MediaStoreLibrary(context: Context) : PhotoBackupLibrary {
	private val appContext = context.applicationContext
	private val resolver: ContentResolver = appContext.contentResolver

	override val access: PhotoLibraryAccess
		get() = libraryAccess(appContext)

	override fun changeToken(): LibraryChangeToken = LibraryChangeToken(
		// getVersion and getGeneration accept only the specific volume names, not VOLUME_EXTERNAL.
		volumes = MediaStore.getExternalVolumeNames(appContext).associateWith { volume ->
			LibraryChangeToken.Volume(MediaStore.getVersion(appContext, volume), MediaStore.getGeneration(appContext, volume))
		},
		access = libraryAccess(appContext),
		// Location access changes what an item's bytes contain, not which items are visible.
		permissions = permissions().filterTo(HashSet()) { it != Manifest.permission.ACCESS_MEDIA_LOCATION && granted(appContext, it) },
	)

	/**
	 * A cursor over a whole collection is not a snapshot: every window refill reruns the
	 * query at an offset, so a row deleted ahead of the read position shifts the rest and one
	 * is skipped. Pages bounded by _id, which MediaStore never reuses, can't shift.
	 */
	override fun assets(mediaType: Long, before: Long?, limit: Int): InventoryPage {
		val arguments = Bundle().apply {
			if (before != null) {
				putString(ContentResolver.QUERY_ARG_SQL_SELECTION, "${MediaStore.MediaColumns._ID} < ?")
				putStringArray(ContentResolver.QUERY_ARG_SQL_SELECTION_ARGS, arrayOf(before.toString()))
			}
			putString(ContentResolver.QUERY_ARG_SQL_SORT_ORDER, "${MediaStore.MediaColumns._ID} DESC")
			putInt(ContentResolver.QUERY_ARG_LIMIT, limit)
		}
		val cursor = resolver.query(collection(MediaStore.VOLUME_EXTERNAL, mediaType), CANDIDATE_PROJECTION, arguments, null)
			?: throw IOException("MediaStore returned no cursor")
		return cursor.use {
			val rows = candidates(it, mediaType).toList()
			InventoryPage(rows.map { row -> row.candidate }, rows.lastOrNull()?.id?.takeIf { rows.size == limit })
		}
	}

	override fun <T> changes(volume: String, mediaType: Long, generation: Long, block: (Sequence<LibraryChange>) -> T): T {
		val arguments = Bundle().apply {
			putString(
				ContentResolver.QUERY_ARG_SQL_SELECTION,
				"${MediaStore.MediaColumns.GENERATION_MODIFIED} > ? OR ${MediaStore.MediaColumns.GENERATION_ADDED} > ?",
			)
			putStringArray(ContentResolver.QUERY_ARG_SQL_SELECTION_ARGS, arrayOf(generation.toString(), generation.toString()))
			// Trashed and pending rows are filtered out by default, which would hide a move to
			// the trash from an incremental pass.
			putInt(MediaStore.QUERY_ARG_MATCH_TRASHED, MediaStore.MATCH_INCLUDE)
			putInt(MediaStore.QUERY_ARG_MATCH_PENDING, MediaStore.MATCH_INCLUDE)
		}
		val cursor = resolver.query(collection(volume, mediaType), CANDIDATE_PROJECTION, arguments, null)
			?: throw IOException("MediaStore returned no cursor")
		return cursor.use {
			block(
				candidates(it, mediaType).map { row ->
					if (row.removed) LibraryChange.Removal(row.candidate.localIdentifier) else LibraryChange.Upsert(row.candidate)
				},
			)
		}
	}

	override fun count(mediaType: Long): Long =
		resolver.query(collection(MediaStore.VOLUME_EXTERNAL, mediaType), arrayOf(MediaStore.MediaColumns._ID), null, null)?.use { it.count.toLong() }
			?: throw IOException("MediaStore returned no cursor")

	override fun resource(localIdentifier: String): ResourceLookup {
		val projection = arrayOf(
			MediaStore.MediaColumns.DISPLAY_NAME,
			MediaStore.MediaColumns.MIME_TYPE,
			MediaStore.MediaColumns.DATE_TAKEN,
			MediaStore.MediaColumns.IS_TRASHED,
			MediaStore.MediaColumns.IS_PENDING,
			MediaStore.MediaColumns.DATE_MODIFIED,
		)
		val arguments = Bundle().apply {
			putInt(MediaStore.QUERY_ARG_MATCH_TRASHED, MediaStore.MATCH_INCLUDE)
			putInt(MediaStore.QUERY_ARG_MATCH_PENDING, MediaStore.MATCH_INCLUDE)
		}
		val cursor = try {
			resolver.query(localIdentifier.toUri(), projection, arguments, null)
		} catch (error: SecurityException) {
			null
		} ?: return ResourceLookup.Unavailable
		return cursor.use {
			if (!it.moveToFirst()) return ResourceLookup.Removed
			if (it.getInt(3) != 0 || it.getInt(4) != 0) return ResourceLookup.Removed
			ResourceLookup.Found(
				LibraryResource(
					displayName = it.getString(0) ?: "item",
					mimeType = it.getString(1) ?: "application/octet-stream",
					takenAtMs = capturedAtMs(it.getLong(2), it.getLong(5), addedSeconds = 0).takeIf { taken -> taken > 0 },
				),
			)
		}
	}

	override val canReadLocation: Boolean
		get() = locationAccess(appContext)

	/**
	 * Opens the exact bytes on disk. setRequireOriginal stops MediaStore from removing the
	 * location, and MediaStore refuses it with UnsupportedOperationException instead of
	 * serving redacted bytes. EXTRA_ACCEPT_ORIGINAL_MEDIA_FORMAT stops Android 12 and later
	 * from transcoding HEVC or HDR video for this app, which setRequireOriginal alone
	 * doesn't; earlier versions don't transcode.
	 */
	override fun open(localIdentifier: String): OpenedResource {
		val uri = MediaStore.setRequireOriginal(localIdentifier.toUri())
		val options = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
			Bundle().apply { putBoolean(MediaStore.EXTRA_ACCEPT_ORIGINAL_MEDIA_FORMAT, true) }
		} else {
			null
		}
		val asset = try {
			resolver.openTypedAssetFileDescriptor(uri, "*/*", options)
		} catch (error: UnsupportedOperationException) {
			throw LocationAccessRequiredException()
		} ?: throw FileNotFoundException(localIdentifier)
		// MediaStore's SIZE column can be stale after an in-place edit; stat the descriptor.
		val length = if (asset.length >= 0) asset.length else asset.parcelFileDescriptor.statSize - asset.startOffset
		if (length < 0) {
			asset.close()
			throw IOException("The item isn't a regular file")
		}
		return OpenedResource(length, asset.createInputStream())
	}

	private class Row(val id: Long, val candidate: PhotoBackupLedger.AssetCandidate, val removed: Boolean)

	private fun candidates(cursor: Cursor, mediaType: Long): Sequence<Row> {
		val id = cursor.getColumnIndexOrThrow(MediaStore.MediaColumns._ID)
		val taken = cursor.getColumnIndexOrThrow(MediaStore.MediaColumns.DATE_TAKEN)
		val modified = cursor.getColumnIndexOrThrow(MediaStore.MediaColumns.DATE_MODIFIED)
		val added = cursor.getColumnIndexOrThrow(MediaStore.MediaColumns.DATE_ADDED)
		val size = cursor.getColumnIndexOrThrow(MediaStore.MediaColumns.SIZE)
		val generationModified = cursor.getColumnIndexOrThrow(MediaStore.MediaColumns.GENERATION_MODIFIED)
		val generationAdded = cursor.getColumnIndexOrThrow(MediaStore.MediaColumns.GENERATION_ADDED)
		val trashed = cursor.getColumnIndexOrThrow(MediaStore.MediaColumns.IS_TRASHED)
		val pending = cursor.getColumnIndexOrThrow(MediaStore.MediaColumns.IS_PENDING)
		val relativePath = cursor.getColumnIndexOrThrow(MediaStore.MediaColumns.RELATIVE_PATH)
		// Identifiers always use the VOLUME_EXTERNAL collection: ids are unique across
		// external volumes, and the app's library grid looks receipts up by the same URI.
		val base = collection(MediaStore.VOLUME_EXTERNAL, mediaType)
		return generateSequence { if (cursor.moveToNext()) cursor else null }.map {
			Row(
				it.getLong(id),
				PhotoBackupLedger.AssetCandidate(
					localIdentifier = ContentUris.withAppendedId(base, it.getLong(id)).toString(),
					mediaType = mediaType,
					creationDateMs = capturedAtMs(it.getLong(taken), it.getLong(modified), it.getLong(added)),
					size = if (it.isNull(size)) 0 else it.getLong(size),
					generation = maxOf(it.getLong(generationModified), it.getLong(generationAdded)),
					folder = PhotoBackupFolders.key(it.getString(relativePath)),
				),
				removed = it.getInt(trashed) != 0 || it.getInt(pending) != 0,
			)
		}
	}

	companion object {
		/**
		 * When an item was taken, dated as the system photo picker dates it: MediaStore's
		 * DATE_TAKEN, else DATE_MODIFIED, else DATE_ADDED (0 for unknown). Android leaves
		 * DATE_TAKEN null when it can't place the EXIF time in a time zone, for example for
		 * photos copied from a computer, and DATE_ADDED would then date a whole copied library
		 * to the day it was copied.
		 */
		fun capturedAtMs(takenMs: Long, modifiedSeconds: Long, addedSeconds: Long): Long = when {
			takenMs > 0 -> takenMs
			modifiedSeconds > 0 -> modifiedSeconds * 1000
			else -> maxOf(0L, addedSeconds) * 1000
		}

		private val CANDIDATE_PROJECTION = arrayOf(
			MediaStore.MediaColumns._ID,
			MediaStore.MediaColumns.DATE_TAKEN,
			MediaStore.MediaColumns.DATE_MODIFIED,
			MediaStore.MediaColumns.DATE_ADDED,
			MediaStore.MediaColumns.SIZE,
			MediaStore.MediaColumns.GENERATION_MODIFIED,
			MediaStore.MediaColumns.GENERATION_ADDED,
			MediaStore.MediaColumns.IS_TRASHED,
			MediaStore.MediaColumns.IS_PENDING,
			MediaStore.MediaColumns.RELATIVE_PATH,
		)

		private fun collection(volume: String, mediaType: Long): Uri =
			if (mediaType == PhotoBackupLedger.MEDIA_TYPE_VIDEO) MediaStore.Video.Media.getContentUri(volume) else MediaStore.Images.Media.getContentUri(volume)

		/**
		 * The documented check for full and partial access: either media permission is full
		 * access on Android 13+, READ_MEDIA_VISUAL_USER_SELECTED alone is a selection on 14+.
		 */
		private fun granted(context: Context, permission: String) =
			ContextCompat.checkSelfPermission(context, permission) == PackageManager.PERMISSION_GRANTED

		fun locationAccess(context: Context): Boolean = granted(context, Manifest.permission.ACCESS_MEDIA_LOCATION)

		fun libraryAccess(context: Context): PhotoLibraryAccess = when {
			Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
				(granted(context, Manifest.permission.READ_MEDIA_IMAGES) || granted(context, Manifest.permission.READ_MEDIA_VIDEO)) -> PhotoLibraryAccess.FULL
			Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE &&
				granted(context, Manifest.permission.READ_MEDIA_VISUAL_USER_SELECTED) -> PhotoLibraryAccess.SELECTED
			Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU && granted(context, Manifest.permission.READ_EXTERNAL_STORAGE) -> PhotoLibraryAccess.FULL
			else -> PhotoLibraryAccess.NONE
		}

		/** One request covers the library and the location metadata stored in it. */
		fun permissions(): Array<String> = when {
			Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE -> arrayOf(
				Manifest.permission.READ_MEDIA_IMAGES,
				Manifest.permission.READ_MEDIA_VIDEO,
				Manifest.permission.READ_MEDIA_VISUAL_USER_SELECTED,
				Manifest.permission.ACCESS_MEDIA_LOCATION,
			)
			Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU -> arrayOf(
				Manifest.permission.READ_MEDIA_IMAGES,
				Manifest.permission.READ_MEDIA_VIDEO,
				Manifest.permission.ACCESS_MEDIA_LOCATION,
			)
			else -> arrayOf(Manifest.permission.READ_EXTERNAL_STORAGE, Manifest.permission.ACCESS_MEDIA_LOCATION)
		}
	}
}
