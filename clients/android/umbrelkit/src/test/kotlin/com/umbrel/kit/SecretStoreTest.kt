package com.umbrel.kit

import com.umbrel.kit.SecretStore.RawReadResult
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

// Ports the Swift KeychainTests classification cases. Android reads a sealed file instead
// of a Keychain item, so an OSStatus maps onto RawReadResult: errSecItemNotFound is Missing,
// errSecSuccess with data is Found, and any other status is Unavailable.
class SecretStoreTest {
	private val session = Umbreld.Session("device", "0", "access", 1, "device-token")

	@Test
	fun missingItemIsDefinitive() {
		assertEquals(SecretStore.SessionReadResult.Missing, SecretStore.classifySessionRead(RawReadResult.Missing))
	}

	@Test
	fun transientStorageFailureIsNotMissing() {
		val read = SecretStore.classifySessionRead(RawReadResult.Unavailable("IOException"))

		assertTrue(read is SecretStore.SessionReadResult.Unavailable)
		assertEquals("IOException", (read as SecretStore.SessionReadResult.Unavailable).reason)
		assertNull(read.cachedSession)
	}

	@Test
	fun transientFailureCanRetainTheLastKnownSession() {
		val result = SecretStore.SessionReadResult.Unavailable("IOException", cachedSession = session)

		assertEquals(session, result.sessionOrCached)
	}

	@Test
	fun malformedStoredSessionIsInvalid() {
		assertEquals(SecretStore.SessionReadResult.Invalid, SecretStore.classifySessionRead(RawReadResult.Found("not-json".toByteArray())))
	}

	@Test
	fun validStoredSessionIsReturned() {
		val data = Umbreld.json.encodeToString(Umbreld.Session.serializer(), session).toByteArray()

		assertEquals(SecretStore.SessionReadResult.Found(session), SecretStore.classifySessionRead(RawReadResult.Found(data)))
	}

	@Test
	fun storedSessionWithoutAccountIdIsInvalid() {
		val data = """{"deviceId":"device","accessToken":"access","accessExpiresAt":1,"deviceToken":"device-token"}""".toByteArray()

		assertEquals(SecretStore.SessionReadResult.Invalid, SecretStore.classifySessionRead(RawReadResult.Found(data)))
	}

	// Not in the Swift suite: Android-only storage outcomes.

	@Test
	fun aSessionThatCanNeverBeDecryptedIsSignedOut() {
		// A Keystore key lost with a restore, or a damaged file, never recovers.
		assertEquals(SecretStore.SessionReadResult.Invalid, SecretStore.classifySessionRead(RawReadResult.Undecryptable))
	}

	@Test
	fun aSessionWithoutADeviceTokenIsSignedOut() {
		val data = Umbreld.json.encodeToString(Umbreld.Session.serializer(), session.copy(deviceToken = "")).toByteArray()

		assertEquals(SecretStore.SessionReadResult.Invalid, SecretStore.classifySessionRead(RawReadResult.Found(data)))
	}

	@Test
	fun anUnreadablePinIsNeverReportedAsAbsent() {
		// Absence would let sign-in recovery replace the pin by first use.
		assertTrue(SecretStore.classifyLocalHttpsCaRead(RawReadResult.Undecryptable) is SecretStore.LocalHttpsCaReadResult.Unavailable)
		assertTrue(SecretStore.classifyLocalHttpsCaRead(RawReadResult.Unavailable("IOException")) is SecretStore.LocalHttpsCaReadResult.Unavailable)
		assertEquals(SecretStore.LocalHttpsCaReadResult.Missing, SecretStore.classifyLocalHttpsCaRead(RawReadResult.Missing))
	}

	@Test
	fun sessionsAreStoredWithTheAppleKeychainKeys() {
		val element = Umbreld.json.parseToJsonElement(Umbreld.json.encodeToString(Umbreld.Session.serializer(), session)) as JsonObject

		assertEquals(setOf("deviceId", "accountId", "accessToken", "accessExpiresAt", "deviceToken"), element.keys)
		assertEquals(JsonPrimitive("access"), element["accessToken"])
	}
}
