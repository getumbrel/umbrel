package com.umbrel.kit

import kotlinx.coroutines.CancellationException
import kotlinx.serialization.Serializable
import okhttp3.Cookie
import okhttp3.HttpUrl.Companion.toHttpUrl
import java.security.MessageDigest

/**
 * The in-app browser shows umbrelOS and its apps exactly as a browser would, so it needs
 * the credentials umbrelOS gives a browser: a dashboard token plus two host-scoped cookies.
 * A native session can't be used in their place, but umbrelOS makes them from one (see
 * Umbreld.makeBrowserSession), linked to the app's sign-in.
 *
 * They're replayed into the web view for whichever of the Umbrel's addresses is reachable.
 * umbrelOS never rotates them; it only slides their expiry while the session is in use.
 */
@Serializable
data class BrowserSession(
	val deviceId: String,
	val accountId: String,
	val dashboardToken: String,
	// Cookie values are kept exactly as umbrelOS issued them.
	val browserCookie: String,
	val appCookie: String? = null,
	/**
	 * Made from the app's own sign-in, so umbrelOS ends it with that sign-in. Others (a
	 * password login, a sign-in on umbrelOS's own page) are replaced where umbrelOS can make
	 * one of these. Sessions stored before this existed were all password logins.
	 */
	val linked: Boolean = false,
) {
	/** Identifies this login to a web page without revealing any credential. */
	val fingerprint: String
		get() = MessageDigest.getInstance("SHA-256").digest(dashboardToken.toByteArray())
			.take(8).joinToString("") { "%02x".format(it) }

	/**
	 * Host-only, Secure, HttpOnly cookies equivalent to the ones umbrelOS sets at login, as
	 * Set-Cookie values for the web view's cookie store. The in-app browser only ever loads
	 * an Umbrel over HTTPS. Without a Domain attribute each cookie stays on the host it is
	 * set for, which the __Host- prefix requires and which works for IP addresses too.
	 */
	val setCookieValues: List<String>
		get() = cookies.map { (name, value) -> "$name=$value; Path=/; Max-Age=2592000; Secure; HttpOnly; SameSite=Lax" }

	internal val cookieHeader: String
		get() = cookies.joinToString("; ") { (name, value) -> "$name=$value" }

	/** Each cookie's name and value, exactly as umbrelOS issued it. */
	val cookies: List<Pair<String, String>>
		get() = listOf(BROWSER_COOKIE_NAME to browserCookie) + listOfNotNull(appCookie?.let { APP_COOKIE_NAME to it })

	companion object {
		const val BROWSER_COOKIE_NAME = "__Host-UMBREL_BROWSER_SESSION_HTTPS"
		const val APP_COOKIE_NAME = "__Host-UMBREL_APP_SESSION_HTTPS"
		const val TOKEN_STORAGE_KEY = "umbrel-auth-token"

		/**
		 * umbrelOS labels this login in the account's session list by its user agent. The
		 * in-app browser ends its own with the same token, so both show as this app.
		 */
		val userAgentToken: String
			get() = "UmbrelApp/${NativeClientInfo.current.appVersion} (Android)"
	}
}

enum class BrowserSessionStatus {
	VALID,

	/** umbrelOS no longer accepts these credentials. */
	INVALID,

	/** The Umbrel couldn't be asked; nothing was learned. */
	UNKNOWN,
}

@Serializable
private data class BrowserLoginInput(val userId: String, val password: String, val totpToken: String? = null)

suspend fun Umbreld.loginBrowser(target: Umbreld.Target, userId: String, password: String, totpToken: String?): BrowserSession {
	val body = json.encodeToString(BrowserLoginInput.serializer(), BrowserLoginInput(userId, password, totpToken))
	return withResolvedHost(target, Umbreld.ReplayPolicy.NEVER) { host ->
		val result = performRequestRaw(
			host, "user.login", "POST", target.deviceId, null, body, REQUEST_TIMEOUT_MS,
			userAgent = BrowserSession.userAgentToken,
		)
		val dashboardToken: String = decodeEnvelope(result, "user.login")
		issuedBrowserSession(host, result, "user.login", target.deviceId, userId, dashboardToken)
	}
}

/** The session a response made. Its cookies come with the response. */
internal fun issuedBrowserSession(
	host: String,
	result: HttpResult,
	path: String,
	deviceId: String,
	accountId: String,
	dashboardToken: String,
	linked: Boolean = false,
): BrowserSession {
	val cookies = issuedCookies(host, result)
	val browserCookie = cookies[BrowserSession.BROWSER_COOKIE_NAME]
		?: throw Umbreld.Error(0, "$path: missing browser session", Umbreld.ErrorKind.PROTOCOL_FAILURE)
	return BrowserSession(deviceId, accountId, dashboardToken, browserCookie, cookies[BrowserSession.APP_COOKIE_NAME], linked)
}

/** Extends the session's sliding expiry, which also proves it is still accepted. */
suspend fun Umbreld.renewBrowserSession(target: Umbreld.Target, session: BrowserSession): BrowserSessionStatus {
	val status = try {
		browserSessionRequest(target, session, "user.renewToken", Umbreld.ReplayPolicy.SAFE)
	} catch (cancelled: CancellationException) {
		throw cancelled
	} catch (error: Exception) {
		return BrowserSessionStatus.UNKNOWN
	}
	return when (status) {
		200 -> BrowserSessionStatus.VALID
		401, 403 -> BrowserSessionStatus.INVALID
		else -> BrowserSessionStatus.UNKNOWN
	}
}

/**
 * The account umbrelOS signs in with exactly these credentials. Null when it doesn't accept
 * them as one session, or couldn't be asked.
 */
suspend fun Umbreld.browserSessionAccountId(target: Umbreld.Target, session: BrowserSession): String? = try {
	withResolvedHost(target, Umbreld.ReplayPolicy.SAFE) { host ->
		val result = performRequestRaw(
			host, "user.get", "GET", target.deviceId, session.dashboardToken, null, REQUEST_TIMEOUT_MS,
			cookieHeader = session.cookieHeader,
			userAgent = BrowserSession.userAgentToken,
		)
		decodeEnvelope<Umbreld.UserInfo>(result, "user.get").userId
	}
} catch (cancelled: CancellationException) {
	throw cancelled
} catch (error: Exception) {
	null
}

suspend fun Umbreld.logoutBrowser(target: Umbreld.Target, session: BrowserSession) {
	browserSessionRequest(target, session, "user.logout", Umbreld.ReplayPolicy.NEVER)
}

private suspend fun Umbreld.browserSessionRequest(
	target: Umbreld.Target,
	session: BrowserSession,
	path: String,
	replay: Umbreld.ReplayPolicy,
): Int {
	val body = json.encodeToString(Umbreld.EmptyInput.serializer(), Umbreld.EmptyInput())
	return withResolvedHost(target, replay) { host ->
		performRequestRaw(
			host, path, "POST", target.deviceId, session.dashboardToken, body, REQUEST_TIMEOUT_MS,
			cookieHeader = session.cookieHeader,
			userAgent = BrowserSession.userAgentToken,
		).status
	}
}

/** The cookies a response sets, by name. umbrelOS sends each in its own Set-Cookie header. */
internal fun issuedCookies(host: String, result: HttpResult): Map<String, String> =
	Cookie.parseAll(Umbreld.httpsUrl(host, "/").toHttpUrl(), result.headers).associate { it.name to it.value }
