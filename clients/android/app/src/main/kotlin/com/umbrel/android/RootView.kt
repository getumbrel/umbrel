package com.umbrel.android

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.compose.LifecycleStartEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.umbrel.android.browser.BrowserSessions
import com.umbrel.android.main.AllDevicesScreen
import com.umbrel.android.main.ConnectionState
import com.umbrel.android.main.MainScreen
import com.umbrel.android.main.MainViewModel
import com.umbrel.android.onboarding.OnboardingFlow
import com.umbrel.android.onboarding.OnboardingMode
import com.umbrel.kit.SavedDevice
import com.umbrel.kit.SecretStore
import com.umbrel.kit.Umbreld
import kotlinx.coroutines.launch

/**
 * App root and navigation, as on iOS:
 *  - while an Umbrel is still being removed: the list, waiting
 *  - no saved devices, or "add device": onboarding
 *  - a selected device with a session: that device's tabs
 *  - otherwise: the all-devices list, which presents the sign-in sheet for a signed-out device
 * The selected device id is remembered so relaunching returns to it.
 */
@Composable
fun RootView() {
	val context = LocalContext.current
	val store = context.container.deviceStore
	val scope = rememberCoroutineScope()
	val devices by store.devices.collectAsStateWithLifecycle()
	val selectedId by store.selectedDeviceId.collectAsStateWithLifecycle()
	val signedIn by store.signedIn.collectAsStateWithLifecycle()
	val connections by store.connections.snapshots.collectAsStateWithLifecycle()
	val storageIssue by store.issue.collectAsStateWithLifecycle()
	// Onboarding saves the device as soon as sign-in succeeds, before its Connected step, so
	// once it opens it stays open until it finishes or is cancelled instead of following the
	// live device list.
	var onboarding by rememberSaveable { mutableStateOf<OnboardingMode?>(null) }
	var signInDeviceId by rememberSaveable { mutableStateOf<String?>(null) }
	val removals by store.removals.state.collectAsStateWithLifecycle()
	val shownDevices = removals.shown(devices)
	val route = rootRoute(devices, selectedId, signedIn, onboarding, removals)

	// iOS re-reads session presence whenever its root renders, including on returning to
	// the foreground; the first read here also releases the splash screen.
	LifecycleStartEffect(store) {
		val read = scope.launch { store.refreshSessions() }
		onStopOrDispose { read.cancel() }
	}

	// Web data for accounts no longer signed in on this phone, only when that's certain:
	// secret storage or a config that can't be read right now must not look like being
	// signed out.
	LaunchedEffect(Unit) {
		if (storageIssue != null) return@LaunchedEffect
		val signedInAccounts = mutableListOf<Pair<String, String>>()
		for (device in devices) {
			when (val read = store.readSession(device.id)) {
				is SecretStore.SessionReadResult.Found -> signedInAccounts += device.id to read.session.accountId
				is SecretStore.SessionReadResult.Unavailable -> return@LaunchedEffect
				else -> Unit
			}
		}
		BrowserSessions.removeOrphanedData(signedInAccounts)
	}

	// Saved devices follow their mDNS advertisements while the app is in the foreground.
	// Onboarding runs its own discovery, so the monitor stops while it is open, and while an
	// Umbrel is being removed, which Reconnect follows with onboarding.
	val savedDeviceDiscovery = remember { SavedDeviceDiscoveryMonitor(context, store) }
	val discoversSavedDevices = devices.isNotEmpty() && route !is RootRoute.Onboarding && removals.removing.isEmpty()
	LifecycleStartEffect(savedDeviceDiscovery, discoversSavedDevices) {
		if (discoversSavedDevices) savedDeviceDiscovery.start()
		onStopOrDispose { savedDeviceDiscovery.stop() }
	}

	// Back or sign out: re-read session state before routing.
	fun showAllDevices() {
		scope.launch {
			store.refreshSessions()
			store.select("")
		}
	}

	// A removed Umbrel's sheet is forgotten once its removal has finished, even if this screen
	// was recreated meanwhile, so adding it again doesn't reopen the sheet.
	LaunchedEffect(signInDeviceId, devices, removals) {
		if (removals.forgetsSignIn(signInDeviceId, devices)) signInDeviceId = null
	}

	/**
	 * Removing an Umbrel closes the screen or sheet that asked once it's gone, so it starts in
	 * this screen's scope. DeviceStore tracks the rest, which carries on even if this screen is
	 * recreated.
	 */
	suspend fun remove(device: SavedDevice, addsDevice: Boolean = false) {
		scope.launch { MainViewModel.removeSavedDevice(context, device.id, addsDevice) }.join()
	}

	/**
	 * For an Umbrel the app no longer recognizes: remove it, then go straight to adding an
	 * Umbrel, where it shows up again as it is now.
	 */
	suspend fun reconnect(device: SavedDevice) = remove(device, addsDevice = true)

	// Looked up in the list as shown, so an address the discovery monitor updates while the
	// sheet is open is used by its next request, and as on iOS, the sheet of an Umbrel being
	// removed stays up until it's gone.
	val signInDevice = shownDevices.firstOrNull { it.id == signInDeviceId }

	when (route) {
		is RootRoute.Onboarding -> {
			val mode = route.mode
			LaunchedEffect(mode) {
				onboarding = mode
				store.removals.addDeviceOpened()
			}
			// The flow keeps its mode for its lifetime; cancelling adding after Reconnect removed
			// the only Umbrel has to start a fresh first run.
			key(mode) { OnboardingFlow(
				mode = mode,
				onFinished = { deviceId ->
					// Onboarding just signed in over this connection, so Home opens on Connected.
					store.connections.record(deviceId, ConnectionState.CONNECTED)
					scope.launch {
						store.refreshSession(deviceId)
						store.select(deviceId)
						onboarding = null
					}
				},
				onCancel = { onboarding = null },
			) }
		}
		// The splash screen stays up until the first session read lands.
		RootRoute.Loading -> Box(Modifier.fillMaxSize().background(Color.Black))
		is RootRoute.Device -> key(route.device.id) {
			MainScreen(
				device = route.device,
				onSignedOut = ::showAllDevices,
				onShowAllDevices = ::showAllDevices,
				onReconnect = { reconnect(route.device) },
			)
		}
		RootRoute.AllDevices -> {
			// With the sheet closed before an Umbrel's sessions and certificate are gone, the
			// list waits: nothing can be opened or added meanwhile, and Back waits too.
			val waiting = removals.removing.isNotEmpty() && signInDevice == null
			AllDevicesScreen(
				devices = shownDevices,
				signedIn = signedIn.orEmpty(),
				connections = connections,
				onSelect = { device ->
					scope.launch {
						if (store.refreshSession(device.id)) store.select(device.id) else signInDeviceId = device.id
					}
				},
				onAdd = {
					// Before onboarding composes and starts its own browse. Before Android 14,
					// NSD resolves one service at a time per NsdManager, which both share.
					savedDeviceDiscovery.stop()
					onboarding = OnboardingMode.ADD_DEVICE
				},
				removing = waiting,
			)
			if (waiting) BackHandler {}
		}
	}

	signInDevice?.let { device ->
		SignInSheet(
			deviceId = device.id,
			deviceName = device.model ?: device.name,
			deviceModel = device.model,
			target = device.nativeTarget,
			preferredUserId = device.lastAccountId,
			onPrepare = { Umbreld.prepareSavedDeviceForSignIn(device.nativeTarget) },
			onSignedIn = { session, account ->
				store.saveSignIn(device.id, session, account)
				store.connections.record(device.id, ConnectionState.CONNECTED)
				scope.launch {
					store.refreshSession(device.id)
					store.select(device.id)
					signInDeviceId = null
				}
			},
			onDismiss = { signInDeviceId = null },
			onReconnect = { reconnect(device) },
			onRemove = { remove(device) },
			removing = device.id in removals.removing,
		)
	}

	storageIssue?.let { issue ->
		AlertDialog(
			onDismissRequest = store::dismissIssue,
			title = { Text(issue.title) },
			text = { Text(issue.description) },
			confirmButton = { TextButton(onClick = store::dismissIssue) { Text("OK") } },
		)
	}
}

/** Where the app root goes; see [RootView]. */
internal sealed interface RootRoute {
	data class Onboarding(val mode: OnboardingMode) : RootRoute

	/** The first session read hasn't landed. */
	data object Loading : RootRoute

	data class Device(val device: SavedDevice) : RootRoute

	data object AllDevices : RootRoute
}

/**
 * As on iOS, an Umbrel being removed stays where it was until it's gone: its own screen keeps
 * showing, and an empty list doesn't open first-run onboarding, where it could be added again
 * meanwhile. Reconnect's request to add one comes before first-run onboarding, which an empty
 * list would otherwise open.
 */
internal fun rootRoute(
	devices: List<SavedDevice>,
	selectedId: String,
	signedIn: Map<String, Boolean>?,
	onboarding: OnboardingMode?,
	removals: SavedDeviceRemovals.State,
): RootRoute {
	val shown = removals.shown(devices)
	val mode = onboarding
		?: OnboardingMode.ADD_DEVICE.takeIf { removals.addsDevice }
		?: OnboardingMode.FIRST_RUN.takeIf { shown.isEmpty() }
	if (mode != null) return RootRoute.Onboarding(mode)
	if (signedIn == null) return RootRoute.Loading
	val selected = shown.firstOrNull { it.id == selectedId }?.takeIf { signedIn[it.id] == true }
	return if (selected != null) RootRoute.Device(selected) else RootRoute.AllDevices
}

/** Whether the sign-in sheet's Umbrel is gone, and its removal has finished. */
internal fun SavedDeviceRemovals.State.forgetsSignIn(deviceId: String?, devices: List<SavedDevice>): Boolean =
	deviceId != null && deviceId !in removing && devices.none { it.id == deviceId }
