package com.umbrel.kit.backup

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PhotoBackupSourceNameTest {
	@Test
	fun keepsNamesWithJoinedEmoji() {
		val flag = "Nate\u2019s Pixel \uD83C\uDFF3\uFE0F\u200D\uD83C\uDF08"
		assertEquals(flag, PhotoBackupSourceName.suggested(flag))
		val developer = "\uD83E\uDDD1\u200D\uD83D\uDCBB Dev phone"
		assertEquals(developer, PhotoBackupSourceName.suggested(developer))
	}

	@Test
	fun rejectsWhatUmbrelOSRejects() {
		assertNull(PhotoBackupSourceName.suggested("Nate\u0007s Pixel"))
		assertNull(PhotoBackupSourceName.suggested("Nate\u007Fs Pixel"))
		assertNull(PhotoBackupSourceName.suggested("  \n"))
		assertNull(PhotoBackupSourceName.suggested(null))
	}

	@Test
	fun trims() {
		assertEquals("Nate\u2019s Pixel", PhotoBackupSourceName.suggested("  Nate\u2019s Pixel \n"))
	}

	// umbrelOS counts UTF-16 code units, so 60 emoji (120 units) are cut to 50.
	@Test
	fun fitsUmbrelOSLengthLimit() {
		val emoji = "\uD83D\uDE00"
		val suggested = PhotoBackupSourceName.suggested(emoji.repeat(60))
		assertEquals(emoji.repeat(50), suggested)
		assertEquals(100, suggested?.length)

		assertEquals(100, PhotoBackupSourceName.suggested("a".repeat(150))?.length)
		// A joined emoji that would straddle the limit is left out whole.
		val family = "\uD83D\uDC68\u200D\uD83D\uDC69\u200D\uD83D\uDC67"
		assertEquals("a".repeat(95), PhotoBackupSourceName.suggested("a".repeat(95) + family))
	}

	@Test
	fun aNewSourceTakesTheNextFreeName() {
		val name = "Nate\u2019s Pixel"
		assertEquals(name, PhotoBackupSourceName.unique(name, listOf("Pixel")))
		assertEquals("$name (2)", PhotoBackupSourceName.unique(name, listOf(name)))
		assertEquals("$name (3)", PhotoBackupSourceName.unique(name, listOf(name.uppercase(), "$name (2)")))
		// Still within umbrelOS's limit once the number is added
		val long = "a".repeat(100)
		val unique = PhotoBackupSourceName.unique(long, listOf(long))
		assertTrue(unique.endsWith(" (2)"))
		assertEquals(100, unique.length)
	}
}
