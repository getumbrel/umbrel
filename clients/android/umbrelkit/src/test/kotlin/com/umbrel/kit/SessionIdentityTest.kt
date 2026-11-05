package com.umbrel.kit

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SessionIdentityTest {
	@Test
	fun rotatedAccessTokenStillBelongsToSameLogin() {
		val original = session(accountId = "0", accessToken = "access-1", deviceToken = "device-token")
		val rotated = session(accountId = "0", accessToken = "access-2", deviceToken = "device-token")

		assertTrue(original.belongsToSameLogin(rotated))
	}

	@Test
	fun differentAccountNeverBelongsToSameLogin() {
		val owner = session(accountId = "0", accessToken = "owner-access", deviceToken = "owner-device")
		val member = session(accountId = "nate", accessToken = "member-access", deviceToken = "member-device")

		assertFalse(owner.belongsToSameLogin(member))
	}

	@Test
	fun newLoginForSameAccountHasDifferentIdentity() {
		val old = session(accountId = "0", accessToken = "access-1", deviceToken = "device-token-1")
		val new = session(accountId = "0", accessToken = "access-2", deviceToken = "device-token-2")

		assertFalse(old.belongsToSameLogin(new))
	}

	private fun session(accountId: String, accessToken: String, deviceToken: String) =
		Umbreld.Session(deviceId = "umbrel", accountId = accountId, accessToken = accessToken, accessExpiresAt = 1, deviceToken = deviceToken)
}
