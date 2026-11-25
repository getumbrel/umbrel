package com.umbrel.android.ui

import androidx.compose.ui.unit.dp
import org.junit.Assert.assertEquals
import org.junit.Test

class WideLayoutTest {
	@Test
	fun gridsKeepThePhoneColumnsUntilMoreTilesFit() {
		// A Pixel Fold's Home column (368 wide inside its card) still fits only three tiles
		assertEquals(3, WideLayout.columns(368.dp, phone = 3))
		assertEquals(3, WideLayout.columns(399.dp, phone = 3))
	}

	@Test
	fun widerGridsUseAnEvenColumnCount() {
		assertEquals(4, WideLayout.columns(400.dp, phone = 3))
		assertEquals(4, WideLayout.columns(588.dp, phone = 3))
		assertEquals(6, WideLayout.columns(645.dp, phone = 3))
		// Apps on an unfolded Fold held sideways, and on a tablet
		assertEquals(8, WideLayout.columns(801.dp, phone = 4))
		assertEquals(12, WideLayout.columns(1240.dp, phone = 4))
	}

	@Test
	fun twoColumnsSplitTheWidthAroundTheGap() {
		val columns = WideLayout.twoColumns(800.dp, spacing = 32.dp)
		assertEquals(ColumnFrame(0.dp, 384.dp), columns[0])
		assertEquals(ColumnFrame(416.dp, 384.dp), columns[1])
		val library = WideLayout.twoColumns(800.dp, spacing = 32.dp, leadingFraction = 0.4f)
		assertEquals(ColumnFrame(0.dp, 307.dp), library[0])
		assertEquals(ColumnFrame(339.dp, 461.dp), library[1])
	}

	@Test
	fun aHalfOpenHingeGetsEqualColumnsMirroredAroundIt() {
		// The hinge 10 left of centre: both columns take the narrower side's width
		val columns = WideLayout.twoColumns(800.dp, spacing = 32.dp, leadingFraction = 0.4f, fold = FoldBand(390.dp, 390.dp))
		assertEquals(ColumnFrame(0.dp, 374.dp), columns[0])
		assertEquals(ColumnFrame(406.dp, 374.dp), columns[1])
	}

	@Test
	fun aHingeOutsideTheLayoutIsIgnored() {
		val columns = WideLayout.twoColumns(800.dp, spacing = 32.dp, fold = FoldBand(-20.dp, -20.dp))
		assertEquals(ColumnFrame(0.dp, 384.dp), columns[0])
	}
}
