package com.umbrel.android.main

import android.content.Context
import android.net.Uri
import android.provider.MediaStore
import android.text.format.DateFormat
import android.webkit.MimeTypeMap
import androidx.exifinterface.media.ExifInterface
import com.umbrel.android.ui.formatDateSkeleton
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.math.RoundingMode
import java.text.NumberFormat
import java.time.Instant
import java.time.LocalDateTime
import java.time.ZoneId
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlin.math.abs
import kotlin.math.roundToInt
import kotlin.math.roundToLong

/**
 * The file and camera details the viewer's Info shows, the port of iOS's
 * PhotoViewerMetadata: read from MediaStore's row and the photo's own EXIF header, never by
 * loading the image.
 */
internal data class PhotoViewerMetadata(
	val name: String? = null,
	val format: String? = null,
	val camera: String? = null,
	val lens: String? = null,
	// ISO, focal length, exposure bias, aperture and shutter speed, in Photos' order
	val exposure: List<String?> = NoExposure,
	// The capture time as the camera showed it, in no time zone
	val cameraClock: LocalDateTime? = null,
	val bytes: Long? = null,
	// The file couldn't be read, which isn't the same as a photo that records no camera
	val isOriginalUnavailable: Boolean = false,
) {
	companion object {
		val NoExposure: List<String?> = List(5) { null }

		suspend fun load(context: Context, item: LocalMediaItem): PhotoViewerMetadata = withContext(Dispatchers.IO) {
			var metadata = PhotoViewerMetadata()
			try {
				val columns = arrayOf(MediaStore.MediaColumns.DISPLAY_NAME, MediaStore.MediaColumns.MIME_TYPE, MediaStore.MediaColumns.SIZE)
				context.contentResolver.query(item.uri, columns, null, null, null)?.use {
					if (!it.moveToFirst()) return@use
					metadata = metadata.copy(
						name = it.getString(0)?.substringBeforeLast('.')?.takeIf(String::isNotEmpty),
						format = it.getString(1)?.let(::formatName),
						bytes = if (it.isNull(2)) null else it.getLong(2).takeIf { bytes -> bytes > 0 },
					)
				}
			} catch (error: SecurityException) {
				// Access to the item was taken away: the card shows what the grid row already has.
			}
			if (item.isVideo) return@withContext metadata
			// The item's ordinary URI: MediaStore leaves the location out of what it serves there,
			// and Info doesn't show it.
			val exif = exif(context, item.uri)
			if (exif == null) metadata.copy(isOriginalUnavailable = true) else metadata.reading(exif)
		}

		// From a file descriptor ExifInterface seeks through the file's header, where a stream
		// would be read from the start up to wherever the metadata ends.
		private fun exif(context: Context, uri: Uri): ExifInterface? = try {
			context.contentResolver.openFileDescriptor(uri, "r")?.use { ExifInterface(it.fileDescriptor) }
		} catch (error: Exception) {
			null
		}

		/** Photos names the format, not the file extension: HEIF for .heic, JPEG for .jpg. */
		internal fun formatName(mimeType: String): String? = when (mimeType.lowercase(Locale.ROOT)) {
			"image/heic", "image/heif", "image/heic-sequence", "image/heif-sequence" -> "HEIF"
			"image/jpeg" -> "JPEG"
			"image/png" -> "PNG"
			"video/quicktime" -> "MOV"
			"video/mp4" -> "MP4"
			else -> MimeTypeMap.getSingleton().getExtensionFromMimeType(mimeType)?.uppercase(Locale.ROOT)
		}

		/**
		 * "Apple" + "iPhone 15 Pro" reads as one name, but Nikon's model already starts with
		 * "NIKON", so its make ("NIKON CORPORATION") would repeat it.
		 */
		internal fun cameraName(make: String?, model: String?): String? {
			if (model.isNullOrEmpty()) return null
			val brand = make?.split(' ')?.firstOrNull().orEmpty()
			return if (make != null && brand.isNotEmpty() && !model.contains(brand, ignoreCase = true)) "$make $model" else model
		}

		/**
		 * Which of an iPhone's cameras took it, told by the lens itself and not the zoom: a 2×
		 * crop of the Main camera reports 48 mm and is still the Main camera. The file gives the
		 * shortest and longest lenses of the camera system; null when that isn't enough to be sure.
		 */
		internal fun iPhoneCamera(lensModel: String, focalLength: Double?, lensRange: List<Double>): String? {
			val model = lensModel.lowercase(Locale.ROOT)
			if ("front" in model) return "Front Camera"
			if ("back" !in model) return null
			if ("dual" !in model && "triple" !in model) return "Main Camera"
			if (focalLength == null || lensRange.size < 2) return null
			val isShortest = abs(focalLength - lensRange[0]) < 0.1
			val isLongest = abs(focalLength - lensRange[1]) < 0.1
			return when {
				"dual wide" in model -> if (isShortest) "Ultra Wide Camera" else if (isLongest) "Main Camera" else null
				"triple" in model -> if (isShortest) "Ultra Wide Camera" else if (isLongest) "Telephoto Camera" else "Main Camera"
				else -> if (isShortest) "Main Camera" else if (isLongest) "Telephoto Camera" else null
			}
		}

		internal fun shutterText(seconds: Double): String =
			if (seconds < 0.5) "1/${(1 / seconds).roundToInt()} s" else "${number(seconds, 1, 1)} s"

		internal fun megapixelsText(width: Int, height: Int): String? {
			val megapixels = width.toDouble() * height / 1_000_000
			if (megapixels <= 0) return null
			val precision = if (megapixels < 1) 1 else 0
			return "${number(megapixels, precision, precision)} MP"
		}

		/** A file's size as iOS's ByteCountFormatter writes it: "22 KB", "1.9 MB", "1.25 GB". */
		internal fun fileSizeText(bytes: Long): String {
			if (bytes < 1000) return "$bytes bytes"
			val units = listOf("KB" to 0, "MB" to 1, "GB" to 2, "TB" to 2)
			var scaled = bytes / 1000.0
			var unit = 0
			while (scaled >= 999.5 && unit < units.lastIndex) {
				scaled /= 1000
				unit++
			}
			return "${number(scaled, 0, units[unit].second)} ${units[unit].first}"
		}

		internal fun number(value: Double, minFraction: Int, maxFraction: Int): String =
			NumberFormat.getNumberInstance().apply {
				isGroupingUsed = false
				minimumFractionDigits = minFraction
				maximumFractionDigits = maxFraction
				roundingMode = RoundingMode.HALF_EVEN
			}.format(value)

		private val ExifClock = DateTimeFormatter.ofPattern("yyyy:MM:dd HH:mm:ss", Locale.ROOT)
	}

	private fun reading(exif: ExifInterface): PhotoViewerMetadata {
		fun text(tag: String): String? = exif.getAttribute(tag)?.trim()?.takeIf(String::isNotEmpty)
		fun positive(tag: String): Double? = exif.getAttributeDouble(tag, 0.0).takeIf { it > 0 && it.isFinite() }

		val make = text(ExifInterface.TAG_MAKE)
		val focalLength = positive(ExifInterface.TAG_FOCAL_LENGTH)
		val focalText = (positive(ExifInterface.TAG_FOCAL_LENGTH_IN_35MM_FILM) ?: focalLength)?.let { "${it.roundToLong()} mm" }
		val apertureText = positive(ExifInterface.TAG_F_NUMBER)?.let { "ƒ${number(it, 0, 2)}" }

		// Cameras with interchangeable lenses often name the lens outside the main EXIF block
		val lensModel = text(ExifInterface.TAG_LENS_MODEL) ?: exif.getAttributeBytes(ExifInterface.TAG_XMP)?.let(::xmpLens)
		val lens = when {
			lensModel == null -> null
			// iPhones write "iPhone X back dual camera 6mm f/2.4", which Photos shows as
			// "Telephoto Camera — 52 mm ƒ2.4"
			make == "Apple" && focalText != null && apertureText != null -> {
				val lensRange = exif.getAttribute(ExifInterface.TAG_LENS_SPECIFICATION).orEmpty().split(',').mapNotNull(::rational)
				listOfNotNull(iPhoneCamera(lensModel, focalLength, lensRange), "$focalText $apertureText").joinToString(" — ")
			}
			else -> lensModel.replace("f/", "ƒ")
		}

		val exposure = listOf(
			exif.getAttributeInt(ExifInterface.TAG_PHOTOGRAPHIC_SENSITIVITY, 0).takeIf { it > 0 }?.let { "ISO $it" },
			focalText,
			exif.getAttribute(ExifInterface.TAG_EXPOSURE_BIAS_VALUE)?.let(::rational)?.let { "${number(it, 0, 1)} ev" },
			apertureText,
			positive(ExifInterface.TAG_EXPOSURE_TIME)?.let(::shutterText),
		)
		return copy(
			camera = cameraName(make, text(ExifInterface.TAG_MODEL)),
			lens = lens,
			exposure = exposure,
			cameraClock = text(ExifInterface.TAG_DATETIME_ORIGINAL)?.let { runCatching { LocalDateTime.parse(it, ExifClock) }.getOrNull() },
		)
	}

	/**
	 * "Thursday • Aug 9, 2012 • 7:55 AM": the time on the camera's own clock when it recorded
	 * one, as in Photos and in umbrelOS, so a photo reads the same wherever and whenever it's
	 * looked at. Otherwise the library's date, in this phone's time zone.
	 */
	fun dateLine(context: Context, item: LocalMediaItem): String {
		val date = cameraClock
			?: item.takenAtMs.takeIf { it > 0 }?.let { LocalDateTime.ofInstant(Instant.ofEpochMilli(it), ZoneId.systemDefault()) }
			?: return "No date"
		return dateLine(date, Locale.getDefault(), DateFormat.is24HourFormat(context))
	}
}

internal fun dateLine(date: LocalDateTime, locale: Locale, uses24Hour: Boolean): String =
	// The camera's clock has no zone, so it is written in the one it's read in.
	listOf("EEEE", "yMMMd", if (uses24Hour) "Hm" else "hm").joinToString(" • ") { skeleton ->
		formatDateSkeleton(skeleton, date.toInstant(ZoneOffset.UTC), ZoneOffset.UTC, locale)
	}

// The lens as Adobe's XMP names it, as an element or an attribute: "16.0-35.0 mm f/4.0".
private val XmpLens = Regex("""<aux:Lens>([^<]+)</aux:Lens>|aux:Lens="([^"]+)"""")

private fun xmpLens(xmp: ByteArray): String? =
	XmpLens.find(String(xmp, Charsets.UTF_8))?.let { it.groupValues[1].ifEmpty { it.groupValues[2] } }?.trim()?.takeIf(String::isNotEmpty)

// One EXIF rational as ExifInterface writes it: "28/10", or a plain number.
private fun rational(value: String): Double? {
	val parts = value.trim().split('/')
	val numerator = parts[0].toDoubleOrNull() ?: return null
	val denominator = if (parts.size > 1) parts[1].toDoubleOrNull() ?: return null else 1.0
	return (numerator / denominator).takeIf { it.isFinite() }
}
