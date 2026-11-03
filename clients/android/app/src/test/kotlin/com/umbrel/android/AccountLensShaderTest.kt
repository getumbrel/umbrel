package com.umbrel.android

import android.graphics.Bitmap
import android.graphics.BitmapShader
import android.graphics.HardwareRenderer
import android.graphics.Paint
import android.graphics.PixelFormat
import android.graphics.RenderNode
import android.graphics.RuntimeShader
import android.graphics.Shader
import android.hardware.HardwareBuffer
import android.media.ImageReader
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import kotlin.math.asin
import kotlin.math.atan
import kotlin.math.pow
import kotlin.math.sin

/** Compiles the lens with Android's real shader compiler and checks where it samples. */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [37])
class AccountLensShaderTest {
	private val size = 200
	private val radius = 78f
	private val bevel = 50f
	private val scale = 35f
	private val chroma = 0.2f

	// Red rises and blue falls one step per pixel from left to right, so a sample's
	// channels say which column it came from.
	private val input = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888).apply {
		for (x in 0 until size) for (y in 0 until size) setPixel(x, y, android.graphics.Color.rgb(x, 0, 255 - x))
	}

	private val output: Bitmap by lazy {
		val shader = RuntimeShader(AccountLensShader).apply {
			setFloatUniform("size", size.toFloat(), size.toFloat())
			setFloatUniform("radius", radius)
			setFloatUniform("bevel", bevel)
			setFloatUniform("scale", scale)
			setFloatUniform("chroma", chroma)
			setInputShader("layer", BitmapShader(input, Shader.TileMode.CLAMP, Shader.TileMode.CLAMP))
		}
		// RuntimeShader only draws on a hardware canvas.
		val reader = ImageReader.newInstance(
			size,
			size,
			PixelFormat.RGBA_8888,
			1,
			HardwareBuffer.USAGE_GPU_SAMPLED_IMAGE or HardwareBuffer.USAGE_GPU_COLOR_OUTPUT,
		)
		val node = RenderNode("lens").apply {
			setPosition(0, 0, size, size)
			beginRecording().drawRect(0f, 0f, size.toFloat(), size.toFloat(), Paint().apply { this.shader = shader })
			endRecording()
		}
		HardwareRenderer().apply {
			setSurface(reader.surface)
			setContentRoot(node)
			createRenderRequest().setWaitForPresent(true).syncAndDraw()
			destroy()
		}
		reader.acquireNextImage().use { image ->
			val plane = image.planes[0]
			val padded = Bitmap.createBitmap(plane.rowStride / plane.pixelStride, size, Bitmap.Config.ARGB_8888)
			padded.copyPixelsFromBuffer(plane.buffer)
			Bitmap.createBitmap(padded, 0, 0, size, size)
		}
	}

	@Test
	fun centerAndOutsideAreUntouched() {
		for ((x, y) in listOf(100 to 100, 120 to 100, 5 to 5, 190 to 100)) {
			assertEquals("($x, $y)", input.getPixel(x, y), output.getPixel(x, y))
		}
	}

	@Test
	fun bevelSamplesOutwardWithRedFurtherThanBlue() {
		val x = 170
		val position = x + 0.5f
		val bend = bend(distance = position - size / 2f)
		val red = android.graphics.Color.red(output.getPixel(x, 100))
		val blue = android.graphics.Color.blue(output.getPixel(x, 100))
		assertEquals(position + bend * scale * (1 + chroma), red + 0.5f, 1.5f)
		assertEquals(position + bend * scale * (1 - chroma), 255 - blue + 0.5f, 1.5f)
	}

	// The shader's bend, evaluated independently.
	private fun bend(distance: Float): Float {
		val u = ((radius - distance) / bevel).coerceIn(0f, 1f)
		val inverse = 1 - u
		val slope = inverse.pow(3) / (1 - inverse.pow(4)).coerceAtLeast(0.0001f).pow(0.75f)
		val incident = atan(slope)
		return sin(incident - asin(sin(incident) / 1.5f)) / 0.7453559925f
	}
}
