package com.umbrel.android

import android.content.Context
import coil3.ImageLoader
import coil3.disk.DiskCache
import coil3.disk.directory
import coil3.memory.MemoryCache
import coil3.network.okhttp.OkHttpNetworkFetcherFactory
import coil3.svg.SvgDecoder
import com.umbrel.android.main.DeviceDataStore
import com.umbrel.android.main.IconResponseLimit
import com.umbrel.android.main.WallpaperStore
import com.umbrel.kit.backup.PhotoBackupManager
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import okhttp3.OkHttpClient
import java.util.concurrent.TimeUnit

/**
 * Manual dependency container held by the Application. The app has a handful of screens,
 * so the documented manual-DI pattern is used instead of Hilt.
 */
class AppContainer(context: Context) {
	val appContext: Context = context.applicationContext
	val deviceStore = DeviceStore(appContext)
	val backup = PhotoBackupManager(appContext).apply { setDeviceLookup(deviceStore::device) }
	val wallpapers = WallpaperStore(appContext)
	val deviceData = DeviceDataStore(appContext.cacheDir.resolve("device-data-v2"))

	/** For work that must finish after the screen that started it closes, like revoking a session. */
	val applicationScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

	/**
	 * Image loader for public app-store icons (external HTTPS SVG or raster images with
	 * system trust, size-limited by [IconResponseLimit]) and local photo thumbnails.
	 * Umbrel-hosted wallpapers go through UmbrelKit's pinned transport into
	 * [WallpaperStore], never through this client.
	 */
	val imageLoader: ImageLoader by lazy {
		val client = OkHttpClient.Builder()
			.followRedirects(false)
			.addInterceptor(IconResponseLimit)
			.connectTimeout(10, TimeUnit.SECONDS)
			.readTimeout(20, TimeUnit.SECONDS)
			.build()
		ImageLoader.Builder(appContext)
			.components {
				add(OkHttpNetworkFetcherFactory(callFactory = { client }))
				add(SvgDecoder.Factory())
				add(coil3.video.VideoFrameDecoder.Factory())
			}
			.memoryCache { MemoryCache.Builder().maxSizePercent(appContext, 0.2).build() }
			.diskCache { DiskCache.Builder().directory(appContext.cacheDir.resolve("images")).maxSizeBytes(64L * 1024 * 1024).build() }
			.build()
	}
}

val Context.container: AppContainer
	get() = (applicationContext as UmbrelApplication).container
