package com.umbrel.android

import com.umbrel.kit.Config
import com.umbrel.kit.SavedDevice
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SavedDeviceRemovalsTest {
	private val removals = SavedDeviceRemovals()
	private val device = SavedDevice(id = "device", name = "umbrel", host = "umbrel.local")
	private val events = mutableListOf<String>()
	private var stateWhenDeselected: SavedDeviceRemovals.State? = null
	private var configWrites = true

	// The Umbrel's answer to logging out, which can take a while.
	private var logOutAnswer = CompletableDeferred(Unit)

	private val steps = object : SavedDeviceRemovalSteps {
		override fun removeSaved() {
			if (!configWrites) throw Config.StorageException(Config.StorageIssue.SAVE_FAILED)
			events += "config"
		}

		override fun removeBackup() {
			events += "backup"
		}

		override suspend fun signOutBrowser() {
			events += "browser session"
		}

		override suspend fun logOut() {
			logOutAnswer.await()
			events += "native session"
		}

		override suspend fun deleteSession() {
			events += "delete session"
		}

		override suspend fun forgetCertificate() {
			events += "forget certificate"
		}

		override suspend fun deleteData() {
			events += "delete data"
		}

		override fun deselect() {
			events += "deselect"
			stateWhenDeselected = removals.state.value
		}
	}

	private val allSteps = listOf(
		"config", "backup", "browser session", "native session",
		"delete session", "forget certificate", "delete data", "deselect",
	)

	@Test
	fun sessionsAreRevokedOverTheOldCertificateBeforeItIsForgotten() = runTest {
		assertTrue(removals.remove(device, backgroundScope, addsDevice = false, steps))
		assertEquals(allSteps, events)
		// A plain removal goes back to the list.
		assertEquals(SavedDeviceRemovals.State(), removals.state.value)
	}

	@Test
	fun theWaitLastsUntilEveryStepHasRun() = runTest {
		logOutAnswer = CompletableDeferred()
		var returned = false
		launch {
			removals.remove(device, backgroundScope, addsDevice = false, steps)
			returned = true
		}
		runCurrent()
		// Gone from the config but not yet from the phone, so it still shows.
		assertEquals(listOf(device), removals.state.value.shown(emptyList()))
		assertFalse(returned)

		logOutAnswer.complete(Unit)
		runCurrent()
		assertEquals(allSteps, events)
		assertEquals(emptyList<SavedDevice>(), removals.state.value.shown(emptyList()))
		assertTrue(returned)
	}

	@Test
	fun theRemovalOutlivesTheScreenThatAsked() = runTest {
		logOutAnswer = CompletableDeferred()
		val sheet = launch { removals.remove(device, backgroundScope, addsDevice = false, steps) }
		runCurrent()
		// The sheet closes, or the whole screen is recreated.
		sheet.cancel()
		runCurrent()
		assertEquals(listOf(device), removals.state.value.shown(emptyList()))

		logOutAnswer.complete(Unit)
		runCurrent()
		assertEquals(allSteps, events)
		assertEquals(emptyList<SavedDevice>(), removals.state.value.shown(emptyList()))
	}

	@Test
	fun aConfigThatCantBeWrittenStopsBeforeAnythingElse() = runTest {
		configWrites = false
		assertFalse(removals.remove(device, backgroundScope, addsDevice = true, steps))
		assertEquals(emptyList<String>(), events)
		assertEquals(SavedDeviceRemovals.State(), removals.state.value)
	}

	@Test
	fun reconnectOpensAddingInTheSameUpdateThatEndsTheWait() = runTest {
		logOutAnswer = CompletableDeferred()
		val seen = mutableListOf<SavedDeviceRemovals.State>()
		backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) { removals.state.collect { seen += it } }
		launch { removals.remove(device, backgroundScope, addsDevice = true, steps) }
		runCurrent()
		logOutAnswer.complete(Unit)
		runCurrent()
		// Never a moment with neither the wait nor adding, when the list would flash, and the
		// selection is cleared only after, so the screen that asked stays until then.
		assertEquals(
			listOf(
				SavedDeviceRemovals.State(),
				SavedDeviceRemovals.State(removing = mapOf("device" to device)),
				SavedDeviceRemovals.State(addsDevice = true),
			),
			seen,
		)

		assertEquals(SavedDeviceRemovals.State(addsDevice = true), stateWhenDeselected)

		removals.addDeviceOpened()
		assertEquals(SavedDeviceRemovals.State(), removals.state.value)
	}

	@Test
	fun aSecondRequestWhileItsBeingRemovedRunsNothingAgain() = runTest {
		logOutAnswer = CompletableDeferred()
		launch { removals.remove(device, backgroundScope, addsDevice = false, steps) }
		runCurrent()
		assertTrue(removals.remove(device, backgroundScope, addsDevice = true, steps))
		assertEquals(listOf("config", "backup", "browser session"), events)

		logOutAnswer.complete(Unit)
		runCurrent()
		assertEquals(allSteps, events)
		// Only the first request's choice counts: a plain removal goes back to the list.
		assertEquals(SavedDeviceRemovals.State(), removals.state.value)
	}
}
