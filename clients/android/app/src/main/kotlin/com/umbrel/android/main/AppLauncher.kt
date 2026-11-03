package com.umbrel.android.main

import com.umbrel.kit.SavedDevice
import com.umbrel.kit.Umbreld
import java.net.URI
import java.net.URISyntaxException

/** One address a browser can open the Umbrel at, and what kind of route it is. */
data class BrowserEndpoint(val host: String, val kind: Kind) {
	enum class Kind { TAILSCALE_DNS, LOCAL_DNS, TAILSCALE_IP, LOCAL_IP }

	val isTailscale: Boolean get() = kind == Kind.TAILSCALE_DNS || kind == Kind.TAILSCALE_IP
	val isLiteralIP: Boolean get() = kind == Kind.TAILSCALE_IP || kind == Kind.LOCAL_IP
}

/**
 * How the app hands umbrelOS and its apps to the user's browser: which addresses to try,
 * in which order, and which scheme each one uses.
 */
object BrowserRouting {
	/** The saved host and every address the Umbrel reported, without duplicates. */
	fun addressOptions(device: SavedDevice): List<String> {
		val seen = HashSet<String>()
		return (listOf(device.host) + device.addresses).filter { it.isNotEmpty() && seen.add(it) }
	}

	fun localNames(options: List<String>): List<String> =
		options.filter { !SavedDevice.isIPv4Address(it) && !SavedDevice.isTailscaleAddress(it) }

	fun tailscaleIPs(options: List<String>): List<String> = options.filter(SavedDevice::isTailscaleAddress)

	fun localIPs(options: List<String>): List<String> =
		options.filter { SavedDevice.isIPv4Address(it) && !SavedDevice.isTailscaleAddress(it) }

	fun hasTailscaleAddress(device: SavedDevice): Boolean = tailscaleIPs(addressOptions(device)).isNotEmpty()

	/**
	 * Candidates in preference order. Stable names come first so a link keeps working
	 * across network changes; literal addresses are the fallback for networks without
	 * mDNS and tailnets with MagicDNS off, rather than racing and randomly winning.
	 */
	fun candidates(tailscaleHostname: String?, options: List<String>): List<BrowserEndpoint> {
		val tailscaleName = listOfNotNull(tailscaleHostname?.let { BrowserEndpoint(it, BrowserEndpoint.Kind.TAILSCALE_DNS) })
		val localNames = localNames(options).map { BrowserEndpoint(it, BrowserEndpoint.Kind.LOCAL_DNS) }
		val tailscaleIPs = tailscaleIPs(options).map { BrowserEndpoint(it, BrowserEndpoint.Kind.TAILSCALE_IP) }
		val localIPs = localIPs(options).map { BrowserEndpoint(it, BrowserEndpoint.Kind.LOCAL_IP) }
		return tailscaleName + localNames + tailscaleIPs + localIPs
	}

	/** Names get one second to answer, since a dead name should fall through quickly. */
	fun probeTimeoutMillis(endpoint: BrowserEndpoint): Long = when (endpoint.kind) {
		BrowserEndpoint.Kind.TAILSCALE_DNS, BrowserEndpoint.Kind.LOCAL_DNS -> 1_000
		BrowserEndpoint.Kind.TAILSCALE_IP, BrowserEndpoint.Kind.LOCAL_IP -> 3_000
	}

	/**
	 * The first candidate that answers as this Umbrel. A recent successful app request
	 * counts as an answer, except for the Tailscale name, which is probed on every open
	 * because Tailscale can be switched off before that evidence expires.
	 */
	suspend fun firstReachable(
		candidates: List<BrowserEndpoint>,
		recentlyReached: (String) -> Boolean,
		probe: suspend (host: String, timeoutMillis: Long) -> Boolean,
		remember: (String) -> Unit,
	): BrowserEndpoint? {
		val seen = HashSet<String>()
		for (endpoint in candidates) {
			if (!seen.add(endpoint.host.lowercase())) continue
			if (endpoint.kind != BrowserEndpoint.Kind.TAILSCALE_DNS && recentlyReached(endpoint.host)) return endpoint
			if (probe(endpoint.host, probeTimeoutMillis(endpoint))) {
				remember(endpoint.host)
				return endpoint
			}
		}
		return null
	}

	/**
	 * A local name uses HTTPS when the phone's browser trusts the Umbrel's certificate, as it
	 * does once the user installs it in Settings, so the browser opens it without a warning.
	 * A Tailscale name stays on HTTP: Tailscale already encrypts it, and the certificate
	 * doesn't cover it. A literal IP is the last-resort route and always uses Umbrel's
	 * IP-valid local certificate: browsers let the user continue past an
	 * untrusted-certificate warning, while an HTTPS-only mode can block a plain HTTP address
	 * with no way forward.
	 */
	suspend fun usesHttps(endpoint: BrowserEndpoint, browserTrustsUmbrel: suspend (host: String) -> Boolean): Boolean =
		when (endpoint.kind) {
			BrowserEndpoint.Kind.LOCAL_IP, BrowserEndpoint.Kind.TAILSCALE_IP -> true
			BrowserEndpoint.Kind.TAILSCALE_DNS -> false
			BrowserEndpoint.Kind.LOCAL_DNS -> browserTrustsUmbrel(endpoint.host)
		}

	/** Path and query characters a URL cannot carry literally are percent-encoded as UTF-8. */
	fun dashboardUrl(host: String, https: Boolean, path: String = "", query: List<Pair<String, String>> = emptyList()): String? =
		url(if (https) "https" else "http", host, -1, path, query)

	/** The app's web UI; null for error stubs and Tor-only apps. */
	fun appUrl(app: Umbreld.AppSummary, host: String, scheme: String): String? {
		val port = app.port ?: return null
		if (app.torOnly == true) return null
		val path = app.path?.takeIf { it.isNotEmpty() }?.let { if (it.startsWith("/")) it else "/$it" } ?: ""
		return url(scheme, host, port, path, emptyList())
	}

	private fun url(scheme: String, host: String, port: Int, path: String, query: List<Pair<String, String>>): String? {
		val queryString = query.takeIf { it.isNotEmpty() }?.joinToString("&") { (name, value) -> "$name=$value" }
		return try {
			URI(scheme, null, host, port, path, queryString, null).toASCIIString()
		} catch (error: URISyntaxException) {
			null
		}
	}
}
