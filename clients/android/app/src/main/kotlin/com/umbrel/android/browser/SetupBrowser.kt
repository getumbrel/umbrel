package com.umbrel.android.browser

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.compose.ui.window.DialogWindowProvider
import androidx.core.net.toUri
import com.umbrel.android.ui.AppleType
import com.umbrel.android.ui.MainTheme
import com.umbrel.android.ui.Symbols
import com.umbrel.kit.Umbreld

/**
 * First-time setup, without leaving the app. A new Umbrel is set up by umbrelOS's own
 * onboarding (it knows the hardware, storage, and restore options), shown here over the
 * Umbrel's pinned secure connection. When the account exists, the app signs in with the
 * password that was just chosen and carries on.
 *
 * [onFinish] is called once setup has produced an account, with the chosen password if the
 * app saw it being typed. [onNeedsBrowser] is called when setup reaches a step that restarts
 * the Umbrel, which has to happen in a browser, saying whether it's a restore.
 */
@Composable
internal fun SetupBrowser(
	target: Umbreld.Target,
	onFinish: (password: String?) -> Unit,
	onNeedsBrowser: (restoring: Boolean) -> Unit,
	onCancel: () -> Unit,
) {
	Dialog(
		onDismissRequest = onCancel,
		properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false, dismissOnClickOutside = false),
	) {
		val window = (LocalView.current.parent as? DialogWindowProvider)?.window
		SideEffect { window?.setDimAmount(0f) }
		SetupContent(target, window, onFinish, onNeedsBrowser, onCancel)
	}
}

@Composable
private fun SetupContent(
	target: Umbreld.Target,
	window: android.view.Window?,
	onFinish: (password: String?) -> Unit,
	onNeedsBrowser: (restoring: Boolean) -> Unit,
	onCancel: () -> Unit,
) {
	val context = LocalContext.current
	val density = LocalDensity.current
	val scope = rememberCoroutineScope()
	val currentOnFinish by rememberUpdatedState(onFinish)
	val currentOnNeedsBrowser by rememberUpdatedState(onNeedsBrowser)
	var page by remember { mutableStateOf<BrowserPage?>(null) }
	var unreachable by remember { mutableStateOf(false) }
	var attempt by remember { mutableIntStateOf(0) }
	val top = with(density) { WindowInsets.statusBars.getTop(this).toDp().value.toInt() }
	val bottom = with(density) { WindowInsets.navigationBars.getBottom(this).toDp().value.toInt() }

	LaunchedEffect(attempt) {
		unreachable = false
		val host = try {
			Umbreld.resolvedHost(target)
		} catch (failure: Exception) {
			if (failure is kotlinx.coroutines.CancellationException) throw failure
			unreachable = true
			return@LaunchedEffect
		}
		// The owner is the only account that can exist at the end of setup.
		val browserContext = BrowserContext.create(context.applicationContext, target.deviceId, "0", target.hosts + host, scope)
		val setup = BrowserPage("setup", BrowserPage.Identity("Set Up Umbrel", null, isUmbrel = true), browserContext)
		var password: String? = null
		var accountCreated = false
		setup.observePasswordEntry { password = it }
		// Setup is umbrelOS's moment: its wallpaper fills the screen, with no bar.
		setup.fillScreen(top, bottom)
		setup.isOnScreen = { true }
		setup.onLocationChange = { location ->
			val path = location.path.orEmpty()
			when {
				// Restore is chosen partway through setup, so it can't be sent to a browser in
				// advance. It hands over at its first screen, before anything has changed. The
				// RAID pages are a safety net in case umbrelOS offers RAID where the app doesn't
				// expect it.
				RestartingSteps.any { path.startsWith(it) } -> currentOnNeedsBrowser(path.startsWith("/onboarding/restore"))
				// umbrelOS ends onboarding on a confirmation page, then enters the desktop.
				// Leaving onboarding after that page is the user saying they're done.
				path.startsWith("/onboarding/account-created") -> accountCreated = true
				accountCreated && !path.startsWith("/onboarding") -> currentOnFinish(password)
			}
		}
		setup.open("https://${BrowserContext.bracketed(host)}/".toUri(), resuming = false)
		page = setup
	}
	DisposableEffect(Unit) { onDispose { page?.destroy() } }
	BackHandler(onBack = onCancel)

	Box(Modifier.fillMaxSize().background(Color.Black), contentAlignment = Alignment.Center) {
		val current = page
		when {
			current != null -> BrowserPageView(current, onClose = onCancel, onOpenInBrowser = null, window = window, isImmersive = true)
			unreachable -> Column(
				Modifier.padding(horizontal = 32.dp),
				horizontalAlignment = Alignment.CenterHorizontally,
				verticalArrangement = Arrangement.spacedBy(8.dp),
			) {
				Icon(Symbols.WifiAlert, contentDescription = null, tint = MainTheme.gray, modifier = Modifier.size(40.dp))
				Text("Can’t Reach Umbrel", style = AppleType.title3, fontWeight = FontWeight.SemiBold, color = Color.White)
				Text(
					"Make sure your Umbrel is turned on and this phone is on the same network.",
					style = AppleType.subheadline,
					color = MainTheme.gray,
					textAlign = TextAlign.Center,
				)
				TextButton(onClick = { attempt++ }) { Text("Try Again") }
				TextButton(onClick = onCancel) { Text("Cancel") }
			}
			else -> CircularProgressIndicator(Modifier.size(28.dp), color = Color.White, strokeWidth = 2.5.dp)
		}
	}
}

private val RestartingSteps = listOf("/onboarding/restore", "/onboarding/raid", "/onboarding/ssd-raid", "/onboarding/hdd-raid")
