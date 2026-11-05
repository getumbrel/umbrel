package com.umbrel.android.browser

import android.content.Context
import android.content.SharedPreferences
import android.webkit.CookieManager
import android.webkit.WebStorage
import androidx.core.content.edit
import androidx.webkit.ProfileStore
import androidx.webkit.WebViewFeature
import com.umbrel.kit.BrowserSession
import com.umbrel.kit.BrowserSessionStatus
import com.umbrel.kit.SecretStore
import com.umbrel.kit.Umbreld
import com.umbrel.kit.loginBrowser
import com.umbrel.kit.logoutBrowser
import com.umbrel.kit.renewBrowserSession
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.security.MessageDigest

/**
 * The in-app browser's umbrelOS sign-in for each Umbrel, and the web data its pages keep.
 * Each signed-in account's pages keep their cookies and storage in their own WebView
 * profile, so one account's pages never see another's, and signing out clears only that
 * account's.
 */
internal object BrowserSessions {
	private const val VALIDATION_INTERVAL_MS = 12 * 60 * 60 * 1000L
	private const val PROFILE_PREFIX = "umbrel-"

	@Volatile
	private var preferences: SharedPreferences? = null

	/** Must be called once before any sign-in or sign-out. */
	fun initialize(context: Context) {
		preferences = context.getSharedPreferences("browser-sessions", Context.MODE_PRIVATE)
	}

	/**
	 * Called with a native sign-in before it's stored, so a web page never asks for the
	 * password again. Making the browser session renews the sign-in's access, so the session
	 * returned is the one to store. Best effort: without a browser session, the browser makes
	 * one when it first needs it, or shows umbrelOS's own login page once.
	 */
	suspend fun signIn(target: Umbreld.Target, session: Umbreld.Session, password: String, totpToken: String?): Umbreld.Session {
		// Ends any previous browser session for this Umbrel rather than leaving it live on
		// the server once its stored entry is replaced.
		signOut(target, session.accountId)
		val made = try {
			Umbreld.makeBrowserSessionSigningIn(target, session)
		} catch (cancelled: CancellationException) {
			throw cancelled
		} catch (error: Exception) {
			null
		}
		// An older umbrelOS makes none, so log in the way a browser does, as the app always
		// has. Older Umbrels keep working.
		val browserSession = made?.browserSession ?: try {
			Umbreld.loginBrowser(target, session.accountId, password, totpToken)
		} catch (cancelled: CancellationException) {
			throw cancelled
		} catch (error: Exception) {
			null
		}
		if (browserSession != null) store(target, browserSession)
		return made?.session ?: session
	}

	/** Keeps a session the browser was given. */
	suspend fun store(target: Umbreld.Target, session: BrowserSession) {
		if (withContext(Dispatchers.IO) { SecretStore.setBrowserSession(session) }) {
			markValidated(target.deviceId)
		} else if (!session.linked) {
			// A session this phone can't keep would stay live on the server for a week. A linked
			// one ends with the app's sign-in, and logging it out would end that sign-in too.
			logOutQuietly(target, session)
		}
	}

	/**
	 * Forgets the session and everything its web pages stored. The server-side session is
	 * ended on a best-effort basis; it expires on its own regardless.
	 */
	suspend fun signOut(target: Umbreld.Target, accountId: String?) {
		val session = withContext(Dispatchers.IO) {
			SecretStore.readBrowserSession(target.deviceId).also { SecretStore.deleteBrowserSession(target.deviceId) }
		}
		if (accountId != null) clearWebData(target.deviceId, accountId)
		if (session != null) logOutQuietly(target, session)
	}

	private suspend fun logOutQuietly(target: Umbreld.Target, session: BrowserSession) {
		try {
			Umbreld.logoutBrowser(target, session)
		} catch (cancelled: CancellationException) {
			throw cancelled
		} catch (error: Exception) {
			// Best effort: the session expires on its own.
		}
	}

	/**
	 * umbrelOS sessions last a week from their last use. Renewing on the app's behalf keeps
	 * the browser signed in for people who mostly use the native screens, and tells us when
	 * the session has ended so a dead one is never handed to a page. Null when it was renewed
	 * recently enough not to ask; an ended session is also forgotten here.
	 */
	suspend fun validate(target: Umbreld.Target, session: BrowserSession, force: Boolean = false): BrowserSessionStatus? {
		val last = preferences?.getLong(validatedKey(target.deviceId), 0L) ?: 0L
		if (!force && System.currentTimeMillis() - last <= VALIDATION_INTERVAL_MS) return null
		val status = Umbreld.renewBrowserSession(target, session)
		when (status) {
			BrowserSessionStatus.VALID -> markValidated(target.deviceId)
			BrowserSessionStatus.INVALID -> withContext(Dispatchers.IO) {
				// Only the session that was found dead: a sign-in meanwhile may have replaced it.
				if (SecretStore.readBrowserSession(target.deviceId) == session) SecretStore.deleteBrowserSession(target.deviceId)
			}
			BrowserSessionStatus.UNKNOWN -> Unit
		}
		return status
	}

	/**
	 * Web data outlives the accounts it was made for (a removed Umbrel, a sign-out while a
	 * profile was in use). Keeps only the profiles of accounts still signed in. Call before
	 * any page is shown in this process: a profile a web view has used can't be deleted.
	 */
	suspend fun removeOrphanedData(keeping: List<Pair<String, String>>) = withContext(Dispatchers.Main) {
		try {
			removeOrphanedProfiles(keeping)
		} catch (unavailable: RuntimeException) {
			// WebView is missing or being updated; the next launch tries again.
		}
	}

	private fun removeOrphanedProfiles(keeping: List<Pair<String, String>>) {
		if (!WebViewFeature.isFeatureSupported(WebViewFeature.MULTI_PROFILE)) return
		val keep = keeping.map { (deviceId, accountId) -> profileName(deviceId, accountId) }.toSet()
		val store = ProfileStore.getInstance()
		for (name in store.allProfileNames) {
			if (!name.startsWith(PROFILE_PREFIX) || name in keep) continue
			try {
				store.deleteProfile(name)
			} catch (inUse: IllegalStateException) {
				// Loaded in this process already; its data was cleared at sign-out.
			}
		}
	}

	/** The WebView profile holding one account's pages on one Umbrel. */
	fun profileName(deviceId: String, accountId: String): String {
		val digest = MessageDigest.getInstance("SHA-256").digest("umbrel-browser:$deviceId:$accountId".toByteArray())
		return PROFILE_PREFIX + digest.take(16).joinToString("") { "%02x".format(it) }
	}

	private suspend fun clearWebData(deviceId: String, accountId: String) = withContext(Dispatchers.Main) {
		try {
			if (WebViewFeature.isFeatureSupported(WebViewFeature.MULTI_PROFILE)) {
				val profile = ProfileStore.getInstance().getProfile(profileName(deviceId, accountId)) ?: return@withContext
				profile.cookieManager.removeAllCookies(null)
				profile.webStorage.deleteAllData()
			} else {
				// Without profiles every account shares one store, so all of it goes.
				CookieManager.getInstance().removeAllCookies(null)
				WebStorage.getInstance().deleteAllData()
			}
		} catch (unavailable: RuntimeException) {
			// WebView is missing or being updated. Its data stays until the next launch removes
			// web data of accounts no longer signed in.
		}
	}

	private fun markValidated(deviceId: String) {
		preferences?.edit { putLong(validatedKey(deviceId), System.currentTimeMillis()) }
	}

	private fun validatedKey(deviceId: String) = "validated:$deviceId"
}
