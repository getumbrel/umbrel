package com.umbrel.android.main

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class RefreshPlanTest {
	private val now = 1_000_000L
	private val justFetched = RefreshPlan.Times(now, now, now, now, now)

	@Test
	fun eachTabFetchesOnlyWhatItShows() {
		val empty = RefreshPlan.Times()
		assertEquals(RefreshPlan(identity = true, apps = true, disk = true, favorites = true, updates = true), RefreshPlan.make(RefreshScope.HOME, false, true, now, empty))
		assertEquals(RefreshPlan(identity = true, apps = true, disk = false, favorites = false, updates = true), RefreshPlan.make(RefreshScope.APPS, false, true, now, empty))
		assertEquals(RefreshPlan(identity = true, apps = false, disk = false, favorites = false, updates = false), RefreshPlan.make(RefreshScope.LIBRARY, false, true, now, empty))
		assertEquals(RefreshPlan(identity = true, apps = false, disk = true, favorites = false, updates = false), RefreshPlan.make(RefreshScope.PROFILE, false, true, now, empty))
		assertEquals(RefreshPlan(identity = true, apps = false, disk = false, favorites = false, updates = false), RefreshPlan.make(RefreshScope.CONNECTION, false, true, now, empty))
	}

	@Test
	fun membersNeverFetchUpdates() {
		assertEquals(false, RefreshPlan.make(RefreshScope.HOME, true, false, now, RefreshPlan.Times()).updates)
	}

	@Test
	fun freshResourcesAreSkippedUntilTheirIntervalPasses() {
		assertTrue(RefreshPlan.make(RefreshScope.HOME, false, true, now + 14_999, justFetched).isEmpty)
		assertEquals(
			RefreshPlan(identity = true, apps = true, disk = false, favorites = false, updates = false),
			RefreshPlan.make(RefreshScope.HOME, false, true, now + 15_000, justFetched),
		)
		assertEquals(
			RefreshPlan(identity = true, apps = true, disk = true, favorites = true, updates = false),
			RefreshPlan.make(RefreshScope.HOME, false, true, now + 60_000, justFetched),
		)
		assertEquals(
			RefreshPlan(identity = true, apps = true, disk = true, favorites = true, updates = true),
			RefreshPlan.make(RefreshScope.HOME, false, true, now + 300_000, justFetched),
		)
	}

	@Test
	fun pullToRefreshForcesEverythingTheTabShows() {
		assertEquals(
			RefreshPlan(identity = true, apps = true, disk = false, favorites = false, updates = true),
			RefreshPlan.make(RefreshScope.APPS, true, true, now, justFetched),
		)
		// A forced connection check fetches identity only.
		assertEquals(
			RefreshPlan(identity = true, apps = false, disk = false, favorites = false, updates = false),
			RefreshPlan.make(RefreshScope.CONNECTION, true, true, now, justFetched),
		)
	}
}
