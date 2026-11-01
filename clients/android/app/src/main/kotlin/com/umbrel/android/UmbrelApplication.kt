package com.umbrel.android

import android.annotation.SuppressLint
import android.app.Application
import android.util.Log
import androidx.work.Configuration
import androidx.work.Logger
import com.umbrel.android.browser.BrowserSessions
import com.umbrel.kit.NativeClientInfo
import com.umbrel.kit.SecretStore
import com.umbrel.kit.backup.PhotoBackupScheduler

class UmbrelApplication : Application(), Configuration.Provider {
	lateinit var container: AppContainer
		private set

	// Logger is internal to WorkManager, but it's the only way to get the configured level in.
	@SuppressLint("RestrictedApi")
	override fun onCreate() {
		super.onCreate()
		// WorkManager logs while it sets itself up, before it reads the configuration below, and
		// keeps the first logger it creates, so its debug logging would stay on. Set first, the
		// configured level applies.
		Logger.setLogger(Logger.LogcatLogger(WORK_MANAGER_LOG_LEVEL))
		SecretStore.initialize(this)
		NativeClientInfo.initialize(this)
		BrowserSessions.initialize(this)
		container = AppContainer(this)
		PhotoBackupScheduler.catchUp(this)
	}

	// WorkManager is initialized on demand (the manifest removes the default initializer)
	// so the worker can be resolved without a DI framework.
	override val workManagerConfiguration: Configuration
		get() = Configuration.Builder().setMinimumLoggingLevel(WORK_MANAGER_LOG_LEVEL).build()

	private companion object {
		const val WORK_MANAGER_LOG_LEVEL = Log.INFO
	}
}
