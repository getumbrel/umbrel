package com.umbrel.android.main

import android.os.SystemClock
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update

/** The last confirmed reachability of one Umbrel, with the monotonic time it was confirmed. */
data class DeviceConnectionSnapshot(val state: ConnectionState, val checkedAt: Long?) {
	fun isFresh(now: Long): Boolean = state != ConnectionState.UNVERIFIED && checkedAt != null && now - checkedAt < FRESHNESS_MS

	companion object {
		val UNVERIFIED = DeviceConnectionSnapshot(ConnectionState.UNVERIFIED, null)
		const val FRESHNESS_MS = 15_000L
	}
}

/**
 * Reachability is deliberately process-local. Sharing the last confirmed result between the
 * device list and Home stops navigation from restarting the same loading state, while a
 * possibly stale network claim never carries into a future launch.
 */
class DeviceConnectionSnapshots(private val clock: () -> Long = SystemClock::elapsedRealtime) {
	private val _snapshots = MutableStateFlow(emptyMap<String, DeviceConnectionSnapshot>())
	val snapshots: StateFlow<Map<String, DeviceConnectionSnapshot>> = _snapshots

	operator fun get(deviceId: String): DeviceConnectionSnapshot = _snapshots.value[deviceId] ?: DeviceConnectionSnapshot.UNVERIFIED

	fun isFresh(deviceId: String): Boolean = get(deviceId).isFresh(clock())

	fun record(deviceId: String, state: ConnectionState) {
		val snapshot = DeviceConnectionSnapshot(state, clock())
		_snapshots.update { it + (deviceId to snapshot) }
	}

	fun forget(deviceId: String) {
		_snapshots.update { it - deviceId }
	}
}
