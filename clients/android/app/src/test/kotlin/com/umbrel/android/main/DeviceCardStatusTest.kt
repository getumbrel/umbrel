package com.umbrel.android.main

import com.umbrel.kit.SecretStore
import com.umbrel.kit.Umbreld
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.IOException

class DeviceCardStatusTest {
	private val session = Umbreld.Session("device", "0", "access", 1L, "grant")
	private val user = Umbreld.UserInfo("0", "Satoshi", "owner", "/Home", wallpaper = Umbreld.Wallpaper("18", "259 100% 59%"))
	private val found = SecretStore.SessionReadResult.Found(session)

	@Test
	fun signedOutWinsOverAnyReachability() {
		for (connection in ConnectionState.entries) {
			assertEquals(DeviceCardStatus.SIGNED_OUT, deviceCardStatus(signedIn = false, connection))
		}
	}

	@Test
	fun aSignedInDeviceShowsItsLastConfirmedResult() {
		assertEquals(DeviceCardStatus.CHECKING, deviceCardStatus(signedIn = true, ConnectionState.UNVERIFIED))
		assertEquals(DeviceCardStatus.CONNECTED, deviceCardStatus(signedIn = true, ConnectionState.CONNECTED))
		assertEquals(DeviceCardStatus.OFFLINE, deviceCardStatus(signedIn = true, ConnectionState.UNAVAILABLE))
	}

	@Test
	fun connectedMeansTheUmbrelAnsweredAnAuthenticatedRequest() = runTest {
		var used: Umbreld.Session? = null
		val result = checkDevice(readSession = { found }, fetchUser = { used = it; user })
		assertEquals(DeviceCheck.Connected(user), result)
		assertEquals(session, used)
	}

	@Test
	fun aMissingOrUnreadableSessionIsSignedOutWithoutAnyRequest() = runTest {
		for (read in listOf(SecretStore.SessionReadResult.Missing, SecretStore.SessionReadResult.Invalid)) {
			val result = checkDevice(readSession = { read }, fetchUser = { error("no request without a session") })
			assertEquals(DeviceCheck.SignedOut, result)
		}
	}

	@Test
	fun unavailableStorageIsNotSignOut() = runTest {
		// Nothing cached to sign in with: offline rather than signed out.
		val empty = SecretStore.SessionReadResult.Unavailable("locked", cachedSession = null)
		assertEquals(DeviceCheck.Offline, checkDevice(readSession = { empty }, fetchUser = { error("no session to send") }))

		// A session cached from an earlier read is still used.
		val cached = SecretStore.SessionReadResult.Unavailable("locked", cachedSession = session)
		assertEquals(DeviceCheck.Connected(user), checkDevice(readSession = { cached }, fetchUser = { user }))
	}

	@Test
	fun anUnreachableUmbrelIsOffline() = runTest {
		val result = checkDevice(readSession = { found }, fetchUser = { throw IOException("timed out") })
		assertEquals(DeviceCheck.Offline, result)
	}

	@Test
	fun aSessionRemovedDuringTheRequestIsSignedOutNotOffline() = runTest {
		// The kit deletes the session when the Umbrel rejects it, so the re-read is missing.
		val reads = ArrayDeque(listOf<SecretStore.SessionReadResult>(found, SecretStore.SessionReadResult.Missing))
		val result = checkDevice(
			readSession = { reads.removeFirst() },
			fetchUser = { throw Umbreld.Error(401, "Unauthorized") },
		)
		assertEquals(DeviceCheck.SignedOut, result)
		assertTrue(reads.isEmpty())
	}

	@Test
	fun cancellationIsNotReportedAsOffline() = runTest {
		val thrown = try {
			checkDevice(readSession = { found }, fetchUser = { throw CancellationException("left the screen") })
			null
		} catch (cancelled: CancellationException) {
			cancelled
		}
		assertEquals("left the screen", thrown?.message)
	}
}
