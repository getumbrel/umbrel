package com.umbrel.kit

import java.security.KeyStore
import java.security.Provider
import java.security.Security
import java.util.Collections
import javax.net.ssl.ManagerFactoryParameters
import javax.net.ssl.TrustManager
import javax.net.ssl.TrustManagerFactory
import javax.net.ssl.TrustManagerFactorySpi

/**
 * Records the threads that initialize a default-algorithm TrustManagerFactory, by putting a
 * delegating provider ahead of the JDK's for the duration of [record].
 */
object TrustManagerThreads {
	private val threads: MutableList<String> = Collections.synchronizedList(mutableListOf())

	// Robolectric installs Conscrypt as the default provider for later tests in the same
	// JVM, so the delegate comes from whichever provider was the default before recording.
	@Volatile
	private var delegateProvider: Provider? = null

	@Suppress("DEPRECATION")
	private val provider = object : Provider("RecordingTrustManagerFactory", 1.0, "Records trust manager threads") {
		init {
			put("TrustManagerFactory.${TrustManagerFactory.getDefaultAlgorithm()}", Recording::class.java.name)
		}
	}

	suspend fun record(block: suspend () -> Unit): List<String> {
		threads.clear()
		delegateProvider = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm()).provider
		Security.insertProviderAt(provider, 1)
		try {
			block()
		} finally {
			Security.removeProvider(provider.name)
		}
		return threads.toList()
	}

	class Recording : TrustManagerFactorySpi() {
		private val delegate = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm(), delegateProvider)

		override fun engineInit(keyStore: KeyStore?) {
			threads += Thread.currentThread().name
			delegate.init(keyStore)
		}

		override fun engineInit(parameters: ManagerFactoryParameters?) {
			threads += Thread.currentThread().name
			delegate.init(parameters)
		}

		override fun engineGetTrustManagers(): Array<TrustManager> = delegate.trustManagers
	}
}
