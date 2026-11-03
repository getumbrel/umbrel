package com.umbrel.android.onboarding

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.exp

class BlurredDiskTest {
	@Test
	fun theCenterMatchesTheClosedForm() {
		// At the center the integral reduces to 1 − exp(−R²/2σ²).
		for ((radius, sigma) in listOf(229f to 170f, 209f to 170f, 50f to 10f)) {
			val expected = 1 - exp(-(radius * radius) / (2 * sigma * sigma))
			assertEquals(expected, blurredDisk(0f, radius, sigma), 0.002f)
		}
	}

	@Test
	fun aSharpDiskIsFullInsideAndEmptyOutside() {
		assertEquals(1f, blurredDisk(50f, 100f, 1f), 0.001f)
		assertEquals(0f, blurredDisk(150f, 100f, 1f), 0.001f)
		assertEquals(0.5f, blurredDisk(100f, 100f, 1f), 0.02f)
	}

	@Test
	fun brightnessFallsOffWithDistance() {
		var previous = blurredDisk(0f, 229f, 170f)
		for (distance in 50..900 step 50) {
			val value = blurredDisk(distance.toFloat(), 229f, 170f)
			assertTrue("brightness rose at $distance", value <= previous)
			previous = value
		}
	}
}
