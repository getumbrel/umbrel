package com.umbrel.kit

import android.content.Context
import android.os.Build
import kotlinx.serialization.Serializable

/**
 * Client details reported with every native login and access refresh so app and OS
 * updates never leave stale details on the server's long-lived native session.
 */
@Serializable
data class NativeClientInfo(
	val id: String,
	val platform: String,
	val deviceClass: String,
	val appVersion: String,
	val appBuild: String,
	val osVersion: String,
) {
	companion object {
		@Volatile
		var current: NativeClientInfo = NativeClientInfo("umbrel", "android", "phone", "unknown", "unknown", "unknown")

		fun initialize(context: Context) {
			val info = context.packageManager.getPackageInfo(context.packageName, 0)
			val isTablet = context.resources.configuration.smallestScreenWidthDp >= 600
			current = NativeClientInfo(
				id = "umbrel",
				platform = "android",
				deviceClass = if (isTablet) "tablet" else "phone",
				appVersion = info.versionName ?: "unknown",
				appBuild = info.longVersionCode.toString(),
				osVersion = Build.VERSION.RELEASE ?: Build.VERSION.SDK_INT.toString(),
			)
		}
	}
}
