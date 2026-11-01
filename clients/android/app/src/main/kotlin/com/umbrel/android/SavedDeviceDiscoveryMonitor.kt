package com.umbrel.android

import android.content.Context
import com.umbrel.kit.Candidate
import com.umbrel.kit.Config
import com.umbrel.kit.Discovery
import com.umbrel.kit.IdentifiedDevice
import com.umbrel.kit.SavedDevice
import com.umbrel.kit.Umbreld
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.cancel
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * Keeps already-paired devices aligned with mDNS while the app is in the foreground, so a
 * new DHCP lease doesn't strand a saved Umbrel. TXT ids only select possible matches; the
 * saved CA and the HTTPS discovery response must still prove the device before any address
 * changes. Not thread-safe: start, stop and every callback run on the main thread.
 */
class SavedDeviceDiscoveryMonitor(context: Context, private val store: DeviceStore) {
	private val discovery = Discovery(context)
	private var scope: CoroutineScope? = null
	private var settle: Job? = null
	private var identification: Job? = null

	fun start() {
		if (scope != null) return
		val running = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
		scope = running
		discovery.onUpdate = { candidates -> scheduleIdentification(running, candidates) }
		discovery.start()
	}

	fun stop() {
		val running = scope ?: return
		scope = null
		running.cancel()
		settle = null
		identification = null
		discovery.onUpdate = null
		discovery.stop()
	}

	private fun scheduleIdentification(scope: CoroutineScope, candidates: List<Candidate>) {
		settle?.cancel()
		settle = scope.launch {
			// mDNS reports a service once it resolves and again as its addresses and TXT
			// record update. Let that short burst settle so saved devices are verified once.
			delay(250)
			identifySavedDevices(scope, candidates)
		}
	}

	private fun identifySavedDevices(scope: CoroutineScope, candidates: List<Candidate>) {
		identification?.cancel()
		val matches = savedDeviceCandidates(candidates, store.devices.value.mapTo(HashSet()) { it.id })
		if (matches.isEmpty()) return
		identification = scope.launch {
			for (route in verifiedSavedRoutes(matches) { candidate, deviceId -> Umbreld.identify(candidate, deviceId) }) {
				try {
					// The merge is applied to the stored device as it is now, and skipped
					// when it changes nothing.
					store.update(route.id) { it.mergeVerifiedDiscovery(route) }
				} catch (error: Config.StorageException) {
					// DeviceStore reports it, and the storage alert shows.
					return@launch
				}
			}
		}
	}
}

/** Candidates whose TXT id names a saved device, paired with that id. */
internal fun savedDeviceCandidates(candidates: List<Candidate>, savedIds: Set<String>): List<Pair<Candidate, String>> =
	candidates.mapNotNull { candidate -> candidate.id?.takeIf { it in savedIds }?.let { candidate to it } }

/**
 * Verifies every match concurrently against its saved pin and keeps one route per device:
 * an mDNS hostname before a literal address, then the lowest host, so the choice doesn't
 * depend on which probe finished first.
 */
internal suspend fun verifiedSavedRoutes(
	matches: List<Pair<Candidate, String>>,
	identify: suspend (Candidate, String) -> IdentifiedDevice?,
): List<IdentifiedDevice> = coroutineScope {
	val identified = matches.map { (candidate, deviceId) -> async { identify(candidate, deviceId) } }.awaitAll()
	val byId = LinkedHashMap<String, IdentifiedDevice>()
	identified
		.filterNotNull()
		.sortedWith(compareBy<IdentifiedDevice> { !SavedDevice.isBonjourHostname(it.host) }.thenBy { it.host.lowercase() })
		.forEach { byId.putIfAbsent(it.id, it) }
	byId.values.toList()
}
