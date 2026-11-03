package com.umbrel.kit

import okhttp3.Cookie
import okhttp3.Headers.Companion.headersOf
import okhttp3.HttpUrl.Companion.toHttpUrl
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class BrowserSessionTest {
	@Test
	fun cookiesAreHostOnlySecureAndHiddenFromScripts() {
		val cookies = installed(session(appCookie = "app-value"), "umbrel.local")

		assertEquals(setOf(BrowserSession.BROWSER_COOKIE_NAME, BrowserSession.APP_COOKIE_NAME), cookies.map { it.name }.toSet())
		for (cookie in cookies) {
			assertEquals("umbrel.local", cookie.domain)
			assertTrue(cookie.hostOnly)
			assertEquals("/", cookie.path)
			assertTrue(cookie.secure)
			assertTrue(cookie.httpOnly)
			assertEquals("Lax", cookie.sameSite)
			assertTrue(cookie.persistent)
		}
		assertEquals("browser-value", cookies.first { it.name == BrowserSession.BROWSER_COOKIE_NAME }.value)
	}

	@Test
	fun cookiesWorkForAddressLiterals() {
		val cookies = installed(session(appCookie = null), "100.64.0.1")

		assertEquals(listOf(BrowserSession.BROWSER_COOKIE_NAME), cookies.map { it.name })
		assertEquals("100.64.0.1", cookies.first().domain)
	}

	@Test
	fun fingerprintIdentifiesALoginWithoutRevealingItsToken() {
		val session = session(appCookie = null)
		val other = session(appCookie = null, dashboardToken = "another-token")

		assertEquals(16, session.fingerprint.length)
		assertFalse(session.fingerprint.contains(session.dashboardToken))
		assertNotEquals(other.fingerprint, session.fingerprint)
	}

	// Pages compare the fingerprint across launches, and it's written into page script, so
	// it depends only on the token and stays plain hex.
	@Test
	fun fingerprintIsStableForTheSameLogin() {
		val session = session(appCookie = "app-value")
		val sameLogin = BrowserSession("other-umbrel", "1", "dashboard-token", "renewed-browser-value", null)
		val decoded = roundTrip(session)

		assertEquals("66e7ac6f0a868503", session.fingerprint)
		assertEquals(session.fingerprint, sameLogin.fingerprint)
		assertEquals(session.fingerprint, decoded.fingerprint)
	}

	@Test
	fun serializationKeepsEveryCredential() {
		val session = session(appCookie = "app-value")

		val decoded = roundTrip(session)

		assertEquals(session, decoded)
		assertEquals("app-value", decoded.appCookie)
	}

	@Test
	fun serializationKeepsAMissingAppCookieMissing() {
		val session = session(appCookie = null)

		val decoded = roundTrip(session)

		assertEquals(session, decoded)
		assertNull(decoded.appCookie)
	}

	@Test
	fun aSessionStoredBeforeLinkingExistedReadsAsAPasswordLogin() {
		val stored = """{"deviceId":"umbrel","accountId":"0","dashboardToken":"dashboard-token","browserCookie":"browser-value"}"""

		val decoded = Umbreld.json.decodeFromString(BrowserSession.serializer(), stored)

		assertEquals(session(appCookie = null), decoded)
		assertFalse(decoded.linked)
	}

	@Test
	fun serializationKeepsALinkedSessionLinked() {
		val session = session(appCookie = null).copy(linked = true)

		assertEquals(session, roundTrip(session))
	}

	// The Cookie header a request made with the installed cookies carries: each cookie
	// exactly as umbrelOS issued it, the app session only when there is one.
	@Test
	fun installedCookiesSendBothSessionsExactlyAsIssued() {
		val withApp = session(appCookie = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIwIn0.c2ln-_")
		val withoutApp = session(appCookie = null)

		assertEquals(
			"__Host-UMBREL_BROWSER_SESSION_HTTPS=browser-value; __Host-UMBREL_APP_SESSION_HTTPS=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIwIn0.c2ln-_",
			installed(withApp, "umbrel.local").joinToString("; ") { "${it.name}=${it.value}" },
		)
		assertEquals(withApp.cookieHeader, installed(withApp, "umbrel.local").joinToString("; ") { "${it.name}=${it.value}" })
		assertEquals("__Host-UMBREL_BROWSER_SESSION_HTTPS=browser-value", withoutApp.cookieHeader)
	}

	// umbrelOS sends each cookie in its own Set-Cookie header.
	@Test
	fun issuedCookiesReadsBothSessionCookiesFromALoginResponse() {
		val result = HttpResult(
			200,
			ByteArray(0),
			"application/json",
			headersOf(
				"Set-Cookie", "__Host-UMBREL_APP_SESSION_HTTPS=app-value; Path=/; Expires=Wed, 14 Oct 2026 10:00:00 GMT; HttpOnly; Secure; SameSite=Lax",
				"Set-Cookie", "__Host-UMBREL_BROWSER_SESSION_HTTPS=browser-value; Path=/; Expires=Wed, 14 Oct 2026 10:00:00 GMT; HttpOnly; Secure; SameSite=Lax",
			),
		)

		val cookies = issuedCookies("umbrel.local", result)

		assertEquals("browser-value", cookies[BrowserSession.BROWSER_COOKIE_NAME])
		assertEquals("app-value", cookies[BrowserSession.APP_COOKIE_NAME])
	}

	@Test
	fun aRefreshResponseCarriesTheSessionItMade() {
		val result = HttpResult(
			200,
			ByteArray(0),
			"application/json",
			headersOf(
				"Set-Cookie", "__Host-UMBREL_APP_SESSION_HTTPS=app-value; Path=/; HttpOnly; Secure; SameSite=Lax",
				"Set-Cookie", "__Host-UMBREL_BROWSER_SESSION_HTTPS=browser-value; Path=/; HttpOnly; Secure; SameSite=Lax",
			),
		)

		val session = issuedBrowserSession("umbrel.local", result, "user.refreshNativeAccess", "umbrel", "alice", "dashboard-token", linked = true)

		assertEquals(BrowserSession("umbrel", "alice", "dashboard-token", "browser-value", "app-value", linked = true), session)
	}

	@Test
	fun aTokenWithoutItsBrowserCookieIsNotASession() {
		val result = HttpResult(
			200,
			ByteArray(0),
			"application/json",
			headersOf("Set-Cookie", "__Host-UMBREL_APP_SESSION_HTTPS=app-value; Path=/; HttpOnly; Secure; SameSite=Lax"),
		)

		assertThrows(Umbreld.Error::class.java) {
			issuedBrowserSession("umbrel.local", result, "user.refreshNativeAccess", "umbrel", "alice", "dashboard-token")
		}
	}

	@Test
	fun userAgentNamesTheAndroidApp() {
		assertTrue(BrowserSession.userAgentToken.matches(Regex("""UmbrelApp/\S+ \(Android\)""")))
	}

	private fun installed(session: BrowserSession, host: String): List<Cookie> {
		val url = "https://$host/".toHttpUrl()
		return session.setCookieValues.map { requireNotNull(Cookie.parse(url, it)) }
	}

	private fun roundTrip(session: BrowserSession): BrowserSession =
		Umbreld.json.decodeFromString(BrowserSession.serializer(), Umbreld.json.encodeToString(BrowserSession.serializer(), session))

	private fun session(appCookie: String?, dashboardToken: String = "dashboard-token") =
		BrowserSession("umbrel", "0", dashboardToken, "browser-value", appCookie)
}
