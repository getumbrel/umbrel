package com.umbrel.android.main

import com.umbrel.kit.Umbreld
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class DeviceDataStoreTest {
	@get:Rule
	val folder = TemporaryFolder()

	private val snapshot = DeviceDataSnapshot(
		apps = listOf(
			Umbreld.AppSummary(
				id = "nextcloud",
				name = "Nextcloud",
				icon = "https://getumbrel.github.io/umbrel-apps-gallery/nextcloud/icon.svg",
				state = "ready",
				port = 8085,
				credentials = Umbreld.AppCredentials(defaultUsername = "umbrel", defaultPassword = "secret", showBeforeOpen = true),
			),
			Umbreld.AppSummary(id = "broken"),
		),
		disk = Umbreld.DiskUsage(size = 2e12, totalUsed = 5e11, system = 1e10, files = 2e11, apps = listOf(Umbreld.DiskUsageApp("nextcloud", 3e9))),
		favoritePaths = listOf("/Home/Downloads", "/Home/Documents"),
		updatableApps = listOf("nextcloud"),
	)

	@Test
	fun roundTripsTheSnapshotWithoutCredentials() {
		val store = DeviceDataStore(folder.root)
		store.save(snapshot, "device", "0")
		val loaded = store.load("device", "0")
		assertEquals(snapshot.copy(apps = snapshot.apps.map { it.withoutCredentials }), loaded)
		assertNull(loaded!!.apps.first().credentials)
		val written = folder.root.walkTopDown().filter { it.isFile }.single().readText()
		assertFalse(written.contains("secret"))
	}

	@Test
	fun snapshotsAreIsolatedByDeviceAndAccount() {
		val store = DeviceDataStore(folder.root)
		store.save(snapshot, "device", "0")
		assertNull(store.load("device", "1"))
		assertNull(store.load("other", "0"))
	}

	@Test
	fun deletingADeviceRemovesEveryAccountSnapshot() {
		val store = DeviceDataStore(folder.root)
		store.save(snapshot, "device", "0")
		store.save(snapshot, "device", "1")
		store.save(snapshot, "other", "0")
		store.delete("device")
		assertNull(store.load("device", "0"))
		assertNull(store.load("device", "1"))
		assertEquals(snapshot.copy(apps = snapshot.apps.map { it.withoutCredentials }), store.load("other", "0"))
	}

	@Test
	fun remoteIdsNeverBecomePathSegments() {
		val store = DeviceDataStore(folder.root)
		store.save(snapshot, "../../escape", "a/b")
		val files = folder.root.walkTopDown().filter { it.isFile }.toList()
		assertEquals(1, files.size)
		assertTrue(files.single().canonicalPath.startsWith(folder.root.canonicalPath))
		assertTrue(files.single().name.matches(Regex("[0-9a-f]{64}\\.json")))
		assertEquals(snapshot.copy(apps = snapshot.apps.map { it.withoutCredentials }), store.load("../../escape", "a/b"))
	}

	@Test
	fun unreadableSnapshotsReadAsMissing() {
		val store = DeviceDataStore(folder.root)
		store.save(snapshot, "device", "0")
		folder.root.walkTopDown().filter { it.isFile }.single().writeText("{ not json")
		assertNull(store.load("device", "0"))
		assertNull(store.load("never-saved", "0"))
	}
}
