package com.umbrel.android.main

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PhotoGridGeometryTest {
	// A 393-wide phone at 3x: the card's interior is 393 - 40 - 16 = 337 points.
	private val density = 3f
	private val width = 337 * density
	private val spacing = 4 * density
	private val bleedExtra = 24 * density

	@Test
	fun cellsAreWholePixelSquaresInThreeColumns() {
		val layout = PhotoGridLayout.of(count = 9, width = width, spacing = spacing, bleedExtra = bleedExtra)
		assertEquals(329f, layout.cell) // floor((1011 - 24) / 3)
		assertEquals(3, layout.rows)
	}

	@Test
	fun upToFourRowsTheCardFitsTheLibraryExactly() {
		val layout = PhotoGridLayout.of(count = 12, width = width, spacing = spacing, bleedExtra = bleedExtra)
		assertFalse(layout.bleeds)
		assertEquals(4 * 329f + 3 * spacing, layout.viewport)
		val partialRow = PhotoGridLayout.of(count = 4, width = width, spacing = spacing, bleedExtra = bleedExtra)
		assertEquals(2, partialRow.rows)
		assertEquals(2 * 329f + spacing, partialRow.viewport)
	}

	@Test
	fun beyondFourRowsTheCardShowsFourPointSixRows() {
		val layout = PhotoGridLayout.of(count = 13, width = width, spacing = spacing, bleedExtra = bleedExtra)
		assertTrue(layout.bleeds)
		assertEquals(4.6f * 329f + bleedExtra, layout.viewport, 0.001f)
		assertEquals(layout.viewport, PhotoGridLayout.of(50_000, width, spacing, bleedExtra).viewport, 0.001f)
	}

	@Test
	fun emptyLibraryHasNoHeight() {
		assertEquals(0f, PhotoGridLayout.of(0, width, spacing, bleedExtra).viewport)
	}

	private fun geometry(count: Int, viewport: Float = 1000f) =
		PhotoGridGeometry(count = count, cell = 100f, spacing = 4f, viewport = viewport, bottomInset = 8f)

	@Test
	fun offsetsFollowWholeRows() {
		val grid = geometry(count = 300)
		assertEquals(100 * 100f + 99 * 4f, grid.contentHeight)
		assertEquals(grid.contentHeight + 8f - 1000f, grid.maxOffset)
		assertEquals(0f, grid.offset(0, 0))
		assertEquals(104f * 7 + 30f, grid.offset(21, 30))
		// Any item in a row reports that row's offset.
		assertEquals(grid.offset(21, 30), grid.offset(23, 30))
	}

	@Test
	fun positionsRoundTripThroughOffsets() {
		val grid = geometry(count = 300)
		for (offset in listOf(0f, 50f, 103f, 104f, 1234f, grid.maxOffset)) {
			val (index, within) = grid.position(offset)
			assertEquals(0, index % 3)
			assertEquals(offset, grid.offset(index, within), 0.5f)
		}
		assertEquals(grid.position(grid.maxOffset), grid.position(grid.maxOffset + 500f))
		assertEquals(0 to 0, grid.position(-10f))
	}

	@Test
	fun progressSpansTheScrollableRange() {
		val grid = geometry(count = 300)
		assertEquals(0f, grid.progress(0f))
		assertEquals(0.5f, grid.progress(grid.maxOffset / 2), 0.0001f)
		assertEquals(1f, grid.progress(grid.maxOffset + 10f))
		assertFalse(geometry(count = 6).isScrollable)
		assertEquals(1f, geometry(count = 6).progress(0f))
	}

	@Test
	fun jumpToLatestAppearsBeyondThreeQuartersOfAScreen() {
		val grid = geometry(count = 300)
		assertTrue(grid.isNearLatest(grid.maxOffset, minimum = 100f))
		assertTrue(grid.isNearLatest(grid.contentHeight - 1000f - 749f, minimum = 100f))
		assertFalse(grid.isNearLatest(grid.contentHeight - 1000f - 750f, minimum = 100f))
		// Short viewports use the minimum distance instead.
		val short = geometry(count = 300, viewport = 80f)
		assertTrue(short.isNearLatest(short.contentHeight - 80f - 99f, minimum = 100f))
		assertFalse(short.isNearLatest(short.contentHeight - 80f - 100f, minimum = 100f))
	}

	@Test
	fun theGridStaysPinnedOnlyWhenAtTheNewestRow() {
		val grid = geometry(count = 300)
		assertTrue(grid.isNearBottom(grid.maxOffset, minimum = 24f))
		assertTrue(grid.isNearBottom(grid.contentHeight - 1000f - 50f, minimum = 24f))
		assertFalse(grid.isNearBottom(grid.contentHeight - 1000f - 51f, minimum = 24f))
		// An empty grid counts as at the bottom, so the first load opens at the newest row.
		assertTrue(geometry(count = 0).isNearBottom(0f, minimum = 24f))
	}

	@Test
	fun scrollThumbIsProportionalWithAMinimumHeight() {
		val proportional = ScrollThumb.of(progress = 0f, viewport = 1000f, content = 4000f, inset = 8f, minimum = 36f)
		assertEquals(984f * 0.25f, proportional.height, 0.001f)
		assertEquals(8f, proportional.top)
		val long = ScrollThumb.of(progress = 1f, viewport = 1000f, content = 1_000_000f, inset = 8f, minimum = 36f)
		assertEquals(36f, long.height)
		assertEquals(8f + 984f - 36f, long.top)
	}

	@Test
	fun scrubbingCentersTheThumbOnTheFinger() {
		val thumb = ScrollThumb.of(progress = 0f, viewport = 1000f, content = 1_000_000f, inset = 8f, minimum = 36f)
		assertEquals(0f, thumb.progressAt(0f))
		assertEquals(0f, thumb.progressAt(8f + 18f))
		assertEquals(0.5f, thumb.progressAt(500f), 0.0001f)
		assertEquals(1f, thumb.progressAt(1000f - 8f - 18f), 0.0001f)
		assertEquals(1f, thumb.progressAt(5000f))
	}
}
