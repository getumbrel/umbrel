package com.umbrel.android.onboarding

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.umbrel.android.container
import com.umbrel.kit.Candidate
import com.umbrel.kit.Discovery
import com.umbrel.kit.IdentifiedDevice
import com.umbrel.kit.Umbreld
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

enum class OnboardingMode { FIRST_RUN, ADD_DEVICE }

// Declared in flow order, which sets the direction of each step transition, as on iOS.
enum class OnboardingStep { SPLASH, WELCOME, FINDING, NO_DEVICE, DEVICE_FOUND, MANUAL_ADDRESS, SIGN_IN, CONNECTED }

data class OnboardingState(
	val step: OnboardingStep,
	val movingForward: Boolean = true,
	val devices: List<IdentifiedDevice> = emptyList(),
	// Current Umbrels at a fallback hostname that couldn't prove their identity
	val unverified: List<Umbreld.UnverifiedDevice> = emptyList(),
	val updateRequired: List<Umbreld.UpdateRequiredDevice> = emptyList(),
	// Hosts whose "Couldn't connect" card is asking again
	val retryingHosts: Set<String> = emptySet(),
	val selectedDevice: IdentifiedDevice? = null,
	val connectedDeviceId: String? = null,
	val savedIds: Set<String> = emptySet(),
) {
	val hasResults: Boolean get() = devices.isNotEmpty() || unverified.isNotEmpty() || updateRequired.isNotEmpty()
}

/**
 * Where a step that sits over the results goes back to, as the results stand now: the results
 * once something was found, "No device found" once the last result went.
 */
internal fun resultsDestination(origin: OnboardingStep, hasResults: Boolean): OnboardingStep = when {
	origin == OnboardingStep.NO_DEVICE && hasResults -> OnboardingStep.DEVICE_FOUND
	origin == OnboardingStep.DEVICE_FOUND && !hasResults -> OnboardingStep.NO_DEVICE
	else -> origin
}

/**
 * The onboarding step machine. Android has no local-network permission at this target
 * level, so Welcome leads straight to the radar; the finding screen keeps a minimum dwell
 * of 2.4 s and gives up after 12 s, unless an Umbrel that answered is still being verified.
 */
class OnboardingViewModel(context: Context, mode: OnboardingMode) : ViewModel() {
	private val container = context.container
	// Each owner browses with its own Discovery, as on iOS; the saved-device monitor never
	// runs while onboarding is open.
	private val discovery = Discovery(context)
	private val _state = MutableStateFlow(
		OnboardingState(
			step = if (mode == OnboardingMode.FIRST_RUN) OnboardingStep.SPLASH else OnboardingStep.FINDING,
			savedIds = container.deviceStore.devices.value.map { it.id }.toSet(),
		),
	)
	val state: StateFlow<OnboardingState> = _state

	// Steps that sit on top of the results keep their cards, so Back returns to them
	private val results = ScanResults(_state.value.savedIds) {
		_state.value.step in setOf(OnboardingStep.DEVICE_FOUND, OnboardingStep.MANUAL_ADDRESS, OnboardingStep.SIGN_IN)
	}

	private var identification: Job? = null
	private var fallback: Job? = null
	private var findingTimer: Job? = null
	private var advanceAfterDwell: Job? = null
	private var findingStartedAt = 0L
	private var gracePeriodElapsed = false
	private var discoveryStarted = false
	private val manualAddress = ManualAddress { address -> Umbreld.discoverManually(address, _state.value.savedIds) }

	init {
		results.onChange = ::resultsChanged
		if (mode == OnboardingMode.FIRST_RUN) {
			viewModelScope.launch {
				delay(1_300)
				advance(OnboardingStep.WELCOME)
			}
		} else {
			advance(OnboardingStep.FINDING)
		}
	}

	fun advance(step: OnboardingStep) {
		_state.update { it.copy(step = step, movingForward = step.ordinal > it.step.ordinal) }
		if (step == OnboardingStep.FINDING) {
			findingStartedAt = System.currentTimeMillis()
			gracePeriodElapsed = false
			startDiscoveryIfNeeded()
			findingTimer?.cancel()
			findingTimer = viewModelScope.launch {
				// Give discovery a grace period before showing "no device"
				delay(FINDING_GRACE_PERIOD_MS)
				gracePeriodElapsed = true
				showNoDeviceIfNothingFound()
				delay(MAX_VERIFICATION_WAIT_MS - FINDING_GRACE_PERIOD_MS)
				showNoDeviceIfNothingFound(waitingForVerification = false)
			}
		}
	}

	private fun startDiscoveryIfNeeded() {
		if (discoveryStarted) return
		discoveryStarted = true
		discovery.onUpdate = ::handleCandidates
		discovery.start()
		startFallbackDiscovery()
	}

	/**
	 * mDNS remains the primary path. This bounded fallback checks default hostnames
	 * concurrently, so a current Umbrel that mDNS misses still appears (or says why it
	 * couldn't connect) and an older one shows an update hint.
	 */
	private fun startFallbackDiscovery() {
		fallback?.cancel()
		val knownDeviceIds = _state.value.savedIds
		results.fallbackStarted()
		fallback = viewModelScope.launch {
			val found = Umbreld.discoverFallbackHosts(knownDeviceIds) { updateRequired ->
				if (isActive) results.fallbackUpdateHints(updateRequired)
			}
			if (isActive) results.fallbackFinished(found)
		}
	}

	// A browse update can arrive first with a hostname and again with resolved IPs. Cancel the
	// superseded batch so a slower, stale probe cannot overwrite newer results.
	private fun handleCandidates(candidates: List<Candidate>) {
		identification?.cancel()
		if (candidates.isEmpty()) {
			// mDNS can lose a device and find it again within moments. An empty snapshot waits
			// like any other, so the blip doesn't bounce the results through "No device found".
			identification = viewModelScope.launch {
				delay(250)
				results.identifying(candidates)
			}
			return
		}
		results.identifying(candidates)
		identification = viewModelScope.launch {
			delay(250)
			val identified = Umbreld.identify(candidates, _state.value.savedIds)
			if (isActive) results.identified(identified)
		}
	}

	/** Try again on a "Couldn't connect" card. */
	fun retry(device: Umbreld.UnverifiedDevice) {
		viewModelScope.launch { results.retry(device) }
	}

	private fun resultsChanged() {
		_state.update {
			it.copy(
				devices = results.devices,
				unverified = results.unverified,
				updateRequired = results.updateRequired,
				retryingHosts = results.retryingHosts,
			)
		}
		val step = _state.value.step
		when {
			// Discovery keeps running on "No device found": an Umbrel that finishes verifying
			// late, or that starts answering, moves on to the results.
			step == OnboardingStep.NO_DEVICE && !results.isEmpty -> advance(resultsDestination(step, hasResults = true))
			// The last result can go while it's shown, as when Try again finds a saved Umbrel's
			// identity changed.
			step == OnboardingStep.DEVICE_FOUND && results.isEmpty -> advance(resultsDestination(step, hasResults = false))
			step == OnboardingStep.FINDING && !results.isEmpty -> advanceToResultsAfterDwell()
			step == OnboardingStep.FINDING -> showNoDeviceIfNothingFound()
		}
	}

	// Move to the results once the minimum dwell has played out, immediately if discovery
	// took longer than the dwell.
	private fun advanceToResultsAfterDwell() {
		advanceAfterDwell?.cancel()
		advanceAfterDwell = viewModelScope.launch {
			val elapsed = System.currentTimeMillis() - findingStartedAt
			if (elapsed < MIN_DWELL_MS) delay(MIN_DWELL_MS - elapsed)
			// mDNS can flap; if the device vanished during the dwell, stay on the radar.
			if (_state.value.step == OnboardingStep.FINDING && !results.isEmpty) advance(OnboardingStep.DEVICE_FOUND)
		}
	}

	private fun showNoDeviceIfNothingFound(waitingForVerification: Boolean = true) {
		if (!gracePeriodElapsed || _state.value.step != OnboardingStep.FINDING || !results.isEmpty) return
		if (waitingForVerification && results.isVerifyingCandidates) return
		advance(OnboardingStep.NO_DEVICE)
	}

	fun scanAgain() {
		identification?.cancel()
		fallback?.cancel()
		results.clear()
		discovery.stop()
		discoveryStarted = false
		advance(OnboardingStep.FINDING)
	}

	fun selectDevice(device: IdentifiedDevice) {
		_state.update { it.copy(selectedDevice = device, step = OnboardingStep.SIGN_IN) }
	}

	fun openManualAddress() {
		manualAddress.open(from = _state.value.step)
		advance(OnboardingStep.MANUAL_ADDRESS)
	}

	/** Checks an address typed on Connect by address. Leaving the screen cancels the check. */
	suspend fun discoverManually(address: String): Umbreld.ManualDiscoveryResult = manualAddress.check(address)

	// The on-screen and the system Back both leave through here, so either one cancels the check
	fun closeManualAddress() {
		_state.value = manualAddress.close(_state.value)
	}

	/** An address the user typed stays out of the scan results; sign-in opens over it. */
	fun manualDeviceFound(device: IdentifiedDevice) {
		_state.update { it.copy(selectedDevice = device) }
	}

	fun dismissSignIn() {
		_state.update { current ->
			if (current.step == OnboardingStep.MANUAL_ADDRESS) current.copy(selectedDevice = null)
			else current.copy(selectedDevice = null, step = OnboardingStep.DEVICE_FOUND, movingForward = false)
		}
	}

	fun signedIn(deviceId: String) {
		_state.update { it.copy(connectedDeviceId = deviceId, step = OnboardingStep.CONNECTED) }
	}

	fun finish(): String? {
		discovery.onUpdate = null
		discovery.stop()
		return _state.value.connectedDeviceId
	}

	override fun onCleared() {
		discovery.onUpdate = null
		discovery.stop()
	}

	private companion object {
		// One full sweep of the radar, so an instant discovery doesn't flash past
		const val MIN_DWELL_MS = 2_400L
		const val FINDING_GRACE_PERIOD_MS = 12_000L

		// The fallback scan finishes within its time limit; past that, this only guards against
		// a browse that keeps restarting verification
		val MAX_VERIFICATION_WAIT_MS = maxOf(FINDING_GRACE_PERIOD_MS, Umbreld.FALLBACK_DISCOVERY_TIME_LIMIT_MS) + 2_000
	}
}
