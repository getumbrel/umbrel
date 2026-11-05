package com.umbrel.android.ui

import androidx.compose.ui.graphics.Color
import org.junit.Assert.assertEquals
import org.junit.Test

class BrandColorTest {
	private fun assertColor(expected: Color, actual: Color) {
		assertEquals(expected.red, actual.red, 0.002f)
		assertEquals(expected.green, actual.green, 0.002f)
		assertEquals(expected.blue, actual.blue, 0.002f)
	}

	@Test
	fun parsesUmbreldHslComponents() {
		// hsl(160, 100%, 27%) is umbrelOS's green wallpaper accent.
		assertColor(Color(0f, 0.54f, 0.36f), BrandColor.color("160 100% 27%"))
		assertColor(Color(1f, 0f, 0f), BrandColor.color(" 0  100%   50% "))
	}

	@Test
	fun malformedOrOutOfRangeValuesUseTheDefaultViolet() {
		val fallback = BrandColor.color(null)
		assertColor(BrandColor.hslColor(259.0, 1.0, 0.59), fallback)
		for (value in listOf("", "259 100%", "259 100 59", "hsl(1, 2%, 3%)", "400 50% 50%", "-1 50% 50%", "120 150% 50%", "120 50% -5%", "NaN 50% 50%", "120 50% 50% 1")) {
			assertColor(fallback, BrandColor.color(value))
		}
	}

	@Test
	fun boundaryValuesNeverLeaveTheColorRange() {
		// These hit the edges of the HSL conversion; Compose's Color would throw if a
		// channel left 0…1.
		for (value in listOf("360 100% 100%", "0 0% 0%", "359.999 100% 50%", "360 100% 50%", "180 100% 0%")) {
			val color = BrandColor.color(value, mixWhite = 0.5)
			for (channel in listOf(color.red, color.green, color.blue)) assertEquals(true, channel in 0f..1f)
		}
		assertColor(Color(1f, 0f, 0f), BrandColor.color("360 100% 50%"))
	}

	@Test
	fun mixingTowardWhiteMatchesUmbrelOSColorMix() {
		assertColor(Color(1f, 0.32f, 0.32f), BrandColor.color("0 100% 50%", mixWhite = 0.32))
		assertColor(Color.White, BrandColor.color("0 100% 50%", mixWhite = 2.0))
		assertColor(Color(1f, 0f, 0f), BrandColor.color("0 100% 50%", mixWhite = -1.0))
	}
}
