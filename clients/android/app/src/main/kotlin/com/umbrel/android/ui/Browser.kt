package com.umbrel.android.ui

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import androidx.browser.customtabs.CustomTabsIntent
import androidx.core.net.toUri

/**
 * Opens a web address in a Custom Tab: the user's own browser with its cookie jar and
 * permissions. The app's pinned CA is app-scoped, so the browser trusts an Umbrel's local
 * HTTPS only once the user installed the Umbrel's certificate.
 */
fun Context.openUrl(url: String) {
	val uri = url.toUri()
	try {
		CustomTabsIntent.Builder().setShowTitle(true).build().launchUrl(this, uri)
	} catch (error: ActivityNotFoundException) {
		try {
			startActivity(Intent(Intent.ACTION_VIEW, uri).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
		} catch (fallback: ActivityNotFoundException) {
			// No browser installed; nothing to do.
		}
	}
}

/**
 * Opens [url] with whichever app handles it, so a store link opens the store app rather
 * than a browser tab.
 */
fun Context.openExternal(url: String) {
	try {
		startActivity(Intent(Intent.ACTION_VIEW, url.toUri()).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
	} catch (error: ActivityNotFoundException) {
		openUrl(url)
	}
}

fun Context.openAppSettings() {
	val intent = Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS, "package:$packageName".toUri())
		.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
	try {
		startActivity(intent)
	} catch (error: ActivityNotFoundException) {
	}
}
