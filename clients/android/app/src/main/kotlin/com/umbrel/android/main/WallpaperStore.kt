package com.umbrel.android.main

import android.content.Context
import android.graphics.Bitmap
import android.graphics.ImageDecoder
import android.os.Build
import android.util.LruCache
import com.umbrel.kit.Umbreld
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.IOException
import java.nio.ByteBuffer
import kotlin.math.max
import kotlin.math.roundToInt
import kotlin.math.sqrt

/**
 * The account's umbrelOS wallpaper, its smaller device-card rendition, and the blurred
 * companion that frosts the cards. Wallpaper ids are content-stable across Umbrels, so one
 * disk cache serves every device. Bytes come through UmbrelKit's pinned transport.
 *
 * Memory is evictable: the screen keeps what it shows, and the LRU can drop other decoded
 * bitmaps and recreate them from disk.
 */
class WallpaperStore(context: Context) {
	private enum class Variant(val suffix: String, val maxPixelSize: Int, val rendition: Umbreld.WallpaperImageRendition) {
		FULL_SCREEN("large", 2_880, Umbreld.WallpaperImageRendition.LARGE),
		DEVICE_CARD("medium", 1_440, Umbreld.WallpaperImageRendition.MEDIUM),
	}

	private val directory = File(context.applicationContext.cacheDir, "wallpapers-v2")
	private val memory = object : LruCache<String, Bitmap>(64 * 1024 * 1024) {
		override fun sizeOf(key: String, value: Bitmap): Int = value.allocationByteCount
	}

	// A screen recreated for the same device renders its wallpaper on the first frame from
	// memory; disk and network work stay asynchronous below.
	fun memoryCached(id: String): Bitmap? = memory.get(key(id, Variant.FULL_SCREEN))
	fun memoryCachedCard(id: String): Bitmap? = memory.get(key(id, Variant.DEVICE_CARD))
	fun memoryBlurred(id: String): Bitmap? = memory.get(blurKey(id))

	suspend fun cached(id: String): Bitmap? = cached(id, Variant.FULL_SCREEN)

	suspend fun cachedCard(id: String): Bitmap? {
		cached(id, Variant.DEVICE_CARD)?.let { return it }
		// A prior full-screen download is also a valid source for the smaller card.
		val data = read(key(id, Variant.FULL_SCREEN)) ?: return null
		val image = decode(data, Variant.DEVICE_CARD.maxPixelSize) ?: return null
		memory.put(key(id, Variant.DEVICE_CARD), image)
		return image
	}

	/** The full-screen wallpaper, downloading it once, plus its blurred companion. */
	suspend fun load(id: String, target: Umbreld.Target): Bitmap? {
		val image = load(id, target, Variant.FULL_SCREEN) ?: return null
		blurred(id)
		return image
	}

	suspend fun loadCard(id: String, target: Umbreld.Target): Bitmap? =
		cachedCard(id) ?: load(id, target, Variant.DEVICE_CARD)

	/**
	 * The blurred companion, built once from whichever source is on disk. The frost is
	 * deliberately soft, so it starts from a smaller decode than the sharp backdrop.
	 */
	suspend fun blurred(id: String): Bitmap? {
		val key = blurKey(id)
		memory.get(key)?.let { return it }
		read(key)?.let { data ->
			decode(data, BLUR_MAX_PIXEL_SIZE)?.let { image ->
				memory.put(key, image)
				return image
			}
		}
		val source = read(key(id, Variant.FULL_SCREEN)) ?: read(key(id, Variant.DEVICE_CARD)) ?: return null
		val blurred = withContext(Dispatchers.Default) {
			val image = decode(source, BLUR_MAX_PIXEL_SIZE, software = true) ?: return@withContext null
			val pixels = IntArray(image.width * image.height)
			image.getPixels(pixels, 0, image.width, 0, 0, image.width, image.height)
			image.recycle()
			ensureActive()
			GaussianBlur.blur(pixels, image.width, image.height, BLUR_SIGMA)
			Bitmap.createBitmap(pixels, image.width, image.height, Bitmap.Config.ARGB_8888)
		} ?: return null
		val encoded = withContext(Dispatchers.Default) {
			ByteArrayOutputStream().also { blurred.compress(Bitmap.CompressFormat.JPEG, 90, it) }.toByteArray()
		}
		memory.put(key, blurred)
		write(key, encoded)
		return blurred
	}

	private suspend fun cached(id: String, variant: Variant): Bitmap? {
		val key = key(id, variant)
		memory.get(key)?.let { return it }
		val data = read(key) ?: return null
		val image = decode(data, variant.maxPixelSize) ?: return null
		memory.put(key, image)
		return image
	}

	private suspend fun load(id: String, target: Umbreld.Target, variant: Variant): Bitmap? {
		cached(id, variant)?.let { return it }
		// Android 12 added AVIF decoding; earlier releases go straight to the JPEG original.
		val preferred = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) fetch(id, target, variant.rendition, variant.maxPixelSize) else null
		val loaded = preferred ?: fetch(id, target, Umbreld.WallpaperImageRendition.JPEG_FALLBACK, variant.maxPixelSize) ?: return null
		memory.put(key(id, variant), loaded.second)
		write(key(id, variant), loaded.first)
		return loaded.second
	}

	private suspend fun fetch(id: String, target: Umbreld.Target, rendition: Umbreld.WallpaperImageRendition, maxPixelSize: Int): Pair<ByteArray, Bitmap>? {
		val data = try {
			Umbreld.wallpaperData(target, id, rendition)
		} catch (cancelled: CancellationException) {
			throw cancelled
		} catch (error: Exception) {
			return null
		}
		val image = decode(data, maxPixelSize) ?: return null
		return data to image
	}

	private suspend fun read(key: String): ByteArray? = withContext(Dispatchers.IO) {
		try {
			file(key).takeIf { it.exists() }?.readBytes()
		} catch (error: IOException) {
			null
		}
	}

	private suspend fun write(key: String, data: ByteArray) = withContext(Dispatchers.IO) {
		try {
			directory.mkdirs()
			val target = file(key)
			val temp = File(directory, "${target.name}.tmp")
			temp.writeBytes(data)
			if (!temp.renameTo(target)) temp.delete()
		} catch (error: IOException) {
			// The image stays in memory; a later launch downloads it again.
		}
	}

	// Wallpaper ids are a numeric preset set (UmbrelKit rejects anything else), so they
	// are safe as file names.
	private fun file(key: String): File = File(directory, "$key.image")

	private fun key(id: String, variant: Variant): String = "$id-${variant.suffix}"

	private fun blurKey(id: String): String = "$id-blur"

	/**
	 * Decodes a bounded bitmap straight from the compressed source, so a 5K original never
	 * inflates at full size.
	 */
	private suspend fun decode(data: ByteArray, maxPixelSize: Int, software: Boolean = false): Bitmap? = withContext(Dispatchers.Default) {
		try {
			ImageDecoder.decodeBitmap(ImageDecoder.createSource(ByteBuffer.wrap(data))) { decoder, info, _ ->
				val longest = max(info.size.width, info.size.height)
				if (longest > maxPixelSize) {
					val scale = maxPixelSize.toDouble() / longest
					decoder.setTargetSize(
						max(1, (info.size.width * scale).roundToInt()),
						max(1, (info.size.height * scale).roundToInt()),
					)
				}
				if (software) decoder.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
			}
		} catch (error: IOException) {
			null
		} catch (error: IllegalArgumentException) {
			null
		}
	}

	private companion object {
		const val BLUR_MAX_PIXEL_SIZE = 1_440

		// Matches the Core Image Gaussian radius the iOS app uses, which is a standard
		// deviation in source pixels.
		const val BLUR_SIGMA = 40.0
	}
}

/**
 * A Gaussian blur approximated by three successive box blurs, the standard construction
 * whose result converges on a true Gaussian. Edges clamp, so the borders don't fade to
 * transparent.
 */
object GaussianBlur {
	/** Box widths whose three passes have the variance of a Gaussian with [sigma]. */
	fun boxSizes(sigma: Double, passes: Int = 3): IntArray {
		val ideal = sqrt(12 * sigma * sigma / passes + 1)
		var lower = ideal.toInt()
		if (lower % 2 == 0) lower--
		val upper = lower + 2
		val lowerCount = ((12 * sigma * sigma - passes * lower * lower - 4 * passes * lower - 3 * passes) / (-4.0 * lower - 4)).roundToInt()
		return IntArray(passes) { if (it < lowerCount) lower else upper }
	}

	/** Blurs packed ARGB [pixels] in place. */
	fun blur(pixels: IntArray, width: Int, height: Int, sigma: Double) {
		val scratch = IntArray(pixels.size)
		for (size in boxSizes(sigma)) {
			val radius = (size - 1) / 2
			boxPass(pixels, scratch, width, height, radius, horizontal = true)
			boxPass(scratch, pixels, width, height, radius, horizontal = false)
		}
	}

	private fun boxPass(source: IntArray, target: IntArray, width: Int, height: Int, radius: Int, horizontal: Boolean) {
		val length = if (horizontal) width else height
		val lines = if (horizontal) height else width
		val step = if (horizontal) 1 else width
		val window = 2 * radius + 1
		for (line in 0 until lines) {
			val start = if (horizontal) line * width else line
			var a = 0
			var r = 0
			var g = 0
			var b = 0
			fun at(index: Int): Int = source[start + index.coerceIn(0, length - 1) * step]
			for (offset in -radius..radius) {
				val pixel = at(offset)
				a += pixel ushr 24
				r += (pixel shr 16) and 0xFF
				g += (pixel shr 8) and 0xFF
				b += pixel and 0xFF
			}
			for (index in 0 until length) {
				target[start + index * step] = ((a + radius) / window shl 24) or
					((r + radius) / window shl 16) or
					((g + radius) / window shl 8) or
					((b + radius) / window)
				val leaving = at(index - radius)
				val entering = at(index + radius + 1)
				a += (entering ushr 24) - (leaving ushr 24)
				r += ((entering shr 16) and 0xFF) - ((leaving shr 16) and 0xFF)
				g += ((entering shr 8) and 0xFF) - ((leaving shr 8) and 0xFF)
				b += (entering and 0xFF) - (leaving and 0xFF)
			}
		}
	}
}
