package com.umbrel.android.main

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.abs
import kotlin.math.sqrt

class GaussianBlurTest {
	private fun gray(value: Int) = (0xFF shl 24) or (value shl 16) or (value shl 8) or value

	private fun red(pixel: Int) = (pixel shr 16) and 0xFF

	@Test
	fun threeBoxesMatchTheGaussianVariance() {
		val sizes = GaussianBlur.boxSizes(40.0)
		assertArrayEquals(intArrayOf(79, 79, 81), sizes)
		// A box of width w has variance (w² - 1) / 12; the passes add up to σ².
		val variance = sizes.sumOf { (it * it - 1) / 12.0 }
		assertEquals(1600.0, variance, 25.0)
	}

	@Test
	fun uniformImagesAreUnchangedIncludingTheEdges() {
		val pixels = IntArray(40 * 30) { gray(137) }
		GaussianBlur.blur(pixels, 40, 30, 10.0)
		assertTrue(pixels.all { it == gray(137) })
	}

	@Test
	fun anImpulseSpreadsWithTheRequestedStandardDeviation() {
		val width = 401
		val pixels = IntArray(width) { 0xFF000000.toInt() }
		pixels[width / 2] = 0xFF000000.toInt() or (255 shl 16) or (255 shl 8) or 255
		// One white pixel in a black row; the blurred red channel is the kernel.
		GaussianBlur.blur(pixels, width, 1, 20.0)
		val weights = pixels.map { red(it).toDouble() }
		val total = weights.sum()
		val mean = weights.withIndex().sumOf { (index, weight) -> index * weight } / total
		val sigma = sqrt(weights.withIndex().sumOf { (index, weight) -> (index - mean) * (index - mean) * weight } / total)
		assertEquals(width / 2.0, mean, 0.5)
		assertTrue("sigma was $sigma", abs(sigma - 20.0) < 3.0)
	}

	@Test
	fun aStepEdgeBecomesAMonotonicRampAndKeepsOpacity() {
		val width = 200
		val height = 3
		val pixels = IntArray(width * height) { if (it % width < width / 2) gray(0) else gray(255) }
		GaussianBlur.blur(pixels, width, height, 8.0)
		val row = (0 until width).map { red(pixels[width + it]) }
		assertEquals(0, row.first())
		assertEquals(255, row.last())
		assertTrue(row.zipWithNext().all { (a, b) -> b >= a })
		assertTrue(row[width / 2 - 1] in 100..155)
		assertTrue(pixels.all { it ushr 24 == 0xFF })
	}
}
