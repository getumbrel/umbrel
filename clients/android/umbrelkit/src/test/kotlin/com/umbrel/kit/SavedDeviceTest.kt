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
	fun privateEndpointHostsAreLocalNamesAndLanLinkLocalAndTailscaleAddresses() {
		assertTrue(SavedDevice.isPrivateEndpointHost("umbrel.local"))
		assertTrue(SavedDevice.isPrivateEndpointHost("192.168.1.5"))
		assertTrue(SavedDevice.isPrivateEndpointHost("10.0.0.1"))
		assertTrue(SavedDevice.isPrivateEndpointHost("172.31.255.254"))
		assertTrue(SavedDevice.isPrivateEndpointHost("169.254.10.10"))
		assertTrue(SavedDevice.isPrivateEndpointHost("100.64.0.1"))
		// Nothing else, least of all an address or name a public authority can certify.
		assertFalse(SavedDevice.isPrivateEndpointHost("8.8.8.8"))
		assertFalse(SavedDevice.isPrivateEndpointHost("100.128.0.1"))
		assertFalse(SavedDevice.isPrivateEndpointHost("172.32.0.1"))
		assertFalse(SavedDevice.isPrivateEndpointHost("umbrel.example.com"))
		assertFalse(SavedDevice.isPrivateEndpointHost("umbrel.my-tailnet.ts.net"))
		assertFalse(SavedDevice.isPrivateEndpointHost("umbrel"))
		assertFalse(SavedDevice.isPrivateEndpointHost("127.0.0.1"))
		assertFalse(SavedDevice.isPrivateEndpointHost(""))
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
