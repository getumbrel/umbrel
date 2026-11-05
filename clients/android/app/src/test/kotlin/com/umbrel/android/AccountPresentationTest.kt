package com.umbrel.android

import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import com.umbrel.kit.Umbreld
import org.junit.Assert.assertEquals
import org.junit.Test

class AccountPresentationTest {
	private fun account(id: String, name: String = "User $id") = Umbreld.Account(id, name, Umbreld.Wallpaper("1", "259 100% 59%"))

	@Test
	fun gradientIndexMatchesUmbrelOs() {
		// Reference values from umbrelOS's hashString: `(hash * 31 + charCode) | 0`, then
		// Math.abs, modulo the 20 meshes. The negative hashes are where a floor modulo differs.
		val expected = mapOf(
			"0" to 8,
			"42" to 2,
			"alice" to 0,
			"bob" to 17,
			"usr_01HZX8" to 6,
			"Ünïcødé" to 3,
			"👋" to 2,
			"3f2a9c1e-7b4d-4e8a-9f10-2b3c4d5e6f70" to 16,
			"member-1" to 14,
			// Hashes to Int.MIN_VALUE, whose absolute value only fits in a Long.
			"polygenelubricants" to 8,
		)
		for ((id, index) in expected) assertEquals(id, index, AccountGradient.index(id))
	}

	@Test
	fun paletteMatchesUmbrelOs() {
		val all = AccountGradient.all
		assertEquals(20, all.size)
		assertEquals(listOf(0f to Color(0xFFFA709A), 1f to Color(0xFFFEE140)), all[0].stops)
		assertEquals(Color(0xFF231557), all[7].stops.first().second)
		assertEquals(listOf(0f, 0.29f, 0.67f, 1f), all[7].stops.map { it.first })
		assertEquals(9, all[19].stops.size)
		assertEquals(Color(0xFFF7C978), all[19].stops.last().second)
	}

	@Test
	fun gradientEndpointsFollowCssAngles() {
		// "to right" (90°) runs left to right across the middle.
		assertOffset(Offset(0f, 0.5f), AccountGradient.all[0].start)
		assertOffset(Offset(1f, 0.5f), AccountGradient.all[0].end)
		// "to top" (0°) runs bottom to top.
		assertOffset(Offset(0.5f, 1f), AccountGradient.all[1].start)
		assertOffset(Offset(0.5f, 0f), AccountGradient.all[1].end)
		// -225° is 135°: corner to corner, top-left to bottom-right.
		assertOffset(Offset(0f, 0f), AccountGradient.all[6].start)
		assertOffset(Offset(1f, 1f), AccountGradient.all[6].end)
	}

	private fun assertOffset(expected: Offset, actual: Offset) {
		assertEquals(expected.x, actual.x, 1e-5f)
		assertEquals(expected.y, actual.y, 1e-5f)
	}

	@Test
	fun ownerSitsInTheMiddleWithMembersAlternatingRightThenLeft() {
		val members = (1..4).map { account("m$it") }
		val arranged = arrangeAccounts(listOf(members[0], account("0"), members[1], members[2], members[3]))
		assertEquals(listOf("m4", "m2", "0", "m1", "m3"), arranged.map { it.userId })
	}

	@Test
	fun accountsWithoutAnOwnerKeepTheirOrder() {
		val accounts = listOf(account("b"), account("a"))
		assertEquals(accounts, arrangeAccounts(accounts))
	}

	@Test
	fun firstNameIsTheFirstWord() {
		assertEquals("Nate", accountFirstName("Nate Fretz"))
		assertEquals("Nate", accountFirstName("  Nate\tFretz "))
		assertEquals("Satoshi", accountFirstName("Satoshi"))
		assertEquals("   ", accountFirstName("   "))
	}

	@Test
	fun initialIsTheFirstCharacterUppercased() {
		assertEquals("N", accountInitial("  nate"))
		assertEquals("É", accountInitial("élodie"))
		assertEquals("👋", accountInitial("👋 hi"))
		assertEquals("", accountInitial("  "))
	}

	@Test
	fun dragSettlesOnTheNearestAccountWithinRange() {
		val stride = 130f
		// Dragging right moves toward lower indices; halves round away from zero.
		assertEquals(1, settledAccountIndex(2, 65f, stride, 5))
		assertEquals(2, settledAccountIndex(2, 64f, stride, 5))
		assertEquals(3, settledAccountIndex(2, -65f, stride, 5))
		assertEquals(2, settledAccountIndex(2, -64f, stride, 5))
		// Projections past either end clamp to the strip.
		assertEquals(0, settledAccountIndex(2, 10_000f, stride, 5))
		assertEquals(4, settledAccountIndex(2, -10_000f, stride, 5))
	}
}
