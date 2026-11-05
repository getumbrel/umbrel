package com.umbrel.android.browser

import android.annotation.SuppressLint
import android.content.Context
import android.content.MutableContextWrapper
import android.graphics.Color
import android.net.Uri
import android.view.ContextThemeWrapper
import android.webkit.CookieManager
import android.webkit.WebView
import androidx.annotation.MainThread
import androidx.webkit.ProfileStore
import androidx.webkit.ScriptHandler
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import com.umbrel.android.BuildConfig
import com.umbrel.android.R
import com.umbrel.kit.BrowserSession
import com.umbrel.kit.BrowserSessionStatus
import com.umbrel.kit.SecretStore
import com.umbrel.kit.Umbreld
import com.umbrel.kit.browserSessionAccountId
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonPrimitive
import java.lang.ref.WeakReference
import kotlin.coroutines.resume

/**
 * Everything the in-app browser needs to show one account on one Umbrel: a private WebView
 * profile, the Umbrel's addresses, and the umbrelOS browser session that keeps the user
 * signed in across all of them.
 */
@MainThread
internal class BrowserContext private constructor(
	private val appContext: Context,
	val deviceId: String,
	val accountId: String,
	hosts: Collection<String>,
	session: BrowserSession?,
	private val scope: CoroutineScope,
) {
	var hosts: Set<String> = hosts.map(::normalized).toSet()
		private set

	var session: BrowserSession? = session
		private set(value) {
			if (field == value) return
			field = value
			replaceScripts()
		}

	private val profileName = BrowserSessions.profileName(deviceId, accountId)

	val cookieManager: CookieManager
		get() = if (WebViewFeature.isFeatureSupported(WebViewFeature.MULTI_PROFILE)) {
			ProfileStore.getInstance().getOrCreateProfile(profileName).cookieManager
		} else {
			CookieManager.getInstance()
		}

	// The web views made here, each with the scripts it was given, so a new session or a
	// new address can reach pages that are already open.
	private class OpenWebView(val webView: WeakReference<WebView>, val seeThrough: Boolean) {
		var scripts: List<ScriptHandler> = emptyList()
	}
	private val openWebViews = mutableListOf<OpenWebView>()

	private val target: Umbreld.Target get() = Umbreld.Target(deviceId, hosts.toList())

	fun updateHosts(hosts: Collection<String>) {
		val updated = this.hosts + hosts.map(::normalized)
		if (updated == this.hosts) return
		this.hosts = updated
		replaceScripts()
	}

	fun isUmbrel(url: Uri?): Boolean {
		val host = url?.host ?: return false
		return normalized(host) in hosts
	}

	/** umbrelOS itself, as opposed to an app on another port. */
	fun isDashboard(url: Uri?): Boolean {
		if (url == null || !isUmbrel(url) || url.scheme?.lowercase() != "https") return false
		return url.port == -1 || url.port == 443
	}

	/**
	 * The Umbrel only ever loads over HTTPS here. Its plain HTTP addresses serve the same
	 * pages, so an http:// link to it opens at the matching https:// address.
	 */
	fun secureUrl(url: Uri): Uri {
		if (url.scheme?.lowercase() != "http" || !isUmbrel(url)) return url
		val authority = if (url.port == -1 || url.port == 80) url.host else "${url.host}:${url.port}"
		return url.buildUpon().scheme("https").encodedAuthority(authority?.let(::bracketed)).build()
	}

	// ── Web view ──

	/**
	 * A see-through web view shows umbrelOS as content on the app's own wallpaper rather than
	 * as a page with a wallpaper of its own.
	 */
	@SuppressLint("SetJavaScriptEnabled")
	fun makeWebView(seeThrough: Boolean = false): WebView {
		// The Activity is swapped in while the page is on screen, so dialogs and pickers
		// the page opens have a window, and swapped back out so a page kept warm never
		// holds on to a closed Activity.
		val webView = WebView(MutableContextWrapper(offscreenContext(appContext)))
		if (WebViewFeature.isFeatureSupported(WebViewFeature.MULTI_PROFILE)) WebViewCompat.setProfile(webView, profileName)
		webView.settings.apply {
			javaScriptEnabled = true
			// umbrelOS keeps its token in localStorage.
			domStorageEnabled = true
			// Pages lay out and zoom as they would in a phone's browser.
			useWideViewPort = true
			loadWithOverviewMode = true
			builtInZoomControls = true
			displayZoomControls = false
			setSupportMultipleWindows(true)
			javaScriptCanOpenWindowsAutomatically = false
			allowFileAccess = false
			// The trailing token lets umbrelOS recognise this app. Unlike iOS, which presents its
			// web view as Safari, the rest stays WebView's own: Google refuses its sign-in in an
			// embedded web view and forbids disguising one, so a Google sign-in that has to stay
			// in the page (its redirect comes back to the Umbrel) won't work here.
			userAgentString = "$userAgentString ${BrowserSession.userAgentToken}"
		}
		if (seeThrough) webView.setBackgroundColor(Color.TRANSPARENT)
		WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
		val open = OpenWebView(WeakReference(webView), seeThrough)
		open.scripts = addScripts(webView, seeThrough)
		openWebViews += open
		return webView
	}

	/**
	 * A web view that only catches where a new window is going, in this account's profile
	 * like the page that opened it, with nothing of the page's own.
	 */
	fun makeStandInWebView(): WebView {
		val webView = WebView(MutableContextWrapper(offscreenContext(appContext)))
		if (WebViewFeature.isFeatureSupported(WebViewFeature.MULTI_PROFILE)) WebViewCompat.setProfile(webView, profileName)
		return webView
	}

	private fun addScripts(webView: WebView, seeThrough: Boolean): List<ScriptHandler> {
		if (!WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT) || hosts.isEmpty()) return emptyList()
		val origins = hosts.map(::origin).toSet()
		return listOfNotNull(
			tokenScript()?.let { WebViewCompat.addDocumentStartJavaScript(webView, it, origins) },
			if (seeThrough) WebViewCompat.addDocumentStartJavaScript(webView, SEE_THROUGH_SCRIPT, origins) else null,
		)
	}

	/**
	 * umbrelOS keeps its dashboard token in localStorage, which only a page on that origin
	 * can write. This hands it over once per origin and login: if umbrelOS later discards
	 * the token, it is never put back. Only the top page gets it; Android runs these scripts
	 * in every frame from an allowed origin.
	 */
	private fun tokenScript(): String? {
		val session = session ?: return null
		val token = JsonPrimitive(session.dashboardToken).toString()
		return """
			(() => {
				if (window.top !== window) return
				try {
					if (localStorage.getItem('umbrel-app-session') === '${session.fingerprint}') return
					localStorage.setItem('umbrel-app-session', '${session.fingerprint}')
					localStorage.setItem('${BrowserSession.TOKEN_STORAGE_KEY}', $token)
				} catch {}
			})()
		""".trimIndent()
	}

	/**
	 * A page keeps the scripts it was made with. When the session changes (signed in again
	 * on umbrelOS's own page, or ended), or the Umbrel gains an address, each open page gets
	 * new scripts in place of its old ones, so its next load never puts an old token back.
	 */
	private fun replaceScripts() {
		openWebViews.removeAll { it.webView.get() == null }
		for (open in openWebViews) {
			val webView = open.webView.get() ?: continue
			open.scripts.forEach(ScriptHandler::remove)
			open.scripts = addScripts(webView, open.seeThrough)
		}
	}

	/** A web view that was destroyed stops receiving scripts. */
	fun forget(webView: WebView) {
		openWebViews.removeAll { it.webView.get().let { view -> view == null || view === webView } }
	}

	// ── Session ──

	/**
	 * Gives the web view the session's cookies for the address about to be opened. umbrelOS
	 * only accepts a token and a cookie from the same session, so cookies left by another
	 * session are replaced, but only while umbrelOS still accepts this one: the other may be
	 * a sign-in made on one of umbrelOS's own pages after this ended. First, where umbrelOS
	 * can, the app makes a session from its own sign-in to use in place of any other.
	 */
	suspend fun prepare(url: Uri) {
		val host = url.host ?: return
		if (!isUmbrel(url)) return
		val existing = cookies(host)
		session?.let { current ->
			val replacesAnother = current.cookies.any { (name, value) -> existing[name].let { it != null && it != value } }
			if (replacesAnother) validateSession(force = true)
		}
		if (session?.linked != true) makeSession()
		val session = session ?: return
		val cookieUrl = "https://${bracketed(host)}/"
		for ((index, cookie) in session.cookies.withIndex()) {
			if (existing[cookie.first] == cookie.second) continue
			setCookie(cookieUrl, session.setCookieValues[index])
		}
		cookieManager.flush()
	}

	/**
	 * Signing in on umbrelOS's own login page (or finishing setup there) creates a perfectly
	 * good session. Keep it, so the next address doesn't ask again, but only once umbrelOS
	 * confirms it belongs to this account. The login page offers every account on the
	 * Umbrel, and the app goes on to give this session to every address.
	 */
	suspend fun adoptSession(webView: WebView) {
		val url = webView.url?.let(Uri::parse)
		if (!isDashboard(url)) return
		val host = url?.host ?: return
		val token = evaluate(webView, "localStorage.getItem('${BrowserSession.TOKEN_STORAGE_KEY}')")
		if (token.isNullOrEmpty()) {
			// umbrelOS dropped the token it was given: find out whether the session ended.
			if (session != null) scope.launch { validateSession(force = true) }
			return
		}
		if (token == session?.dashboardToken) return
		val cookies = cookies(host)
		val browserCookie = cookies[BrowserSession.BROWSER_COOKIE_NAME] ?: return
		val adopted = BrowserSession(deviceId, accountId, token, browserCookie, cookies[BrowserSession.APP_COOKIE_NAME])
		if (Umbreld.browserSessionAccountId(target, adopted) != accountId) return
		// The app may have signed out of this account while umbrelOS was asked.
		val signedIn = withContext(Dispatchers.IO) { SecretStore.readSession(deviceId).sessionOrCached }
		if (signedIn?.accountId != accountId) return
		session = adopted
		withContext(Dispatchers.IO) { SecretStore.setBrowserSession(adopted) }
		// The page that produced this session already holds it, if it is still there.
		val tokenJson = JsonPrimitive(token).toString()
		evaluate(webView, "(() => { if (localStorage.getItem('${BrowserSession.TOKEN_STORAGE_KEY}') === $tokenJson) localStorage.setItem('umbrel-app-session', '${adopted.fingerprint}') })()")
	}

	// umbrelOS makes a browser session from the app's own sign-in, so a browser without one
	// (signed in before umbrelOS could do this, or unused for a week) gets one here rather
	// than asking for the password. A session it replaces is left to expire, not logged out,
	// so pages already using it keep working.
	private var making: Deferred<Unit>? = null

	// An older umbrelOS makes none. It's asked once; after that its login page shows.
	private var makesSessions = true

	private suspend fun makeSession() {
		val pending = making?.takeIf { it.isActive } ?: run {
			if (!makesSessions) return
			// In this context's scope rather than the caller's, so a page whose load is replaced
			// meanwhile doesn't leave the pages waiting on it without a session.
			scope.async(Dispatchers.Main) { mintSession() }.also { making = it }
		}
		pending.await()
	}

	private suspend fun mintSession() {
		val native = withContext(Dispatchers.IO) { SecretStore.readSession(deviceId).sessionOrCached }
		if (native == null || native.accountId != accountId) return
		val made = try {
			Umbreld.makeBrowserSession(target, native)
		} catch (cancelled: CancellationException) {
			throw cancelled
		} catch (error: Exception) {
			return
		}
		if (made == null) {
			makesSessions = false
			return
		}
		// The app may have signed out while umbrelOS was asked.
		val signedIn = withContext(Dispatchers.IO) { SecretStore.readSession(deviceId).sessionOrCached }
		if (signedIn?.belongsToSameLogin(native) != true) return
		session = made
		BrowserSessions.store(target, made)
	}

	/** Renews the session in the background; one umbrelOS no longer accepts is dropped. */
	suspend fun validateSession(force: Boolean = false) {
		val current = session ?: return
		if (BrowserSessions.validate(target, current, force) == BrowserSessionStatus.INVALID && session == current) {
			session = null
		}
	}

	private fun cookies(host: String): Map<String, String> =
		cookieManager.getCookie("https://${bracketed(host)}/")
			?.split(";")
			?.mapNotNull { pair -> pair.trim().split("=", limit = 2).takeIf { it.size == 2 }?.let { it[0] to it[1] } }
			?.toMap()
			.orEmpty()

	private suspend fun setCookie(url: String, value: String) = suspendCancellableCoroutine { continuation ->
		cookieManager.setCookie(url, value) { continuation.resume(Unit) }
	}

	private suspend fun evaluate(webView: WebView, script: String): String? = suspendCancellableCoroutine { continuation ->
		webView.evaluateJavascript(script) { result ->
			val value = try {
				Json.parseToJsonElement(result ?: "null").jsonPrimitive.contentOrNull
			} catch (error: IllegalArgumentException) {
				null
			}
			continuation.resume(value)
		}
	}

	companion object {
		suspend fun create(
			appContext: Context,
			deviceId: String,
			accountId: String,
			hosts: Collection<String>,
			scope: CoroutineScope,
		): BrowserContext {
			val stored = withContext(Dispatchers.IO) { SecretStore.readBrowserSession(deviceId) }
			return BrowserContext(appContext, deviceId, accountId, hosts, stored?.takeIf { it.accountId == accountId }, scope)
		}

		/**
		 * umbrelOS paints the user's wallpaper behind everything it draws. The app is already
		 * showing that wallpaper, edge to edge, so umbrelOS's copy is made invisible and its
		 * page background cleared: one wallpaper, with umbrelOS's interface on top of it. The
		 * images stay in the page (umbrelOS samples them for its glass), they are simply not
		 * drawn. Wallpaper previews in Settings are positioned differently and are left alone.
		 * A video wallpaper is left alone too: the app only has a still of it, so umbrelOS
		 * keeps drawing its own, moving one within its page.
		 *
		 * umbrelOS's windows also fade their frosted backing in after they open, which reads
		 * as a dark flash when a window is the first thing shown. Here they arrive fully
		 * formed. The backing starts invisible and only the fade reveals it, so skipping the
		 * fade also has to show it.
		 *
		 * This is the one place the app knows anything about umbrelOS's markup. If a future
		 * umbrelOS changes it, the only effect is that its own wallpaper shows inside the page
		 * again.
		 */
		private val SEE_THROUGH_SCRIPT = """
			(() => {
				if (window.top !== window) return
				const style = document.createElement('style')
				style.textContent = `
					html, body { background: transparent !important; }
					picture > img.fixed.inset-0:not(.absolute),
					img[data-wallpaper-full]:not(.absolute) { opacity: 0 !important; }
					.umbrel-window-wallpaper { animation: none !important; opacity: 1 !important; }
				`
				document.documentElement.appendChild(style)
			})()
		""".trimIndent()

		/**
		 * The context a web view runs with while it's off screen: the application, in the app's
		 * dark theme. Pages that follow the system appearance take it from the theme, so they're
		 * dark from their first frame, including pages loaded before they're shown.
		 */
		fun offscreenContext(context: Context): Context = ContextThemeWrapper(context.applicationContext, R.style.Theme_Umbrel)

		fun normalized(host: String): String = host.removePrefix("[").removeSuffix("]").trimEnd('.').lowercase()

		/** An IPv6 literal in the brackets a URL needs. */
		fun bracketed(host: String): String =
			if (host.count { it == ':' } > 1 && !host.startsWith("[")) "[$host]" else host

		private fun origin(host: String): String = "https://${bracketed(host)}"
	}
}
