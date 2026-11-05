package com.umbrel.android.ui

import org.junit.Assert.assertEquals
import org.junit.Test
import java.util.Locale

class FormatStorageSizeTest {
	private fun format(bytes: Double) = formatStorageSize(bytes, Locale.US)

	@Test
	fun matchesUmbrelOSExamples() {
		assertEquals("25GB", format(25e9))
		assertEquals("2TB", format(2e12))
		assertEquals("12.4GB", format(12.4e9))
		assertEquals("256GB", format(256e9))
	}

	@Test
	fun roundsToWholeNumbersFromThreeDigits() {
		assertEquals("99.9GB", format(99.94e9))
		assertEquals("100GB", format(99.96e9))
		assertEquals("123GB", format(123.4e9))
		assertEquals("512B", format(512.0))
		assertEquals("1kB", format(1_000.0))
		assertEquals("1.5MB", format(1.5e6))
		assertEquals("0B", format(0.0))
		assertEquals("1000PB", format(1e18))
	}

	@Test
	fun roundsHalfToEvenLikeApplesNumberFormatter() {
		assertEquals("12.2GB", format(12.25e9))
		assertEquals("12.4GB", format(12.35e9 + 1))
		assertEquals("12.2kB", format(12_250.0))
	}

	@Test
	fun usesTheLocaleDecimalSeparator() {
		assertEquals("12,4GB", formatStorageSize(12.4e9, Locale.GERMANY))
	}
}
