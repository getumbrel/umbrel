package com.umbrel.kit

import kotlinx.serialization.Serializable

@Serializable
data class SavedAccountProfile(
	val name: String,
	val wallpaperId: String,
	val wallpaperBrandColorHsl: String? = null,
	val role: String,
)

/**
 * Persisted shape of a saved device. Native grants live in [SecretStore], never here.
 * Field names match the Apple config.json so the model stays one contract across clients.
 */
@Serializable
data class SavedDevice(
	val id: String,
	val name: String,
	val host: String,
	val addresses: List<String> = emptyList(),
	val model: String? = null,
	val userName: String? = null,
	// Cached wallpaper ID for rendering the device card while offline.
	val wallpaperId: String? = null,
	// Identity and wallpaper belong to an account, not to the physical Umbrel. The
	// top-level fields cache the last-used presentation for device lists.
	val accountProfiles: Map<String, SavedAccountProfile>? = null,
	// Non-secret picker preference. It changes only after a successful login.
	val lastAccountId: String? = null,
	// Browser preferences are presentation-only.
	val dashboardUsesHTTPS: Boolean? = null,
	val suppressHTTPSRequiredAppWarning: Boolean? = null,
) {
	fun accountProfile(accountId: String): SavedAccountProfile? = accountProfiles?.get(accountId)

	/**
	 * Every address must prove the stable discovery id through the device's pinned HTTPS
	 * CA before use. It remains one Umbrel account with multiple possible routes.
	 */
	val connectionHosts: List<String>
		get() = uniqueAddresses(listOf(host) + addresses)

	val nativeTarget: Umbreld.Target
		get() = Umbreld.Target(id, connectionHosts)

	/**
	 * The Umbrel's address in Tailscale's CGNAT range, if it has one. Prefer the Umbrel's
	 * reported addresses over the canonical host retained from pairing.
	 */
	val tailscaleAddress: String?
		get() = addresses.firstOrNull(::isTailscaleAddress) ?: host.takeIf(::isTailscaleAddress)

	/**
	 * Only an [IdentifiedDevice] has proved the stable discovery id through the saved
	 * Umbrel's HTTPS identity. Its answering endpoint becomes primary, stale mDNS names are
	 * discarded, and current IP candidates remain as fallbacks.
	 */
	fun mergeVerifiedDiscovery(discovered: IdentifiedDevice): SavedDevice {
		if (discovered.id != id) return this
		return copy(
			host = discovered.host,
			addresses = uniqueAddresses(addresses.filterNot(::isBonjourHostname) + discovered.addresses),
			name = discovered.name,
			model = discovered.model,
		)
	}

	/** Keep a discovered route as a candidate without erasing other known routes. */
	fun rememberConnectionCandidates(candidates: List<String>): SavedDevice =
		copy(addresses = uniqueAddresses(addresses + candidates))

	/** Once authenticated, the Umbrel itself is the authority on its current addresses. */
	fun replaceAvailableAddresses(current: List<String>): SavedDevice =
		copy(addresses = uniqueAddresses(current))

	fun saveAccountProfile(
		accountId: String,
		name: String,
		wallpaperId: String,
		wallpaperBrandColorHsl: String? = null,
		role: String,
	): SavedDevice {
		val profiles = (accountProfiles ?: emptyMap()) +
			(accountId to SavedAccountProfile(name, wallpaperId, wallpaperBrandColorHsl, role))
		return copy(
			accountProfiles = profiles,
			lastAccountId = accountId,
			// Device cards deliberately show the last-used account while signed out.
			userName = name,
			wallpaperId = wallpaperId,
		)
	}

	/** Includes the user's name when available, for example "Patrick’s Umbrel Home". */
	val displayName: String
		get() = userName?.let { "$it’s ${model ?: name}" } ?: (model ?: name)

	companion object {
		fun isTailscaleAddress(address: String): Boolean {
			val octets = ipv4Octets(address) ?: return false
			return octets[0] == 100 && octets[1] in 64..127
		}

		fun isIPv4Address(address: String): Boolean = ipv4Octets(address) != null

		/**
		 * Manual connections intentionally cover ordinary LANs, IPv4 link-local, and
		 * Tailscale. Other literal ranges are not reachable through the app's narrowly scoped
		 * plaintext bootstrap policy and fail validation immediately.
		 */
		internal fun isSupportedManualIPv4Address(address: String): Boolean {
			val octets = ipv4Octets(address) ?: return false
			return when {
				octets[0] == 10 -> true
				octets[0] == 172 && octets[1] in 16..31 -> true
				octets[0] == 192 && octets[1] == 168 -> true
				octets[0] == 169 && octets[1] == 254 -> true
				octets[0] == 100 && octets[1] in 64..127 -> true
				else -> false
			}
		}

		private fun ipv4Octets(address: String): IntArray? {
			val parts = address.split('.')
			if (parts.size != 4) return null
			val octets = IntArray(4)
			for (index in 0 until 4) {
				val part = parts[index]
				if (part.isEmpty() || (part.length > 1 && part[0] == '0')) return null
				if (!part.all { it in '0'..'9' }) return null
				val value = part.toIntOrNull() ?: return null
				if (value > 255) return null
				octets[index] = value
			}
			return octets
		}

		fun isBonjourHostname(host: String): Boolean {
			if (!isDNSHostname(host)) return false
			val labels = host.split('.')
			return labels.size >= 2 && labels.last().equals("local", ignoreCase = true)
		}

		internal fun isDNSHostname(host: String): Boolean {
			if (host.isEmpty() || host.toByteArray(Charsets.UTF_8).size > 253) return false
			return host.split('.').all { label ->
				label.length in 1..63 &&
					isAsciiLetterOrDigit(label.first()) &&
					isAsciiLetterOrDigit(label.last()) &&
					label.all { isAsciiLetterOrDigit(it) || it == '-' }
			}
		}

		fun isValidLocalEndpointHost(host: String): Boolean = isIPv4Address(host) || isBonjourHostname(host)

		private fun isAsciiLetterOrDigit(c: Char): Boolean = c in '0'..'9' || c in 'A'..'Z' || c in 'a'..'z'

		private fun uniqueAddresses(values: List<String>): List<String> {
			val seen = HashSet<String>()
			return values.filter { it.isNotEmpty() && seen.add(it.lowercase()) }
		}
	}
}
