package com.umbrel.kit.backup

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.flow.conflate

/**
 * Which networks backup may use. Without mobile data, a network must be Wi-Fi or Ethernet
 * and unmetered: Android marks phone hotspots, and any Wi-Fi the user set to metered, as
 * metered, and a carrier can mark mobile data unmetered, so neither check is enough alone.
 * A VPN such as Tailscale carries its underlying network's transports, and Tailscale takes
 * its meteredness from that network too, so Tailscale over home Wi-Fi qualifies. With
 * mobile data, any network does, except while roaming for automatic passes.
 */
object PhotoBackupNetwork {
	data class Traits(val wifiOrEthernet: Boolean, val unmetered: Boolean, val roaming: Boolean)

	/** Null [network] means there is no default network. */
	fun qualifies(network: Traits?, allowsMobileData: Boolean, userInitiated: Boolean): Boolean = when {
		network == null -> false
		!allowsMobileData -> network.wifiOrEthernet && network.unmetered
		else -> userInitiated || !network.roaming
	}

	fun traits(capabilities: NetworkCapabilities) = Traits(
		wifiOrEthernet = capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) || capabilities.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET),
		unmetered = capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED),
		roaming = !capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_ROAMING),
	)

	/** The app's default network now, the one uploads use. */
	fun current(context: Context): Traits? {
		val manager = context.getSystemService(ConnectivityManager::class.java) ?: return null
		return manager.getNetworkCapabilities(manager.activeNetwork)?.let(::traits)
	}

	/** The app's default network as it changes, starting with the current one. */
	fun defaultNetwork(context: Context): Flow<Traits?> = callbackFlow {
		val manager = context.getSystemService(ConnectivityManager::class.java)
		if (manager == null) {
			trySend(null)
			awaitClose()
			return@callbackFlow
		}
		val callback = object : ConnectivityManager.NetworkCallback() {
			override fun onCapabilitiesChanged(network: Network, capabilities: NetworkCapabilities) {
				trySend(traits(capabilities))
			}

			override fun onLost(network: Network) {
				trySend(null)
			}
		}
		// Starts with the current default network, null when there is none; registering
		// reports it again, and the callback reports every change after.
		trySend(current(context))
		manager.registerDefaultNetworkCallback(callback)
		awaitClose { manager.unregisterNetworkCallback(callback) }
	}.conflate()
}
