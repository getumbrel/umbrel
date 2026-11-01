package com.umbrel.android.main

import org.junit.Assert.assertEquals
import org.junit.Test

class PhotoLibraryTest {
	private fun item(id: Long, takenAtMs: Long, isVideo: Boolean = false) =
		LocalMediaItem(id = id, isVideo = isVideo, takenAtMs = takenAtMs, durationMs = null, width = 0, height = 0, generation = 0)

	@Test
	fun libraryIsChronologicalWithTheNewestLast() {
		val items = listOf(item(1, 3_000), item(2, 1_000), item(3, 2_000, isVideo = true))
		assertEquals(listOf(2L, 3L, 1L), PhotoLibrary.chronological(items).map { it.id })
	}

	@Test
	fun itemsTakenAtTheSameMomentKeepAStableOrder() {
		val items = listOf(item(9, 1_000, isVideo = true), item(4, 1_000), item(2, 1_000))
		assertEquals(listOf(2L, 4L, 9L), PhotoLibrary.chronological(items).map { it.id })
	}

	@Test
	fun rotatedItemsSwapTheirStoredSize() {
		assertEquals(4032 to 3024, PhotoLibrary.orientedSize(4032, 3024, 0))
		assertEquals(3024 to 4032, PhotoLibrary.orientedSize(4032, 3024, 90))
		assertEquals(4032 to 3024, PhotoLibrary.orientedSize(4032, 3024, 180))
		assertEquals(3024 to 4032, PhotoLibrary.orientedSize(4032, 3024, 270))
	}

	@Test
	fun gridDurationsRoundToTheNearestSecondWithUnboundedMinutes() {
		assertEquals("0:00", PhotoLibrary.formatDuration(0))
		assertEquals("0:01", PhotoLibrary.formatDuration(500))
		assertEquals("0:00", PhotoLibrary.formatDuration(499))
		assertEquals("1:05", PhotoLibrary.formatDuration(64_600))
		assertEquals("75:03", PhotoLibrary.formatDuration(4_503_000))
	}

	@Test
	fun infoDurationsShowHoursOnlyWhenThereAreAny() {
		assertEquals("4:09", PhotoLibrary.formatLongDuration(249_000))
		assertEquals("59:59", PhotoLibrary.formatLongDuration(3_599_000))
		assertEquals("1:15:03", PhotoLibrary.formatLongDuration(4_503_000))
		assertEquals("0:00", PhotoLibrary.formatLongDuration(-5))
	}

	@Test
	fun videoLocationsParseFromIso6709() {
		assertEquals(37.4219 to -122.084, PhotoLibrary.parseIso6709("+37.4219-122.0840/"))
		assertEquals(-33.8688 to 151.2093, PhotoLibrary.parseIso6709("-33.8688+151.2093+012.500/"))
		assertEquals(null, PhotoLibrary.parseIso6709("unknown"))
	}

	@Test
	fun countsAbbreviateThousandsLikeIOS() {
		assertEquals("0", formatCount(0))
		assertEquals("999", formatCount(999))
		assertEquals("1k", formatCount(1_000))
		assertEquals("1.2k", formatCount(1_234))
		assertEquals("12.4k", formatCount(12_449))
		assertEquals("20k", formatCount(19_960))
		assertEquals("100k", formatCount(100_000))
	}
}
