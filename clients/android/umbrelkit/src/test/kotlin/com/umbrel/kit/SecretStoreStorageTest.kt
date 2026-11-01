package com.umbrel.kit

import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import org.junit.runner.RunWith
import java.io.File
import java.security.MessageDigest

// Runs the real sealed-file store against an in-memory Keystore. Robolectric supplies the
// android.security.keystore classes SecretStore builds its key spec with.
@RunWith(AndroidJUnit4::class)
class SecretStoreStorageTest {
	@get:Rule
	val temporary = TemporaryFolder()

	private lateinit var directory: File
	private val session = Umbreld.Session("device", "0", "access", 1, "device-token")

	@Before
	fun setUp() {
		SoftwareKeyStore.install()
		directory = temporary.newFolder("secrets")
		SecretStore.initialize(directory)
	}

	@After
	fun tearDown() = SoftwareKeyStore.clear()

	@Test
	fun explicitClaimCanReplaceAStaleUnsavedCa() {
		val deviceId = "keychain-test"
		val stale = "stale-candidate".toByteArray()
		val selected = "explicitly-selected-candidate".toByteArray()

		assertEquals(SecretStore.LocalHttpsCaStoreResult.STORED, SecretStore.storeLocalHttpsCaIfAbsent(stale, deviceId))
		// Ordinary enrollment remains write-once; only the explicit unsaved-device claim
		// below may recover this stale identity.
		assertEquals(SecretStore.LocalHttpsCaStoreResult.CONFLICTS, SecretStore.storeLocalHttpsCaIfAbsent(selected, deviceId))
		assertEquals(SecretStore.LocalHttpsCaStoreResult.STORED, SecretStore.replaceLocalHttpsCa(selected, deviceId))
		assertArrayEquals(selected, foundCa(deviceId))
	}

	@Test
	fun browserSessionRoundTripsAndIsReplacedInPlace() {
		val session = browserSession("device", "0", appCookie = "app-value")
		val replacement = browserSession("device", "0", appCookie = null, dashboardToken = "next-token")

		assertTrue(SecretStore.setBrowserSession(session))
		assertEquals(session, SecretStore.readBrowserSession("device"))
		assertTrue(SecretStore.setBrowserSession(replacement))
		assertEquals(replacement, SecretStore.readBrowserSession("device"))

		SecretStore.deleteBrowserSession("device")
		assertNull(SecretStore.readBrowserSession("device"))
	}

	// One browser session per Umbrel, whichever account signed in last. Reads don't filter
	// by account; the stored account id is what lets a caller refuse another account's session.
	@Test
	fun browserSessionIsKeptPerUmbrelNotPerAccount() {
		val firstAccount = browserSession("device", "0", appCookie = "app-value")
		val secondAccount = browserSession("device", "1", appCookie = null, dashboardToken = "second-account-token")
		val otherUmbrel = browserSession("other-device", "0", appCookie = null)

		assertTrue(SecretStore.setBrowserSession(firstAccount))
		assertTrue(SecretStore.setBrowserSession(otherUmbrel))
		assertEquals("0", SecretStore.readBrowserSession("device")?.accountId)
		assertTrue(SecretStore.setBrowserSession(secondAccount))

		assertEquals(secondAccount, SecretStore.readBrowserSession("device"))
		assertEquals(otherUmbrel, SecretStore.readBrowserSession("other-device"))
		SecretStore.deleteBrowserSession("device")
		assertEquals(otherUmbrel, SecretStore.readBrowserSession("other-device"))
	}

	@Test
	fun deletingTheBrowserSessionKeepsTheNativeSession() {
		assertTrue(SecretStore.setSession(session, "device"))
		assertTrue(SecretStore.setBrowserSession(browserSession("device", "0", appCookie = null)))
		SecretStore.deleteBrowserSession("device")

		assertNull(SecretStore.readBrowserSession("device"))
		assertEquals(SecretStore.SessionReadResult.Found(session), SecretStore.readSession("device"))
	}

	// Not in the Swift suite: storage outcomes the Keychain provides by itself.

	@Test
	fun sessionsRoundTripUntilDeleted() {
		assertTrue(SecretStore.setSession(session, "device"))
		assertEquals(SecretStore.SessionReadResult.Found(session), SecretStore.readSession("device"))

		SecretStore.deleteSession("device")

		assertEquals(SecretStore.SessionReadResult.Missing, SecretStore.readSession("device"))
	}

	@Test
	fun enrollingTheSameCaTwiceAlreadyMatches() {
		assertEquals(SecretStore.LocalHttpsCaStoreResult.STORED, SecretStore.storeLocalHttpsCaIfAbsent("ca".toByteArray(), "device"))
		assertEquals(SecretStore.LocalHttpsCaStoreResult.ALREADY_MATCHES, SecretStore.storeLocalHttpsCaIfAbsent("ca".toByteArray(), "device"))
		assertEquals(SecretStore.LocalHttpsCaStoreResult.ALREADY_MATCHES, SecretStore.replaceLocalHttpsCa("ca".toByteArray(), "device"))
	}

	@Test
	fun secretsSealedByALostKeyAreSignedOutButPinsStayUnavailable() {
		SecretStore.setSession(session, "device")
		SecretStore.storeLocalHttpsCaIfAbsent("ca".toByteArray(), "device")

		// A restored or cleared Keystore no longer holds the key that sealed these files.
		SoftwareKeyStore.clear()

		assertEquals(SecretStore.SessionReadResult.Invalid, SecretStore.readSession("device"))
		assertTrue(SecretStore.readLocalHttpsCa("device") is SecretStore.LocalHttpsCaReadResult.Unavailable)
		// Recovery's first-use enrollment can't replace a pin it can't read.
		assertEquals(SecretStore.LocalHttpsCaStoreResult.UNAVAILABLE, SecretStore.storeLocalHttpsCaIfAbsent("other".toByteArray(), "device"))
	}

	@Test
	fun aSealedSessionCannotBeMovedToAnotherUmbrel() {
		SecretStore.setSession(session, "device")

		sealedFile("com.umbrel.android.session", "device").copyTo(sealedFile("com.umbrel.android.session", "other-device"))

		assertEquals(SecretStore.SessionReadResult.Invalid, SecretStore.readSession("other-device"))
	}

	@Test
	fun aTemporaryReadFailureKeepsTheLastKnownSession() {
		SecretStore.setSession(session, "device")
		val file = sealedFile("com.umbrel.android.session", "device")
		file.setReadable(false)
		try {
			val read = SecretStore.readSession("device")

			assertTrue(read is SecretStore.SessionReadResult.Unavailable)
			assertEquals(session, read.sessionOrCached)
		} finally {
			file.setReadable(true)
		}
	}

	@Test
	fun onlyTheSameLoginIsReplacedOrDeleted() {
		SecretStore.setSession(session, "device")
		val otherLogin = session.copy(accountId = "member", deviceToken = "member-token")

		assertFalse(SecretStore.replaceSession(otherLogin.copy(accessToken = "rotated"), otherLogin))
		SecretStore.deleteSession(otherLogin)
		assertEquals(SecretStore.SessionReadResult.Found(session), SecretStore.readSession("device"))

		assertTrue(SecretStore.replaceSession(session.copy(accessToken = "rotated"), session))
		assertEquals("rotated", (SecretStore.readSession("device") as SecretStore.SessionReadResult.Found).session.accessToken)
		SecretStore.deleteSession(session)
		assertEquals(SecretStore.SessionReadResult.Missing, SecretStore.readSession("device"))
	}

	private fun browserSession(deviceId: String, accountId: String, appCookie: String?, dashboardToken: String = "dashboard-token") =
		BrowserSession(deviceId, accountId, dashboardToken, "browser-value", appCookie)

	private fun foundCa(deviceId: String): ByteArray =
		(SecretStore.readLocalHttpsCa(deviceId) as SecretStore.LocalHttpsCaReadResult.Found).certificate

	// Mirrors SecretStore's file naming: a SHA-256 of the service and account names.
	private fun sealedFile(service: String, account: String): File {
		val digest = MessageDigest.getInstance("SHA-256").digest("$service\u0000$account".toByteArray())
		return File(directory, digest.joinToString("") { "%02x".format(it) } + ".bin")
	}
}
