package com.umbrel.android.onboarding

import com.umbrel.kit.IdentifiedDevice
import com.umbrel.kit.Umbreld
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.withContext
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ManualAddressTest {
	private val umbrel = IdentifiedDevice("192.168.1.10", "192.168.1.10", emptyList(), "192.168.1.10", "home", "Umbrel Home", onboarded = true)
	private val found = Umbreld.ManualDiscoveryResult.Device(umbrel)
	private val onScreen = OnboardingState(step = OnboardingStep.MANUAL_ADDRESS)

	// The system Back leaves as the on-screen Back does. An Umbrel the check found afterwards
	// would open sign-in the next time the screen opened.
	@Test
	fun leavingDropsTheCheckEvenIfItsLookupFinishes() = runTest {
		val lookup = CompletableDeferred<Unit>()
		val manual = ManualAddress {
			withContext(NonCancellable) { lookup.await() }
			found
		}
		manual.open(from = OnboardingStep.NO_DEVICE)
		var answer: Umbreld.ManualDiscoveryResult? = null
		val check = launch { answer = manual.check("192.168.1.10") }
		runCurrent()

		assertEquals(OnboardingStep.NO_DEVICE, manual.close(onScreen).step)
		lookup.complete(Unit)
		check.join()

		assertNull(answer)
		assertTrue(check.isCancelled)
	}

	@Test
	fun aCheckAnswersWhileTheScreenIsOpen() = runTest {
		val manual = ManualAddress { found }
		manual.open(from = OnboardingStep.NO_DEVICE)

		assertEquals(found, manual.check("192.168.1.10"))
		// Results that appeared meanwhile are where Back goes
		assertEquals(OnboardingStep.DEVICE_FOUND, manual.close(onScreen.copy(devices = listOf(umbrel))).step)
	}

	@Test
	fun leavingTakesTheUmbrelFoundThereWithIt() {
		val manual = ManualAddress { found }
		manual.open(from = OnboardingStep.NO_DEVICE)

		val left = manual.close(onScreen.copy(selectedDevice = umbrel))

		assertEquals(OnboardingState(step = OnboardingStep.NO_DEVICE, movingForward = false), left)
	}

	// The screen animates away after signing in, and the Connected screen shows the Umbrel
	@Test
	fun backWhileTheScreenAnimatesAwayChangesNothing() {
		val manual = ManualAddress { found }
		manual.open(from = OnboardingStep.NO_DEVICE)
		val connected = onScreen.copy(step = OnboardingStep.CONNECTED, selectedDevice = umbrel, connectedDeviceId = "home")

		assertEquals(connected, manual.close(connected))
	}
}
