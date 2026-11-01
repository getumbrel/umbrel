package com.umbrel.android.onboarding

import com.umbrel.kit.Candidate
import com.umbrel.kit.IdentifiedDevice
import com.umbrel.kit.Umbreld
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.isActive

/**
 * What the onboarding scan has found: Umbrels found through mDNS or the fallback hostnames and
 * identified by system.discoveryInfo, current Umbrels at a fallback hostname that couldn't
 * prove their identity, and older ones that need an update. Raw candidates never cross into
 * the UI. Used from the main thread only; [onChange] runs after every change.
 */
internal class ScanResults(
	private val savedIds: Set<String>,
	// Whether a step that sits on top of the results is showing, so Back returns to its cards
	private val resultsAreShowing: () -> Boolean = { false },
) {
	var onChange: () -> Unit = {}

	var devices: List<IdentifiedDevice> = emptyList()
		private set

	// Current Umbrels at a fallback hostname that couldn't prove their identity
	var unverified: List<Umbreld.UnverifiedDevice> = emptyList()
		private set
	var updateRequired: List<Umbreld.UpdateRequiredDevice> = emptyList()
		private set

	// Hosts whose "Couldn't connect" card is asking again
	var retryingHosts: Set<String> = emptySet()
		private set

	val isEmpty: Boolean get() = devices.isEmpty() && unverified.isEmpty() && updateRequired.isEmpty()

	/**
	 * Whether an Umbrel that answered is still proving its identity. A slow Umbrel can take
	 * longer than the Finding screen's grace period.
	 */
	val isVerifyingCandidates: Boolean get() = pendingNativeHosts.isNotEmpty() || fallbackInProgress

	private var mdnsDevices: List<IdentifiedDevice> = emptyList()
	private var fallbackDevices: List<IdentifiedDevice> = emptyList()
	private var fallbackUnverified: List<Umbreld.UnverifiedDevice> = emptyList()
	private var fallbackUpdateRequired: List<Umbreld.UpdateRequiredDevice> = emptyList()
	private var pendingNativeHosts: Set<String> = emptySet()
	private var fallbackInProgress = false

	// Bumped by every rescan, so an answer from an earlier scan can't add a stale card
	private var generation = 0

	/**
	 * An mDNS snapshot whose candidates are now being identified. Below Android 16 a candidate's
	 * host is usually its IP address rather than its name, so its addresses count too.
	 */
	fun identifying(candidates: List<Candidate>) {
		pendingNativeHosts = candidates.flatMap { listOf(it.host) + it.addresses }.map(::normalizedDiscoveryHost).toSet()
		if (candidates.isEmpty()) mdnsDevices = emptyList()
		publish()
	}

	fun identified(devices: List<IdentifiedDevice>) {
		pendingNativeHosts = emptySet()
		mdnsDevices = devices
		publish()
	}

	fun fallbackStarted() {
		fallbackInProgress = true
		publish()
	}

	// Older Umbrels show as soon as their version answers
	fun fallbackUpdateHints(updateRequired: List<Umbreld.UpdateRequiredDevice>) {
		if (!fallbackInProgress) return
		fallbackUpdateRequired = updateRequired
		publish()
	}

	fun fallbackFinished(result: Umbreld.FallbackDiscoveryResult) {
		fallbackDevices = result.devices
		fallbackUnverified = result.unverified
		fallbackUpdateRequired = result.updateRequired
		fallbackInProgress = false
		publish()
	}

	/**
	 * Try again on a "Couldn't connect" card. A device that now proves its identity replaces
	 * the card; otherwise the card stays, with the latest reason. An answer that arrives after
	 * a rescan belongs to the old scan and is dropped.
	 */
	suspend fun retry(
		device: Umbreld.UnverifiedDevice,
		identify: suspend (Umbreld.UnverifiedDevice, Set<String>) -> Umbreld.HostIdentification = { unverified, knownIds ->
			Umbreld.identify(unverified, knownIds)
		},
	) {
		if (device.host in retryingHosts) return
		retryingHosts = retryingHosts + device.host
		onChange()
		val started = generation
		val identification = identify(device, savedIds)
		if (started != generation) return
		retryingHosts = retryingHosts - device.host
		if (!currentCoroutineContext().isActive) return
		fallbackUnverified = fallbackUnverified.filterNot { it.host == device.host }
		when (identification) {
			is Umbreld.HostIdentification.Device -> {
				val identified = identification.value
				fallbackDevices = fallbackDevices.filterNot { it.isSameUmbrel(identified) } + identified
			}
			is Umbreld.HostIdentification.Unverified -> fallbackUnverified = fallbackUnverified + identification.value
			// Left to the saved device's own handling; trying again can't fix it
			Umbreld.HostIdentification.SavedIdentityChanged -> Unit
		}
		publish()
	}

	/** Forgets everything for a rescan. */
	fun clear() {
		generation++
		retryingHosts = emptySet()
		mdnsDevices = emptyList()
		fallbackDevices = emptyList()
		fallbackUnverified = emptyList()
		fallbackUpdateRequired = emptyList()
		pendingNativeHosts = emptySet()
		fallbackInProgress = false
		devices = emptyList()
		unverified = emptyList()
		updateRequired = emptyList()
		onChange()
	}

	private fun publish() {
		// mDNS's record for an Umbrel both sources found carries its addresses. A record proven
		// under another CA is a different device, even with the same id.
		devices = (mdnsDevices + fallbackDevices.filter { fallback -> mdnsDevices.none { it.isSameUmbrel(fallback) } })
			.sortedBy { it.host }
		val verifiedLocations = devices.flatMap { listOf(it.host, it.discoveryHost) + it.addresses }
			.map(::normalizedDiscoveryHost)
			.toSet()
		// Once a host proves the current native identity, consume its fallback hints so a later
		// mDNS loss cannot mislabel the now-offline device. A hint's name that resolves to a
		// verified Umbrel's address is that Umbrel by another name, as an older Umbrel's is once
		// it's updated and mDNS finds it by its address.
		fallbackUnverified = fallbackUnverified.filterNot { device ->
			(listOf(device.host) + device.addresses).any { normalizedDiscoveryHost(it) in verifiedLocations }
		}
		fallbackUpdateRequired = fallbackUpdateRequired.filterNot { device ->
			(listOf(device.host) + device.addresses).any { normalizedDiscoveryHost(it) in verifiedLocations }
		}
		unverified = visibleHints(fallbackUnverified, unverified, host = { it.host }, locations = { listOf(it.host) + it.addresses })
		updateRequired = visibleHints(fallbackUpdateRequired, updateRequired, host = { it.host }, locations = { listOf(it.host) + it.addresses })
		onChange()
	}

	/**
	 * One card per host. Hide a newly found fallback card while its mDNS candidate is being
	 * verified, but keep an already-visible card until that verification succeeds.
	 */
	private fun <Hint> visibleHints(
		hints: List<Hint>,
		shown: List<Hint>,
		host: (Hint) -> String,
		// The names and addresses that place a hint at an mDNS candidate
		locations: (Hint) -> List<String>,
	): List<Hint> {
		val previouslyVisible = shown.map { normalizedDiscoveryHost(host(it)) }.toSet()
		val byHost = LinkedHashMap<String, Hint>()
		for (hint in hints) byHost.putIfAbsent(normalizedDiscoveryHost(host(hint)), hint)
		val showing = resultsAreShowing()
		return byHost
			.filter { (key, hint) ->
				locations(hint).none { normalizedDiscoveryHost(it) in pendingNativeHosts } || (showing && key in previouslyVisible)
			}
			.values
			.sortedBy(host)
	}
}

private fun normalizedDiscoveryHost(host: String): String = host.removeSuffix(".").lowercase()
