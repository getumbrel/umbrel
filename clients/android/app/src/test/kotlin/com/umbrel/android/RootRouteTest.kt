package com.umbrel.android

import com.umbrel.android.onboarding.OnboardingMode
import com.umbrel.kit.SavedDevice
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class RootRouteTest {
	private val home = SavedDevice(id = "home", name = "umbrel", host = "umbrel.local", model = "Umbrel Home")
	private val pro = SavedDevice(id = "pro", name = "umbrel-pro", host = "umbrel-pro.local", model = "Umbrel Pro")

	private fun route(
		devices: List<SavedDevice>,
		selectedId: String = "",
		signedIn: Map<String, Boolean>? = mapOf("home" to true, "pro" to true),
		onboarding: OnboardingMode? = null,
		removals: SavedDeviceRemovals.State = SavedDeviceRemovals.State(),
	) = rootRoute(devices, selectedId, signedIn, onboarding, removals)

	@Test
	fun routesAsOnIOS() {
		assertEquals(RootRoute.Onboarding(OnboardingMode.FIRST_RUN), route(emptyList()))
		assertEquals(RootRoute.Onboarding(OnboardingMode.ADD_DEVICE), route(listOf(home), onboarding = OnboardingMode.ADD_DEVICE))
		assertEquals(RootRoute.Loading, route(listOf(home), signedIn = null))
		assertEquals(RootRoute.Device(home), route(listOf(home, pro), selectedId = "home"))
		assertEquals(RootRoute.AllDevices, route(listOf(home), selectedId = "home", signedIn = mapOf("home" to false)))
		assertEquals(RootRoute.AllDevices, route(listOf(home), selectedId = "gone"))
	}

	@Test
	fun anUmbrelBeingRemovedStaysWhereItWasUntilItsGone() {
		val removing = SavedDeviceRemovals.State(removing = mapOf("home" to home))
		// It was the only Umbrel: the list it's leaving, not first-run onboarding, where it
		// could be added again.
		assertEquals(RootRoute.AllDevices, route(emptyList(), removals = removing))
		// Reconnect from its own screen: that screen stays, showing it's reconnecting, before
		// and after its config is written.
		assertEquals(RootRoute.Device(home), route(listOf(home), selectedId = "home", removals = removing))
		assertEquals(RootRoute.Device(home), route(listOf(pro), selectedId = "home", removals = removing))
	}

	@Test
	fun theListKeepsAnUmbrelBeingRemovedInItsPlace() {
		val removing = SavedDeviceRemovals.State(removing = mapOf("home" to home))
		assertEquals(listOf(home, pro), removing.shown(listOf(pro)))
		// Until its config is written, the saved one shows, with any address discovery updated.
		val moved = home.copy(host = "umbrel-2.local")
		assertEquals(listOf(moved, pro), removing.shown(listOf(moved, pro)))
		assertEquals(listOf(pro), SavedDeviceRemovals.State().shown(listOf(pro)))
	}

	@Test
	fun reconnectAddsAnUmbrelOnceItsRemovalHasFinished() {
		val added = SavedDeviceRemovals.State(addsDevice = true)
		assertEquals(RootRoute.Onboarding(OnboardingMode.ADD_DEVICE), route(emptyList(), removals = added))
		assertEquals(RootRoute.Onboarding(OnboardingMode.ADD_DEVICE), route(listOf(pro), selectedId = "pro", removals = added))
		// The selection is cleared just after: the removed Umbrel's screen doesn't come back.
		assertEquals(RootRoute.Onboarding(OnboardingMode.ADD_DEVICE), route(listOf(pro), selectedId = "home", removals = added))
		assertEquals(RootRoute.AllDevices, route(listOf(pro), selectedId = "home"))
	}

	@Test
	fun aRemovedUmbrelsSignInSheetIsForgottenOnceItsRemovalHasFinished() {
		assertFalse(SavedDeviceRemovals.State(removing = mapOf("home" to home)).forgetsSignIn("home", listOf(pro)))
		assertTrue(SavedDeviceRemovals.State().forgetsSignIn("home", listOf(pro)))
		// Still saved, as after a config that couldn't be written: the sheet stays open.
		assertFalse(SavedDeviceRemovals.State().forgetsSignIn("home", listOf(home)))
		assertFalse(SavedDeviceRemovals.State().forgetsSignIn(null, listOf(pro)))
	}
}
