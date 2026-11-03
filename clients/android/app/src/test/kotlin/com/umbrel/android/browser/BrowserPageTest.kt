package com.umbrel.android.browser

import android.net.Uri
import android.webkit.MimeTypeMap
import androidx.compose.ui.graphics.Color
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [37])
class BrowserPageTest {
	@Test
	fun aLocationIsTheSameWhenOnlyTheFragmentOrTrailingSlashDiffers() {
		assertTrue(BrowserPage.isSameLocation(Uri.parse("https://umbrel.local"), Uri.parse("https://umbrel.local/")))
		assertTrue(BrowserPage.isSameLocation(Uri.parse("https://umbrel.local/files#top"), Uri.parse("https://umbrel.local/files")))
		assertFalse(BrowserPage.isSameLocation(Uri.parse("https://umbrel.local/files"), Uri.parse("https://umbrel.local/photos")))
		assertFalse(BrowserPage.isSameLocation(Uri.parse("https://umbrel.local/?a=1"), Uri.parse("https://umbrel.local/?a=2")))
	}

	@Test
	fun pageColorsAreReadFromCssAndATransparentBackgroundIsNone() {
		assertEquals(Color(0xFF112233), BrowserPage.parseCssColor("#112233"))
		assertEquals(Color(0xFFAABBCC), BrowserPage.parseCssColor("#abc"))
		assertEquals(Color(17 / 255f, 34 / 255f, 51 / 255f), BrowserPage.parseCssColor("rgb(17, 34, 51)"))
		assertEquals(Color(17 / 255f, 34 / 255f, 51 / 255f, 0.5f), BrowserPage.parseCssColor("rgba(17, 34, 51, 0.5)"))
		assertEquals(Color(17 / 255f, 34 / 255f, 51 / 255f, 0.5f), BrowserPage.parseCssColor("rgb(17 34 51 / 50%)"))
		assertNull(BrowserPage.parseCssColor("rgba(0, 0, 0, 0)"))
		assertNull(BrowserPage.parseCssColor("transparent"))
		assertNull(BrowserPage.parseCssColor("#12345"))
	}

	@Test
	fun fileInputAcceptListsBecomeMimeTypes() {
		shadowOf(MimeTypeMap.getSingleton()).addExtensionMimeTypeMapping("pdf", "application/pdf")
		assertEquals(emptyList<String>(), mimeTypes(arrayOf("*")))
		assertEquals(emptyList<String>(), mimeTypes(arrayOf("")))
		assertEquals(listOf("image/*"), mimeTypes(arrayOf("image/*")))
		assertEquals(listOf("image/*", "video/*"), mimeTypes(arrayOf("image/*,video/*")))
		assertEquals(listOf("application/pdf"), mimeTypes(arrayOf(".pdf")))
		// Anything at all wins over a narrower type.
		assertEquals(emptyList<String>(), mimeTypes(arrayOf("image/*", "*/*")))
	}

	@Test
	fun ipv6HostsAreBracketedForUrlsAndNamesAreLeftAlone() {
		assertEquals("[fd7a:115c:a1e0::1]", BrowserContext.bracketed("fd7a:115c:a1e0::1"))
		assertEquals("[fd7a:115c:a1e0::1]", BrowserContext.bracketed("[fd7a:115c:a1e0::1]"))
		assertEquals("umbrel.local", BrowserContext.bracketed("umbrel.local"))
		assertEquals("umbrel.local:8080", BrowserContext.bracketed("umbrel.local:8080"))
		assertEquals("umbrel.local", BrowserContext.normalized("UMBREL.local."))
		assertEquals("fd7a::1", BrowserContext.normalized("[fd7a::1]"))
	}
}
