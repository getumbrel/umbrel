package com.umbrel.kit

import org.junit.Assert.assertEquals
import org.junit.Test

class DeviceKindTest {
	@Test
	fun recognizesEverySupportedHardwareFamily() {
		val cases = listOf(
			"Umbrel Home (2025)" to UmbrelDeviceKind.HOME,
			"Umbrel Pro" to UmbrelDeviceKind.PRO,
			"ASUS NUC 14 Essential" to UmbrelDeviceKind.ASUS_NUC_14_ESSENTIAL,
			"ASUS NUC 16 Pro" to UmbrelDeviceKind.ASUS_NUC_16_PRO,
			"ASUS ROG NUC 16" to UmbrelDeviceKind.ASUS_ROG_NUC_16,
			"Raspberry Pi 5" to UmbrelDeviceKind.RASPBERRY_PI,
			"Raspberry Pi 4" to UmbrelDeviceKind.RASPBERRY_PI,
			// umbreld names an ASUS NUC it has no render for just "ASUS NUC"
			"ASUS NUC" to UmbrelDeviceKind.GENERIC,
			"Standard PC (Q35 + ICH9, 2009)" to UmbrelDeviceKind.GENERIC,
		)
		for ((model, expected) in cases) {
			assertEquals(model, expected, UmbrelDeviceKind.fromModel(model))
		}
	}

	@Test
	fun missingModelUsesGenericHardware() {
		assertEquals(UmbrelDeviceKind.GENERIC, UmbrelDeviceKind.fromModel(null))
	}
}
