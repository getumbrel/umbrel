package com.umbrel.android

import com.umbrel.kit.SavedAccountProfile
import com.umbrel.kit.SavedDevice
import com.umbrel.kit.SecretStore
import com.umbrel.kit.Umbreld
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class DeviceStoreTest {
	private val device = SavedDevice(id = "device", name = "umbrel", host = "umbrel.local", model = "Umbrel Home")
	private val wallpaper = Umbreld.Wallpaper("18", "259 100% 59%")

	private fun session(accountId: String) = Umbreld.Session("device", accountId, "access", 1L, "grant")

	@Test
	fun onlyAMissingOrUnreadableSessionIsSignedOut() {
		val session = session("0")
		assertTrue(SecretStore.SessionReadResult.Found(session).isSignedIn)
		assertTrue(SecretStore.SessionReadResult.Unavailable("locked", null).isSignedIn)
		assertFalse(SecretStore.SessionReadResult.Missing.isSignedIn)
		assertFalse(SecretStore.SessionReadResult.Invalid.isSignedIn)
	}

	@Test
	fun signingInWithThePickedAccountSavesItsProfile() {
		val signedIn = device.signedIn(session("7"), Umbreld.Account("7", "Satoshi", wallpaper))
		assertEquals(SavedAccountProfile("Satoshi", "18", "259 100% 59%", "member"), signedIn.accountProfile("7"))
		assertEquals("7", signedIn.lastAccountId)
		assertEquals("Satoshi", signedIn.userName)
		assertEquals("18", signedIn.wallpaperId)

		assertEquals("owner", device.signedIn(session("0"), Umbreld.Account("0", "Nate", wallpaper)).accountProfile("0")?.role)
	}

	@Test
	fun anotherAccountReusesItsSavedProfile() {
		val known = device
			.saveAccountProfile("7", "Satoshi", "4", null, "member")
			.saveAccountProfile("0", "Nate", "18", "259 100% 59%", "owner")
		// The sheet's picked account didn't sign in, so the session's own profile applies.
		val signedIn = known.signedIn(session("7"), Umbreld.Account("0", "Nate", wallpaper))
		assertEquals("7", signedIn.lastAccountId)
		assertEquals("Satoshi", signedIn.userName)
		assertEquals("4", signedIn.wallpaperId)
	}

	@Test
	fun anUnknownAccountOnlyMovesThePickerPreference() {
		val known = device.saveAccountProfile("0", "Nate", "18", null, "owner")
		val signedIn = known.signedIn(session("9"), account = null)
		assertEquals(known.copy(lastAccountId = "9"), signedIn)
	}
}
