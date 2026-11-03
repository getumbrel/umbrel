package com.umbrel.android.main

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class AppIconUrlTest {
	@Test
	fun acceptsPlainHttpsUrls() {
		val icon = "https://getumbrel.github.io/umbrel-apps-gallery/nextcloud/icon.svg"
		assertEquals(icon, appIconUrl(icon))
		assertEquals("HTTPS://example.com/icon.png", appIconUrl("HTTPS://example.com/icon.png"))
	}

	@Test
	fun rejectsAnythingElse() {
		assertNull(appIconUrl(null))
		assertNull(appIconUrl(""))
		assertNull(appIconUrl("http://example.com/icon.svg"))
		assertNull(appIconUrl("https://user:pass@example.com/icon.svg"))
		assertNull(appIconUrl("https:///icon.svg"))
		assertNull(appIconUrl("file:///data/icon.svg"))
		assertNull(appIconUrl("not a url"))
	}
}
