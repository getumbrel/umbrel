package com.umbrel.android.main

import android.content.Context
import android.graphics.Bitmap
import android.net.ConnectivityManager
import android.net.Network
import android.net.Uri
import android.os.SystemClock
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.umbrel.android.AppContainer
import com.umbrel.android.SavedDeviceRemovalSteps
import com.umbrel.android.browser.Browser
import com.umbrel.android.browser.BrowserContext
import com.umbrel.android.browser.BrowserSessions
import com.umbrel.android.container
import com.umbrel.android.ui.BrandColor
import com.umbrel.kit.Config
import com.umbrel.kit.SavedDevice
import com.umbrel.kit.SecretStore
import com.umbrel.kit.Umbreld
import com.umbrel.kit.backup.PhotoBackupLedger
import com.umbrel.kit.backup.PhotoBackupManager
import com.umbrel.kit.backup.PhotoBackupNotice
import com.umbrel.kit.backup.PhotoBackupPreference
import com.umbrel.kit.backup.PhotoBackupSourceName
import com.umbrel.kit.backup.PhotoBackupStatistics
import com.umbrel.kit.backup.PhotoBackupStatus
import com.umbrel.kit.backup.PhotoLibraryAccess
import com.umbrel.kit.backup.PhotoLibraryCounts
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.cancel
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.job
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

enum class ConnectionState { UNVERIFIED, CONNECTED, UNAVAILABLE }

enum class ConnectionRoute { LOCAL, TAILSCALE }

/** Which resources a refresh may fetch: the visible tab's, or only the connection check. */
enum class RefreshScope { HOME, APPS, LIBRARY, PROFILE, CONNECTION }

data class MainUiState(
	val device: SavedDevice,
	val session: Umbreld.Session?,
	val userName: String? = null,
	val accountRole: String = if (session?.accountId == "0") "owner" else "member",
	val brandColorHsl: String? = null,
	val wallpaperId: String? = null,
	val wallpaper: ImageBitmap? = null,
	val blurredWallpaper: ImageBitmap? = null,
	val apps: List<Umbreld.AppSummary> = emptyList(),
	val disk: Umbreld.DiskUsage? = null,
	// The user's first four favorite folders, matching the umbrelOS files widget.
	val favoritePaths: List<String> = emptyList(),
	// Ids of installed apps with a newer version in the registry.
	val updatableApps: Set<String> = emptySet(),
	// A saved session means signed in, not necessarily reachable. Refreshes keep the last
	// confirmed result, so polling never flashes a transient status.
	val connectionState: ConnectionState = ConnectionState.UNVERIFIED,
	// The Umbrel answered with a different identity than the one this phone paired with, as
	// it does after the Umbrel or its certificate is reset. Only set while connectionState is
	// UNAVAILABLE: the user has to remove it and add it again.
	val identityChanged: Boolean = false,
	val connectionRoute: ConnectionRoute? = null,
	// Whether this phone can reach the Umbrel's known Tailscale address right now; null
	// until the first check.
	val tailscaleAvailableOnThisPhone: Boolean? = null,
	val tailscaleAvailabilityCheckInProgress: Boolean = false,
	val tailscaleSetupPresented: Boolean = false,
	// True once data is on screen, so empty states never flash while loading.
	val didLoad: Boolean = false,
	val preparingAppIds: Set<String> = emptySet(),
	val appLaunchSheet: AppLaunchSheet? = null,
	val appLaunchAlert: AppLaunchAlert? = null,
	val openingBrowser: Boolean = false,
	// ── Photo backup (see PhotoBackupManager) ──
	/** The toggles: photos and videos are on only while this account owns backup. */
	val backupPreference: PhotoBackupPreference = PhotoBackupPreference(),
	val backupStatus: PhotoBackupStatus = PhotoBackupStatus.Off,
	val backupNotice: PhotoBackupNotice? = null,
	val backupSetupInProgress: Boolean = false,
	val backupStatistics: PhotoBackupStatistics? = null,
	/** The account's backup source, kept after backup is turned off so receipts stay visible. */
	val backupSourceId: String? = null,
	/** How this phone appears in Photos on the Umbrel, when the app knows. */
	val backupSourceName: String? = null,
	/**
	 * Whether this account's backup source has been read, so the screens never hide backups
	 * from this phone before they know whether there are any.
	 */
	val backupSourceResolved: Boolean = false,
	/** The existing source the unanswered new-phone question names. */
	val backupNewSourceQuestion: String? = null,
	/** A confirmed "Back Up to This Umbrel" is checking this Umbrel, before anything changes. */
	val backupSwitchChecking: Boolean = false,
	/** What a confirmed switch came back needing, until it's answered. */
	val backupSwitchPrompt: BackupSwitchPrompt? = null,
	/** Changes whenever receipts may have changed, so visible thumbnails re-check their badge. */
	val backupReceiptRevision: Long = 0,
	/**
	 * Another Umbrel or account owns backup on this phone. The screens say where backup goes
	 * and offer only a confirmed switch, never controls that would silently move the library.
	 */
	val otherBackupDeviceName: String? = null,
	val photoLibraryAccess: PhotoLibraryAccess = PhotoLibraryAccess.NONE,
	// The library's photos and videos per folder, reported by PhotoLibraryViewModel; remaining
	// work is measured against it.
	val libraryCounts: PhotoLibraryCounts = PhotoLibraryCounts(),
	val error: String? = null,
) {
	val canManageApps: Boolean get() = accountRole == "owner" || session?.accountId == "0"
	val brandColor: Color get() = BrandColor.color(brandColorHsl)

	// Installed apps that decoded cleanly; umbreld can return error stubs.
	val installedApps: List<Umbreld.AppSummary> get() = apps.filter { it.name != null }
	val updateCount: Int get() = updatableApps.size
	val tailscaleApp: Umbreld.AppSummary? get() = installedApps.firstOrNull { it.id == "tailscale" }

	// The device model label, for example "Umbrel Pro".
	val deviceLabel: String get() = device.model ?: device.name

	// The label with the user's name when known, for example "Alex’s Umbrel Pro".
	val title: String get() = userName?.takeIf { it.isNotEmpty() }?.let { "$it’s $deviceLabel" } ?: deviceLabel

	val hasTailscaleBrowserAddress: Boolean get() = BrowserRouting.hasTailscaleAddress(device)

	/** What to say when the Umbrel can't be opened. */
	val unreachableTitle: String get() = if (identityChanged) "Umbrel Not Recognized" else "Can’t Reach Umbrel"
	val unreachableMessage: String
		get() = if (identityChanged) {
			"This usually happens after your Umbrel or its certificate is reset. Reconnect your Umbrel from Home to keep using it in this app."
		} else {
			"Check your connection and try again."
		}

	// A currently reported Tailscale address is evidence that the Umbrel side is set up.
	val umbrelHasTailscaleAddress: Boolean get() = device.tailscaleAddress != null
	val tailscaleConnectionStatus: String
		get() = when (tailscaleAvailableOnThisPhone) {
			null -> "Checking…"
			true -> "Connected"
			false -> "Not connected"
		}

	/** Full or selected access: the library (or the user's selection) can be read and backed up. */
	val libraryAccess: Boolean get() = photoLibraryAccess.canReadLibrary
	val partialLibraryAccess: Boolean get() = photoLibraryAccess == PhotoLibraryAccess.SELECTED
}

/**
 * Which resources one refresh fetches. These resources have no change-event stream, so
 * small foreground-only refreshes keep the visible tab current: identity and apps every
 * 15 s, storage and favorites every minute, updates every five minutes. Pull to refresh
 * forces every resource the tab shows.
 */
internal data class RefreshPlan(val identity: Boolean, val apps: Boolean, val disk: Boolean, val favorites: Boolean, val updates: Boolean) {
	val isEmpty: Boolean get() = !(identity || apps || disk || favorites || updates)

	/** Monotonic times of the last fetch of each resource, null before the first. */
	data class Times(
		val identity: Long? = null,
		val apps: Long? = null,
		val disk: Long? = null,
		val favorites: Long? = null,
		val updates: Long? = null,
	)

	companion object {
		const val IDENTITY_INTERVAL_MS = 15_000L
		const val APPS_INTERVAL_MS = 15_000L
		const val HOME_INTERVAL_MS = 60_000L
		const val UPDATES_INTERVAL_MS = 5 * 60_000L

		fun make(scope: RefreshScope, force: Boolean, canManageApps: Boolean, now: Long, last: Times): RefreshPlan {
			fun due(time: Long?, interval: Long) = force || time == null || now - time >= interval
			val showsApps = scope == RefreshScope.HOME || scope == RefreshScope.APPS
			return RefreshPlan(
				identity = due(last.identity, IDENTITY_INTERVAL_MS),
				apps = showsApps && due(last.apps, APPS_INTERVAL_MS),
				disk = (scope == RefreshScope.HOME || scope == RefreshScope.PROFILE) && due(last.disk, HOME_INTERVAL_MS),
				favorites = scope == RefreshScope.HOME && due(last.favorites, HOME_INTERVAL_MS),
				updates = canManageApps && showsApps && due(last.updates, UPDATES_INTERVAL_MS),
			)
		}
	}
}

/**
 * The main screen's state holder, the port of MainModel. Seeds Home from the cached
 * snapshot, refreshes the visible tab while the app is in the foreground, re-resolves the
 * Umbrel when the network changes, hands umbrelOS and its apps to the browser, and owns
 * the backup toggles for this account.
 */
class MainViewModel(context: Context, deviceId: String) : ViewModel() {
	private val appContext = context.applicationContext
	private val container: AppContainer = context.container
	private val store = container.deviceStore
	private val backup = container.backup
	private val wallpapers = container.wallpapers
	private val deviceData = container.deviceData
	private var ledger: PhotoBackupLedger? = null
	private var presentationJob: Job? = null
	private var switchJob: Job? = null

	// Work that runs only while the screen is started, like scenePhase-bound tasks on iOS.
	private var foreground: CoroutineScope? = null
	private var networkCallback: ConnectivityManager.NetworkCallback? = null
	private var visibleScope = RefreshScope.HOME
	private var remoteRefreshInProgress = false
	private var completedActivationRefresh = false
	private var refreshTimes = RefreshPlan.Times()
	private var renderedWallpaperId: String? = null
	private var wallpaperLoad: Job? = null
	private var wallpaperLoadId: String? = null
	private var shownWallpaper: Bitmap? = null
	private var shownBlurredWallpaper: Bitmap? = null

	// Foreground responses populate this; browser address selection reuses that evidence
	// instead of adding another periodic probe.
	private val recentlyReachableBrowserAddresses = HashMap<String, Long>()

	/** umbrelOS and its apps, open inside the app. */
	internal val browser = Browser(appContext, this, viewModelScope)

	private val _state = MutableStateFlow(initialState(store.device(deviceId) ?: SavedDevice(deviceId, deviceId, ""), store.session(deviceId)))
	val state: StateFlow<MainUiState> = _state

	init {
		// An unreadable Keystore is not proof of who is signed in, so it never stops backup.
		val stored = SecretStore.readSession(deviceId)
		if (stored !is SecretStore.SessionReadResult.Unavailable) backup.releaseStaleConfiguration(deviceId, stored.sessionOrCached?.accountId)
		viewModelScope.launch { backup.state.collect { refreshBackupPresentation() } }
		_state.value.wallpaperId?.let(::restoreCachedWallpaper)
	}

	/**
	 * Restores the last known identity and Home data so the first frame is complete, offline
	 * included. The snapshot is one small file read synchronously for that reason; decoded
	 * wallpapers come from memory here and from disk asynchronously below.
	 */
	private fun initialState(device: SavedDevice, session: Umbreld.Session?): MainUiState {
		val profile = session?.let { device.accountProfile(it.accountId) }
		val wallpaperId = profile?.wallpaperId
		val fullScreen = wallpaperId?.let(wallpapers::memoryCached)
		val image = fullScreen ?: wallpaperId?.let(wallpapers::memoryCachedCard)
		val blurred = wallpaperId?.let(wallpapers::memoryBlurred)
		if (fullScreen != null) renderedWallpaperId = wallpaperId
		shownWallpaper = image
		shownBlurredWallpaper = blurred
		val snapshot = session?.let { deviceData.load(device.id, it.accountId) }
		return MainUiState(
			device = device,
			session = session,
			userName = profile?.name,
			accountRole = profile?.role ?: if (session?.accountId == "0") "owner" else "member",
			brandColorHsl = profile?.wallpaperBrandColorHsl,
			wallpaperId = wallpaperId,
			wallpaper = image?.asImageBitmap(),
			blurredWallpaper = blurred?.asImageBitmap(),
			apps = snapshot?.apps.orEmpty(),
			disk = snapshot?.disk,
			favoritePaths = snapshot?.favoritePaths.orEmpty(),
			updatableApps = snapshot?.updatableApps.orEmpty().toSet(),
			didLoad = snapshot != null,
			// A check confirmed moments ago by onboarding, sign-in or the device list carries
			// over, so Home doesn't restart from Checking.
			connectionState = store.connections[device.id].state,
		)
	}

	private fun restoreCachedWallpaper(id: String) {
		viewModelScope.launch {
			val fullScreen = wallpapers.cached(id)
			val card = if (fullScreen == null) wallpapers.cachedCard(id) else null
			val blurred = wallpapers.blurred(id)
			if (_state.value.wallpaperId != id) return@launch
			showWallpaper(fullScreen ?: card, blurred, keepExisting = true)
			if (fullScreen != null) renderedWallpaperId = id
		}
	}

	private fun showWallpaper(image: Bitmap?, blurred: Bitmap?, keepExisting: Boolean = false) {
		val nextImage = image ?: shownWallpaper.takeIf { keepExisting }
		val nextBlurred = blurred ?: shownBlurredWallpaper.takeIf { keepExisting }
		if (nextImage === shownWallpaper && nextBlurred === shownBlurredWallpaper) return
		val imageChanged = nextImage !== shownWallpaper
		val blurredChanged = nextBlurred !== shownBlurredWallpaper
		shownWallpaper = nextImage
		shownBlurredWallpaper = nextBlurred
		_state.update {
			it.copy(
				wallpaper = if (imageChanged) nextImage?.asImageBitmap() else it.wallpaper,
				blurredWallpaper = if (blurredChanged) nextBlurred?.asImageBitmap() else it.blurredWallpaper,
			)
		}
	}

	// ── Foreground lifecycle ──

	/**
	 * Starts foreground work: one full load, then a refresh of the visible tab every 15 s,
	 * the Tailscale reachability check, and network-change handling. All of it stops in
	 * [stop], and the next start performs one full reconciliation again.
	 */
	fun start() {
		stop()
		val scope = CoroutineScope(viewModelScope.coroutineContext + SupervisorJob(viewModelScope.coroutineContext.job))
		foreground = scope
		val networkChanges = Channel<Unit>(Channel.CONFLATED)
		registerNetworkCallback(networkChanges)
		scope.launch {
			load()
			while (true) {
				delay(15_000)
				refreshVisibleData(visibleScope)
			}
		}
		// Re-check on every start and whenever the known Tailscale address changes.
		scope.launch {
			_state.map { it.device.tailscaleAddress }.distinctUntilChanged().collectLatest { refreshTailscaleAvailability() }
		}
		scope.launch {
			for (change in networkChanges) {
				// Backup may now be waiting for Wi-Fi, or no longer.
				refreshBackupPresentation()
				refreshAfterNetworkPathChange()
			}
		}
		// Revoked photo access pauses backup; returned access resumes it with a pass.
		reconcileLibraryAccess()
	}

	fun stop() {
		foreground?.cancel()
		foreground = null
		networkCallback?.let { appContext.getSystemService(ConnectivityManager::class.java)?.unregisterNetworkCallback(it) }
		networkCallback = null
	}

	/** Opening a tab refreshes it right away; freshness checks make this free when it is current. */
	fun showTab(scope: RefreshScope) {
		visibleScope = scope
		foreground?.launch { refreshVisibleData(scope) }
	}

	/** Profile is a sheet, so it refreshes what it shows when it opens rather than on a tab change. */
	fun profileOpened() {
		foreground?.launch {
			val profile = async { refreshVisibleData(RefreshScope.PROFILE, force = true) }
			refreshTailscaleAvailability()
			profile.await()
		}
	}

	/**
	 * The default-network callback is an event source, not a reachability oracle: a new
	 * default network (Wi-Fi, mobile data, or a VPN such as Tailscale) or losing it means
	 * the last endpoint winner may be stale. The current network at registration is the
	 * starting point and is not an event.
	 */
	private fun registerNetworkCallback(changes: Channel<Unit>) {
		val manager = appContext.getSystemService(ConnectivityManager::class.java) ?: return
		var current: Network? = manager.activeNetwork
		val callback = object : ConnectivityManager.NetworkCallback() {
			override fun onAvailable(network: Network) {
				if (network == current) return
				current = network
				changes.trySend(Unit)
			}

			override fun onLost(network: Network) {
				if (network != current) return
				current = null
				changes.trySend(Unit)
			}
		}
		manager.registerDefaultNetworkCallback(callback)
		networkCallback = callback
	}

	/**
	 * Keeps the last confirmed result on screen while the resolver silently re-establishes
	 * reachability and the active route.
	 */
	private suspend fun refreshAfterNetworkPathChange() {
		val state = _state.value
		if (state.session == null) return
		Umbreld.invalidateResolvedHost(state.device.nativeTarget)
		recentlyReachableBrowserAddresses.clear()
		coroutineScope {
			val tailscale = async { refreshTailscaleAvailability() }
			// A load or timer refresh may still be finishing on the old path. Wait for it
			// rather than overlapping requests, then run one connection-only refresh.
			while (remoteRefreshInProgress) delay(100)
			refreshVisibleData(RefreshScope.CONNECTION, force = true)
			tailscale.await()
		}
	}

	fun refreshSavedDevice(device: SavedDevice) {
		val current = _state.value.device
		if (current.id != device.id || current == device) return
		_state.update { it.copy(device = device) }
	}

	// ── Loading ──

	private class Fetched(
		val user: Umbreld.UserInfo?,
		val apps: List<Umbreld.AppSummary>?,
		val disk: Umbreld.DiskUsage?,
		val favorites: List<String>?,
		val addresses: List<String>?,
		val updates: List<Umbreld.AppUpdate>?,
	) {
		val receivedResponse: Boolean
			get() = user != null || apps != null || disk != null || favorites != null || addresses != null || updates != null
	}

	/**
	 * Fetches the planned resources together, so even a sleeping or offline Umbrel costs one
	 * timeout window rather than several in sequence.
	 */
	private suspend fun fetch(target: Umbreld.Target, session: Umbreld.Session, plan: RefreshPlan, addresses: Boolean): Fetched = coroutineScope {
		val user = async { if (plan.identity) attempt { Umbreld.user(target, session) } else null }
		val apps = async { if (plan.apps) attempt { Umbreld.apps(target, session) } else null }
		val disk = async { if (plan.disk) attempt { Umbreld.diskUsage(target, session) } else null }
		val favorites = async { if (plan.favorites) attempt { Umbreld.favorites(target, session) } else null }
		val ipAddresses = async { if (addresses) attempt { Umbreld.ipAddresses(target, session) } else null }
		val updates = async { if (plan.updates) attempt { Umbreld.appUpdates(target, session) } else null }
		Fetched(user.await(), apps.await(), disk.await(), favorites.await(), ipAddresses.await(), updates.await())
	}

	/** The full reconciliation on every start. Offline is not sign-out; only a definitive 401 is. */
	suspend fun load() {
		if (remoteRefreshInProgress) return
		remoteRefreshInProgress = true
		try {
			refreshBackupPresentation()
			val device = _state.value.device
			if (!readStoredSession(device.id)) return
			var session = _state.value.session ?: return
			try {
				session = Umbreld.renewSession(device.nativeTarget, session)
				if (_state.value.session != session) _state.update { it.copy(session = session) }
			} catch (cancelled: CancellationException) {
				throw cancelled
			} catch (error: Exception) {
				if ((error as? Umbreld.Error)?.isAuthError == true) {
					sessionInvalidated(device.id)
					return
				}
			}
			val plan = RefreshPlan(identity = true, apps = true, disk = true, favorites = true, updates = session.accountId == "0")
			val fetched = fetch(device.nativeTarget, session, plan, addresses = true)
			fetched.user?.let { applyUserInfo(it, device.nativeTarget, device.id) }
			val snapshotChanged = applyDeviceData(fetched.apps, fetched.disk, fetched.favorites, fetched.updates?.map { it.id })
			fetched.addresses?.let(::saveAvailableAddresses)
			if (!_state.value.didLoad) _state.update { it.copy(didLoad = true) }
			currentCoroutineContext().ensureActive()
			val now = SystemClock.elapsedRealtime()
			refreshTimes = RefreshPlan.Times(now, now, now, now, now)
			if (fetched.receivedResponse) {
				confirmConnectionState(ConnectionState.CONNECTED)
				resolvedHost(device.nativeTarget)?.let { host ->
					confirmConnectionRoute(host)
					rememberReachableBrowserAddress(host, now)
				}
			} else {
				confirmNoResponse(device.nativeTarget)
			}
			// Only data that arrived replaces the snapshot, so a flaky refresh can't wipe it.
			if (snapshotChanged) saveDeviceData()
			readStoredSession(device.id)
			// A resource can reach Umbrel while its response is lost; record exact receipts.
			_state.value.session?.let { backup.reconcileServerReceipts(device, it) }
		} finally {
			remoteRefreshInProgress = false
			completedActivationRefresh = true
		}
	}

	/** Refreshes only data the visible screen shows, skipping anything still fresh unless forced. */
	suspend fun refreshVisibleData(scope: RefreshScope, force: Boolean = false) {
		if (!completedActivationRefresh || remoteRefreshInProgress) return
		val state = _state.value
		val session = state.session ?: return
		val target = state.device.nativeTarget
		val now = SystemClock.elapsedRealtime()
		val plan = RefreshPlan.make(scope, force, state.canManageApps, now, refreshTimes)
		if (plan.isEmpty) return
		remoteRefreshInProgress = true
		try {
			val fetched = fetch(target, session, plan, addresses = false)
			currentCoroutineContext().ensureActive()
			refreshTimes = refreshTimes.copy(
				identity = if (plan.identity) now else refreshTimes.identity,
				apps = if (plan.apps) now else refreshTimes.apps,
				disk = if (plan.disk) now else refreshTimes.disk,
				favorites = if (plan.favorites) now else refreshTimes.favorites,
				updates = if (plan.updates) now else refreshTimes.updates,
			)
			fetched.user?.let { applyUserInfo(it, target, state.device.id) }
			if (applyDeviceData(fetched.apps, fetched.disk, fetched.favorites, fetched.updates?.map { it.id })) saveDeviceData()
			if (fetched.receivedResponse) {
				confirmConnectionState(ConnectionState.CONNECTED)
				resolvedHost(target)?.let { host ->
					confirmConnectionRoute(host)
					rememberReachableBrowserAddress(host)
				}
			} else if (plan.identity) {
				confirmNoResponse(target)
			}
			if (scope == RefreshScope.HOME || scope == RefreshScope.LIBRARY) backup.reconcileServerReceipts(state.device, session)
			readStoredSession(state.device.id)
		} finally {
			remoteRefreshInProgress = false
		}
	}

	/**
	 * Requests rotate native access credentials, so the stored session is mirrored back after
	 * each load. Only a definitive missing credential signs out; a transient secret-store
	 * failure keeps the in-memory session and retries later. Returns false once signed out.
	 */
	private suspend fun readStoredSession(deviceId: String): Boolean {
		when (val stored = withContext(Dispatchers.IO) { SecretStore.readSession(deviceId) }) {
			is SecretStore.SessionReadResult.Found -> if (_state.value.session != stored.session) _state.update { it.copy(session = stored.session) }
			SecretStore.SessionReadResult.Missing, SecretStore.SessionReadResult.Invalid -> {
				sessionInvalidated(deviceId)
				return false
			}
			is SecretStore.SessionReadResult.Unavailable -> Unit
		}
		return true
	}

	private suspend fun resolvedHost(target: Umbreld.Target): String? = attempt { Umbreld.resolvedHost(target) }

	/**
	 * Nothing answered at all. "Your Umbrel is off" and "its identity changed" otherwise look
	 * identical, and each needs something different from the user.
	 */
	private suspend fun confirmNoResponse(target: Umbreld.Target) {
		val changed = Umbreld.identityChanged(target)
		_state.update { it.copy(identityChanged = changed) }
		confirmConnectionState(ConnectionState.UNAVAILABLE)
	}

	private fun confirmConnectionState(connection: ConnectionState) {
		store.connections.record(_state.value.device.id, connection)
		// Backup setup that couldn't reach the Umbrel starts once the app reaches it.
		if (connection == ConnectionState.CONNECTED) _state.value.session?.let { backup.resumeWaitingSetup(_state.value.device, it) }
		_state.update {
			it.copy(
				connectionState = connection,
				identityChanged = it.identityChanged && connection != ConnectionState.CONNECTED,
				connectionRoute = if (connection == ConnectionState.CONNECTED) it.connectionRoute else null,
				// A failed refresh has exhausted every verified host, the Tailscale address
				// included, so Remote access can't claim Tailscale works while Home says Offline.
				tailscaleAvailableOnThisPhone = if (connection == ConnectionState.UNAVAILABLE) false else it.tailscaleAvailableOnThisPhone,
			)
		}
	}

	private fun confirmConnectionRoute(host: String) {
		val route = if (SavedDevice.isTailscaleAddress(host)) ConnectionRoute.TAILSCALE else ConnectionRoute.LOCAL
		_state.update {
			it.copy(
				connectionRoute = route,
				// An authenticated request over Tailscale is stronger evidence than a probe.
				tailscaleAvailableOnThisPhone = if (route == ConnectionRoute.TAILSCALE) true else it.tailscaleAvailableOnThisPhone,
			)
		}
	}

	private suspend fun applyUserInfo(info: Umbreld.UserInfo, target: Umbreld.Target, deviceId: String) {
		if (info.userId != _state.value.session?.accountId) return
		val state = _state.value
		val identityChanged = state.userName != info.name || state.wallpaperId != info.wallpaper.id ||
			state.brandColorHsl != info.wallpaper.brandColorHsl || state.accountRole != info.role
		if (identityChanged) {
			_state.update {
				it.copy(userName = info.name, wallpaperId = info.wallpaper.id, brandColorHsl = info.wallpaper.brandColorHsl, accountRole = info.role)
			}
		}
		if (renderedWallpaperId != info.wallpaper.id || shownWallpaper == null || shownBlurredWallpaper == null) {
			startWallpaperLoad(info.wallpaper.id, target)
		}
		if (!identityChanged) return
		// Persist identity changes so the device list and the next launch match.
		persist {
			store.update(deviceId) { it.saveAccountProfile(info.userId, info.name, info.wallpaper.id, info.wallpaper.brandColorHsl, info.role) }
		}
	}

	/**
	 * Loads the wallpaper alongside the rest of the data rather than ahead of it. The first
	 * decode and blur of a wallpaper run on the CPU, and the apps and files shouldn't wait
	 * behind them.
	 */
	private fun startWallpaperLoad(id: String, target: Umbreld.Target) {
		if (wallpaperLoad?.isActive == true && wallpaperLoadId == id) return
		wallpaperLoad?.cancel()
		wallpaperLoadId = id
		wallpaperLoad = viewModelScope.launch { loadWallpaperImages(id, target) }
	}

	/**
	 * The wallpaper and its blurred companion come from the same image, so the frosted cards
	 * align with the sharp backdrop. Both are cached on disk, so this only downloads the
	 * first time a wallpaper is seen.
	 */
	private suspend fun loadWallpaperImages(id: String, target: Umbreld.Target) {
		val image = wallpapers.load(id, target) ?: return
		val blurred = wallpapers.blurred(id)
		if (_state.value.wallpaperId != id) return
		renderedWallpaperId = id
		showWallpaper(image, blurred)
	}

	/** Applies one server response, touching state only for values that changed. */
	private fun applyDeviceData(apps: List<Umbreld.AppSummary>?, disk: Umbreld.DiskUsage?, favorites: List<String>?, updateIds: List<String>?): Boolean {
		val state = _state.value
		var next = state
		// Default credentials are fetched again on every launch, so they never stay in memory.
		apps?.map { it.withoutCredentials }?.takeIf { it != state.apps }?.let { next = next.copy(apps = it) }
		disk?.takeIf { it != state.disk }?.let { next = next.copy(disk = it) }
		favorites?.take(4)?.takeIf { it != state.favoritePaths }?.let { next = next.copy(favoritePaths = it) }
		updateIds?.toSet()?.takeIf { it != state.updatableApps }?.let { next = next.copy(updatableApps = it) }
		if (next == state) return false
		_state.value = next
		return true
	}

	private suspend fun saveDeviceData() {
		val state = _state.value
		val accountId = state.session?.accountId ?: return
		val snapshot = DeviceDataSnapshot(state.apps, state.disk, state.favoritePaths, state.updatableApps.toList())
		withContext(Dispatchers.IO) { deviceData.save(snapshot, state.device.id, accountId) }
	}

	private fun saveAvailableAddresses(addresses: List<String>) {
		val device = _state.value.device
		val updated = device.replaceAvailableAddresses(addresses)
		if (updated == device) return
		_state.update { it.copy(device = updated) }
		persist { store.update(device.id) { it.replaceAvailableAddresses(addresses) } }
	}

	/** DeviceStore reports a failed write to RootView, which shows the storage alert. */
	private inline fun persist(change: () -> Unit): Boolean = try {
		change()
		true
	} catch (error: Config.StorageException) {
		false
	}

	/** A revoked session stops backup but keeps the preference, so signing in again resumes it. */
	private fun sessionInvalidated(deviceId: String) {
		backup.disableLocally(deviceId)
		val state = _state.value
		if (state.device.id == deviceId) {
			val accountId = state.session?.accountId
			container.applicationScope.launch { runCatching { BrowserSessions.signOut(state.device.nativeTarget, accountId) } }
		}
		SecretStore.deleteSession(deviceId)
		_state.update { it.copy(session = null) }
	}

	/** Local sign-out never waits on a reachable Umbrel. */
	fun signOut(onDone: () -> Unit) {
		val state = _state.value
		val device = state.device
		val session = state.session
		// The backup preference survives sign-out so a deliberate sign-in resumes it.
		backup.disableLocally(device.id)
		SecretStore.deleteSession(device.id)
		_state.update { it.copy(session = null) }
		onDone()
		// This screen closes on sign-out, so the best-effort revocations outlive it.
		container.applicationScope.launch { runCatching { BrowserSessions.signOut(device.nativeTarget, session?.accountId) } }
		if (session != null) {
			container.applicationScope.launch { runCatching { Umbreld.logout(device.nativeTarget, session) } }
		}
	}

	// ── Tailscale ──

	/** The Tailscale address the Umbrel currently reports. */
	fun tailscaleAvailabilityHost(): String? = _state.value.device.tailscaleAddress

	/**
	 * Android does not reveal whether another app's VPN is signed in or switched on. A short
	 * identity probe to the Umbrel's known Tailscale address is the only claim made: whether
	 * this phone can reach that endpoint right now.
	 */
	suspend fun refreshTailscaleAvailability() {
		val deviceId = _state.value.device.id
		val host = tailscaleAvailabilityHost()
		if (host == null) {
			_state.update { it.copy(tailscaleAvailableOnThisPhone = false) }
			return
		}
		if (_state.value.tailscaleAvailabilityCheckInProgress) return
		_state.update { it.copy(tailscaleAvailabilityCheckInProgress = true) }
		try {
			val available = Umbreld.isKnownEndpointAvailable(host, deviceId)
			if (_state.value.device.id != deviceId || tailscaleAvailabilityHost() != host) return
			_state.update { it.copy(tailscaleAvailableOnThisPhone = available) }
		} finally {
			_state.update { it.copy(tailscaleAvailabilityCheckInProgress = false) }
		}
	}

	fun presentTailscaleSetup() = _state.update { it.copy(tailscaleSetupPresented = true) }

	fun dismissTailscaleSetup() = _state.update { it.copy(tailscaleSetupPresented = false) }

	// ── Browser hand-off ──

	/**
	 * The dashboard at the first reachable address, for the phone's browser: a name people
	 * can read, over HTTPS wherever the browser opens it without a warning.
	 */
	suspend fun dashboardUrlForOpening(path: String = "", query: List<Pair<String, String>> = emptyList()): String? {
		val endpoint = browserEndpointForOpening(allowsTailscaleDNS = true) ?: return null
		return BrowserRouting.dashboardUrl(endpoint.host, browserUsesHttps(endpoint), path, query)
	}

	/**
	 * Umbrel's local certificate covers its hostnames and interface addresses, not a
	 * user-controlled tailnet name, so HTTPS-required apps skip the MagicDNS name.
	 * requiresHttps is about the browser's secure-context rules, so it wins everywhere,
	 * Tailscale included.
	 */
	suspend fun appUrlForOpening(app: Umbreld.AppSummary): String? {
		val requiresHttps = app.requiresHttps == true
		val endpoint = browserEndpointForOpening(allowsTailscaleDNS = !requiresHttps) ?: return null
		val https = requiresHttps || browserUsesHttps(endpoint)
		return BrowserRouting.appUrl(app, endpoint.host, if (https) "https" else "http")
	}

	private suspend fun browserUsesHttps(endpoint: BrowserEndpoint): Boolean {
		val deviceId = _state.value.device.id
		return BrowserRouting.usesHttps(endpoint) { host ->
			Umbreld.isBrowserEndpoint(host, deviceId, BrowserRouting.probeTimeoutMillis(endpoint), secure = true)
		}
	}

	private suspend fun browserEndpointForOpening(allowsTailscaleDNS: Boolean): BrowserEndpoint? {
		val state = _state.value
		val hostname = if (allowsTailscaleDNS) tailscaleBrowserHostname() else null
		val candidates = BrowserRouting.candidates(hostname, BrowserRouting.addressOptions(state.device))
		val deviceId = state.device.id
		return BrowserRouting.firstReachable(
			candidates,
			recentlyReached = ::recentlyReachedBrowserAddress,
			probe = { host, timeout -> Umbreld.isBrowserEndpoint(host, deviceId, timeout) },
			remember = { rememberReachableBrowserAddress(it) },
		)
	}

	/**
	 * Tailscale's validated short browser name. Older umbrelOS releases lack this endpoint;
	 * their saved literal addresses continue through the same fallback.
	 */
	private suspend fun tailscaleBrowserHostname(): String? {
		val state = _state.value
		val session = state.session ?: return null
		return attempt { Umbreld.tailscaleBrowserHostname(state.device.nativeTarget, session) }
	}

	private fun recentlyReachedBrowserAddress(address: String): Boolean {
		val reached = recentlyReachableBrowserAddresses[address] ?: return false
		return SystemClock.elapsedRealtime() - reached <= BROWSER_REACHABILITY_LIFETIME_MS
	}

	private fun rememberReachableBrowserAddress(address: String, at: Long = SystemClock.elapsedRealtime()) {
		recentlyReachableBrowserAddresses[address] = at
	}

	// ── In-app browser ──
	//
	// Inside the app nobody sees or types an address, so the browser goes wherever the native
	// connection already is: an endpoint that has just proved the Umbrel's pinned HTTPS
	// identity. Every page is therefore a secure context with no certificate warning, and
	// apps that need HTTPS simply work.

	val browserHosts: List<String> get() = BrowserRouting.addressOptions(_state.value.device)

	suspend fun browserUrl(path: String = "", query: List<Pair<String, String>> = emptyList()): Uri? {
		val host = browserHostForOpening() ?: return null
		return BrowserRouting.dashboardUrl(BrowserContext.bracketed(host), https = true, path, query)?.let(Uri::parse)
	}

	suspend fun browserUrl(app: Umbreld.AppSummary): Uri? {
		val host = browserHostForOpening() ?: return null
		return BrowserRouting.appUrl(app, BrowserContext.bracketed(host), "https")?.let(Uri::parse)
	}

	/** umbrelOS and its apps use the same connection as the rest of the app. */
	private suspend fun browserHostForOpening(): String? = attempt { Umbreld.resolvedHost(_state.value.device.nativeTarget) }

	/**
	 * Opens umbrelOS at [path], in the app. With [reportUnavailable], repeated taps are ignored
	 * while one open is resolving and a failure says the Umbrel can't be reached (or isn't
	 * recognized); without it a failure is silent, as on Home's empty-state store button.
	 */
	fun openDashboard(path: String = "", query: List<Pair<String, String>> = emptyList(), reportUnavailable: Boolean = true) {
		if (reportUnavailable) {
			if (_state.value.openingBrowser) return
			_state.update { it.copy(openingBrowser = true) }
		}
		viewModelScope.launch {
			try {
				if (!browser.openUmbrel(path, query) && reportUnavailable) showLaunchAlert(AppLaunchAlert.Unavailable(_state.value.identityChanged))
			} finally {
				if (reportUnavailable) _state.update { it.copy(openingBrowser = false) }
			}
		}
	}

	// ── App launch ──

	/**
	 * Cached tiles deliberately omit default credentials. The live app is resolved on every
	 * tap so lifecycle, credential, and HTTPS decisions use Umbrel's current response.
	 */
	suspend fun appForLaunch(appId: String): Umbreld.AppSummary? {
		val state = _state.value
		val session = state.session ?: return null
		val apps = attempt { Umbreld.apps(state.device.nativeTarget, session) } ?: return null
		val current = _state.value
		if (current.device.id != state.device.id || current.session?.accountId != session.accountId) return null
		val changed = applyDeviceData(apps, null, null, null)
		refreshTimes = refreshTimes.copy(apps = SystemClock.elapsedRealtime())
		if (changed) saveDeviceData()
		confirmConnectionState(ConnectionState.CONNECTED)
		return apps.firstOrNull { it.id == appId && it.name != null }
	}

	/** A tile tap: apps in transition ignore taps, and one tap at a time prepares per app. */
	fun launchApp(app: Umbreld.AppSummary, source: Any? = null) {
		if (AppLaunchDisposition.from(app.state) == AppLaunchDisposition.BUSY || app.id in _state.value.preparingAppIds) return
		_state.update { it.copy(preparingAppIds = it.preparingAppIds + app.id) }
		viewModelScope.launch {
			try {
				prepareLaunch(app.id, source)
			} finally {
				_state.update { it.copy(preparingAppIds = it.preparingAppIds - app.id) }
			}
		}
	}

	private suspend fun prepareLaunch(appId: String, source: Any?) {
		val app = appForLaunch(appId) ?: return showLaunchAlert(AppLaunchAlert.Unavailable(_state.value.identityChanged))
		when (AppLaunchDisposition.from(app.state)) {
			AppLaunchDisposition.AVAILABLE -> Unit
			AppLaunchDisposition.PAUSED -> return showLaunchAlert(AppLaunchAlert.Blocked(app, paused = true))
			AppLaunchDisposition.OFFLINE -> return showLaunchAlert(AppLaunchAlert.Blocked(app, paused = false))
			AppLaunchDisposition.BUSY -> return
		}
		if (app.torOnly == true) return showLaunchAlert(AppLaunchAlert.TorOnly(app))
		if (app.credentials?.showBeforeOpen == true) {
			_state.update { it.copy(appLaunchSheet = AppLaunchSheet.Credentials(app, source)) }
		} else {
			openApp(app, source)
		}
	}

	/**
	 * Continues past the credentials sheet. "Don't show this again" is saved on the Umbrel
	 * through apps.hideCredentialsBeforeOpen, so the choice follows the user across clients.
	 */
	fun continueFromCredentials(dontShowAgain: Boolean) {
		val sheet = _state.value.appLaunchSheet as? AppLaunchSheet.Credentials ?: return
		val state = _state.value
		val session = state.session
		if (dontShowAgain && session != null) {
			viewModelScope.launch { attempt { Umbreld.hideCredentialsBeforeOpen(state.device.nativeTarget, session, sheet.app.id) } }
		}
		_state.update { it.copy(appLaunchSheet = null) }
		openApp(sheet.app, sheet.source)
	}

	fun dismissAppLaunchSheet() = _state.update { it.copy(appLaunchSheet = null) }

	fun dismissAppLaunchAlert() = _state.update { it.copy(appLaunchAlert = null) }

	private fun openApp(app: Umbreld.AppSummary, source: Any?) {
		viewModelScope.launch {
			if (!browser.open(app, source)) showLaunchAlert(AppLaunchAlert.Unavailable(_state.value.identityChanged))
		}
	}

	private fun showLaunchAlert(alert: AppLaunchAlert) = _state.update { it.copy(appLaunchAlert = alert) }

	// ── Photo backup ──

	/** Re-reads backup state on IO; the newest request wins. */
	private fun refreshBackupPresentation() {
		presentationJob?.cancel()
		presentationJob = viewModelScope.launch {
			val state = _state.value
			val session = state.session
			val access = backup.libraryAccess()
			if (session == null) {
				_state.update { it.copy(photoLibraryAccess = access, backupPreference = PhotoBackupPreference(), backupStatus = PhotoBackupStatus.Off, backupNotice = null) }
				return@launch
			}
			val device = state.device
			val counts = state.libraryCounts
			val presentation = withContext(Dispatchers.IO) {
				backup.presentation(device, session.accountId, counts, openLedger())
			}
			val other = backup.otherTarget(device.id, session.accountId)?.let { target ->
				backupDestinationName(target, store.device(target.deviceId), store.device(device.id) ?: device, session.accountId)
			}
			val manager = backup.state.value
			_state.update {
				it.copy(
					photoLibraryAccess = access,
					backupPreference = backup.preference(device.id, session.accountId),
					backupStatus = presentation.status,
					backupNotice = presentation.notice,
					backupSetupInProgress = manager.setupInProgress,
					backupStatistics = presentation.statistics,
					backupSourceId = presentation.sourceId,
					backupSourceName = backupSourceName(presentation.sourceName, presentation.sourceId) { PhotoBackupSourceName.current(appContext) },
					backupSourceResolved = presentation.sourceResolved,
					backupNewSourceQuestion = presentation.newSourceQuestion,
					backupReceiptRevision = manager.revision,
					otherBackupDeviceName = other,
				)
			}
		}
	}

	/** Foreground reconciliation: revoked access pauses backup, and returned access resumes it. */
	private fun reconcileLibraryAccess() {
		val session = _state.value.session ?: return
		backup.libraryAccessChanged(_state.value.device, session, userInitiated = false)
		refreshBackupPresentation()
	}

	/** After the photo permission prompt. A denial turns the toggles back off only when it answered turning them on. */
	fun onPermissionsChanged(turningBackupOn: Boolean) {
		val session = _state.value.session
		if (session != null) backup.libraryAccessChanged(_state.value.device, session, userInitiated = true, deniedTurnsOff = turningBackupOn)
		refreshBackupPresentation()
	}

	/**
	 * Saves the toggles as durable intent right away. Without photo access the screen asks
	 * for it and reports back through [onPermissionsChanged].
	 */
	fun setBackupPreference(preference: PhotoBackupPreference) {
		val session = _state.value.session ?: return
		val device = _state.value.device
		backup.setPreference(device, session, preference)
		_state.update { it.copy(backupPreference = backup.preference(device.id, session.accountId)) }
		refreshBackupPresentation()
	}

	/** The library card's "Set up backup": photos and videos on. */
	fun enableBackup() {
		val session = _state.value.session ?: return
		val device = _state.value.device
		backup.enableBackup(device, session)
		_state.update { it.copy(backupPreference = backup.preference(device.id, session.accountId)) }
		refreshBackupPresentation()
	}

	/**
	 * "Back Up to This Umbrel", once confirmed. [asNewSource] answers the new-phone question,
	 * which the switch asks before anything stops. [canRequestAccess] says Android still shows
	 * its photo access request, which then comes next. One switch at a time.
	 */
	fun backUpToThisUmbrel(asNewSource: Boolean, canRequestAccess: Boolean) {
		val state = _state.value
		val session = state.session ?: return
		val destination = state.otherBackupDeviceName ?: return
		if (switchJob?.isActive == true) return
		val device = state.device
		_state.update { it.copy(backupSwitchChecking = true, backupSwitchPrompt = null) }
		switchJob = viewModelScope.launch {
			try {
				val prompt = when (val outcome = backup.switchHere(device, session, asNewSource, canRequestAccess)) {
					PhotoBackupManager.SwitchOutcome.Done -> BackupSwitchPrompt.AccessRequest.takeIf {
						backup.preference(device.id, session.accountId).isEnabled && !backup.libraryAccess().canReadLibrary
					}
					is PhotoBackupManager.SwitchOutcome.AskNewSource -> BackupSwitchPrompt.NewSource(destination, outcome.existing, canRequestAccess)
					PhotoBackupManager.SwitchOutcome.CouldNotCheck -> BackupSwitchPrompt.CouldNotCheck(destination)
				}
				_state.update { it.copy(backupSwitchPrompt = prompt) }
			} finally {
				// The switch's setup state is read here too, so the button doesn't show idle until
				// the refresh below lands.
				_state.update {
					it.copy(
						backupSwitchChecking = false,
						backupSetupInProgress = backup.state.value.setupInProgress,
						backupPreference = backup.preference(device.id, session.accountId),
					)
				}
				refreshBackupPresentation()
			}
		}
	}

	fun dismissBackupSwitchPrompt() = _state.update { it.copy(backupSwitchPrompt = null) }

	/** The new-phone question's "Back Up Anyway". */
	fun backUpAsNewSource() {
		val session = _state.value.session ?: return
		val device = _state.value.device
		viewModelScope.launch {
			backup.backUpAsNewSource(device, session)
			refreshBackupPresentation()
		}
	}

	/** The new-phone question's "Turn Off Backup". */
	fun turnOffBackup() {
		val session = _state.value.session ?: return
		val device = _state.value.device
		backup.turnOffBackup(device, session)
		_state.update { it.copy(backupPreference = backup.preference(device.id, session.accountId)) }
		refreshBackupPresentation()
	}

	/** "Start Backup", or leaving the folder choice that comes with turning backup on. */
	fun confirmFolderChoice() {
		val session = _state.value.session ?: return
		val device = _state.value.device
		backup.confirmFolderChoice(device, session)
		_state.update { it.copy(backupPreference = backup.preference(device.id, session.accountId)) }
		refreshBackupPresentation()
	}

	/** A folder's switch, on the Folders page or as a photo's "Skip This Folder". */
	fun setFolderSkipped(folder: String, skipped: Boolean) {
		val preference = _state.value.backupPreference
		val folders = if (skipped) preference.skippedFolders + folder else preference.skippedFolders - folder
		setBackupPreference(preference.copy(skippedFolders = folders))
	}

	fun retryBackupAfterStorage() = backup.retryAfterInsufficientStorage()

	/** Try Again or Reconnect, whichever the notice offered. */
	fun retryBackupAfterError() {
		val session = _state.value.session ?: return
		backup.retryAfterError(_state.value.device, session)
	}

	fun clearError() = _state.update { it.copy(error = null) }

	// ── Local library ──

	/** The photo library's contents changed; backup's remaining count is measured against them. */
	fun libraryChanged(counts: PhotoLibraryCounts) {
		if (_state.value.libraryCounts == counts) return
		_state.update { it.copy(libraryCounts = counts) }
		refreshBackupPresentation()
	}

	@Synchronized
	private fun openLedger(): PhotoBackupLedger? = ledger ?: try {
		backup.openLedger().also { ledger = it }
	} catch (error: Exception) {
		null
	}

	/** Whether the item's current revision has a completed upload receipt. Reads the ledger. */
	fun isBackedUp(item: LocalMediaItem): Boolean {
		val sourceId = _state.value.backupSourceId ?: return false
		return try {
			openLedger()?.assetRecord(sourceId, item.localIdentifier)?.state == PhotoBackupLedger.AssetState.UPLOADED
		} catch (error: Exception) {
			false
		}
	}

	override fun onCleared() {
		browser.destroy()
		ledger?.close()
		ledger = null
	}

	companion object {
		/**
		 * Removing is stronger than signing out: the saved connection, credentials and backup
		 * intent are cleared. As on iOS, a failed config write stops before anything else
		 * changes, and the server session is revoked before the pinned CA is forgotten,
		 * because the request needs it. Returns false when the config couldn't be written;
		 * DeviceStore shows the storage alert. With [addsDevice], adding an Umbrel opens once
		 * it's removed.
		 */
		suspend fun removeSavedDevice(context: Context, deviceId: String, addsDevice: Boolean = false): Boolean {
			val container = context.container
			val store = container.deviceStore
			// Already removed: an earlier request got there first.
			val device = store.device(deviceId) ?: return true
			val session = withContext(Dispatchers.IO) { SecretStore.readSession(deviceId).sessionOrCached }
			return store.removals.remove(device, container.applicationScope, addsDevice, object : SavedDeviceRemovalSteps {
				override fun removeSaved() = store.remove(deviceId)

				override fun removeBackup() = container.backup.removeDevice(deviceId)

				// Best effort: the device is removed whether or not the Umbrel answers.
				override suspend fun signOutBrowser() {
					runCatching { BrowserSessions.signOut(device.nativeTarget, session?.accountId) }
				}

				override suspend fun logOut() {
					if (session != null) runCatching { Umbreld.logout(device.nativeTarget, session) }
				}

				override suspend fun deleteSession() = withContext(Dispatchers.IO) { SecretStore.deleteSession(deviceId) }

				override suspend fun forgetCertificate() = withContext(Dispatchers.IO) { Umbreld.forgetLocalHttpsIdentity(deviceId) }

				override suspend fun deleteData() = withContext(Dispatchers.IO) { container.deviceData.delete(deviceId) }

				override fun deselect() {
					store.connections.forget(deviceId)
					store.select("")
				}
			})
		}
	}
}

// Browser address evidence older than this is probed again.
private const val BROWSER_REACHABILITY_LIFETIME_MS = 2 * 60_000L

/** The result of a request whose failure only means "no new data"; cancellation still propagates. */
private inline fun <T> attempt(block: () -> T): T? = try {
	block()
} catch (cancelled: CancellationException) {
	throw cancelled
} catch (error: Exception) {
	null
}
