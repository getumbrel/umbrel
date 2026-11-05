package com.umbrel.android.ui

import androidx.compose.material3.Typography
import androidx.compose.ui.unit.sp
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Test

class TypographyTest {
	private fun Typography.styles() = listOf(
		displayLarge, displayMedium, displaySmall,
		headlineLarge, headlineMedium, headlineSmall,
		titleLarge, titleMedium, titleSmall,
		bodyLarge, bodyMedium, bodySmall,
		labelLarge, labelMedium, labelSmall,
	)

	@Test
	fun everyStyleDropsMaterialTrackingAndKeepsItsSize() {
		val material = Typography().styles()
		val untracked = UntrackedTypography.styles()
		for ((original, adjusted) in material.zip(untracked)) {
			assertEquals(0.sp, adjusted.letterSpacing)
			assertEquals(original.copy(fontFamily = interFor(original.fontSize), letterSpacing = 0.sp), adjusted)
		}
	}

	@Test
	fun interSwitchesToItsDisplayDesignAtTwentyLikeSfPro() {
		assertEquals(interFor(19.sp), interFor(11.sp))
		assertEquals(interFor(20.sp), interFor(34.sp))
		assertNotEquals(interFor(19.sp), interFor(20.sp))
	}
}
