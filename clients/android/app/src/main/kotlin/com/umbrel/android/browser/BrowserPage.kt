package com.umbrel.android.browser

import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.net.http.SslError
import android.os.Message
import android.os.SystemClock
import android.view.View
import android.view.ViewGroup
import android.webkit.ConsoleMessage
import android.webkit.GeolocationPermissions
import android.webkit.HttpAuthHandler
import android.webkit.JsPromptResult
import android.webkit.JsResult
import android.webkit.PermissionRequest
import android.webkit.RenderProcessGoneDetail
import android.webkit.SslErrorHandler
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.annotation.MainThread
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.graphics.Color
import androidx.core.net.toUri
import androidx.webkit.ScriptHandler
import androidx.webkit.WebMessageCompat
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import com.umbrel.android.BuildConfig
import com.umbrel.kit.LocalHttpsTransport
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.MainScope
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.io.File

/**
 * One open web page: umbrelOS itself, or an app running on the Umbrel. Pages stay alive
 * after the browser closes, so returning to an app picks up where it was left.
 */
@MainThread
@Stable
internal class BrowserPage(
	/** Pages are pooled by origin: one per app, one for umbrelOS. */
	val origin: String,
	identity: Identity,
	private val context: BrowserContext,
	/** umbrelOS shown in place, on the app's wallpaper, instead of as a page of its own. */
	val isSeeThrough: Boolean = false,
) {
	data class Identity(
		val name: String,
		val iconUrl: String?,
		/** umbrelOS itself is drawn with the Umbrel mark rather than an app icon. */
		val isUmbrel: Boolean,
	)

	data class Failure(val title: String, val message: String)

	/** A question the page asks. One nobody answers must still be answered, or the page hangs. */
	sealed class Dialog {
		data class Alert(val message: String, val done: () -> Unit) : Dialog()
		data class Confirm(val message: String, val done: (Boolean) -> Unit) : Dialog()
		data class Prompt(val message: String, val defaultText: String, val done: (String?) -> Unit) : Dialog()
		data class Credentials(val host: String, val done: (Pair<String, String>?) -> Unit) : Dialog()
		data class Permission(val resources: Set<Resource>, val done: (Boolean) -> Unit) : Dialog()

		enum class Resource { CAMERA, MICROPHONE }

		fun dismiss() = when (this) {
			is Alert -> done()
			is Confirm -> done(false)
			is Prompt -> done(null)
			is Credentials -> done(null)
			is Permission -> done(false)
		}
	}

	/** A file picker the page asked for, answered with the picked files, or null when cancelled. */
	class FileChooser(val params: WebChromeClient.FileChooserParams, private val callback: ValueCallback<Array<Uri>>) {
		private var answered = false

		fun answer(uris: List<Uri>?) {
			if (answered) return
			answered = true
			callback.onReceiveValue(uris?.toTypedArray())
		}
	}

	/** Video the page put in full screen, until it or the user leaves it. */
	class FullScreen(val view: View, val exit: () -> Unit)

	private val scope = MainScope()

	var identity by mutableStateOf(identity)
		private set
	var webView by mutableStateOf(context.makeWebView(isSeeThrough))
		private set
	var progress by mutableFloatStateOf(0f)
		private set
	var isLoading by mutableStateOf(false)
		private set
	var canGoBack by mutableStateOf(false)
		private set
	var canGoForward by mutableStateOf(false)
		private set
	var currentUrl by mutableStateOf<Uri?>(null)
		private set

	/**
	 * The page actually on screen. During a load, currentUrl is already the address being
	 * loaded while the previous page is still showing, so this only changes when a load
	 * becomes visible or the page changes its own address in place.
	 */
	var shownUrl by mutableStateOf<Uri?>(null)
		private set

	/** Whether the page has drawn something worth showing instead of the launch screen. */
	var isRevealed by mutableStateOf(false)
		private set
	var failure by mutableStateOf<Failure?>(null)
		private set
	var barColor by mutableStateOf<Color?>(null)
		private set
	var pageColor by mutableStateOf<Color?>(null)
		private set
	var dialog by mutableStateOf<Dialog?>(null)
		private set

	/** Who the current dialog is from, shown as its title. */
	var dialogTitle by mutableStateOf("")
		private set

	/** Another website someone tapped through to, for the view to open in a Custom Tab. */
	var externalUrl by mutableStateOf<Uri?>(null)
	var downloadedFile by mutableStateOf<File?>(null)
	var fileChooser by mutableStateOf<FileChooser?>(null)
		private set
	var fullScreen by mutableStateOf<FullScreen?>(null)
		private set

	/** Links that leave this page for another one on the Umbrel (umbrelOS launching an app). */
	var onOpenUmbrelUrl: (Uri) -> Unit = {}

	/** Fired for every main-frame location change, including in-page routing. */
	var onLocationChange: (Uri) -> Unit = {}

	/** Whether the page is on screen, so a page whose renderer was lost reloads at once. */
	var isOnScreen: () -> Boolean = { false }

	/** Whether this page was given the camera or microphone; capture runs on while it stays warm. */
	var wasGrantedCapture = false
		private set

	private var requestedUrl: Uri? = null
	private var revealJob: Job? = null
	private var settleDeadline: Long? = null
	private var authAttempts = HashMap<String, Int>()
	private var lastCrashedUrl: Uri? = null
	private var passwordEntry: ((String) -> Unit)? = null
	private var screenInsets: Pair<Int, Int>? = null
	private var loadJob: Job? = null
	private var colorsJob: Job? = null
	private val downloadsFolder = DownloadsFolder.of(webView.context)
	private val pageDownloads = PageDownloads(scope, downloadsFolder, ::offer)

	// The web view the page downloads channel is installed in, and its script.
	private var downloadsChannel: Pair<WebView, ScriptHandler>? = null

	// Set when the current main-frame load failed. WebView still commits and finishes its own
	// error page afterwards, which must not lift the failure or count as a loaded page.
	private var mainFrameFailed = false

	// Set when the app refuses a connection because the Umbrel's identity doesn't match.
	private var refusal: Refusal? = null

	private enum class Refusal {
		UNTRUSTED,

		/** A different certificate authority, as after the Umbrel or its certificate is reset. */
		DIFFERENT_IDENTITY,
	}

	init {
		attach(webView)
	}

	/**
	 * Reports what is typed into password fields, for first-time setup only: the password
	 * the user chooses on umbrelOS's own form is the one this app then signs in with, so they
	 * are not asked to type it a third time. It is delivered to the caller and never stored
	 * here. Must be called before the first load.
	 */
	fun observePasswordEntry(handler: (String) -> Unit) {
		passwordEntry = handler
		installPasswordEntry(webView)
	}

	/**
	 * Lets the page run edge to edge, under the status bar and the navigation bar, while its
	 * content keeps clear of them: its root is padded by [top] and [bottom] CSS pixels, so
	 * whatever it pins to the window (a wallpaper) fills the screen and whatever it lays out
	 * lands inside the safe area. Must be called before the first load.
	 */
	fun fillScreen(top: Int, bottom: Int) {
		screenInsets = top to bottom
		installScreenInsets(webView)
	}

	private fun installScreenInsets(view: WebView) {
		val (top, bottom) = screenInsets ?: return
		val origins = context.hosts.map { "https://${BrowserContext.bracketed(it)}" }.toSet()
		if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) WebViewCompat.addDocumentStartJavaScript(
			view,
			"""
				(() => {
					if (window.top !== window) return
					const style = document.createElement('style')
					style.textContent = 'html { box-sizing: border-box !important; padding: ${top}px 0 ${bottom}px !important; }'
					document.documentElement.appendChild(style)
				})()
			""".trimIndent(),
			origins,
		)
	}

	fun update(identity: Identity) {
		if (this.identity != identity) this.identity = identity
	}

	/**
	 * Shows a location. Resuming leaves a page that is already open on this address exactly
	 * where it was, wherever inside the app the user had got to; otherwise the page goes to
	 * the location unless it is already there.
	 */
	fun open(url: Uri, resuming: Boolean) {
		val current = currentUrl
		if (current != null && failure == null) {
			if (resuming && origin(current) == origin(url)) return
			if (isSameLocation(current, url)) return
			if (isSeeThrough && isRevealed && origin(current) == origin(url)) {
				navigateInPage(url)
				return
			}
		}
		load(url)
	}

	/**
	 * umbrelOS is a single-page app that is already running. Going somewhere else in it is a
	 * history entry and the standard event every router listens for, not a reload, so its own
	 * interface animates to the new place.
	 */
	private fun navigateInPage(url: Uri) {
		var target = url.encodedPath?.takeIf { it.isNotEmpty() } ?: "/"
		url.encodedQuery?.let { target += "?$it" }
		val argument = JsonPrimitive(target).toString()
		webView.evaluateJavascript(
			"(() => { try { history.pushState(null, '', $argument); dispatchEvent(new PopStateEvent('popstate', {state: null})); return true } catch (e) { return false } })()",
		) { result ->
			// A page that can't do this is in no state to be navigated; load instead.
			if (result != "true") load(url)
		}
	}

	fun reload() {
		val failed = failure != null || mainFrameFailed
		val url = requestedUrl
		// A page that failed starts over, cookies and certificate check included.
		if (failed && url != null) return load(url)
		failure = null
		if (webView.url != null) webView.reload() else url?.let(::load)
	}

	fun goBack() {
		startNavigation()
		webView.goBack()
	}

	fun goForward() {
		startNavigation()
		webView.goForward()
	}

	/** A new main-frame navigation: nothing about the last one carries over to it. */
	private fun startNavigation() {
		refusal = null
		mainFrameFailed = false
	}

	private fun load(url: Uri) {
		requestedUrl = url
		currentUrl = url
		// A refused certificate isn't asked about again until WebView forgets the answer.
		if (refusal != null || failure != null || mainFrameFailed) webView.clearSslPreferences()
		refusal = null
		mainFrameFailed = false
		failure = null
		if (pageDownloads.follow(url, context.hosts)) installPageDownloads(webView)
		// A different location starts from the launch screen, never the previous page.
		revealJob?.cancel()
		settleDeadline = null
		isRevealed = false
		// Only the latest location loads, whichever finishes preparing first.
		loadJob?.cancel()
		loadJob = scope.launch {
			context.prepare(url)
			webView.loadUrl(url.toString())
		}
	}

	/**
	 * The address of a page that has ended up off the Umbrel (a sign-in, a redirect), shown in
	 * place of the app's name so another site never looks like the app.
	 */
	val outsideHost: String?
		get() {
			val shown = shownUrl ?: return null
			if (!isWebAddress(shown) || context.isUmbrel(shown)) return null
			return shown.host
		}

	/**
	 * A sign-in link to another site names where to send someone back to afterwards in its
	 * redirect_uri (OAuth). Coming back to the Umbrel makes it part of an app's own sign-in.
	 */
	private fun returnsToUmbrel(url: Uri): Boolean = try {
		url.getQueryParameters("redirect_uri").any { context.isUmbrel(it.toUri()) }
	} catch (error: UnsupportedOperationException) {
		false
	}

	/** Releases the page's web view; it can't be shown again. */
	fun destroy() {
		scope.cancel()
		dialog?.dismiss()
		dialog = null
		fileChooser?.answer(null)
		fileChooser = null
		pageDownloads.reset()
		release(webView)
	}

	private fun release(view: WebView) {
		(view.parent as? ViewGroup)?.removeView(view)
		context.forget(view)
		view.stopLoading()
		view.destroy()
	}

	private fun reveal(afterMillis: Long = 0) {
		if (isRevealed) return
		revealJob?.cancel()
		revealJob = scope.launch {
			delay(afterMillis)
			isRevealed = true
		}
	}

	/**
	 * Web pages have no API for their theme color, so ask the page: its theme-color meta tag,
	 * or else its background. A page still changing its colors (a dark theme arriving after
	 * a light default) isn't ready to be seen, so the launch screen holds a little longer,
	 * within a fixed limit from when the load finished.
	 */
	private fun watchColors() {
		colorsJob?.cancel()
		colorsJob = scope.launch {
			for (wait in COLOR_SAMPLES_MILLIS) {
				delay(wait)
				updateColors()
			}
		}
	}

	private fun updateColors() {
		webView.evaluateJavascript(COLORS_SCRIPT) { result ->
			val colors = try {
				Json.parseToJsonElement(Json.parseToJsonElement(result ?: "null").jsonPrimitive.contentOrNull ?: return@evaluateJavascript).jsonObject
			} catch (error: IllegalArgumentException) {
				return@evaluateJavascript
			}
			val background = colors.string("background")?.let(::parseCssColor)
			val bar = colors.string("theme")?.let(::parseCssColor) ?: background
			if (bar != barColor || background != pageColor) {
				val deadline = settleDeadline
				if (!isRevealed && deadline != null && SystemClock.uptimeMillis() + SETTLE_MILLIS < deadline) reveal(SETTLE_MILLIS)
			}
			barColor = bar
			pageColor = background
		}
	}

	private fun fail(errorCode: Int, description: String?) {
		mainFrameFailed = true
		val refused = refusal
		refusal = null
		// Cancellations are the page changing its mind (a redirect, a download taking over,
		// the user tapping again), not something to report. A connection the app refused
		// looks the same, and is reported.
		if (refused == null && description?.contains("ERR_ABORTED") == true) {
			mainFrameFailed = false
			return
		}
		// A refusal already reported for this load keeps its more specific message.
		if (failure != null && refused == null) return
		revealJob?.cancel()
		val name = identity.name
		failure = when {
			refused == Refusal.DIFFERENT_IDENTITY -> notRecognized
			refused != null || errorCode == WebViewClient.ERROR_FAILED_SSL_HANDSHAKE -> Failure(
				"Can’t Open $name Securely",
				"This phone couldn’t verify a secure connection to your Umbrel.",
			)
			else -> Failure(
				"Can’t Open $name",
				if (identity.isUmbrel) "Make sure your Umbrel is turned on and this phone can reach it."
				else "The app may still be starting. Give it a moment, then try again.",
			)
		}
	}

	private val notRecognized: Failure
		get() = Failure(
			"Can’t Open ${identity.name}",
			"This app no longer recognizes your Umbrel. This usually happens after your Umbrel or its certificate is reset. Reconnect your Umbrel from Home to keep using it in this app.",
		)

	// ── Dialogs ──

	private fun present(next: Dialog, asker: String) {
		dialog?.dismiss()
		dialogTitle = asker
		dialog = next
	}

	/** Answers the dialog on screen. */
	fun answer(dialog: Dialog, answer: () -> Unit) {
		if (this.dialog !== dialog) return
		this.dialog = null
		answer()
	}

	/**
	 * Who a dialog is from. On this page's own origin that's the page's name. Anything else
	 * (an embedded page, a site the page moved to) is named by its address, so it can't speak
	 * as the app.
	 */
	private fun asker(url: Uri?): String {
		val scheme = url?.scheme?.lowercase() ?: return identity.name
		val host = url.host?.lowercase().orEmpty()
		val defaultPort = if (scheme == "https") 443 else 80
		val port = url.port.takeIf { it > 0 } ?: defaultPort
		val home = requestedUrl
		if (home != null && home.scheme?.lowercase() == scheme && home.host?.lowercase() == host &&
			(home.port.takeIf { it > 0 } ?: defaultPort) == port
		) {
			return identity.name
		}
		// A sandboxed or data: page has no address to show, and isn't the app either.
		if (host.isEmpty()) return "Unknown Page"
		return if (port == defaultPort) host else "$host:$port"
	}

	// ── Other apps ──

	/**
	 * Mail, phone, store and other apps' links belong to the system. Only links a browser may
	 * follow are opened: intent: links lose any explicit component, as Chrome does, and local
	 * files and content are never handed out.
	 */
	private fun openOtherApp(url: Uri) {
		val intent = when (url.scheme?.lowercase()) {
			"intent" -> try {
				Intent.parseUri(url.toString(), Intent.URI_INTENT_SCHEME).apply {
					component = null
					selector = null
					// A link can't hand out access to anything of this app's.
					flags = flags and (Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION or
						Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION or Intent.FLAG_GRANT_PREFIX_URI_PERMISSION).inv()
				}
			} catch (error: java.net.URISyntaxException) {
				return
			}
			else -> Intent(Intent.ACTION_VIEW, url)
		}
		if (intent.data?.scheme?.lowercase() in LocalSchemes || url.scheme?.lowercase() == "javascript") return
		intent.addCategory(Intent.CATEGORY_BROWSABLE).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
		try {
			webView.context.startActivity(intent)
		} catch (error: ActivityNotFoundException) {
			// Nothing on this phone opens it.
		} catch (error: RuntimeException) {
			// Nothing a page links to may close the app (a refused or malformed intent).
		}
	}

	// ── Downloads ──

	private fun download(url: String, userAgent: String, contentDisposition: String?, mimeType: String?, contentLength: Long) {
		when (url.substringBefore(':', "").lowercase()) {
			"http", "https" -> downloadFromWeb(url, userAgent, contentDisposition, mimeType)
			// A page's own data, decoded here; nothing is fetched.
			"data" -> scope.launch {
				val data = withContext(Dispatchers.Default) { decodeDataUrl(url) } ?: return@launch
				// Named by the link the page clicked, when it says; the address names nothing.
				val name = pageDownloads.nameOf(url, webView.url?.toUri())
				save(downloadName(null, contentDisposition, data.mimeType, suggested = name)) { it.writeBytes(data.bytes) }
			}
			// Bytes that exist only inside the page, read out of it.
			"blob" -> pageDownloads.read(url, webView.url?.toUri(), contentDisposition, mimeType, contentLength)
			// Anything else (local files, content) is never fetched.
		}
	}

	private fun downloadFromWeb(url: String, userAgent: String, contentDisposition: String?, mimeType: String?) {
		val uri = url.toUri()
		val cookies = context.cookieManager
		// Each request, redirects included, carries only the cookies for its own address.
		val cookieFor = { address: String -> cookies.getCookie(address) }
		scope.launch {
			save(downloadName(url, contentDisposition, mimeType)) { destination ->
				// The Umbrel is only ever reached over its pinned connection, and over HTTPS.
				if (context.isUmbrel(uri)) {
					LocalHttpsTransport.download(context.deviceId, context.secureUrl(uri).toString(), cookieFor, userAgent, destination)
				} else {
					LocalHttpsTransport.downloadFromWeb(url, cookieFor, userAgent, destination)
				}
			}
		}
	}

	/** Writes a download into a folder of its own in the cache, then offers it to share. */
	private suspend fun save(name: String, write: (File) -> Unit) {
		val destination = File(downloadsFolder.newFolder(), name)
		val saved = withContext(Dispatchers.IO) {
			try {
				destination.parentFile?.mkdirs()
				write(destination)
				true
			} catch (error: Exception) {
				destination.parentFile?.deleteRecursively()
				false
			}
		}
		if (saved) offer(destination)
	}

	/** Offers a download to share, in place of the one before. */
	private fun offer(file: File) {
		downloadsFolder.offer(file)
		downloadedFile = file
	}

	/**
	 * Lets the page hand over the bytes of its own blob: downloads and the names its links gave
	 * them, through a channel and a script WebView gives only to the page's own origin (see
	 * [PageDownloads]). Put in again whenever that origin or the web view changes.
	 */
	private fun installPageDownloads(view: WebView) {
		pageDownloads.reset()
		// Without both, a blob: download does nothing and a data: one goes unnamed, as before.
		if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER) &&
			WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)
		) {
			// The channel before, unless it went with a web view that was lost.
			downloadsChannel?.takeIf { it.first === view }?.let { (_, script) ->
				script.remove()
				WebViewCompat.removeWebMessageListener(view, PageDownloads.CHANNEL)
			}
			downloadsChannel = null
			val origins = pageDownloads.origins
			if (origins.isEmpty()) return
			WebViewCompat.addWebMessageListener(view, PageDownloads.CHANNEL, origins) { _, message, sourceOrigin, isMainFrame, replyProxy ->
				// The page may post anything; only text is part of the exchange.
				if (message.type != WebMessageCompat.TYPE_STRING) return@addWebMessageListener
				val data = message.data ?: return@addWebMessageListener
				pageDownloads.receive(data, sourceOrigin, isMainFrame, replyProxy::postMessage)
			}
			downloadsChannel = view to WebViewCompat.addDocumentStartJavaScript(view, PageDownloads.SCRIPT, origins)
		}
	}

	// ── Web view ──

	private fun attach(view: WebView) {
		view.webViewClient = Client()
		view.webChromeClient = ChromeClient()
		view.setDownloadListener { url, userAgent, contentDisposition, mimeType, contentLength ->
			download(url, userAgent, contentDisposition, mimeType, contentLength)
		}
		if (passwordEntry != null) installPasswordEntry(view)
		installScreenInsets(view)
		installPageDownloads(view)
	}

	private fun installPasswordEntry(view: WebView) {
		val handler = passwordEntry ?: return
		val origins = context.hosts.map { "https://${BrowserContext.bracketed(it)}" }.toSet()
		// Without both, nothing is reported and the user types the password once more.
		if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER) &&
			WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)
		) {
			WebViewCompat.addWebMessageListener(view, "umbrelSetup", origins) { _, message, sourceOrigin, isMainFrame, _ ->
				if (message.type != WebMessageCompat.TYPE_STRING) return@addWebMessageListener
				val value = message.data ?: return@addWebMessageListener
				if (!isMainFrame || !context.isUmbrel(sourceOrigin)) return@addWebMessageListener
				handler(value)
			}
			WebViewCompat.addDocumentStartJavaScript(view, PASSWORD_ENTRY_SCRIPT, origins)
		}
	}

	/**
	 * Every app's renderer runs in one process, and when it's lost every page must let go of
	 * its web view or the app is closed with it. The page gets a fresh one; on screen it loads
	 * again at once, otherwise the next time it's opened. A page that crashed its renderer
	 * twice in a row shows an error instead of crashing it again.
	 */
	private fun replaceLostWebView(view: WebView, crashed: Boolean) {
		if (view !== webView) return
		val url = requestedUrl
		val crashedAgain = crashed && url != null && url == lastCrashedUrl
		lastCrashedUrl = if (crashed) url else null
		release(view)
		val replacement = context.makeWebView(isSeeThrough)
		attach(replacement)
		webView = replacement
		currentUrl = null
		shownUrl = null
		isRevealed = false
		canGoBack = false
		canGoForward = false
		if (crashedAgain) {
			fail(0, null)
		} else if (isOnScreen() && url != null) {
			load(url)
		}
	}

	private inner class Client : WebViewClient() {
		override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
			val url = request.url
			if (!request.isForMainFrame) return false
			startNavigation()
			// Android's guidance matches Apple's: the app's own web content in a web view,
			// other websites in a Custom Tab, which shows their real address and the
			// browser's protections. So a link someone taps on the Umbrel to another site
			// opens there. Redirects stay in the page, as do links on another site's page
			// and sign-in links that come back to the Umbrel, because a sign-in has to finish
			// in the page that started it. Any page that ends up off the Umbrel shows its own
			// address in the title bar.
			if (request.hasGesture() && !request.isRedirect && context.isUmbrel(view.url?.toUri()) &&
				isWebAddress(url) && !context.isUmbrel(url) && !returnsToUmbrel(url)
			) {
				externalUrl = url
				return true
			}
			val scheme = url.scheme?.lowercase()
			if (scheme == "http" && context.isUmbrel(url)) {
				// Over plain HTTP the Umbrel would be signed out and ask for a password in the
				// clear, with no address bar to warn anyone.
				scope.launch { load(context.secureUrl(url)) }
				return true
			}
			return when (scheme) {
				"http", "https", "about", "blob", "data" -> false
				else -> {
					// A tapped link opens straight away; a page sending someone to another app
					// any other way asks first, the way a browser does.
					if (request.hasGesture()) {
						openOtherApp(url)
					} else {
						present(Dialog.Confirm("This page wants to open another app.") { if (it) openOtherApp(url) }, asker(view.url?.toUri()))
					}
					true
				}
			}
		}

		override fun onPageStarted(view: WebView, url: String, favicon: Bitmap?) {
			isLoading = true
			val uri = url.toUri()
			if (uri != currentUrl) {
				currentUrl = uri
				onLocationChange(uri)
			}
		}

		override fun onPageCommitVisible(view: WebView, url: String) {
			// WebView's own error page, after a failure already shown.
			if (mainFrameFailed) return
			val uri = url.toUri()
			if (shownUrl != uri) shownUrl = uri
			failure = null
			// The launch screen normally lifts when the page finishes loading. This is the
			// limit on how long a slow page can keep it up once it's drawing.
			reveal(3_000)
		}

		override fun onPageFinished(view: WebView, url: String) {
			isLoading = false
			if (mainFrameFailed) return
			authAttempts.clear()
			lastCrashedUrl = null
			// Web apps tend to paint a bare document first and their real interface a moment
			// later. Lifting the launch screen on that first paint shows a flash of the wrong
			// page, so wait for the load to finish and for its colors to settle.
			settleDeadline = SystemClock.uptimeMillis() + 1_500
			reveal(SETTLE_MILLIS)
			watchColors()
			scope.launch { context.adoptSession(view) }
		}

		override fun doUpdateVisitedHistory(view: WebView, url: String, isReload: Boolean) {
			canGoBack = view.canGoBack()
			canGoForward = view.canGoForward()
			val uri = url.toUri()
			// A page changing its own address (pushState, a fragment) can't change origin.
			// Anything else waits until the new page is visible.
			val shown = shownUrl
			if (shown != null && origin(shown) == origin(uri) && shown != uri) shownUrl = uri
			if (uri == currentUrl) return
			currentUrl = uri
			onLocationChange(uri)
			if (isRevealed) updateColors()
		}

		override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
			if (!request.isForMainFrame) return
			isLoading = false
			fail(error.errorCode, error.description?.toString())
		}

		// Proceeds only at one of the Umbrel's addresses, and only for a certificate its own
		// pinned CA issued, checked by the platform TrustManager; everything else is cancelled.
		@SuppressLint("WebViewClientOnReceivedSslError")
		override fun onReceivedSslError(view: WebView, handler: SslErrorHandler, error: SslError) {
			val url = error.url.toUri()
			val host = url.host
			val certificate = error.certificate.x509Certificate
			// The Umbrel is trusted through its own pinned CA and nothing else. Any other site
			// keeps WebView's own refusal.
			if (host == null || certificate == null || !context.isUmbrel(url)) {
				handler.cancel()
				return
			}
			scope.launch {
				val (trusted, differs) = withContext(Dispatchers.IO) {
					val trusted = LocalHttpsTransport.trustsPageCertificate(context.deviceId, certificate)
					trusted to (!trusted && LocalHttpsTransport.pageCertificateIdentityDiffers(context.deviceId, certificate))
				}
				if (trusted) {
					handler.proceed()
					return@launch
				}
				refusal = if (differs) Refusal.DIFFERENT_IDENTITY else Refusal.UNTRUSTED
				handler.cancel()
				val page = view.url?.toUri()
				val isOwnAddress = page != null && page.host.equals(host, ignoreCase = true) && port(page) == port(url)
				// A page that is already showing also asks the Umbrel for things in the
				// background (umbrelOS waiting out a reset, say), and those failing doesn't fail
				// the page. Its own address no longer being this Umbrel is final, so say so.
				// Another port or address may be something else entirely.
				if (differs && isOwnAddress) {
					revealJob?.cancel()
					failure = notRecognized
				} else if (url == requestedUrl) {
					// The page itself was refused: say so now rather than loading forever.
					view.stopLoading()
					fail(WebViewClient.ERROR_FAILED_SSL_HANDSHAKE, null)
				}
			}
		}

		override fun onReceivedHttpAuthRequest(view: WebView, handler: HttpAuthHandler, host: String, realm: String?) {
			val attempts = authAttempts[host] ?: 0
			if (attempts >= 3) {
				handler.cancel()
				return
			}
			authAttempts[host] = attempts + 1
			// Named by who's asking, not by the realm the server chose, so a page can't pose
			// as something else ("your Umbrel") to collect a password. WebView doesn't say which
			// port is asking, so it's the bare host: another app on the Umbrel can't ask as this one.
			val asker = host.lowercase()
			present(Dialog.Credentials(asker) { credentials ->
				if (credentials == null) handler.cancel() else handler.proceed(credentials.first, credentials.second)
			}, asker)
		}

		override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
			replaceLostWebView(view, detail.didCrash())
			return true
		}
	}

	private inner class ChromeClient : WebChromeClient() {
		override fun onProgressChanged(view: WebView, newProgress: Int) {
			progress = newProgress / 100f
		}

		/**
		 * Pages ask for a new window with target="_blank" or window.open. There is one window
		 * here, so route the request to where it belongs instead of dropping it. WebView only
		 * says where the window is going once it starts loading there, so a stand-in catches
		 * that first address and is then thrown away.
		 */
		override fun onCreateWindow(view: WebView, isDialog: Boolean, isUserGesture: Boolean, resultMsg: Message): Boolean {
			if (!isUserGesture) return false
			val standIn = context.makeStandInWebView()
			standIn.webViewClient = object : WebViewClient() {
				override fun shouldOverrideUrlLoading(window: WebView, request: WebResourceRequest): Boolean {
					route(request.url)
					window.post { window.destroy() }
					return true
				}

				override fun onRenderProcessGone(window: WebView, detail: RenderProcessGoneDetail): Boolean {
					window.destroy()
					return true
				}
			}
			(resultMsg.obj as WebView.WebViewTransport).webView = standIn
			resultMsg.sendToTarget()
			// A window that never says where it's going (opened blank to fill in later)
			// isn't followed, as on iOS.
			scope.launch {
				delay(STAND_IN_LIFETIME_MILLIS)
				standIn.destroy()
			}
			return true
		}

		private fun route(url: Uri) {
			when {
				url.scheme == "about" -> Unit
				context.isUmbrel(url) -> onOpenUmbrelUrl(url)
				isWebAddress(url) -> externalUrl = url
				else -> openOtherApp(url)
			}
		}

		override fun onJsAlert(view: WebView, url: String, message: String, result: JsResult): Boolean {
			present(Dialog.Alert(message) { result.confirm() }, asker(url.toUri()))
			return true
		}

		override fun onJsConfirm(view: WebView, url: String, message: String, result: JsResult): Boolean {
			present(Dialog.Confirm(message) { if (it) result.confirm() else result.cancel() }, asker(url.toUri()))
			return true
		}

		override fun onJsPrompt(view: WebView, url: String, message: String, defaultValue: String?, result: JsPromptResult): Boolean {
			present(Dialog.Prompt(message, defaultValue.orEmpty()) { if (it != null) result.confirm(it) else result.cancel() }, asker(url.toUri()))
			return true
		}

		// WebKit shows nothing for these either: leaving a page is always allowed.
		override fun onJsBeforeUnload(view: WebView, url: String, message: String, result: JsResult): Boolean {
			result.confirm()
			return true
		}

		/**
		 * Camera and microphone are asked for in the app first, naming the page, because
		 * Android's own prompt names only this app and appears just once.
		 */
		override fun onPermissionRequest(request: PermissionRequest) {
			val resources = request.resources.mapNotNull {
				when (it) {
					PermissionRequest.RESOURCE_VIDEO_CAPTURE -> Dialog.Resource.CAMERA
					PermissionRequest.RESOURCE_AUDIO_CAPTURE -> Dialog.Resource.MICROPHONE
					else -> null
				}
			}.toSet()
			if (resources.isEmpty()) {
				request.deny()
				return
			}
			val granted = request.resources.filter {
				it == PermissionRequest.RESOURCE_VIDEO_CAPTURE || it == PermissionRequest.RESOURCE_AUDIO_CAPTURE
			}.toTypedArray()
			present(
				Dialog.Permission(resources) { allowed ->
					if (allowed) {
						wasGrantedCapture = true
						request.grant(granted)
					} else {
						request.deny()
					}
				},
				asker(request.origin),
			)
		}

		override fun onPermissionRequestCanceled(request: PermissionRequest) {
			(dialog as? Dialog.Permission)?.let { dialog = null }
		}

		// Pages don't get the phone's location: the app doesn't ask for it.
		override fun onGeolocationPermissionsShowPrompt(origin: String, callback: GeolocationPermissions.Callback) {
			callback.invoke(origin, false, false)
		}

		override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
			fileChooser?.answer(null)
			fileChooser = FileChooser(params, callback)
			return true
		}

		override fun onShowCustomView(view: View, callback: CustomViewCallback) {
			fullScreen = FullScreen(view) { callback.onCustomViewHidden() }
		}

		override fun onHideCustomView() {
			fullScreen = null
		}

		// Page logs reach logcat in debug builds only.
		override fun onConsoleMessage(message: ConsoleMessage): Boolean = !BuildConfig.DEBUG
	}

	/** The file picker was answered (or dismissed). */
	fun finishFileChooser(uris: List<Uri>?) {
		fileChooser?.answer(uris)
		fileChooser = null
	}

	/** Leaves full-screen video, as the system back gesture does. */
	fun exitFullScreen() {
		fullScreen?.exit?.invoke()
		fullScreen = null
	}

	companion object {
		private val LocalSchemes = setOf("file", "content", "javascript")
		private const val SETTLE_MILLIS = 300L

		// When a page's colors are read after it finishes loading: across the 1.5 s it gets to
		// settle into the colors it keeps.
		private val COLOR_SAMPLES_MILLIS = listOf(0L, 250L, 350L, 400L, 500L)
		private const val STAND_IN_LIFETIME_MILLIS = 2_000L

		private val COLORS_SCRIPT = """
			(() => {
				const meta = document.querySelector('meta[name="theme-color"]')
				const root = document.body || document.documentElement
				return JSON.stringify({
					theme: meta ? meta.content : null,
					background: root ? getComputedStyle(root).backgroundColor : null,
				})
			})()
		""".trimIndent()

		/** Fields can switch to plain text while "show password" is on. */
		private val PASSWORD_ENTRY_SCRIPT = """
			(() => {
				if (window.top !== window) return
				const fields = new WeakSet()
				document.addEventListener('input', (event) => {
					const field = event.target
					if (!(field instanceof HTMLInputElement)) return
					if (field.type === 'password') fields.add(field)
					if (!fields.has(field) || !field.value) return
					umbrelSetup.postMessage(field.value)
				}, true)
			})()
		""".trimIndent()

		fun isWebAddress(url: Uri): Boolean = url.scheme?.lowercase() in setOf("http", "https")

		private fun port(url: Uri): Int = url.port.takeIf { it > 0 } ?: if (url.scheme?.lowercase() == "http") 80 else 443

		private fun origin(url: Uri): String = "${url.scheme?.lowercase()}://${url.host?.lowercase()}:${port(url)}"

		/** A location is the same when only the fragment differs. */
		internal fun isSameLocation(a: Uri, b: Uri): Boolean {
			fun key(url: Uri) = url.buildUpon().fragment(null).build().toString().trimEnd('/')
			return key(a) == key(b)
		}

		// The page builds this object, so a field may be anything; only a string counts.
		private fun JsonObject.string(name: String): String? = (this[name] as? JsonPrimitive)?.takeIf { it.isString }?.contentOrNull

		/** A CSS color from getComputedStyle or a theme-color tag: #rgb, #rrggbb, rgb() or rgba(). */
		internal fun parseCssColor(value: String): Color? {
			val text = value.trim().lowercase()
			if (text.startsWith("#")) {
				val hex = text.drop(1)
				val full = when (hex.length) {
					3 -> hex.map { "$it$it" }.joinToString("")
					6 -> hex
					else -> return null
				}
				val rgb = full.toLongOrNull(16) ?: return null
				return Color(0xFF000000 or rgb)
			}
			val match = Regex("""rgba?\(([^)]*)\)""").matchEntire(text) ?: return null
			val parts = match.groupValues[1].split(',', '/', ' ').filter { it.isNotBlank() }
			if (parts.size < 3) return null
			val (r, g, b) = parts.take(3).map { it.trim().toFloatOrNull() ?: return null }
			val alpha = parts.getOrNull(3)?.trim()?.let { if (it.endsWith("%")) it.dropLast(1).toFloatOrNull()?.div(100) else it.toFloatOrNull() } ?: 1f
			// A transparent background is no color at all.
			if (alpha == 0f) return null
			return Color(r / 255f, g / 255f, b / 255f, alpha.coerceIn(0f, 1f))
		}
	}
}
