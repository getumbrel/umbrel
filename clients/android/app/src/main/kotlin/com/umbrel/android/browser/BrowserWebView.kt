package com.umbrel.android.browser

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.content.MutableContextWrapper
import android.view.View
import android.view.ViewGroup
import android.webkit.WebView
import android.widget.FrameLayout
import androidx.compose.runtime.Composable
import androidx.compose.runtime.key
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.graphics.Insets
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.webkit.WebViewCompat

/**
 * Hosts a page's long-lived web view. The view is owned by its page, so the same instance
 * moves in and out of the hierarchy as the browser opens and closes. While it's on screen it
 * runs with the Activity as its context, so the dialogs and pickers a page opens have a
 * window; once off screen it goes back to the application, so a page kept warm never holds
 * on to a closed Activity.
 */
@Composable
internal fun BrowserWebView(webView: WebView, modifier: Modifier = Modifier, insets: WebViewInsets? = null) {
	// One container per web view: a page swapped in place gets its own, and the one it
	// replaces is released with its own container.
	key(webView) { AndroidView(
		factory = { context -> FrameLayout(context) },
		modifier = modifier,
		update = { container ->
			if (insets != null && container.tag != insets) {
				container.tag = insets
				insets.apply(container)
			}
			if (webView.parent === container) return@AndroidView
			(webView.parent as? ViewGroup)?.removeView(webView)
			(webView.context as? MutableContextWrapper)?.baseContext = container.context.activity ?: container.context
			container.addView(webView, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
		},
		onRelease = { container ->
			if (webView.parent === container) container.removeView(webView)
			(webView.context as? MutableContextWrapper)?.let { it.baseContext = BrowserContext.offscreenContext(it) }
		},
	) }
}

private val Context.activity: Activity?
	get() {
		var context: Context? = this
		while (context is ContextWrapper) {
			if (context is Activity) return context
			context = context.baseContext
		}
		return null
	}

/**
 * The safe area a web view reports to its page as env(safe-area-inset-*). WebView takes it
 * from the window insets it receives (system bars and display cutout, from WebView 144),
 * so the container hands it insets describing what actually covers the page: [top] at the
 * top, the display cutout at the sides, and the navigation bar when the page runs under it
 * ([underNavigationBar]), at the bottom only while the keyboard isn't up. Otherwise the layout
 * already keeps the page clear of the bar and the keyboard.
 */
internal data class WebViewInsets(private val top: Int, private val underNavigationBar: Boolean) {
	fun apply(container: View) {
		ViewCompat.setOnApplyWindowInsetsListener(container) { _, windowInsets ->
			val cutout = windowInsets.getInsets(WindowInsetsCompat.Type.displayCutout())
			// The bar can be at a side on some large screens. The layout pads the page above the
			// keyboard, which covers the bar when it's up.
			val bar = if (underNavigationBar) windowInsets.getInsets(WindowInsetsCompat.Type.navigationBars()) else Insets.NONE
			val bottom = maxOf(0, bar.bottom - windowInsets.getInsets(WindowInsetsCompat.Type.ime()).bottom)
			WindowInsetsCompat.Builder(windowInsets)
				.setInsets(WindowInsetsCompat.Type.systemBars(), Insets.of(bar.left, top, bar.right, bottom))
				.setInsets(WindowInsetsCompat.Type.displayCutout(), Insets.of(cutout.left, 0, cutout.right, 0))
				.setInsets(WindowInsetsCompat.Type.ime(), Insets.NONE)
				.build()
		}
		container.requestApplyInsets()
	}
}

/**
 * Whether WebView reports the window insets it's given as the page's safe area. Before
 * WebView 144 it does so only for a full-screen web view, so a page laid out under the
 * header would find a top safe area of zero.
 */
internal fun reportsSafeArea(context: Context): Boolean {
	val version = WebViewCompat.getCurrentWebViewPackage(context)?.versionName ?: return false
	return (version.substringBefore('.').toIntOrNull() ?: 0) >= 144
}
