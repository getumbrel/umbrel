package com.umbrel.kit

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import kotlinx.serialization.SerializationException
import java.io.File
import java.io.IOException
import java.security.GeneralSecurityException
import java.security.KeyStore
import java.security.MessageDigest
import java.security.ProviderException
import java.util.UUID
import javax.crypto.AEADBadTagException
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Native device grants, browser sessions and local HTTPS trust anchors, one sealed file per
 * Umbrel id. This is the Android counterpart of the Apple Keychain store. Each blob is
 * encrypted with an AES-256-GCM key that lives in the Android Keystore (non-exportable,
 * hardware-backed where available) and is written under the no-backup files directory, so
 * it never travels in Auto Backup or device-to-device transfer. Jetpack's
 * EncryptedSharedPreferences is deprecated in favor of exactly this: Keystore plus the
 * app's own storage.
 */
object SecretStore {
	private const val KEY_ALIAS = "com.umbrel.android.secrets.v1"
	private const val KEYSTORE = "AndroidKeyStore"
	private const val SESSION_SERVICE = "com.umbrel.android.session"
	private const val LOCAL_HTTPS_CA_SERVICE = "com.umbrel.android.local-https-ca"
	private const val PHOTO_BACKUP_GRANT_SERVICE = "com.umbrel.android.photo-backup-grant"
	private const val PHOTO_BACKUP_SOURCE_SERVICE = "com.umbrel.android.photo-backup-source"
	private const val BROWSER_SESSION_SERVICE = "com.umbrel.android.browser-session"
	private const val GCM_TAG_BITS = 128
	private const val IV_BYTES = 12
	private val separator = 0.toChar().toString()

	private val sessionMutationLock = Any()
	private val localHttpsCaMutationLock = Any()
	private val sessionCache = HashMap<String, Umbreld.Session>()

	@Volatile
	private var directory: File? = null

	/** Must be called once before any read or write. */
	fun initialize(context: Context) {
		directory = File(context.noBackupFilesDir, "secrets")
	}

	fun initialize(directory: File) {
		this.directory = directory
	}

	sealed class SessionReadResult {
		data class Found(val session: Umbreld.Session) : SessionReadResult()
		data object Missing : SessionReadResult()
		data object Invalid : SessionReadResult()
		data class Unavailable(val reason: String, val cachedSession: Umbreld.Session?) : SessionReadResult()

		val sessionOrCached: Umbreld.Session?
			get() = when (this) {
				is Found -> session
				is Unavailable -> cachedSession
				else -> null
			}
	}

	sealed class LocalHttpsCaReadResult {
		class Found(val certificate: ByteArray) : LocalHttpsCaReadResult()
		data object Missing : LocalHttpsCaReadResult()
		data class Unavailable(val reason: String) : LocalHttpsCaReadResult()
	}

	enum class LocalHttpsCaStoreResult { STORED, ALREADY_MATCHES, CONFLICTS, UNAVAILABLE }

	sealed class TokenReadResult {
		data class Found(val value: String) : TokenReadResult()
		data object Missing : TokenReadResult()
		data class Unavailable(val reason: String) : TokenReadResult()

		val valueOrNull: String?
			get() = (this as? Found)?.value
	}

	internal sealed class RawReadResult {
		class Found(val data: ByteArray) : RawReadResult()
		data object Missing : RawReadResult()

		/** The file exists but this device's key can never open it: damaged, or sealed by a lost key. */
		data object Undecryptable : RawReadResult()
		data class Unavailable(val reason: String) : RawReadResult()
	}

	// ── Sessions ──

	/** Returns false when the session could not be stored; callers must not continue with
	 * credentials that won't survive a relaunch. */
	fun setSession(session: Umbreld.Session, deviceId: String): Boolean =
		synchronized(sessionMutationLock) { setSessionUnlocked(session, deviceId) }

	private fun setSessionUnlocked(session: Umbreld.Session, deviceId: String): Boolean {
		val data = try {
			Umbreld.json.encodeToString(Umbreld.Session.serializer(), session).toByteArray(Charsets.UTF_8)
		} catch (error: SerializationException) {
			return false
		}
		val stored = write(SESSION_SERVICE, deviceId, data)
		if (stored) synchronized(sessionCache) { sessionCache[deviceId] = session }
		return stored
	}

	/** Item absence and malformed stored credentials are definitive. Other storage failures are
	 * transient, not proof of logout. */
	fun readSession(deviceId: String): SessionReadResult =
		synchronized(sessionMutationLock) { readSessionUnlocked(deviceId) }

	private fun readSessionUnlocked(deviceId: String): SessionReadResult =
		when (val read = classifySessionRead(read(SESSION_SERVICE, deviceId))) {
			is SessionReadResult.Found -> {
				synchronized(sessionCache) { sessionCache[deviceId] = read.session }
				read
			}
			is SessionReadResult.Missing, is SessionReadResult.Invalid -> {
				synchronized(sessionCache) { sessionCache.remove(deviceId) }
				read
			}
			is SessionReadResult.Unavailable ->
				SessionReadResult.Unavailable(read.reason, synchronized(sessionCache) { sessionCache[deviceId] })
		}

	/**
	 * Like the Apple Keychain store, a session that exists but can't be read is Invalid, not
	 * Unavailable, so the app shows the account as signed out instead of waiting on storage
	 * that won't recover. Only I/O and Keystore failures are Unavailable.
	 */
	internal fun classifySessionRead(read: RawReadResult): SessionReadResult = when (read) {
		is RawReadResult.Found -> {
			val session = try {
				Umbreld.json.decodeFromString(Umbreld.Session.serializer(), String(read.data, Charsets.UTF_8))
			} catch (error: IllegalArgumentException) {
				null
			}
			if (session == null || session.deviceToken.isEmpty()) SessionReadResult.Invalid else SessionReadResult.Found(session)
		}
		is RawReadResult.Missing -> SessionReadResult.Missing
		is RawReadResult.Undecryptable -> SessionReadResult.Invalid
		is RawReadResult.Unavailable -> SessionReadResult.Unavailable(read.reason, null)
	}

	fun deleteSession(deviceId: String) = synchronized(sessionMutationLock) { deleteSessionUnlocked(deviceId) }

	private fun deleteSessionUnlocked(deviceId: String) {
		synchronized(sessionCache) { sessionCache.remove(deviceId) }
		delete(SESSION_SERVICE, deviceId)
	}

	/** Refresh runs concurrently with UI-driven sign-in and sign-out. Only the same
	 * server-issued login may be replaced. */
	internal fun replaceSession(session: Umbreld.Session, expected: Umbreld.Session): Boolean =
		synchronized(sessionMutationLock) {
			val stored = readSessionUnlocked(expected.deviceId).sessionOrCached
			if (stored == null || !stored.belongsToSameLogin(expected)) return false
			setSessionUnlocked(session, expected.deviceId)
		}

	internal fun deleteSession(expected: Umbreld.Session) {
		synchronized(sessionMutationLock) {
			val stored = readSessionUnlocked(expected.deviceId).sessionOrCached
			if (stored == null || !stored.belongsToSameLogin(expected)) return
			deleteSessionUnlocked(expected.deviceId)
		}
	}

	// ── Local HTTPS CA ──
	// The enrolled CA is public, but its integrity is security-sensitive. Enrollment is
	// write-once: replacing a CA requires explicitly forgetting the Umbrel.

	internal fun storeLocalHttpsCaIfAbsent(certificate: ByteArray, deviceId: String): LocalHttpsCaStoreResult =
		synchronized(localHttpsCaMutationLock) {
			when (val existing = readLocalHttpsCaUnlocked(deviceId)) {
				is LocalHttpsCaReadResult.Found ->
					if (existing.certificate.contentEquals(certificate)) LocalHttpsCaStoreResult.ALREADY_MATCHES
					else LocalHttpsCaStoreResult.CONFLICTS
				is LocalHttpsCaReadResult.Unavailable -> LocalHttpsCaStoreResult.UNAVAILABLE
				is LocalHttpsCaReadResult.Missing ->
					if (write(LOCAL_HTTPS_CA_SERVICE, deviceId, certificate)) LocalHttpsCaStoreResult.STORED
					else LocalHttpsCaStoreResult.UNAVAILABLE
			}
		}

	/** Claiming an unsaved discovery result is an explicit first-use trust action. Callers must
	 * never use this for a device that is already saved. */
	internal fun replaceLocalHttpsCa(certificate: ByteArray, deviceId: String): LocalHttpsCaStoreResult =
		synchronized(localHttpsCaMutationLock) {
			when (val existing = readLocalHttpsCaUnlocked(deviceId)) {
				is LocalHttpsCaReadResult.Found ->
					if (existing.certificate.contentEquals(certificate)) LocalHttpsCaStoreResult.ALREADY_MATCHES
					else if (write(LOCAL_HTTPS_CA_SERVICE, deviceId, certificate)) LocalHttpsCaStoreResult.STORED
					else LocalHttpsCaStoreResult.UNAVAILABLE
				is LocalHttpsCaReadResult.Unavailable -> LocalHttpsCaStoreResult.UNAVAILABLE
				is LocalHttpsCaReadResult.Missing ->
					if (write(LOCAL_HTTPS_CA_SERVICE, deviceId, certificate)) LocalHttpsCaStoreResult.STORED
					else LocalHttpsCaStoreResult.UNAVAILABLE
			}
		}

	fun readLocalHttpsCa(deviceId: String): LocalHttpsCaReadResult =
		synchronized(localHttpsCaMutationLock) { readLocalHttpsCaUnlocked(deviceId) }

	private fun readLocalHttpsCaUnlocked(deviceId: String): LocalHttpsCaReadResult =
		classifyLocalHttpsCaRead(read(LOCAL_HTTPS_CA_SERVICE, deviceId))

	/**
	 * Unlike a session, an unreadable pin is never reported as absent: absence would let
	 * sign-in recovery replace the pin by first use. It stays Unavailable until the Umbrel is
	 * removed, which deletes it.
	 */
	internal fun classifyLocalHttpsCaRead(read: RawReadResult): LocalHttpsCaReadResult = when (read) {
		is RawReadResult.Found -> LocalHttpsCaReadResult.Found(read.data)
		is RawReadResult.Missing -> LocalHttpsCaReadResult.Missing
		is RawReadResult.Undecryptable -> LocalHttpsCaReadResult.Unavailable("undecryptable")
		is RawReadResult.Unavailable -> LocalHttpsCaReadResult.Unavailable(read.reason)
	}

	internal fun deleteLocalHttpsCa(deviceId: String) =
		synchronized(localHttpsCaMutationLock) { delete(LOCAL_HTTPS_CA_SERVICE, deviceId) }

	// ── Browser session ──

	/** The in-app browser's umbrelOS session, kept beside the native session so any of the
	 * Umbrel's addresses can be opened without signing in again. One per Umbrel: the last
	 * account to sign in replaces it. */
	fun setBrowserSession(session: BrowserSession): Boolean {
		val data = try {
			Umbreld.json.encodeToString(BrowserSession.serializer(), session).toByteArray(Charsets.UTF_8)
		} catch (error: SerializationException) {
			return false
		}
		return write(BROWSER_SESSION_SERVICE, session.deviceId, data)
	}

	/** Null when there is none, or it can't be read; the browser then shows umbrelOS's own
	 * login page, and a sign-in there is kept. */
	fun readBrowserSession(deviceId: String): BrowserSession? {
		val read = read(BROWSER_SESSION_SERVICE, deviceId) as? RawReadResult.Found ?: return null
		return try {
			Umbreld.json.decodeFromString(BrowserSession.serializer(), String(read.data, Charsets.UTF_8))
		} catch (error: SerializationException) {
			null
		} catch (error: IllegalArgumentException) {
			null
		}
	}

	fun deleteBrowserSession(deviceId: String) = delete(BROWSER_SESSION_SERVICE, deviceId)

	// ── Photo backup grant and source id ──

	fun setPhotoBackupGrant(token: String, deviceId: String, accountId: String): Boolean =
		token.isNotEmpty() && write(PHOTO_BACKUP_GRANT_SERVICE, "$deviceId:$accountId", token.toByteArray(Charsets.UTF_8))

	fun readPhotoBackupGrant(deviceId: String, accountId: String): TokenReadResult =
		readToken(PHOTO_BACKUP_GRANT_SERVICE, "$deviceId:$accountId") { it.isNotEmpty() }

	fun deletePhotoBackupGrant(deviceId: String, accountId: String) =
		delete(PHOTO_BACKUP_GRANT_SERVICE, "$deviceId:$accountId")

	/** This non-secret id survives disabling backup, signing out, and removing a saved connection
	 * so the same account-owned folder can resume without duplicates. */
	fun setPhotoBackupSourceId(sourceId: String, deviceId: String, accountId: String): Boolean =
		isUuid(sourceId) && write(PHOTO_BACKUP_SOURCE_SERVICE, "$deviceId:$accountId", sourceId.toByteArray(Charsets.UTF_8))

	fun readPhotoBackupSourceId(deviceId: String, accountId: String): TokenReadResult =
		readToken(PHOTO_BACKUP_SOURCE_SERVICE, "$deviceId:$accountId", ::isUuid)

	private fun isUuid(value: String): Boolean = try {
		UUID.fromString(value)
		true
	} catch (error: IllegalArgumentException) {
		false
	}

	private fun readToken(service: String, account: String, isValid: (String) -> Boolean): TokenReadResult =
		when (val read = read(service, account)) {
			is RawReadResult.Found -> {
				val value = String(read.data, Charsets.UTF_8)
				if (isValid(value)) TokenReadResult.Found(value) else TokenReadResult.Unavailable("decode")
			}
			is RawReadResult.Missing -> TokenReadResult.Missing
			is RawReadResult.Undecryptable -> TokenReadResult.Unavailable("undecryptable")
			is RawReadResult.Unavailable -> TokenReadResult.Unavailable(read.reason)
		}

	// ── Sealed file plumbing ──

	private fun requireDirectory(): File = directory ?: error("SecretStore.initialize was not called")

	private fun filePath(service: String, account: String): File {
		// Hash the logical key so untrusted ids can never influence the on-disk path.
		val digest = MessageDigest.getInstance("SHA-256")
			.digest((service + separator + account).toByteArray(Charsets.UTF_8))
		return File(requireDirectory(), digest.joinToString("") { "%02x".format(it) } + ".bin")
	}

	// Additional authenticated data binds each blob to its logical key so a sealed session
	// can't be copied into another Umbrel's slot.
	private fun aad(service: String, account: String): ByteArray =
		("com.umbrel.android" + separator + service + separator + account).toByteArray(Charsets.UTF_8)

	@Synchronized
	private fun key(): SecretKey {
		val keyStore = KeyStore.getInstance(KEYSTORE).apply { load(null) }
		(keyStore.getKey(KEY_ALIAS, null) as? SecretKey)?.let { return it }
		val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE)
		val spec = KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
			.setBlockModes(KeyProperties.BLOCK_MODE_GCM)
			.setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
			.setKeySize(256)
			// Background uploads must read the grant while the device is locked, so the key
			// is deliberately not gated on user authentication.
			.setUserAuthenticationRequired(false)
			// Not StrongBox: it is slower, and every request decrypts the session.
			.build()
		generator.init(spec)
		return generator.generateKey()
	}

	private fun write(service: String, account: String, plaintext: ByteArray): Boolean = try {
		val dir = requireDirectory()
		dir.mkdirs()
		val cipher = Cipher.getInstance("AES/GCM/NoPadding")
		cipher.init(Cipher.ENCRYPT_MODE, key())
		cipher.updateAAD(aad(service, account))
		val iv = cipher.iv
		check(iv.size == IV_BYTES)
		val sealed = iv + cipher.doFinal(plaintext)
		val temp = File(dir, ".${UUID.randomUUID()}.tmp")
		temp.writeBytes(sealed)
		if (!temp.renameTo(filePath(service, account))) {
			temp.delete()
			false
		} else {
			true
		}
	} catch (error: IOException) {
		false
	} catch (error: GeneralSecurityException) {
		false
	} catch (error: ProviderException) {
		false
	} catch (error: IllegalStateException) {
		false
	}

	private fun read(service: String, account: String): RawReadResult {
		val file = try {
			filePath(service, account)
		} catch (error: IllegalStateException) {
			return RawReadResult.Unavailable("uninitialized")
		}
		val sealed = try {
			if (!file.exists()) return RawReadResult.Missing
			file.readBytes()
		} catch (error: IOException) {
			return RawReadResult.Unavailable(error.javaClass.simpleName)
		}
		if (sealed.size <= IV_BYTES) return RawReadResult.Undecryptable
		return try {
			val cipher = Cipher.getInstance("AES/GCM/NoPadding")
			cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(GCM_TAG_BITS, sealed, 0, IV_BYTES))
			cipher.updateAAD(aad(service, account))
			RawReadResult.Found(cipher.doFinal(sealed, IV_BYTES, sealed.size - IV_BYTES))
		} catch (error: AEADBadTagException) {
			// Keystore reports a failed GCM tag check this way: the file is damaged or was
			// sealed by a key this device no longer has. Neither recovers.
			RawReadResult.Undecryptable
		} catch (error: GeneralSecurityException) {
			RawReadResult.Unavailable(error.javaClass.simpleName)
		} catch (error: ProviderException) {
			RawReadResult.Unavailable(error.javaClass.simpleName)
		} catch (error: IOException) {
			// KeyStore.load
			RawReadResult.Unavailable(error.javaClass.simpleName)
		}
	}

	private fun delete(service: String, account: String) {
		try {
			filePath(service, account).delete()
		} catch (error: IllegalStateException) {
		} catch (error: SecurityException) {
		}
	}
}
