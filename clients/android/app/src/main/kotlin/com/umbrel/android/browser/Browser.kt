package com.umbrel.android.browser

import android.content.Context
import android.net.Uri
import androidx.annotation.MainThread
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.layout.boundsInWindow
import androidx.compose.ui.layout.onGloballyPositioned
import com.umbrel.android.main.ConnectionState
import com.umbrel.android.main.MainViewModel
import com.umbrel.kit.Umbreld
import kotlinx.coroutines.CoroutineScope

/**
 * The in-app browser for one connected Umbrel. umbrelOS and its apps open here instead of
 * leaving for a browser: already signed in, over the Umbrel's pinned secure connection, and
 * still running the next time they are opened.
 *
 * The two are shown differently on purpose. An app is its own thing, so it zooms out of its
 * icon into a page with a title bar. umbrelOS is the Umbrel itself and shares the app's
 * wallpaper, so it takes over in place.
 */
@MainThread
@Stable
internal class Browser(
	private val appContext: Context,
	private val model: MainViewModel,
	private val scope: CoroutineScope,
) {
	/** An app, presented over everything with its own title bar. */
	var page by mutableStateOf<BrowserPage?>(null)
		private set
	var isPresented by mutableStateOf(false)
		private set

	/** Whether the presented page is on screen at all, including while it zooms away. */
	var showsPresentation by mutableStateOf(false)
		private set

	/** umbrelOS, shown in place of the native screens on the same wallpaper. */
	var umbrel by mutableStateOf<BrowserPage?>(null)
		private set
	var showsUmbrel by mutableStateOf(false)
		private set

	/** Where the presented page grows out of and shrinks back into. */
	var sourceId by mutableStateOf<Any?>(null)
		private set
	val sources = BrowserSources()

	private var context: BrowserContext? = null

	// Most recently used first. A handful stay warm so switching between umbrelOS and a
	// couple of apps is instant; older ones are released to keep memory modest.
	private val pages = mutableListOf<BrowserPage>()

	// ── Opening ──

	/** Opens umbrelOS at a path. Returns false when the Umbrel can't be reached. */
	suspend fun openUmbrel(path: String = "", query: List<Pair<String, String>> = emptyList()): Boolean {
		val url = model.browserUrl(path, query) ?: return false
		val context = currentContext() ?: return false
		// Asking for umbrelOS itself returns to wherever it was; asking for a place inside it
		// goes there.
		show(umbrelPage(context), url, resuming = path.isEmpty() && query.isEmpty(), source = null)
		return true
	}

	suspend fun open(app: Umbreld.AppSummary, source: Any? = null): Boolean {
		val url = model.browserUrl(app) ?: return false
		val context = currentContext() ?: return false
		show(page(app, context), url, resuming = true, source = source)
		return true
	}

	/**
	 * Loads umbrelOS quietly once the Umbrel is known to be reachable, so the first time it is
	 * opened it is simply there. Nothing is shown and nothing is asked of the user; if it
	 * can't load now, opening it later loads it as usual.
	 */
	suspend fun preloadUmbrel() {
		if (umbrel != null || model.state.value.connectionState != ConnectionState.CONNECTED) return
		val url = model.browserUrl() ?: return
		val context = currentContext() ?: return
		if (umbrel != null) return
		umbrelPage(context).open(url, resuming = true)
	}

	/** Starts closing the presented page; the view calls [didDismiss] once it's gone. */
	fun close() {
		isPresented = false
	}

	fun closeUmbrel() {
		showsUmbrel = false
	}

	/** The presentation ended, by the close button or by gesture. */
	fun didDismiss() {
		isPresented = false
		showsPresentation = false
		sourceId = null
		page?.let(::releaseIfCapturing)
	}

	/** Keeps the browser session alive while the app is in use, off the path of opening a page. */
	suspend fun keepSessionAlive() {
		currentContext()?.validateSession()
	}

	/**
	 * The current location, readdressed for the phone's browser: a name people can read, over
	 * HTTPS wherever the browser can open it without a warning.
	 */
	suspend fun browserUrlForOpening(page: BrowserPage): String? {
		// Another website (a sign-in, say): its own address.
		if (page.outsideHost != null) return page.shownUrl?.toString()
		val app = model.state.value.installedApps.firstOrNull { it.id == page.origin }
		val base = (if (app != null) model.appUrlForOpening(app) else model.dashboardUrlForOpening())?.let(Uri::parse)
			?: return null
		val shown = page.shownUrl ?: return base.toString()
		val builder = base.buildUpon()
		// A page on the Umbrel that isn't an app's front door keeps its own port.
		if (app == null && page.origin != UMBREL_PAGE_ORIGIN && shown.port > 0) {
			builder.encodedAuthority("${base.encodedAuthority?.substringBeforeLast(':')}:${shown.port}")
		}
		return builder.encodedPath(shown.encodedPath).encodedQuery(shown.encodedQuery).encodedFragment(shown.encodedFragment)
			.build().toString()
	}

	/** Releases every page; called when this Umbrel's screen goes away. */
	fun destroy() {
		pages.forEach(BrowserPage::destroy)
		pages.clear()
		umbrel?.destroy()
		umbrel = null
		page = null
		isPresented = false
		showsPresentation = false
		showsUmbrel = false
		context = null
	}

	// ── Pages ──

	private fun show(page: BrowserPage, url: Uri, resuming: Boolean, source: Any?) {
		context?.updateHosts(model.browserHosts)
		page.open(url, resuming)
		if (page === umbrel) {
			// umbrelOS takes over in place; any app on top steps aside for it.
			isPresented = false
			showsUmbrel = true
			return
		}
		pages.remove(page)
		pages.add(0, page)
		for (stale in pages.drop(WARM_PAGE_LIMIT)) {
			if (stale === this.page) continue
			pages.remove(stale)
			stale.destroy()
		}
		if (isPresented) {
			// Already on screen (umbrelOS just launched an app): change pages in place.
			val replaced = this.page
			this.page = page
			if (replaced !== page) replaced?.let(::releaseIfCapturing)
		} else {
			sourceId = source
			this.page = page
			isPresented = true
			showsPresentation = true
		}
	}

	/**
	 * A warm page keeps running out of sight, and so does a call it holds: WebView has no way
	 * to stop a page's camera and microphone short of releasing it. Closing a page that was
	 * given either releases it, so the next open loads it again.
	 */
	private fun releaseIfCapturing(page: BrowserPage) {
		if (!page.wasGrantedCapture) return
		pages.remove(page)
		if (this.page === page) this.page = null
		page.destroy()
	}

	/**
	 * umbrelOS has one page for the life of the connection. It is never released with the app
	 * pages: it is what makes opening umbrelOS feel like part of the app.
	 */
	private fun umbrelPage(context: BrowserContext): BrowserPage {
		umbrel?.let { return it }
		val page = BrowserPage(UMBREL_PAGE_ORIGIN, BrowserPage.Identity("umbrelOS", null, isUmbrel = true), context, isSeeThrough = true)
		configure(page)
		umbrel = page
		return page
	}

	private fun page(app: Umbreld.AppSummary, context: BrowserContext): BrowserPage =
		page(app.id, BrowserPage.Identity(app.name ?: app.id, app.icon, isUmbrel = false), context)

	private fun page(origin: String, identity: BrowserPage.Identity, context: BrowserContext): BrowserPage {
		pages.firstOrNull { it.origin == origin }?.let {
			it.update(identity)
			return it
		}
		return BrowserPage(origin, identity, context).also(::configure)
	}

	private fun configure(page: BrowserPage) {
		page.onOpenUmbrelUrl = ::route
		page.isOnScreen = { (page === this.page && isPresented) || (page === umbrel && showsUmbrel) }
	}

	/**
	 * A page asked for another page on this Umbrel. Send it to that app's own page (or
	 * umbrelOS's), so each keeps its place.
	 */
	private fun route(requested: Uri) {
		val context = context ?: return
		val url = context.secureUrl(requested)
		if (context.isDashboard(url)) {
			show(umbrelPage(context), url, resuming = false, source = null)
			return
		}
		val app = url.port.takeIf { it > 0 }?.let { port -> model.state.value.installedApps.firstOrNull { it.port == port } }
		if (app != null) {
			show(page(app, context), url, resuming = false, source = null)
		} else {
			// Something on the Umbrel that isn't an installed app's front door.
			val identity = BrowserPage.Identity(url.host ?: "Umbrel", null, isUmbrel = false)
			show(page("${url.host}:${url.port}", identity, context), url, resuming = false, source = null)
		}
	}

	private suspend fun currentContext(): BrowserContext? {
		val state = model.state.value
		val deviceId = state.device.id
		val accountId = state.session?.accountId ?: return null
		context?.let { if (it.deviceId == deviceId && it.accountId == accountId) return it }
		destroy()
		val created = BrowserContext.create(appContext, deviceId, accountId, model.browserHosts, scope)
		// Another open may have made one while the stored session was read.
		context?.let { if (it.deviceId == deviceId && it.accountId == accountId) return it }
		context = created
		return created
	}

	companion object {
		private const val WARM_PAGE_LIMIT = 3
		const val UMBREL_PAGE_ORIGIN = "umbrelos"
	}
}

/**
 * The on-screen tiles pages grow out of and shrink back into, by their bounds in the window.
 * Read only while a page opens or closes, so moving tiles never cause a recomposition.
 */
internal class BrowserSources {
	private val bounds = HashMap<Any, Rect>()

	fun register(id: Any, rect: Rect) {
		bounds[id] = rect
	}

	fun unregister(id: Any) {
		bounds.remove(id)
	}

	fun bounds(id: Any?): Rect? = id?.let { bounds[it] }?.takeIf { !it.isEmpty }
}

internal val LocalBrowserSources = staticCompositionLocalOf<BrowserSources?> { null }

/** Marks this as the place a page zooms out of and back into, under [id]. */
@Composable
internal fun Modifier.browserSource(id: Any): Modifier {
	val sources = LocalBrowserSources.current ?: return this
	DisposableEffect(sources, id) { onDispose { sources.unregister(id) } }
	return onGloballyPositioned { sources.register(id, it.boundsInWindow()) }
}
