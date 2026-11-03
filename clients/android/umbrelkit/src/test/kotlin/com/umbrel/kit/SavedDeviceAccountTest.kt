package com.umbrel.kit

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SavedDeviceAccountTest {
	@Test
	fun topLevelPresentationDoesNotDefineAnAccountProfile() {
		val device = SavedDevice(
			id = "device",
			name = "Umbrel",
			host = "umbrel.local",
			addresses = listOf("umbrel.local"),
			userName = "Mayank",
			wallpaperId = "22",
		)

		assertEquals("Mayank", device.userName)
		assertEquals("22", device.wallpaperId)
		assertNull(device.accountProfile("0"))
		assertNull(device.accountProfile("member"))
	}

	@Test
	fun profilesAreStoredSeparatelyByAccount() {
		val device = SavedDevice(id = "device", name = "Umbrel", host = "umbrel.local", addresses = listOf("umbrel.local"))
			.saveAccountProfile(accountId = "0", name = "Mayank", wallpaperId = "22", wallpaperBrandColorHsl = "92 52% 41%", role = "owner")
			.saveAccountProfile(accountId = "nate", name = "Nate", wallpaperId = "4", wallpaperBrandColorHsl = "198 100% 31%", role = "member")

		assertEquals(SavedAccountProfile(name = "Mayank", wallpaperId = "22", wallpaperBrandColorHsl = "92 52% 41%", role = "owner"), device.accountProfile("0"))
		assertEquals(SavedAccountProfile(name = "Nate", wallpaperId = "4", wallpaperBrandColorHsl = "198 100% 31%", role = "member"), device.accountProfile("nate"))
		assertEquals("Nate", device.userName)
		assertEquals("4", device.wallpaperId)
		assertEquals("nate", device.lastAccountId)
	}

	@Test
	fun httpsWarningPreferenceRoundTrips() {
		val device = SavedDevice(
			id = "device",
			name = "Umbrel",
			host = "umbrel.local",
			addresses = listOf("umbrel.local"),
			suppressHTTPSRequiredAppWarning = true,
		)

		val decoded = Config.json.decodeFromString(SavedDevice.serializer(), Config.json.encodeToString(SavedDevice.serializer(), device))

		assertTrue(decoded.suppressHTTPSRequiredAppWarning == true)
	}
}
