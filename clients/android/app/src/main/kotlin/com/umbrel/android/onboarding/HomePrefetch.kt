package com.umbrel.android.onboarding

import com.umbrel.android.AppContainer
import com.umbrel.android.main.DeviceDataSnapshot
import com.umbrel.kit.Config
import com.umbrel.kit.SavedDevice
import com.umbrel.kit.Umbreld
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * Fetches everything Home renders (identity, wallpaper and a data snapshot) while the
 * Connected screen shows, so Home's first frame is complete even on a first connect.
 * Best effort: if Continue outruns it, Home's skeletons cover the gap and its own load fills
 * in. It runs in the application scope because the onboarding flow closes on Continue.
 */
internal fun prefetchHome(container: AppContainer, device: SavedDevice, session: Umbreld.Session) {
	container.applicationScope.launch {
		val target = device.nativeTarget
		val userInfo = async { runCatching { Umbreld.user(target, session) }.getOrNull() }
		val apps = async { runCatching { Umbreld.apps(target, session) }.getOrNull() }
		val disk = async { runCatching { Umbreld.diskUsage(target, session) }.getOrNull() }
		val favorites = async { runCatching { Umbreld.favorites(target, session) }.getOrNull() }
		val updates = async {
			if (session.accountId == "0") runCatching { Umbreld.appUpdates(target, session) }.getOrNull() else null
		}

		userInfo.await()?.let { info ->
			withContext(Dispatchers.Main) {
				try {
					container.deviceStore.update(device.id) {
						it.saveAccountProfile(session.accountId, info.name, info.wallpaper.id, info.wallpaper.brandColorHsl, info.role)
					}
				} catch (error: Config.StorageException) {
					// DeviceStore reports the issue.
				}
			}
			container.wallpapers.load(info.wallpaper.id, target)
		}
		// Only snapshot when the app list arrived; a half-failed prefetch shouldn't replace
		// Home's skeletons with empty content.
		val appList = apps.await() ?: return@launch
		val snapshot = DeviceDataSnapshot(
			apps = appList,
			disk = disk.await(),
			favoritePaths = favorites.await().orEmpty().take(4),
			updatableApps = updates.await()?.map { it.id }.orEmpty(),
		)
		withContext(Dispatchers.IO) { container.deviceData.save(snapshot, device.id, session.accountId) }
	}
}
