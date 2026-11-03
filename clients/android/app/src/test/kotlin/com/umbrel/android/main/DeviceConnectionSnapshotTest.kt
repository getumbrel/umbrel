package com.umbrel.android.main

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class DeviceConnectionSnapshotTest {
	private var now = 1_000_000L
	private val snapshots = DeviceConnectionSnapshots { now }

	@Test
	fun anUnknownDeviceIsUnverifiedAndNeverFresh() {
		assertEquals(DeviceConnectionSnapshot.UNVERIFIED, snapshots["device"])
		assertFalse(snapshots.isFresh("device"))
	}

	@Test
	fun aConnectionConfirmedBeforeOpeningHomeIsItsStartingState() {
		// Onboarding and sign-in record Connected; the main screen then starts from it.
		snapshots.record("device", ConnectionState.CONNECTED)
		assertEquals(ConnectionState.CONNECTED, snapshots["device"].state)
		assertEquals(now, snapshots["device"].checkedAt)
	}

	@Test
	fun aConfirmedResultStaysFreshForFifteenSeconds() {
		snapshots.record("device", ConnectionState.UNAVAILABLE)
		now += DeviceConnectionSnapshot.FRESHNESS_MS - 1
		assertTrue(snapshots.isFresh("device"))
		now += 1
		assertFalse(snapshots.isFresh("device"))
	}

	@Test
	fun theLatestCheckReplacesTheEarlierOne() {
		snapshots.record("device", ConnectionState.CONNECTED)
		now += 20_000
		snapshots.record("device", ConnectionState.UNAVAILABLE)
		assertEquals(DeviceConnectionSnapshot(ConnectionState.UNAVAILABLE, now), snapshots["device"])
		assertTrue(snapshots.isFresh("device"))
	}

	@Test
	fun forgettingADeviceReturnsItToUnverified() {
		snapshots.record("device", ConnectionState.CONNECTED)
		snapshots.record("other", ConnectionState.CONNECTED)
		snapshots.forget("device")
		assertEquals(DeviceConnectionSnapshot.UNVERIFIED, snapshots["device"])
		assertEquals(ConnectionState.CONNECTED, snapshots["other"].state)
	}

	@Test
	fun anUnverifiedSnapshotIsNeverFresh() {
		assertFalse(DeviceConnectionSnapshot(ConnectionState.UNVERIFIED, now).isFresh(now))
	}
}
