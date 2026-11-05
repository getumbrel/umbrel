package com.umbrel.kit

import android.security.keystore.KeyGenParameterSpec
import java.io.InputStream
import java.io.OutputStream
import java.security.Key
import java.security.KeyStoreSpi
import java.security.Provider
import java.security.SecureRandom
import java.security.Security
import java.security.cert.Certificate
import java.security.spec.AlgorithmParameterSpec
import java.util.Collections
import java.util.Date
import java.util.Enumeration
import java.util.concurrent.ConcurrentHashMap
import javax.crypto.KeyGeneratorSpi
import javax.crypto.SecretKey
import javax.crypto.spec.SecretKeySpec

/**
 * The JVM has no AndroidKeyStore provider, so SecretStore tests install this one. It keeps
 * AES keys in memory under the alias from their KeyGenParameterSpec, and the JDK's own
 * AES/GCM cipher uses them. Only the operations SecretStore performs are supported.
 */
object SoftwareKeyStore {
	private val keys = ConcurrentHashMap<String, Key>()

	private val provider = object : @Suppress("DEPRECATION") Provider("AndroidKeyStore", 1.0, "In-memory AndroidKeyStore for unit tests") {
		init {
			put("KeyStore.AndroidKeyStore", Store::class.java.name)
			put("KeyGenerator.AES", AesGenerator::class.java.name)
		}
	}

	@Synchronized
	fun install() {
		if (Security.getProvider(provider.name) == null) Security.addProvider(provider)
	}

	/** Forget every key, as a device restore or a cleared Keystore would. */
	fun clear() = keys.clear()

	class Store : KeyStoreSpi() {
		override fun engineGetKey(alias: String, password: CharArray?): Key? = keys[alias]
		override fun engineGetCertificateChain(alias: String): Array<Certificate>? = null
		override fun engineGetCertificate(alias: String): Certificate? = null
		override fun engineGetCreationDate(alias: String): Date? = null
		override fun engineSetKeyEntry(alias: String, key: Key, password: CharArray?, chain: Array<out Certificate>?) {
			keys[alias] = key
		}
		override fun engineSetKeyEntry(alias: String, key: ByteArray, chain: Array<out Certificate>?) = throw UnsupportedOperationException()
		override fun engineSetCertificateEntry(alias: String, cert: Certificate) = throw UnsupportedOperationException()
		override fun engineDeleteEntry(alias: String) {
			keys.remove(alias)
		}
		override fun engineAliases(): Enumeration<String> = Collections.enumeration(keys.keys)
		override fun engineContainsAlias(alias: String): Boolean = keys.containsKey(alias)
		override fun engineSize(): Int = keys.size
		override fun engineIsKeyEntry(alias: String): Boolean = keys.containsKey(alias)
		override fun engineIsCertificateEntry(alias: String): Boolean = false
		override fun engineGetCertificateAlias(cert: Certificate): String? = null
		override fun engineStore(stream: OutputStream?, password: CharArray?) = Unit
		override fun engineLoad(stream: InputStream?, password: CharArray?) = Unit
	}

	class AesGenerator : KeyGeneratorSpi() {
		private var alias: String? = null

		override fun engineInit(random: SecureRandom?) = throw UnsupportedOperationException()
		override fun engineInit(keysize: Int, random: SecureRandom?) = throw UnsupportedOperationException()
		override fun engineInit(params: AlgorithmParameterSpec, random: SecureRandom?) {
			val spec = params as KeyGenParameterSpec
			check(spec.keySize == 256)
			alias = spec.keystoreAlias
		}

		override fun engineGenerateKey(): SecretKey {
			val key = SecretKeySpec(ByteArray(32).also { SecureRandom().nextBytes(it) }, "AES")
			keys[checkNotNull(alias)] = key
			return key
		}
	}
}
