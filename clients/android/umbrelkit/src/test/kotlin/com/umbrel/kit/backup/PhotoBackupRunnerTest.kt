package com.umbrel.kit.backup

import com.umbrel.kit.backup.PhotoBackupEngine.PassOutcome
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.currentTime
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PhotoBackupRunnerTest {
	private val homeWiFi = PhotoBackupNetwork.Traits(wifiOrEthernet = true, unmetered = true, roaming = false)
	private val mobileData = PhotoBackupNetwork.Traits(wifiOrEthernet = false, unmetered = false, roaming = false)

	@Test
	fun aPassOnAQualifyingNetworkRunsToItsEnd() = runTest {
		val outcome = PhotoBackupRunner.whileNetworkQualifies(MutableStateFlow(homeWiFi), allowsMobileData = false, userInitiated = false) {
			delay(60_000)
			PassOutcome.MoreWork
		}

		assertEquals(PassOutcome.MoreWork, outcome)
	}

	@Test
	fun aDefaultNetworkThatMovesToMobileDataStopsThePass() = runTest {
		val network = MutableStateFlow<PhotoBackupNetwork.Traits?>(homeWiFi)
		var finished = false
		launch {
			delay(1_000)
			network.value = mobileData
		}

		val outcome = PhotoBackupRunner.whileNetworkQualifies(network, allowsMobileData = false, userInitiated = false) {
			delay(60_000)
			finished = true
			PassOutcome.MoreWork
		}

		assertEquals(PassOutcome.WaitingForNetwork, outcome)
		assertFalse(finished)
		// Stopped once the move outlasted the grace period, not at the end of the pass.
		assertTrue(currentTime < 10_000)
	}

	@Test
	fun aBriefMoveRidesOutTheGracePeriod() = runTest {
		val network = MutableStateFlow<PhotoBackupNetwork.Traits?>(homeWiFi)
		launch {
			delay(1_000)
			network.value = null
			delay(1_000)
			network.value = homeWiFi
		}

		val outcome = PhotoBackupRunner.whileNetworkQualifies(network, allowsMobileData = false, userInitiated = false) {
			delay(60_000)
			PassOutcome.Completed
		}

		assertEquals(PassOutcome.Completed, outcome)
	}

	@Test
	fun withMobileDataAllowedTheMoveDoesntStopThePass() = runTest {
		val network = MutableStateFlow<PhotoBackupNetwork.Traits?>(homeWiFi)
		launch {
			delay(1_000)
			network.value = mobileData
		}

		val outcome = PhotoBackupRunner.whileNetworkQualifies(network, allowsMobileData = true, userInitiated = false) {
			delay(60_000)
			PassOutcome.Completed
		}

		assertEquals(PassOutcome.Completed, outcome)
	}

	@Test
	fun aStopFromOutsideIsStillACancellation() = runTest {
		val started = CompletableDeferred<Unit>()
		val job = launch {
			PhotoBackupRunner.whileNetworkQualifies(MutableStateFlow(homeWiFi), allowsMobileData = false, userInitiated = false) {
				started.complete(Unit)
				delay(60_000)
				PassOutcome.Completed
			}
		}
		started.await()
		job.cancel()
		job.join()

		assertTrue(job.isCancelled)
	}
}
