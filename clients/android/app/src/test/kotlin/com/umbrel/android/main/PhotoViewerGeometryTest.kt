package com.umbrel.android.main

import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.Size
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PhotoViewerGeometryTest {
	private val screen = Size(1000f, 2000f)

	private fun assertRect(expected: Rect, actual: Rect?) {
		requireNotNull(actual)
		assertEquals(expected.left, actual.left, 0.01f)
		assertEquals(expected.top, actual.top, 0.01f)
		assertEquals(expected.right, actual.right, 0.01f)
		assertEquals(expected.bottom, actual.bottom, 0.01f)
	}

	@Test
	fun photosFitCenteredInThePage() {
		assertRect(Rect(0f, 625f, 1000f, 1375f), fitRect(4000, 3000, screen))
		assertRect(Rect(250f, 0f, 750f, 2000f), fitRect(1000, 4000, screen))
		assertNull(fitRect(0, 3000, screen))
	}

	@Test
	fun tilesCropToTheCenterOfThePhoto() {
		val tile = Rect(100f, 100f, 200f, 200f)
		assertRect(Rect(83.33f, 100f, 216.67f, 200f), fillRect(4f / 3f, tile))
		assertRect(Rect(100f, 50f, 200f, 250f), fillRect(0.5f, tile))
	}

	@Test
	fun zoomRunsFromTheTileCropToTheWholePhoto() {
		val tile = Rect(100f, 100f, 200f, 200f)
		val full = fitRect(4000, 3000, screen)!!
		val start = ZoomFrame.of(0f, tile, full)
		assertRect(tile, start.clip)
		assertRect(fillRect(4f / 3f, tile), start.image)
		val end = ZoomFrame.of(1f, tile, full)
		assertRect(full, end.clip)
		assertRect(full, end.image)
		// The photo keeps its proportions all the way.
		val middle = ZoomFrame.of(0.5f, tile, full)
		assertEquals(4f / 3f, middle.image.width / middle.image.height, 0.001f)
	}

	@Test
	fun draggingMovesAndShrinksAboutTheCenter() {
		val rect = Rect(0f, 625f, 1000f, 1375f)
		assertRect(Rect(150f, 912.5f, 850f, 1437.5f), dragged(rect, Offset(0f, 175f), 0.7f))
	}

	@Test
	fun doubleTapZoomsToTwoAndAHalfCenteredOnThePoint() {
		val zoomed = PageZoom().toggled(Offset(500f, 1000f), screen)
		assertEquals(2.5f, zoomed.scale)
		// The tapped point lands at the center of the page.
		assertEquals(Offset(500f, 1000f), Offset(500f, 1000f) * zoomed.scale + zoomed.offset)
		assertFalse(zoomed.toggled(Offset(10f, 10f), screen).isZoomed)
	}

	@Test
	fun doubleTapNearAnEdgeStaysInsideThePage() {
		val zoomed = PageZoom().toggled(Offset(0f, 0f), screen)
		assertEquals(Offset.Zero, zoomed.offset)
		val corner = PageZoom().toggled(Offset(1000f, 2000f), screen)
		assertEquals(Offset(1000f - 2500f, 2000f - 5000f), corner.offset)
	}

	@Test
	fun pinchKeepsThePointUnderTheFingersAndClampsTheScale() {
		val start = PageZoom(2f, Offset(-500f, -1000f))
		val centroid = Offset(400f, 900f)
		val anchor = (centroid - start.offset) / start.scale
		val pinched = start.transformed(centroid, Offset.Zero, 1.5f, screen)
		assertEquals(3f, pinched.scale)
		assertEquals(centroid, anchor * pinched.scale + pinched.offset)
		assertEquals(4f, start.transformed(centroid, Offset.Zero, 10f, screen).scale)
		assertEquals(PageZoom(), start.transformed(centroid, Offset.Zero, 0.1f, screen))
	}

	@Test
	fun panningStopsAtThePageEdges() {
		val zoom = PageZoom(2f, Offset(-200f, -300f)).transformed(Offset(500f, 500f), Offset(5000f, -5000f), 1f, screen)
		assertEquals(Offset(0f, -2000f), zoom.offset)
		assertTrue(zoom.isZoomed)
	}

	@Test
	fun viewerStatusPrefersAReceiptOverTheToggle() {
		assertEquals(ViewerBackupStatus.BACKED_UP, ViewerBackupStatus.of(backedUp = true, backupEnabled = false))
		assertEquals(ViewerBackupStatus.NOT_BACKED_UP, ViewerBackupStatus.of(backedUp = false, backupEnabled = false))
		assertEquals(ViewerBackupStatus.WAITING, ViewerBackupStatus.of(backedUp = false, backupEnabled = true))
	}

	@Test
	fun infoRestsThePhotoInASquareOrTheTopHalf() {
		// A phone: a landscape photo grows to fill the square and rests on its bottom edge.
		val phone = PhotoViewerInfoLayout(screen, 3000, 2000)
		assertEquals(1000f, phone.photoHeight, 0.01f)
		assertEquals(1000f, phone.openOffset, 0.01f)
		assertEquals(1.5f, phone.scale(1f), 0.001f)
		assertEquals(500f, phone.shift(1f), 0.01f)
		assertEquals(1f, phone.scale(0f), 0.001f)
		// A wide screen: the top half, and a photo taller than it keeps its size.
		val wide = PhotoViewerInfoLayout(Size(2000f, 1600f), 1000, 1000)
		assertEquals(800f, wide.photoHeight, 0.01f)
		assertEquals(1f, wide.scale(1f), 0.001f)
		assertEquals(0f, wide.shift(1f), 0.01f)
	}

	@Test
	fun aReleasedSwipeRestsOnThePhotoOrOnInfo() {
		fun target(start: Float, projected: Float, velocity: Float, holdsInfo: Boolean = false) =
			infoSnapTarget(start, projected, velocity, openOffset = 1000f, holdsInfo = holdsInfo, flick = 100f)
		// A flick decides by its direction, wherever it would have stopped.
		assertEquals(1000f, target(0f, 300f, 800f))
		assertEquals(0f, target(1000f, 700f, -800f, holdsInfo = true))
		// A slow drag commits once it has clearly left where it started.
		assertEquals(1000f, target(0f, 200f, 50f))
		assertEquals(0f, target(0f, 100f, 50f))
		assertEquals(0f, target(1000f, 800f, -50f, holdsInfo = true))
		assertEquals(1000f, target(1000f, 900f, -50f, holdsInfo = true))
		// Scrolling back up through Info stops at its top, and below that it scrolls freely.
		assertEquals(1000f, target(1600f, 200f, -3000f, holdsInfo = true))
		assertNull(target(1600f, 1200f, -300f, holdsInfo = true))
	}
}
