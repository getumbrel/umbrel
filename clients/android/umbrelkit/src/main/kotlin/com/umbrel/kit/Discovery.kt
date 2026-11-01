package com.umbrel.kit

import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.net.wifi.WifiManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.ext.SdkExtensions
import androidx.core.content.ContextCompat
import java.net.Inet4Address
import java.util.concurrent.Executor

/** A host that might be an Umbrel, found via the _umbrel._tcp DNS-SD advertisement. */
data class Candidate(
	val host: String,
	val addresses: List<String> = emptyList(),
	val name: String,
	val id: String? = null,
	val model: String? = null,
	val onboarded: Boolean? = null,
)

/**
 * A discovery candidate whose local CA validated an HTTPS system.discoveryInfo response
 * with the same id. mDNS contributes only connection locations and a cosmetic name; it is
 * never an identity authority.
 */
data class IdentifiedDevice(
	val host: String,
	val discoveryHost: String,
	val addresses: List<String>,
	val name: String,
	val id: String,
	val model: String,
	val onboarded: Boolean,
	// Kept inside UmbrelKit so passive scans can hand the exact verified candidate anchor
	// to an explicit claim without exposing trust material to app UI code.
	internal val candidateCaCertificate: ByteArray? = null,
) {
	val discoveryInfo: Umbreld.DiscoveryInfo
		get() = Umbreld.DiscoveryInfo(id, model, onboarded)

	/**
	 * Whether two records are the same Umbrel: the same anchor proved the same id. An id alone
	 * is unauthenticated, as another LAN device can claim it under its own CA.
	 */
	fun isSameUmbrel(other: IdentifiedDevice): Boolean =
		id == other.id && candidateCaCertificate.contentEquals(other.candidateCaCertificate)

	// Compares the anchor by content, so a rescan that finds a new anchor for the same id
	// replaces the result an explicit claim will use.
	override fun equals(other: Any?): Boolean =
		other is IdentifiedDevice && other.host == host && other.discoveryHost == discoveryHost &&
			other.addresses == addresses && other.name == name && other.id == id && other.model == model &&
			other.onboarded == onboarded && other.candidateCaCertificate.contentEquals(candidateCaCertificate)

	override fun hashCode(): Int =
		31 * listOf(host, discoveryHost, addresses, name, id, model, onboarded).hashCode() + candidateCaCertificate.contentHashCode()
}

/**
 * Browses for _umbrel._tcp through the platform NSD service (NsdManager, DNS-SD over mDNS).
 * Only devices advertising this service are discoverable; results remain unverified
 * candidates until system.discoveryInfo establishes their identity.
 *
 * Android 14+ resolves through registerServiceInfoCallback, which keeps addresses and TXT
 * records current; older releases fall back to the deprecated one-shot resolveService, which
 * runs one resolve per app at a time and fails any other with FAILURE_ALREADY_ACTIVE, so
 * services are queued and resolved one after another. The mainline NSD service holds its
 * own Wi-Fi multicast lock on newer module versions; older devices need the app to hold one
 * to receive mDNS packets at all, so the lock is taken below a conservative cutoff (the exact
 * module version is not documented). Snapshots are published through [onUpdate] on the main
 * thread.
 */
class Discovery(context: Context) {
	private val appContext = context.applicationContext
	private val nsdManager = appContext.getSystemService(NsdManager::class.java)
	private val mainHandler = Handler(Looper.getMainLooper())
	private val mainExecutor: Executor = ContextCompat.getMainExecutor(appContext)
	private val lock = Any()
	private val entries = HashMap<String, Entry>()
	private var discoveryListener: NsdManager.DiscoveryListener? = null
	private var multicastLock: WifiManager.MulticastLock? = null
	private val pendingLegacyResolves = ArrayDeque<NsdServiceInfo>()
	private var legacyResolveInFlight = false

	/** Fired on the main thread with a fresh candidate snapshot after every change. */
	var onUpdate: ((List<Candidate>) -> Unit)? = null

	private class Entry(val serviceName: String) {
		var host: String? = null
		var addresses: List<String> = emptyList()
		var id: String? = null
		var model: String? = null
		var onboarded: Boolean? = null
		var callback: NsdManager.ServiceInfoCallback? = null
	}

	fun start() {
		synchronized(lock) {
			if (discoveryListener != null) return
			acquireMulticastLockIfNeeded()
			val listener = object : NsdManager.DiscoveryListener {
				override fun onStartDiscoveryFailed(serviceType: String, errorCode: Int) {
					synchronized(lock) { if (discoveryListener === this) discoveryListener = null }
				}

				override fun onStopDiscoveryFailed(serviceType: String, errorCode: Int) = Unit
				override fun onDiscoveryStarted(serviceType: String) = Unit
				override fun onDiscoveryStopped(serviceType: String) = Unit

				override fun onServiceFound(serviceInfo: NsdServiceInfo) {
					if (normalizeType(serviceInfo.serviceType) != SERVICE_TYPE) return
					serviceFound(serviceInfo)
				}

				override fun onServiceLost(serviceInfo: NsdServiceInfo) {
					serviceLost(serviceInfo.serviceName)
				}
			}
			discoveryListener = listener
			nsdManager.discoverServices(SERVICE_TYPE, NsdManager.PROTOCOL_DNS_SD, listener)
		}
	}

	fun stop() {
		synchronized(lock) {
			for (entry in entries.values) cancelResolution(entry)
			entries.clear()
			// A legacy resolve already handed to the system can't be cancelled; its callback
			// still clears legacyResolveInFlight.
			pendingLegacyResolves.clear()
			discoveryListener?.let { listener ->
				try {
					nsdManager.stopServiceDiscovery(listener)
				} catch (error: IllegalArgumentException) {
					// Discovery had already failed to start.
				}
			}
			discoveryListener = null
			multicastLock?.let { if (it.isHeld) it.release() }
			multicastLock = null
		}
		// Publish the cleared snapshot so a restarted browse starts from nothing.
		publish()
	}

	private fun acquireMulticastLockIfNeeded() {
		val needsLock = Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
			(Build.VERSION.SDK_INT == Build.VERSION_CODES.TIRAMISU &&
				SdkExtensions.getExtensionVersion(Build.VERSION_CODES.TIRAMISU) < 7)
		if (!needsLock) return
		val wifi = appContext.getSystemService(WifiManager::class.java) ?: return
		multicastLock = wifi.createMulticastLock("umbrel-discovery").apply {
			setReferenceCounted(false)
			acquire()
		}
	}

	private fun serviceFound(serviceInfo: NsdServiceInfo) {
		synchronized(lock) {
			val key = serviceInfo.serviceName
			if (entries.containsKey(key)) return
			val entry = Entry(key)
			entries[key] = entry
			if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
				val callback = object : NsdManager.ServiceInfoCallback {
					override fun onServiceInfoCallbackRegistrationFailed(errorCode: Int) = Unit

					override fun onServiceUpdated(serviceInfo: NsdServiceInfo) {
						resolved(key, serviceInfo)
					}

					override fun onServiceLost() {
						serviceLost(key)
					}

					override fun onServiceInfoCallbackUnregistered() = Unit
				}
				entry.callback = callback
				try {
					nsdManager.registerServiceInfoCallback(serviceInfo, mainExecutor, callback)
				} catch (error: IllegalArgumentException) {
					entries.remove(key)
				}
			} else {
				pendingLegacyResolves.addLast(serviceInfo)
				resolveNextLegacy()
			}
		}
	}

	/** Must be called holding [lock]. */
	private fun resolveNextLegacy() {
		if (legacyResolveInFlight) return
		val next = pendingLegacyResolves.removeFirstOrNull() ?: return
		legacyResolveInFlight = true
		@Suppress("DEPRECATION")
		nsdManager.resolveService(next, object : NsdManager.ResolveListener {
			override fun onResolveFailed(serviceInfo: NsdServiceInfo, errorCode: Int) {
				synchronized(lock) {
					legacyResolveInFlight = false
					// Drop the entry so the service resolves again if discovery reports it again.
					entries.remove(next.serviceName)
					resolveNextLegacy()
				}
			}

			override fun onServiceResolved(serviceInfo: NsdServiceInfo) {
				synchronized(lock) {
					legacyResolveInFlight = false
					resolveNextLegacy()
				}
				resolved(next.serviceName, serviceInfo)
			}
		})
	}

	private fun serviceLost(serviceName: String) {
		synchronized(lock) {
			val entry = entries.remove(serviceName) ?: return
			cancelResolution(entry)
		}
		publish()
	}

	private fun cancelResolution(entry: Entry) {
		if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
			entry.callback?.let {
				try {
					nsdManager.unregisterServiceInfoCallback(it)
				} catch (error: IllegalArgumentException) {
					// Registration had failed or was already released.
				}
			}
		}
		entry.callback = null
	}

	private fun resolved(serviceName: String, serviceInfo: NsdServiceInfo) {
		synchronized(lock) {
			val entry = entries[serviceName] ?: return
			val addresses: List<String> = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
				serviceInfo.hostAddresses.filterIsInstance<Inet4Address>().mapNotNull { it.hostAddress }
			} else {
				@Suppress("DEPRECATION")
				listOfNotNull((serviceInfo.host as? Inet4Address)?.hostAddress)
			}.distinct().sorted()
			// The advertised hostname is available from Android 16, or Android 13 with NSD
			// extension 17. It comes without ".local.", which the certificate's DNS names and
			// the system resolver both need. Elsewhere the app connects by address, which the
			// certificate covers through its IP SANs.
			val hostname = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.BAKLAVA ||
				SdkExtensions.getExtensionVersion(Build.VERSION_CODES.TIRAMISU) >= 17
			) {
				serviceInfo.hostname?.trimEnd('.')?.takeIf { it.isNotEmpty() }?.let { "$it.local" }
			} else {
				null
			}
			entry.host = hostname ?: addresses.firstOrNull()
			entry.addresses = addresses
			val attributes = serviceInfo.attributes
			entry.id = attributes["id"]?.let { String(it, Charsets.UTF_8) }?.takeIf { it.isNotEmpty() }
			entry.model = attributes["device"]?.let { String(it, Charsets.UTF_8) }?.takeIf { it.isNotEmpty() }
			entry.onboarded = attributes["onboarded"]?.let { String(it, Charsets.UTF_8) == "1" }
		}
		publish()
	}

	/** Builds the candidate list from resolved services, merged by host. */
	private fun publish() {
		val candidates: List<Candidate>
		synchronized(lock) {
			val byHost = HashMap<String, Candidate>()
			for (entry in entries.values) {
				val host = entry.host ?: continue // not resolved yet
				var candidate = Candidate(host, entry.addresses, entry.serviceName, entry.id, entry.model, entry.onboarded)
				byHost[host.lowercase()]?.let { existing ->
					candidate = candidate.copy(addresses = (existing.addresses + candidate.addresses).distinct().sorted())
				}
				byHost[host.lowercase()] = candidate
			}
			candidates = byHost.values.sortedBy { it.host }
		}
		mainHandler.post { onUpdate?.invoke(candidates) }
	}

	private fun normalizeType(type: String?): String = type.orEmpty().trim('.')

	companion object {
		const val SERVICE_TYPE = "_umbrel._tcp"
	}
}
