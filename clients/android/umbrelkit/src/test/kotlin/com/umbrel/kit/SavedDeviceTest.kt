package com.umbrel.kit

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SavedDeviceTest {
	@Test
	fun tailscaleRangeIsExactlyCgnat() {
		assertTrue(SavedDevice.isTailscaleAddress("100.64.0.1"))
		assertTrue(SavedDevice.isTailscaleAddress("100.127.255.254"))
		assertFalse(SavedDevice.isTailscaleAddress("100.128.0.1"))
		assertFalse(SavedDevice.isTailscaleAddress("100.63.255.255"))
		assertFalse(SavedDevice.isTailscaleAddress("192.168.1.5"))
		assertFalse(SavedDevice.isTailscaleAddress("umbrel.local"))
	}

	@Test
	fun manualIPv4RangesMatchThePlaintextBootstrapPolicy() {
		assertTrue(SavedDevice.isSupportedManualIPv4Address("192.168.1.5"))
		assertTrue(SavedDevice.isSupportedManualIPv4Address("10.0.0.1"))
		assertTrue(SavedDevice.isSupportedManualIPv4Address("172.16.0.1"))
		assertFalse(SavedDevice.isSupportedManualIPv4Address("172.32.0.1"))
		assertTrue(SavedDevice.isSupportedManualIPv4Address("169.254.10.10"))
		assertFalse(SavedDevice.isSupportedManualIPv4Address("8.8.8.8"))
		assertFalse(SavedDevice.isSupportedManualIPv4Address("192.168.01.5"))
		assertFalse(SavedDevice.isSupportedManualIPv4Address("256.1.1.1"))
	}

	@Test
	fun bonjourHostnamesEndInLocal() {
		assertTrue(SavedDevice.isBonjourHostname("umbrel.local"))
		assertTrue(SavedDevice.isBonjourHostname("UMBREL.LOCAL"))
		assertFalse(SavedDevice.isBonjourHostname("local"))
		assertFalse(SavedDevice.isBonjourHostname("umbrel.example.com"))
		assertFalse(SavedDevice.isBonjourHostname("-bad.local"))
	}

	@Test
	fun connectionHostsDeduplicateCaseInsensitively() {
		val device = SavedDevice(id = "id", name = "Umbrel", host = "umbrel.local", addresses = listOf("192.168.1.5", "UMBREL.LOCAL", "", "192.168.1.5"))
		assertEquals(listOf("umbrel.local", "192.168.1.5"), device.connectionHosts)
	}



	@Test
	fun saveAccountProfileCachesPresentation() {
		val saved = SavedDevice(id = "id", name = "Umbrel", host = "umbrel.local").saveAccountProfile("0", "Patrick", "18", "259 100% 59%", "owner")
		assertEquals("Patrick", saved.userName)
		assertEquals("Patrick’s Umbrel", saved.displayName)
		assertEquals("owner", saved.accountProfile("0")?.role)
	}

}
