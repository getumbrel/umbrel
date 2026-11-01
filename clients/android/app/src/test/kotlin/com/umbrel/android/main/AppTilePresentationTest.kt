package com.umbrel.android.main

import com.umbrel.kit.Umbreld
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AppTilePresentationTest {
	@Test
	fun availableAndStoppedStatesMatchUmbrelOSPresentation() {
		val available = AppTilePresentation.from("ready")
		assertFalse(available.dimsIcon)
		assertNull(available.symbol)
		assertEquals("Files", available.label("Files"))

		val stopped = AppTilePresentation.from("stopped")
		assertTrue(stopped.dimsIcon)
		assertEquals(AppTilePresentation.Symbol.PAUSED, stopped.symbol)
		assertEquals("Files", stopped.label("Files"))
		assertEquals("Stopped", stopped.accessibilityValue)
	}

	@Test
	fun unknownAndFutureStatesUseUnavailablePresentation() {
		for (state in listOf("unknown", "future-state", null)) {
			val presentation = AppTilePresentation.from(state)
			assertTrue(presentation.dimsIcon)
			assertEquals(AppTilePresentation.Symbol.UNAVAILABLE, presentation.symbol)
			assertEquals("Offline", presentation.label("Files"))
			assertEquals("Offline", presentation.accessibilityValue)
		}
	}

	@Test
	fun lifecycleActivitiesUseUmbrelOSLabels() {
		val expected = mapOf(
			"installing" to "Files",
			"starting" to "Starting…",
			"running" to "Files",
			"stopping" to "Stopping…",
			"restarting" to "Restarting…",
			"uninstalling" to "Uninstalling…",
			"updating" to "Updating…",
		)
		for ((state, label) in expected) {
			val presentation = AppTilePresentation.from(state)
			assertTrue(state, presentation.dimsIcon)
			assertNull(state, presentation.symbol)
			assertEquals(state, label, presentation.label("Files"))
		}
	}

	@Test
	fun onlyInstallingAndUpdatingUseClampedReportedProgress() {
		assertEquals(0.0, AppTilePresentation.from("installing").reportedProgress(-1.0)!!, 0.0)
		assertEquals(42.5, AppTilePresentation.from("updating").reportedProgress(42.5)!!, 0.0)
		assertEquals(100.0, AppTilePresentation.from("updating").reportedProgress(101.0)!!, 0.0)
		assertNull(AppTilePresentation.from("updating").reportedProgress(Double.NaN))
		assertNull(AppTilePresentation.from("updating").reportedProgress(null))
		assertNull(AppTilePresentation.from("starting").reportedProgress(50.0))
		assertNull(AppTilePresentation.from("ready").reportedProgress(50.0))
	}

	@Test
	fun runningAppsOpenWhileTransitionsIgnoreTaps() {
		assertEquals(AppLaunchDisposition.AVAILABLE, AppLaunchDisposition.from("ready"))
		assertEquals(AppLaunchDisposition.AVAILABLE, AppLaunchDisposition.from("running"))
		assertEquals(AppLaunchDisposition.PAUSED, AppLaunchDisposition.from("stopped"))
		for (state in listOf("installing", "starting", "stopping", "restarting", "uninstalling", "updating")) {
			assertEquals(state, AppLaunchDisposition.BUSY, AppLaunchDisposition.from(state))
		}
		for (state in listOf("unknown", "future-state", null)) {
			assertEquals(AppLaunchDisposition.OFFLINE, AppLaunchDisposition.from(state))
		}
	}

	@Test
	fun launchAlertsUseOwnerAndMemberCopy() {
		val app = Umbreld.AppSummary(id = "nextcloud", name = "Nextcloud")
		val paused = AppLaunchAlert.Blocked(app, paused = true)
		val offline = AppLaunchAlert.Blocked(app, paused = false)
		assertEquals("Nextcloud is Paused", paused.title)
		assertEquals("Nextcloud is Offline", offline.title)
		assertEquals("Open Umbrel to start this app.", paused.message(canManageApps = true))
		assertEquals("Open Umbrel to restart or troubleshoot this app.", offline.message(canManageApps = true))
		assertEquals("Ask the Umbrel owner to start this app.", paused.message(canManageApps = false))
		assertEquals("Ask the Umbrel owner to restart this app.", offline.message(canManageApps = false))
		assertEquals("", paused.ownerDestination(canManageApps = true))
		assertNull(paused.ownerDestination(canManageApps = false))

		val tor = AppLaunchAlert.TorOnly(Umbreld.AppSummary(id = "tor-app"))
		assertEquals("tor-app Uses Tor", tor.title)
		assertEquals("/settings/advanced/tor", tor.ownerDestination(canManageApps = true))
		assertNull(tor.ownerDestination(canManageApps = false))
		assertTrue(tor.message(canManageApps = false).endsWith("then open Umbrel in Tor Browser."))

		assertEquals("Can’t Reach Umbrel", AppLaunchAlert.Unavailable().title)
		assertNull(AppLaunchAlert.Unavailable().ownerDestination(canManageApps = true))
		// After a reset the Umbrel answers as a different one, which needs Reconnect, not patience.
		assertEquals("Umbrel Not Recognized", AppLaunchAlert.Unavailable(identityChanged = true).title)
		assertTrue(AppLaunchAlert.Unavailable(identityChanged = true).message(canManageApps = true).contains("Reconnect"))
	}

	@Test
	fun appsSubtitleShowsUpdatesOnlyToAccountsThatCanInstallThem() {
		assertEquals("1 app", appsSubtitle(1, 0, canManageApps = true))
		assertEquals("12 apps · 1 update", appsSubtitle(12, 1, canManageApps = true))
		assertEquals("12 apps · 3 updates", appsSubtitle(12, 3, canManageApps = true))
		assertEquals("12 apps", appsSubtitle(12, 3, canManageApps = false))
		assertEquals("0 apps", appsSubtitle(0, 0, canManageApps = true))
	}
}
