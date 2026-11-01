package com.umbrel.android.browser

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.content.MutableContextWrapper
import android.view.ViewGroup
import android.webkit.WebView
import android.widget.FrameLayout
import androidx.compose.runtime.Composable
import androidx.compose.runtime.key
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.AndroidView

/**
 * Hosts a page's long-lived web view. The view is owned by its page, so the same instance
 * moves in and out of the hierarchy as the browser opens and closes. While it's on screen it
 * runs with the Activity as its context, so the dialogs and pickers a page opens have a
 * window; once off screen it goes back to the application, so a page kept warm never holds
 * on to a closed Activity.
 */
@Composable
internal fun BrowserWebView(webView: WebView, modifier: Modifier = Modifier) {
	// One container per web view: a page swapped in place gets its own, and the one it
	// replaces is released with its own container.
	key(webView) { AndroidView(
		factory = { context -> FrameLayout(context) },
		modifier = modifier,
		update = { container ->
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
