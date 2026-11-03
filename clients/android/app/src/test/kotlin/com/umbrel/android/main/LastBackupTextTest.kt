package com.umbrel.android.main

import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.time.LocalDateTime
import java.time.ZoneId
import java.util.Locale

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [37])
class LastBackupTextTest {
	private val zone = ZoneId.of("Australia/Sydney")
	// A Thursday afternoon.
	private val now = at(2026, 10, 15, 16, 30)

	private fun at(year: Int, month: Int, day: Int, hour: Int, minute: Int): Long =
		LocalDateTime.of(year, month, day, hour, minute).atZone(zone).toInstant().toEpochMilli()

	private fun text(atMs: Long, is24Hour: Boolean = false) = lastBackupText(atMs, now, zone, Locale.US, is24Hour)

	@Test
	fun recentBackupsReadAsADayAndATime() {
		assertEquals("Today at 3:04 PM", text(at(2026, 10, 15, 15, 4)))
		assertEquals("Today at 15:04", text(at(2026, 10, 15, 15, 4), is24Hour = true))
		assertEquals("Yesterday at 11:58 PM", text(at(2026, 10, 14, 23, 58)))
		assertEquals("Friday at 9:00 AM", text(at(2026, 10, 9, 9, 0)))
	}

	@Test
	fun olderBackupsReadAsADate() {
		assertEquals("Oct 8", text(at(2026, 10, 8, 9, 0)))
		assertEquals("Dec 30, 2025", text(at(2025, 12, 30, 9, 0)))
	}
}
