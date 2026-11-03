package com.umbrel.android.main

import android.Manifest
import android.content.ContentResolver
import android.content.ContentUris
import android.content.Context
import android.content.pm.PackageManager
import android.database.Cursor
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.provider.MediaStore
import androidx.core.content.ContextCompat
import androidx.exifinterface.media.ExifInterface
import com.umbrel.kit.backup.MediaStoreLibrary
import com.umbrel.kit.backup.PhotoBackupFolders
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.util.Locale
import kotlin.math.roundToLong

/**
 * One item of the phone's photo library. MediaStore stays the owner of the collection;
 * this is the row the Library grid and viewer render.
 */
data class LocalMediaItem(
	val id: Long,
	val isVideo: Boolean,
	val takenAtMs: Long,
	val durationMs: Long?,
	// Pixel size as displayed, after the item's rotation.
	val width: Int,
	val height: Int,
	// MediaStore's GENERATION_MODIFIED: changes whenever the item is edited.
	val generation: Long,
	// MediaStore's RELATIVE_PATH ("DCIM/Camera/"), and its key for backup's folder choice.
	val folderPath: String? = null,
	val folder: String = PhotoBackupFolders.key(folderPath),
) {
	val uri: Uri get() = ContentUris.withAppendedId(if (isVideo) PhotoLibrary.videos else PhotoLibrary.images, id)

	/** The backup ledger key: the MediaStore content URI string. */
	val localIdentifier: String get() = uri.toString()
}

/**
 * The library in chronological order, oldest first so the newest sit at the bottom like
 * Photos. [revision] increases with every reload so views can tell a new result apart.
 */
class PhotoLibraryAssets(val items: List<LocalMediaItem>, val revision: Int) {
	val size: Int get() = items.size

	fun indexOf(localIdentifier: String): Int = items.indexOfFirst { it.localIdentifier == localIdentifier }

	companion object {
		val Empty = PhotoLibraryAssets(emptyList(), 0)
	}
}

/** The details the viewer's info sheet adds to a grid row. */
data class LocalMediaDetails(val displayName: String?, val location: Pair<Double, Double>?)

/** Reads images and videos from MediaStore. Every query runs on the IO dispatcher. */
object PhotoLibrary {
	val images: Uri by lazy { MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL) }
	val videos: Uri by lazy { MediaStore.Video.Media.getContentUri(MediaStore.VOLUME_EXTERNAL) }

	suspend fun query(resolver: ContentResolver): List<LocalMediaItem> = withContext(Dispatchers.IO) {
		chronological(collection(resolver, images, isVideo = false) + collection(resolver, videos, isVideo = true))
	}

	/** Oldest first; items taken at the same moment keep a stable order. */
	internal fun chronological(items: List<LocalMediaItem>): List<LocalMediaItem> =
		items.sortedWith(compareBy<LocalMediaItem>({ it.takenAtMs }, { it.isVideo }, { it.id }))

	private fun collection(resolver: ContentResolver, collection: Uri, isVideo: Boolean): List<LocalMediaItem> {
		val projection = arrayOf(
			MediaStore.MediaColumns._ID,
			MediaStore.MediaColumns.DATE_TAKEN,
			MediaStore.MediaColumns.DATE_MODIFIED,
			MediaStore.MediaColumns.DATE_ADDED,
			MediaStore.MediaColumns.DURATION,
			MediaStore.MediaColumns.WIDTH,
			MediaStore.MediaColumns.HEIGHT,
			MediaStore.MediaColumns.ORIENTATION,
			MediaStore.MediaColumns.GENERATION_MODIFIED,
			MediaStore.MediaColumns.RELATIVE_PATH,
		)
		val cursor = try {
			resolver.query(collection, projection, null, null, null)
		} catch (error: SecurityException) {
			null
		} ?: return emptyList()
		return cursor.use {
			val idColumn = it.getColumnIndexOrThrow(MediaStore.MediaColumns._ID)
			val takenColumn = it.getColumnIndexOrThrow(MediaStore.MediaColumns.DATE_TAKEN)
			val modifiedColumn = it.getColumnIndexOrThrow(MediaStore.MediaColumns.DATE_MODIFIED)
			val addedColumn = it.getColumnIndexOrThrow(MediaStore.MediaColumns.DATE_ADDED)
			val durationColumn = it.getColumnIndexOrThrow(MediaStore.MediaColumns.DURATION)
			val widthColumn = it.getColumnIndexOrThrow(MediaStore.MediaColumns.WIDTH)
			val heightColumn = it.getColumnIndexOrThrow(MediaStore.MediaColumns.HEIGHT)
			val orientationColumn = it.getColumnIndexOrThrow(MediaStore.MediaColumns.ORIENTATION)
			val generationColumn = it.getColumnIndexOrThrow(MediaStore.MediaColumns.GENERATION_MODIFIED)
			val pathColumn = it.getColumnIndexOrThrow(MediaStore.MediaColumns.RELATIVE_PATH)
			// A library has a handful of folders and many items: share one path and key per folder.
			val folders = HashMap<String?, Pair<String?, String>>()
			val items = ArrayList<LocalMediaItem>(it.count)
			while (it.moveToNext()) {
				val (width, height) = orientedSize(it.intOrZero(widthColumn), it.intOrZero(heightColumn), it.intOrZero(orientationColumn))
				val (path, folder) = it.getString(pathColumn).let { path -> folders.getOrPut(path) { path to PhotoBackupFolders.key(path) } }
				items += LocalMediaItem(
					id = it.getLong(idColumn),
					isVideo = isVideo,
					// Dated as backup and the system photo picker date it.
					takenAtMs = MediaStoreLibrary.capturedAtMs(it.longOrZero(takenColumn), it.longOrZero(modifiedColumn), it.longOrZero(addedColumn)),
					durationMs = if (isVideo && !it.isNull(durationColumn)) it.getLong(durationColumn) else null,
					width = width,
					height = height,
					generation = it.longOrZero(generationColumn),
					folderPath = path,
					folder = folder,
				)
			}
			items
		}
	}

	/** The details row for the info sheet, or null when the item is gone. */
	suspend fun details(context: Context, item: LocalMediaItem): LocalMediaDetails? = withContext(Dispatchers.IO) {
		val cursor = try {
			context.contentResolver.query(item.uri, arrayOf(MediaStore.MediaColumns.DISPLAY_NAME), null, null, null)
		} catch (error: SecurityException) {
			null
		} ?: return@withContext null
		val displayName = cursor.use {
			if (!it.moveToFirst()) return@withContext null
			it.getString(0)
		}
		LocalMediaDetails(displayName, location(context, item))
	}

	/**
	 * Where the item was captured. MediaStore redacts location from the bytes it serves unless
	 * the app holds ACCESS_MEDIA_LOCATION and asks for the original file, and its own location
	 * columns are always empty since Android 10.
	 */
	private fun location(context: Context, item: LocalMediaItem): Pair<Double, Double>? {
		if (ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_MEDIA_LOCATION) != PackageManager.PERMISSION_GRANTED) return null
		val original = MediaStore.setRequireOriginal(item.uri)
		return try {
			if (item.isVideo) {
				MediaMetadataRetriever().use { retriever ->
					retriever.setDataSource(context, original)
					retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_LOCATION)?.let(::parseIso6709)
				}
			} else {
				context.contentResolver.openInputStream(original)?.use { stream ->
					ExifInterface(stream).latLong?.let { it[0] to it[1] }
				}
			}
		} catch (error: Exception) {
			// Unreadable, or the original isn't available: the sheet leaves location out.
			null
		}
	}

	/** A video's ISO 6709 location ("+37.4219-122.0840/" or with altitude) as latitude and longitude. */
	internal fun parseIso6709(value: String): Pair<Double, Double>? {
		val match = Regex("""^([+-]\d+(?:\.\d+)?)([+-]\d+(?:\.\d+)?)""").find(value) ?: return null
		val latitude = match.groupValues[1].toDoubleOrNull() ?: return null
		val longitude = match.groupValues[2].toDoubleOrNull() ?: return null
		return latitude to longitude
	}

	/** MediaStore stores the encoded size and the rotation separately. */
	internal fun orientedSize(width: Int, height: Int, orientation: Int): Pair<Int, Int> =
		if (orientation % 180 == 0) width to height else height to width

	/** The grid's video label: minutes and seconds, with minutes unbounded ("75:03"). */
	fun formatDuration(durationMs: Long): String {
		val total = roundedSeconds(durationMs)
		return String.format(Locale.ROOT, "%d:%02d", total / 60, total % 60)
	}

	/** The info sheet's duration: hours appear once there are any ("1:15:03", "4:09"). */
	fun formatLongDuration(durationMs: Long): String {
		val total = roundedSeconds(durationMs)
		val hours = total / 3600
		val minutes = (total % 3600) / 60
		val seconds = total % 60
		return if (hours > 0) {
			String.format(Locale.ROOT, "%d:%02d:%02d", hours, minutes, seconds)
		} else {
			String.format(Locale.ROOT, "%d:%02d", minutes, seconds)
		}
	}

	// iOS rounds the asset's duration in seconds to the nearest whole second.
	private fun roundedSeconds(durationMs: Long): Long = (durationMs.coerceAtLeast(0) / 1000.0).roundToLong()
}

private fun Cursor.longOrZero(column: Int): Long = if (isNull(column)) 0L else getLong(column)

private fun Cursor.intOrZero(column: Int): Int = if (isNull(column)) 0 else getInt(column)
