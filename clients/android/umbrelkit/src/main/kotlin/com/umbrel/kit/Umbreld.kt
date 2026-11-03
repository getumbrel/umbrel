package com.umbrel.kit

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.EOFException
import java.io.IOException
import java.net.ConnectException
import java.net.NoRouteToHostException
import java.net.SocketException
import java.net.URI
import java.net.URISyntaxException
import java.net.URLEncoder
import java.net.UnknownHostException
import java.security.cert.CertificateException
import javax.net.ssl.SSLException
import javax.net.ssl.SSLPeerUnverifiedException
import kotlin.coroutines.coroutineContext

/**
 * Minimal hand-written client for the umbreld tRPC endpoints the apps use. Wire shapes are
 * plain serializable classes rather than generated from the router. Calls are stateless
 * functions taking (host, session) because the apps talk to several devices at once.
 *
 * umbreld runs tRPC without a transformer, so envelopes are plain JSON:
 *   success: {"result": {"data": value}}
 *   error:   {"error": {"message": "..."}}
 */
object Umbreld {
	enum class ErrorKind { SERVER, CONNECTIVITY, TRUST, STORAGE, PROTOCOL_FAILURE }

	class Error(
		val status: Int,
		message: String,
		val kind: ErrorKind = ErrorKind.SERVER,
		// A connectivity failure where the host didn't answer in time, rather than refusing or
		// dropping the connection
		internal val timedOut: Boolean = false,
	) : Exception(message) {
		val isAuthError: Boolean get() = status == 401
		val isConnectivityFailure: Boolean get() = kind == ErrorKind.CONNECTIVITY
		val requiresTwoFactorAuthentication: Boolean get() = message == "Missing 2FA code"
	}

	// The stable device credential is stored in the secret store and sent only to the
	// access exchange. Normal API calls carry the short-lived access credential.
	@Serializable
	data class Session(
		val deviceId: String,
		val accountId: String,
		val accessToken: String,
		val accessExpiresAt: Long,
		val deviceToken: String,
	) {
		/** Access tokens rotate, but these fields identify one server-issued login. */
		fun belongsToSameLogin(other: Session): Boolean =
			deviceId == other.deviceId && accountId == other.accountId && deviceToken == other.deviceToken
	}

	@Serializable
	data class DiscoveryInfo(val id: String, val device: String, val onboarded: Boolean)

	@Serializable
	data class Wallpaper(val id: String, val brandColorHsl: String)

	@Serializable
	data class Account(val userId: String, val name: String, val wallpaper: Wallpaper, val avatarUrl: String? = null)

	@Serializable
	data class UserInfo(
		val userId: String,
		val name: String,
		val role: String,
		val homePath: String,
		val sambaEnabled: Boolean = false,
		val sambaUsername: String = "",
		val wallpaper: Wallpaper,
	)

	@Serializable
	data class AppCredentials(
		val defaultUsername: String? = null,
		val defaultPassword: String? = null,
		val showBeforeOpen: Boolean? = null,
	)

	/**
	 * One installed app. umbreld returns a per-app error object instead when a manifest fails
	 * to read, so every display field is optional and callers filter.
	 */
	@Serializable
	data class AppSummary(
		val id: String,
		val name: String? = null,
		val version: String? = null,
		val icon: String? = null,
		val state: String? = null,
		val progress: Double? = null,
		val port: Int? = null,
		val path: String? = null,
		val torOnly: Boolean? = null,
		val requiresHttps: Boolean? = null,
		val credentials: AppCredentials? = null,
	) {
		val withoutCredentials: AppSummary get() = copy(credentials = null)

		/** The app's web UI; null for error stubs and Tor-only apps. */
		fun webUrl(host: String, scheme: String = "http"): String? {
			val port = port ?: return null
			if (torOnly == true) return null
			val normalizedPath = path?.takeIf { it.isNotEmpty() }?.let { if (it.startsWith("/")) it else "/$it" } ?: ""
			return "$scheme://$host:$port$normalizedPath"
		}
	}

	@Serializable
	data class AppUpdate(val id: String, val version: String)

	@Serializable
	data class DiskUsageApp(val id: String, val used: Double)

	@Serializable
	data class DiskUsageMachine(val id: String, val name: String, val osId: String, val used: Double)

	@Serializable
	data class DiskUsage(
		val size: Double,
		val totalUsed: Double,
		val system: Double,
		val files: Double,
		val apps: List<DiskUsageApp>,
		// Optional keeps the app compatible with umbrelOS versions from before the
		// Machines category was added to system.diskUsage.
		val machines: List<DiskUsageMachine>? = null,
	) {
		val appsUsed: Double get() = apps.sumOf { it.used }
		val machinesUsed: Double get() = machines?.sumOf { it.used } ?: 0.0
	}

	@Serializable
	data class Share(val name: String, val path: String, val sharename: String)

	@Serializable
	data class PhotoBackupSource(val id: String, val accountId: String, val name: String)

	@Serializable
	data class PhotoBackupGrant(val token: String, val source: PhotoBackupSource)

	@Serializable
	data class PhotoBackupResourceQuery(val resourceKey: String, val fileExtension: String)

	@Serializable
	data class PhotoBackupResourceReceipt(val resourceKey: String, val bytes: Long)

	/**
	 * One Photos source of the signed-in account: this Umbrel's own library, or a phone that
	 * backs up to it. Available since umbrelOS 2.0.
	 */
	@Serializable
	data class PhotoSourceSummary(
		val type: String,
		val name: String,
		val stats: Stats,
		// Kept in the Photos database; the counts come from the file index and read 0 while it
		// rebuilds
		val lastImportAt: Double? = null,
	) {
		@Serializable
		data class Stats(val photos: Long, val videos: Long)

		/**
		 * umbrelOS reports Android phones as "android" once their app has asked it for a backup
		 * grant; earlier releases report every phone as "iphone". Its other types, the Umbrel's
		 * own library and later drives and network shares, aren't phones.
		 */
		val isPhone: Boolean get() = type == "iphone" || type == "android"

		val isPhoneWithBackups: Boolean get() = isPhone && (stats.photos + stats.videos > 0 || lastImportAt != null)
	}

	/**
	 * Asked before a phone starts a new backup source. umbrelOS 2.0 keys backups by source, so a
	 * new or reinstalled phone backing up as a new source stores every photo the account
	 * already has from its old one again.
	 */
	sealed class NewPhotoBackupSourceCheck {
		data object Proceed : NewPhotoBackupSourceCheck()

		/** Names of the account's phone sources that hold backups, most recent first. */
		data class Ask(val existing: List<String>) : NewPhotoBackupSourceCheck()

		/**
		 * The check didn't get through. Setup waits only while the Umbrel itself can't be
		 * reached; one that answers but couldn't complete the check needs Try Again.
		 */
		data object Wait : NewPhotoBackupSourceCheck()
		data class Fail(val message: String) : NewPhotoBackupSourceCheck()

		companion object {
			/** Cancellation isn't a result here: callers let it propagate. */
			fun resolve(sources: Result<List<PhotoSourceSummary>>): NewPhotoBackupSourceCheck = sources.fold(
				onSuccess = { list ->
					val existing = list.filter { it.isPhoneWithBackups }.sortedByDescending { it.lastImportAt ?: 0.0 }.map { it.name }
					if (existing.isEmpty()) Proceed else Ask(existing)
				},
				onFailure = { error ->
					if ((error as? Error)?.isConnectivityFailure == true || error is IOException) Wait else Fail(error.message.orEmpty())
				},
			)
		}
	}

	/**
	 * An Umbrel whose long-standing public version endpoint reports a release older than
	 * umbrelOS 2.0. This is only an update hint: it is never trusted as an identity or admitted
	 * to sign-in.
	 */
	data class UpdateRequiredDevice(
		val host: String,
		// IPv4 addresses the host resolved to that report the older version too, so the hint goes
		// once the Umbrel, updated, proves itself at one of them
		val addresses: List<String> = emptyList(),
	)

	/**
	 * A current umbrelOS that answered its public version endpoint but didn't prove its
	 * identity over HTTPS, even after a quiet retry. It is never trusted as an identity or
	 * admitted to sign-in; the user can try again or open it in a browser.
	 */
	data class UnverifiedDevice(
		val host: String,
		// IPv4 addresses the host resolved to, so a second name for an Umbrel that did prove
		// itself isn't shown as a separate failure
		val addresses: List<String> = emptyList(),
		val reason: Reason,
	) {
		enum class Reason(val explanation: String) {
			// It didn't answer in the time allowed
			SLOW("Your Umbrel is taking too long to respond. It may be busy or still starting up."),
			// Anything else, such as a refused connection or a certificate its CA didn't issue
			UNEXPECTED("Your Umbrel didn’t respond as expected."),
		}
	}

	sealed class HostIdentification {
		data class Device(val value: IdentifiedDevice) : HostIdentification()
		data class Unverified(val value: UnverifiedDevice) : HostIdentification()

		/**
		 * The host proved a saved Umbrel's id but not that Umbrel's pin, as after a certificate
		 * reset. Trying again can't fix it, so it's left to the saved device's own handling
		 * rather than shown as a failed connection.
		 */
		data object SavedIdentityChanged : HostIdentification()
	}

	sealed class ManualDiscoveryResult {
		data class Device(val value: IdentifiedDevice) : ManualDiscoveryResult()
		data class UpdateRequired(val value: UpdateRequiredDevice) : ManualDiscoveryResult()
		data class Unverified(val value: UnverifiedDevice) : ManualDiscoveryResult()
	}

	/**
	 * Hostnames that answered the public version endpoint: current Umbrels that proved their
	 * identity like any mDNS candidate, current Umbrels that couldn't, and Umbrels too old to
	 * connect.
	 */
	data class FallbackDiscoveryResult(
		val devices: List<IdentifiedDevice> = emptyList(),
		val unverified: List<UnverifiedDevice> = emptyList(),
		val updateRequired: List<UpdateRequiredDevice> = emptyList(),
	)

	class ManualDiscoveryException(val kind: Kind) : Exception(kind.description) {
		enum class Kind(val description: String) {
			INVALID_ADDRESS("Enter a local or Tailscale IP address, .local hostname, or Tailscale MagicDNS name."),
			NO_DEVICE_FOUND("Couldn’t find an Umbrel at this address. Make sure it’s online and reachable."),
		}
	}

	class Target(val deviceId: String, hosts: List<String>) {
		val hosts: List<String>

		init {
			val seen = HashSet<String>()
			this.hosts = hosts.filter { it.isNotEmpty() && seen.add(it.lowercase()) }
		}

		override fun equals(other: Any?): Boolean = other is Target && other.deviceId == deviceId && other.hosts == hosts
		override fun hashCode(): Int = 31 * deviceId.hashCode() + hosts.hashCode()
		override fun toString(): String = "Target($deviceId, $hosts)"
	}

	enum class WallpaperImageRendition {
		LARGE, MEDIUM, JPEG_FALLBACK;

		internal fun path(id: String): String = when (this) {
			LARGE -> "/assets/wallpapers/generated-avif/large/$id.avif"
			MEDIUM -> "/assets/wallpapers/generated-avif/medium/$id.avif"
			JPEG_FALLBACK -> "/assets/wallpapers/$id.jpg"
		}
	}

	internal val json = Json {
		ignoreUnknownKeys = true
		explicitNulls = false
		encodeDefaults = true
		isLenient = false
	}

	// Short timeout for identity probes: sweeps hit several hosts in parallel and nonexistent
	// .local hostnames should fail fast
	private const val PROBE_TIMEOUT_MS = 3_000L
	// discoveryInfo after the host has proven itself. It reads the hardware, which can take
	// seconds on a busy umbrelOS 2.0.0.
	private const val IDENTITY_RESPONSE_TIMEOUT_MS = 8_000L
	// One whole identification attempt, across every address it tries
	private const val IDENTIFICATION_DEADLINE_MS = 10_000L
	// A host that answered the version probe resolves from the mDNS cache
	private const val FALLBACK_ADDRESS_TIMEOUT_MS = 1_000L
	// A current Umbrel that failed unexpectedly is asked once more after this
	private const val QUIET_RETRY_DELAY_MS = 2_000L
	internal const val REQUEST_TIMEOUT_MS = 10_000L
	private const val FALLBACK_RESPONSE_MAXIMUM_BYTES = 16 * 1024
	private val coordinator = SessionCoordinator()
	private val endpointResolver = NativeEndpointResolver()
	private val jsonMediaType = "application/json".toMediaType()

	// ── Identity (the discovery oracle) ──
	// system.discoveryInfo is the authority for a device's id, model, and onboarding state.
	// mDNS only supplies candidate locations and display hints. The HTTP bootstrap carries no
	// credentials and is accepted only after the advertised CA proves the same identity.

	@Serializable
	internal data class LocalHttpsIdentity(val id: String, val caCertificate: String)

	private class VerifiedLocalHttpsCandidate(val discoveryInfo: DiscoveryInfo, val certificate: ByteArray)

	internal class IdentityProbeResult(val discoveryInfo: DiscoveryInfo, val candidateCertificate: ByteArray?)

	internal sealed class SavedIdentityRecoveryDecision {
		data object AlreadyEnrolled : SavedIdentityRecoveryDecision()
		data class Claim(val host: String) : SavedIdentityRecoveryDecision()
	}

	/**
	 * Passive discovery is deliberately read-only. HTTP carries only a candidate public CA
	 * and discovery id; the candidate stays in memory long enough to prove the same id over
	 * HTTPS, but opening the app never persists it.
	 */
	suspend fun identify(host: String, expectedDeviceId: String? = null): DiscoveryInfo? = try {
		verifiedLocalHttpsIdentity(host, expectedDeviceId).discoveryInfo
	} catch (cancelled: CancellationException) {
		throw cancelled
	} catch (error: Exception) {
		null
	}

	private suspend fun verifiedLocalHttpsIdentity(host: String, expectedDeviceId: String?): IdentityProbeResult {
		// A saved Umbrel must validate directly against its existing pin.
		if (expectedDeviceId != null) {
			return when (storedLocalHttpsCa(expectedDeviceId)) {
				is SecretStore.LocalHttpsCaReadResult.Found -> {
					val identity = discoveryInfoOverHttps(host, expectedDeviceId)
					if (identity.id != expectedDeviceId) throw LocalHttpsTransportException(LocalHttpsTransportException.Kind.IDENTITY_CHANGED)
					IdentityProbeResult(identity, null)
				}
				is SecretStore.LocalHttpsCaReadResult.Missing ->
					throw LocalHttpsTransportException(LocalHttpsTransportException.Kind.NOT_ENROLLED)
				is SecretStore.LocalHttpsCaReadResult.Unavailable ->
					throw LocalHttpsTransportException(LocalHttpsTransportException.Kind.STORAGE_UNAVAILABLE)
			}
		}
		val candidate = verifiedFirstUseCandidate(host, expectedDeviceId)
		return IdentityProbeResult(candidate.discoveryInfo, candidate.certificate)
	}

	private suspend fun verifiedFirstUseCandidate(host: String, expectedDeviceId: String?): VerifiedLocalHttpsCandidate {
		val bootstrap = localHttpsIdentity(host)
		if (expectedDeviceId != null && bootstrap.id != expectedDeviceId) {
			throw LocalHttpsTransportException(LocalHttpsTransportException.Kind.IDENTITY_CHANGED)
		}
		val candidate = LocalHttpsTransport.certificateDataFromPem(bootstrap.caCertificate)
		val identity = discoveryInfoOverHttps(host, candidate, bootstrap.id)
		if (identity.id != bootstrap.id) throw LocalHttpsTransportException(LocalHttpsTransportException.Kind.IDENTITY_CHANGED)
		return VerifiedLocalHttpsCandidate(identity, candidate)
	}

	/**
	 * Explicitly selecting an unsaved card establishes first-use trust. Re-verify the exact
	 * endpoint with the candidate anchor held from that scan, then replace a stale unsaved
	 * pin left by older builds. Saved devices never call this API.
	 */
	suspend fun claimLocalHttpsIdentity(device: IdentifiedDevice): DiscoveryInfo {
		val certificate = device.candidateCaCertificate
			?: throw LocalHttpsTransportException(LocalHttpsTransportException.Kind.IDENTITY_CHANGED)
		val identity = discoveryInfoOverHttps(device.host, certificate, device.id)
		if (identity.id != device.id) throw LocalHttpsTransportException(LocalHttpsTransportException.Kind.IDENTITY_CHANGED)
		return when (enroll(certificate, device.id, replacingExisting = true)) {
			SecretStore.LocalHttpsCaStoreResult.STORED, SecretStore.LocalHttpsCaStoreResult.ALREADY_MATCHES -> identity
			SecretStore.LocalHttpsCaStoreResult.UNAVAILABLE ->
				throw LocalHttpsTransportException(LocalHttpsTransportException.Kind.STORAGE_UNAVAILABLE)
			SecretStore.LocalHttpsCaStoreResult.CONFLICTS ->
				throw LocalHttpsTransportException(LocalHttpsTransportException.Kind.IDENTITY_CHANGED)
		}
	}

	/**
	 * A restored config can outlive both device-local secrets. Recover only from an explicit
	 * sign-in, only when neither a pin nor a session exists, and only through the saved
	 * primary LAN endpoint. Returns true when a pin was (re)established.
	 */
	suspend fun prepareSavedDeviceForSignIn(target: Target): Boolean {
		val decision = decideSavedIdentityRecovery(
			target, storedLocalHttpsCa(target.deviceId), storedSession(target.deviceId),
		)
		val claim = decision as? SavedIdentityRecoveryDecision.Claim ?: return false
		val candidate = verifiedFirstUseCandidate(claim.host, target.deviceId)

		// Re-check after the network operation. If another explicit flow installed a pin,
		// validate with that pin; never replace it from this recovery path.
		val recheck = decideSavedIdentityRecovery(
			target, storedLocalHttpsCa(target.deviceId), storedSession(target.deviceId),
		)
		if (recheck is SavedIdentityRecoveryDecision.AlreadyEnrolled) {
			provePinnedIdentity(claim.host, target.deviceId)
			return true
		}
		return when (enroll(candidate.certificate, target.deviceId)) {
			SecretStore.LocalHttpsCaStoreResult.STORED, SecretStore.LocalHttpsCaStoreResult.ALREADY_MATCHES -> true
			SecretStore.LocalHttpsCaStoreResult.UNAVAILABLE ->
				throw LocalHttpsTransportException(LocalHttpsTransportException.Kind.STORAGE_UNAVAILABLE)
			SecretStore.LocalHttpsCaStoreResult.CONFLICTS ->
				throw LocalHttpsTransportException(LocalHttpsTransportException.Kind.IDENTITY_CHANGED)
		}
	}

	internal fun decideSavedIdentityRecovery(
		target: Target,
		caRead: SecretStore.LocalHttpsCaReadResult,
		sessionRead: SecretStore.SessionReadResult,
	): SavedIdentityRecoveryDecision {
		when (caRead) {
			is SecretStore.LocalHttpsCaReadResult.Found -> return SavedIdentityRecoveryDecision.AlreadyEnrolled
			is SecretStore.LocalHttpsCaReadResult.Unavailable ->
				throw LocalHttpsTransportException(LocalHttpsTransportException.Kind.STORAGE_UNAVAILABLE)
			is SecretStore.LocalHttpsCaReadResult.Missing -> Unit
		}
		when (sessionRead) {
			is SecretStore.SessionReadResult.Missing -> Unit
			is SecretStore.SessionReadResult.Unavailable ->
				throw LocalHttpsTransportException(LocalHttpsTransportException.Kind.STORAGE_UNAVAILABLE)
			else -> throw LocalHttpsTransportException(LocalHttpsTransportException.Kind.NOT_ENROLLED)
		}
		val host = target.hosts.firstOrNull()
		if (host == null || !SavedDevice.isValidLocalEndpointHost(host) || SavedDevice.isTailscaleAddress(host)) {
			throw LocalHttpsTransportException(LocalHttpsTransportException.Kind.TRUST_FAILED)
		}
		return SavedIdentityRecoveryDecision.Claim(host)
	}

	// Keystore decryption and file access block, so stored secrets are read and written on
	// the IO dispatcher.
	private suspend fun storedLocalHttpsCa(deviceId: String): SecretStore.LocalHttpsCaReadResult =
		withContext(Dispatchers.IO) { SecretStore.readLocalHttpsCa(deviceId) }

	private suspend fun storedSession(deviceId: String): SecretStore.SessionReadResult =
		withContext(Dispatchers.IO) { SecretStore.readSession(deviceId) }

	private suspend fun enroll(
		certificate: ByteArray,
		deviceId: String,
		replacingExisting: Boolean = false,
	): SecretStore.LocalHttpsCaStoreResult =
		withContext(Dispatchers.IO) { LocalHttpsTransport.enroll(certificate, deviceId, replacingExisting) }

	private suspend fun localHttpsIdentity(host: String): LocalHttpsIdentity {
		val request = LocalHttpsTransport.request(plainUrl(host, "/trpc/system.localHttpsIdentity")).build()
		val result = guardTransport(host) { LocalHttpsTransport.bootstrapData(request) }
		return decodeEnvelope(result, "system.localHttpsIdentity")
	}

	/**
	 * Thrown when an Umbrel proved its identity and then didn't answer discoveryInfo in time.
	 * It's slow, not missing, and its other addresses would only wait the same way.
	 */
	internal class IdentityResponseTimeoutException : Exception("Your Umbrel is taking too long to respond")

	/**
	 * Proves a saved Umbrel's pinned identity at [host]. The anchor is the pinned CA and the id
	 * must match. system.localHttpsIdentity does no work beyond reading the id and CA, so the
	 * short timeout still fails a missing or unreachable route fast without cutting off a busy
	 * Umbrel.
	 */
	private suspend fun provePinnedIdentity(host: String, deviceId: String) {
		val request = LocalHttpsTransport.request(httpsUrl(host, "/trpc/system.localHttpsIdentity")).build()
		val result = guardTransport(host) { LocalHttpsTransport.data(request, deviceId, PROBE_TIMEOUT_MS) }
		requireIdentity(deviceId, result)
	}

	/** The same proof, after checking that this phone has a pin to prove it with. */
	private suspend fun requirePinnedIdentity(host: String, deviceId: String) {
		when (storedLocalHttpsCa(deviceId)) {
			is SecretStore.LocalHttpsCaReadResult.Found -> provePinnedIdentity(host, deviceId)
			is SecretStore.LocalHttpsCaReadResult.Missing ->
				throw LocalHttpsTransportException(LocalHttpsTransportException.Kind.NOT_ENROLLED)
			is SecretStore.LocalHttpsCaReadResult.Unavailable ->
				throw LocalHttpsTransportException(LocalHttpsTransportException.Kind.STORAGE_UNAVAILABLE)
		}
	}

	/** The same proof with the candidate CA from a first-use scan. */
	private suspend fun proveCandidateIdentity(host: String, candidateCertificate: ByteArray, deviceId: String) {
		val request = LocalHttpsTransport.request(httpsUrl(host, "/trpc/system.localHttpsIdentity")).build()
		val result = guardTransport(host) { LocalHttpsTransport.data(request, candidateCertificate, PROBE_TIMEOUT_MS) }
		requireIdentity(deviceId, result)
	}

	private fun requireIdentity(deviceId: String, result: HttpResult) {
		val identity: LocalHttpsIdentity = decodeEnvelope(result, "system.localHttpsIdentity")
		if (identity.id != deviceId) throw LocalHttpsTransportException(LocalHttpsTransportException.Kind.IDENTITY_CHANGED)
	}

	// The route is proven first, so a missing host still fails fast.
	private suspend fun discoveryInfoOverHttps(host: String, deviceId: String): DiscoveryInfo {
		provePinnedIdentity(host, deviceId)
		return discoveryInfoAfterProof(host) { request -> LocalHttpsTransport.data(request, deviceId, IDENTITY_RESPONSE_TIMEOUT_MS) }
	}

	private suspend fun discoveryInfoOverHttps(host: String, candidateCertificate: ByteArray, deviceId: String): DiscoveryInfo {
		proveCandidateIdentity(host, candidateCertificate, deviceId)
		return discoveryInfoAfterProof(host) { request ->
			LocalHttpsTransport.data(request, candidateCertificate, IDENTITY_RESPONSE_TIMEOUT_MS)
		}
	}

	// discoveryInfo reads the hardware, which can take seconds on a busy umbrelOS 2.0.0, so once
	// the host has proven itself it gets the longer budget.
	private suspend fun discoveryInfoAfterProof(host: String, send: suspend (Request) -> HttpResult): DiscoveryInfo {
		val request = LocalHttpsTransport.request(httpsUrl(host, "/trpc/system.discoveryInfo")).build()
		val result = try {
			guardTransport(host) { send(request) }
		} catch (error: Error) {
			if (error.timedOut) throw IdentityResponseTimeoutException()
			throw error
		}
		return decodeEnvelope(result, "system.discoveryInfo")
	}

	/**
	 * A read-only availability check for addresses already learned from a saved Umbrel.
	 * Every route, including a 100.64/10 address, must validate against the existing CA pin.
	 */
	suspend fun isKnownEndpointAvailable(host: String, deviceId: String): Boolean = try {
		if (storedLocalHttpsCa(deviceId) !is SecretStore.LocalHttpsCaReadResult.Found) {
			false
		} else {
			provePinnedIdentity(host, deviceId)
			true
		}
	} catch (cancelled: CancellationException) {
		throw cancelled
	} catch (error: Exception) {
		false
	}

	/**
	 * Whether a failure means the Umbrel answered with a different identity than the one this
	 * phone paired with, as it does after the Umbrel or its certificate is reset.
	 */
	fun isIdentityChange(error: Throwable): Boolean = when (error) {
		is LocalHttpsTransportException -> error.kind == LocalHttpsTransportException.Kind.IDENTITY_CHANGED
		is Error -> error.kind == ErrorKind.TRUST && error.message == LocalHttpsTransportException.Kind.IDENTITY_CHANGED.description
		else -> false
	}

	/**
	 * Whether the Umbrel answers at one of its addresses with a different identity than the
	 * one this phone paired with, as it does after the Umbrel or its certificate is reset.
	 * Asked once requests have failed, to tell that apart from being unreachable.
	 */
	suspend fun identityChanged(target: Target): Boolean {
		val pinned = (storedLocalHttpsCa(target.deviceId) as? SecretStore.LocalHttpsCaReadResult.Found)?.certificate
			?: return false
		val answers = coroutineScope {
			target.hosts.map { host -> async { identityAnswer(host, target.deviceId, pinned) } }.awaitAll()
		}
		return IdentityAnswer.VERIFIED !in answers && IdentityAnswer.CHANGED in answers
	}

	private enum class IdentityAnswer { VERIFIED, CHANGED, OTHER }

	private suspend fun identityAnswer(host: String, deviceId: String, pinned: ByteArray): IdentityAnswer {
		try {
			requirePinnedIdentity(host, deviceId)
			return IdentityAnswer.VERIFIED
		} catch (cancelled: CancellationException) {
			throw cancelled
		} catch (error: Exception) {
			val refusedByPin = (error is Error && error.kind == ErrorKind.TRUST) || error is LocalHttpsTransportException
			if (!refusedByPin) return IdentityAnswer.OTHER
		}
		// Any HTTPS server at a saved address (a printer that got the Umbrel's old IP, a
		// captive portal) looks the same from here. It counts only if it proves it's this
		// Umbrel, with the same device id and a new CA.
		val proven = try {
			verifiedFirstUseCandidate(host, deviceId)
		} catch (cancelled: CancellationException) {
			throw cancelled
		} catch (error: Exception) {
			return IdentityAnswer.OTHER
		}
		return if (proven.certificate.contentEquals(pinned)) IdentityAnswer.OTHER else IdentityAnswer.CHANGED
	}

	/** Resolve a candidate through its hostname first, then its advertised IPv4 addresses. */
	suspend fun identify(candidate: Candidate): IdentifiedDevice? = identifyCandidate(candidate, emptySet())

	/** Refresh a saved device through a newly advertised route; requires the existing CA pin. */
	suspend fun identify(candidate: Candidate, expectedDeviceId: String): IdentifiedDevice? {
		if (storedLocalHttpsCa(expectedDeviceId) !is SecretStore.LocalHttpsCaReadResult.Found) return null
		return identifyCandidate(candidate, setOf(expectedDeviceId), requiredDeviceId = expectedDeviceId)
	}

	internal fun interface IdentityProbe {
		suspend fun probe(host: String, expectedDeviceId: String?): IdentityProbeResult?
	}

	// The TXT id is only an optimization. A candidate claiming a saved id is probed with
	// that pin immediately; if an unhinted candidate later returns a saved id, repeat the
	// probe with the saved pin before admitting it.
	internal suspend fun identifyCandidate(
		candidate: Candidate,
		knownDeviceIds: Set<String>,
		requiredDeviceId: String? = null,
		allowsTailscaleHost: Boolean = false,
		probe: IdentityProbe? = null,
	): IdentifiedDevice? {
		val accepted = if (allowsTailscaleHost) candidate else localDiscoveryCandidate(candidate) ?: return null
		val prober = probe ?: IdentityProbe { host, expectedDeviceId ->
			try {
				verifiedLocalHttpsIdentity(host, expectedDeviceId)
			} catch (cancelled: CancellationException) {
				throw cancelled
			} catch (error: Exception) {
				null
			}
		}
		val hintedDeviceId = requiredDeviceId ?: accepted.id?.takeIf { it in knownDeviceIds }
		val attempted = HashSet<String>()
		for (host in listOf(accepted.host) + accepted.addresses) {
			if (!attempted.add(host)) continue
			coroutineContext.ensureActive()
			var verified = prober.probe(host, hintedDeviceId) ?: continue
			var identity = verified.discoveryInfo
			if (hintedDeviceId != null) {
				if (identity.id != hintedDeviceId) continue
			} else if (identity.id in knownDeviceIds) {
				// The authoritative response identified a saved device whose TXT hint did
				// not. Discard the first-use result unless its stored pin also validates.
				val pinned = prober.probe(host, identity.id) ?: continue
				if (pinned.discoveryInfo.id != identity.id) continue
				verified = pinned
				identity = pinned.discoveryInfo
			}
			return IdentifiedDevice(
				host = host,
				discoveryHost = accepted.host,
				addresses = accepted.addresses,
				name = accepted.name,
				id = identity.id,
				model = identity.device,
				onboarded = identity.onboarded,
				candidateCaCertificate = verified.candidateCertificate,
			)
		}
		return null
	}

	/**
	 * mDNS is an unauthenticated source of local connection candidates. Never let it
	 * introduce a Tailscale-range endpoint; those come only from the authenticated
	 * system.getIpAddresses response after sign-in.
	 */
	internal fun localDiscoveryCandidate(candidate: Candidate): Candidate? {
		if (SavedDevice.isTailscaleAddress(candidate.host)) return null
		return candidate.copy(addresses = candidate.addresses.filterNot(SavedDevice::isTailscaleAddress))
	}

	/** Probe a discovery snapshot concurrently and collapse duplicate records of one Umbrel. */
	suspend fun identify(candidates: List<Candidate>, knownDeviceIds: Set<String> = emptySet()): List<IdentifiedDevice> =
		coroutineScope {
			val results = candidates.map { candidate ->
				async {
					// Bounded like every other identification, however many addresses it tries
					withTimeoutOrNull(IDENTIFICATION_DEADLINE_MS) { identifyCandidate(candidate, knownDeviceIds) }
				}
			}.awaitAll()
			ensureActive()
			uniqueUmbrels(results.filterNotNull())
		}

	/**
	 * One record per Umbrel, the first by host. Records collapse only when the same anchor
	 * proved the same id: an id alone is unauthenticated, and another LAN device can claim it
	 * under its own CA.
	 */
	internal fun uniqueUmbrels(devices: List<IdentifiedDevice>): List<IdentifiedDevice> {
		val unique = mutableListOf<IdentifiedDevice>()
		for (device in devices.sortedBy { it.host }) {
			if (unique.none { it.isSameUmbrel(device) }) unique += device
		}
		return unique
	}

	// ── Manual discovery ──

	internal sealed class ManualDiscoveryHost(val value: String) {
		class Direct(host: String) : ManualDiscoveryHost(host)
		class UnqualifiedHostname(host: String) : ManualDiscoveryHost(host)
		class TailscaleDns(host: String) : ManualDiscoveryHost(host)
	}

	/**
	 * Manual discovery is an explicit user action, so unlike passive mDNS it may probe a
	 * Tailscale endpoint. A plain HTTP(S) root URL is normalized to its host. Short hostnames
	 * may resolve to a LAN or Tailscale address, while full MagicDNS names resolve only to a
	 * literal Tailscale address because Umbrel's pinned certificate covers its interface IP.
	 * If the identity check fails, only a public version older than 2.0 is reported as needing
	 * an update; a current version is asked once more and otherwise reported as unverified.
	 */
	suspend fun discoverManually(input: String, knownDeviceIds: Set<String> = emptySet()): ManualDiscoveryResult {
		val parsed = manualDiscoveryHostKind(input) ?: throw ManualDiscoveryException(ManualDiscoveryException.Kind.INVALID_ADDRESS)
		val candidate = when (parsed) {
			is ManualDiscoveryHost.Direct -> manualDiscoveryCandidate(input)
				?: throw ManualDiscoveryException(ManualDiscoveryException.Kind.INVALID_ADDRESS)
			else -> {
				val addresses = IPv4HostResolver.resolve(parsed.value)
				coroutineContext.ensureActive()
				if (addresses.isEmpty()) throw ManualDiscoveryException(ManualDiscoveryException.Kind.NO_DEVICE_FOUND)
				manualDiscoveryCandidate(input, addresses)
					?: throw ManualDiscoveryException(ManualDiscoveryException.Kind.NO_DEVICE_FOUND)
			}
		}
		return discoverManually(candidate, knownDeviceIds)
	}

	internal suspend fun discoverManually(
		candidate: Candidate,
		knownDeviceIds: Set<String>,
		identify: suspend (Candidate) -> HostIdentification = {
			identifyReportingFailure(it, knownDeviceIds, allowsTailscaleHost = true)
		},
		version: suspend (String) -> String? = ::fallbackVersion,
		retryDelayMillis: Long = QUIET_RETRY_DELAY_MS,
		attemptDeadlineMillis: Long = IDENTIFICATION_DEADLINE_MS,
	): ManualDiscoveryResult {
		val attempt = suspend { identifyWithinDeadline(candidate, attemptDeadlineMillis, identify) }
		var identification = attempt()
		coroutineContext.ensureActive()
		val unverified = (identification as? HostIdentification.Unverified)?.value ?: return manualResult(identification)
		val reported = version(candidate.host)
		coroutineContext.ensureActive()
		if (reported == null) throw ManualDiscoveryException(ManualDiscoveryException.Kind.NO_DEVICE_FOUND)
		if (requiresUpdate(reported)) return ManualDiscoveryResult.UpdateRequired(UpdateRequiredDevice(candidate.host))
		// A current Umbrel answered. One that failed unexpectedly may still be starting, so it's
		// asked once more; a slow one isn't, as that would only double the wait.
		if (unverified.reason == UnverifiedDevice.Reason.UNEXPECTED) {
			delay(retryDelayMillis)
			identification = attempt()
			coroutineContext.ensureActive()
		}
		return manualResult(identification)
	}

	private fun manualResult(identification: HostIdentification): ManualDiscoveryResult = when (identification) {
		is HostIdentification.Device -> ManualDiscoveryResult.Device(identification.value)
		is HostIdentification.Unverified -> ManualDiscoveryResult.Unverified(identification.value)
		// Explains itself: the saved Umbrel has to be removed and added again
		HostIdentification.SavedIdentityChanged ->
			throw LocalHttpsTransportException(LocalHttpsTransportException.Kind.IDENTITY_CHANGED)
	}

	internal fun manualDiscoveryCandidate(input: String, resolvedIPv4Addresses: List<String> = emptyList()): Candidate? =
		when (val parsed = manualDiscoveryHostKind(input)) {
			is ManualDiscoveryHost.Direct -> Candidate(host = parsed.value, name = parsed.value)
			is ManualDiscoveryHost.UnqualifiedHostname ->
				resolvedManualDiscoveryCandidate(parsed.value, resolvedIPv4Addresses, SavedDevice::isSupportedManualIPv4Address)
			is ManualDiscoveryHost.TailscaleDns ->
				resolvedManualDiscoveryCandidate(parsed.value, resolvedIPv4Addresses, SavedDevice::isTailscaleAddress)
			null -> null
		}

	private fun resolvedManualDiscoveryCandidate(
		hostname: String,
		addresses: List<String>,
		accepts: (String) -> Boolean,
	): Candidate? {
		val seen = HashSet<String>()
		val accepted = addresses.filter { accepts(it) && seen.add(it) }
		val host = accepted.firstOrNull() ?: return null
		return Candidate(host = host, addresses = accepted.drop(1), name = hostname)
	}

	internal fun manualDiscoveryHostValue(input: String): String? = manualDiscoveryHostKind(input)?.value

	internal fun manualDiscoveryHostKind(input: String): ManualDiscoveryHost? {
		var host = normalizedManualDiscoveryHost(input) ?: return null
		if (host.endsWith(".")) host = host.dropLast(1)
		if (host.isEmpty()) return null
		if (SavedDevice.isIPv4Address(host)) {
			return if (SavedDevice.isSupportedManualIPv4Address(host)) ManualDiscoveryHost.Direct(host) else null
		}
		if (SavedDevice.isBonjourHostname(host)) return ManualDiscoveryHost.Direct(host)
		if (!SavedDevice.isDNSHostname(host)) return null
		val labels = host.split('.')
		if (labels.size == 1) return ManualDiscoveryHost.UnqualifiedHostname(host)
		return if (host.endsWith(".ts.net")) ManualDiscoveryHost.TailscaleDns(host) else null
	}

	private fun normalizedManualDiscoveryHost(input: String): String? {
		val value = input.trim()
		val lowercased = value.lowercase()
		if (!lowercased.startsWith("http://") && !lowercased.startsWith("https://")) return lowercased
		val uri = try {
			URI(value)
		} catch (error: URISyntaxException) {
			return null
		}
		val scheme = uri.scheme?.lowercase()
		if (scheme != "http" && scheme != "https") return null
		val host = uri.host ?: return null
		if (uri.userInfo != null || uri.port != -1) return null
		if (!(uri.rawPath.isNullOrEmpty() || uri.rawPath == "/")) return null
		if (uri.rawQuery != null || uri.rawFragment != null) return null
		if (host.startsWith("[")) return null
		return host.lowercase()
	}

	// ── Fallback discovery ──

	/**
	 * Older umbrelOS releases predate the _umbrel._tcp advertisement, and some networks answer
	 * .local hostname lookups while filtering mDNS service browsing. Only this small set of
	 * default and common hostnames is probed, in parallel; a custom hostname outside it remains
	 * undiscoverable rather than turning onboarding into a subnet scanner.
	 */
	internal val fallbackDiscoveryHosts = listOf(
		"umbrel.local",
		"umbrel-2.local",
		"umbrel-3.local",
		"umbrel-4.local",
		"umbrel-5.local",
		"umbrel-home.local",
		"umbrel-pro.local",
	)

	/**
	 * The longest a fallback scan takes: the version probes with a second's grace for their
	 * timer, resolving a host's addresses, an identification attempt, the quiet retry and a
	 * second attempt. Screens that wait for it use this.
	 */
	const val FALLBACK_DISCOVERY_TIME_LIMIT_MS: Long = LocalHttpsTransport.FALLBACK_DISCOVERY_TIMEOUT_MS + 1_000 +
		FALLBACK_ADDRESS_TIMEOUT_MS + IDENTIFICATION_DEADLINE_MS * 2 + QUIET_RETRY_DELAY_MS

	/**
	 * Runs beside normal discovery. A host whose public version endpoint reports umbrelOS 2.0 or
	 * later is then identified exactly like an mDNS candidate, so a current Umbrel still appears
	 * when mDNS misses it; one that can't prove its identity is reported as unverified. Only an
	 * older version becomes an update hint, handed to [onUpdateRequired] as soon as the version
	 * probes finish; the result's hints also carry the addresses where that version answered.
	 * The plaintext version response never creates trust, stores state, or enables
	 * authentication.
	 */
	suspend fun discoverFallbackHosts(
		knownDeviceIds: Set<String> = emptySet(),
		onUpdateRequired: suspend (List<UpdateRequiredDevice>) -> Unit = {},
	): FallbackDiscoveryResult = discoverFallbackHosts(
		knownDeviceIds,
		version = ::fallbackVersion,
		candidate = ::fallbackCandidate,
		identify = { candidate, ids -> identifyReportingFailure(candidate, ids) },
		retryDelayMillis = QUIET_RETRY_DELAY_MS,
		attemptDeadlineMillis = IDENTIFICATION_DEADLINE_MS,
		onUpdateRequired = onUpdateRequired,
	)

	/** Try again for an Umbrel the fallback scan reported as unverified. */
	suspend fun identify(device: UnverifiedDevice, knownDeviceIds: Set<String> = emptySet()): HostIdentification =
		identifyWithinDeadline(fallbackCandidate(device.host), IDENTIFICATION_DEADLINE_MS) { identifyReportingFailure(it, knownDeviceIds) }

	internal suspend fun discoverFallbackHosts(
		knownDeviceIds: Set<String>,
		version: suspend (host: String) -> String?,
		candidate: suspend (host: String) -> Candidate,
		identify: suspend (Candidate, Set<String>) -> HostIdentification,
		retryDelayMillis: Long,
		attemptDeadlineMillis: Long,
		onUpdateRequired: suspend (List<UpdateRequiredDevice>) -> Unit,
	): FallbackDiscoveryResult = coroutineScope {
		val answered = fallbackDiscoveryHosts.map { host -> async { version(host)?.let { host to it } } }.awaitAll().filterNotNull()
		ensureActive()
		val (older, current) = answered.partition { (_, reported) -> requiresUpdate(reported) }

		val identifying = current.map { (host, _) ->
			async {
				val resolved = candidate(host)
				identifyWithQuietRetry(retryDelayMillis) {
					identifyWithinDeadline(resolved, attemptDeadlineMillis) { identify(it, knownDeviceIds) }
				}
			}
		}

		// Beside the identity checks, an older Umbrel's name resolves as a current Umbrel's does.
		// A current Umbrel can answer to the same name, so only an address that reports the older
		// version too is the older Umbrel's.
		val confirming = older.map { (host, _) ->
			async {
				val addresses = candidate(host).addresses
					.map { address -> async { address.takeIf { version(address)?.let(::requiresUpdate) == true } } }
					.awaitAll()
					.filterNotNull()
				UpdateRequiredDevice(host, addresses)
			}
		}

		// Older Umbrels need nothing more, so they show now, not after the identity checks
		onUpdateRequired(older.map { (host, _) -> UpdateRequiredDevice(host) }.sortedBy { it.host })

		val identifications = identifying.awaitAll()
		val updateRequired = confirming.awaitAll().sortedBy { it.host }
		ensureActive()

		// A saved Umbrel whose certificate changed is left to the saved device's own handling.
		val devices = uniqueUmbrels(identifications.mapNotNull { (it as? HostIdentification.Device)?.value })
		// A second name for an Umbrel that did prove itself isn't a separate failure
		val verifiedLocations = devices.flatMap { listOf(it.host, it.discoveryHost) + it.addresses }.map { it.lowercase() }.toSet()
		val unverified = identifications.mapNotNull { (it as? HostIdentification.Unverified)?.value }
			.filterNot { device -> (listOf(device.host) + device.addresses).any { it.lowercase() in verifiedLocations } }
			.sortedBy { it.host }
		FallbackDiscoveryResult(devices, unverified, updateRequired)
	}

	/**
	 * Identifies a candidate as [identifyCandidate] does, and says why it failed. An attempt that
	 * ran out of time means the Umbrel is slow; once it has answered and then run out of time,
	 * its other addresses would only wait the same way, so they're skipped.
	 */
	internal suspend fun identifyReportingFailure(
		candidate: Candidate,
		knownDeviceIds: Set<String>,
		allowsTailscaleHost: Boolean = false,
		verify: suspend (host: String, expectedDeviceId: String?) -> IdentityProbeResult = ::verifiedLocalHttpsIdentity,
	): HostIdentification {
		// identifyCandidate probes one host at a time, so these need no lock.
		var timedOut = false
		var answeredSlowly = false
		var failedSavedPin = false
		val device = identifyCandidate(
			candidate,
			knownDeviceIds,
			allowsTailscaleHost = allowsTailscaleHost,
			probe = IdentityProbe { host, expectedDeviceId ->
				if (answeredSlowly) return@IdentityProbe null
				try {
					verify(host, expectedDeviceId)
				} catch (cancelled: CancellationException) {
					throw cancelled
				} catch (slow: IdentityResponseTimeoutException) {
					timedOut = true
					answeredSlowly = true
					null
				} catch (error: Exception) {
					if (error is Error && error.timedOut) {
						timedOut = true
					} else if (expectedDeviceId != null && rejectsPin(error)) {
						// These candidates carry no TXT hint, so a pinned probe only follows a
						// first-use proof of a saved id. Only a rejected pin means its identity
						// changed; a refused connection or unreadable storage is temporary.
						failedSavedPin = true
					}
					null
				}
			},
		)
		if (device != null) return HostIdentification.Device(device)
		if (failedSavedPin) return HostIdentification.SavedIdentityChanged
		val reason = if (timedOut) UnverifiedDevice.Reason.SLOW else UnverifiedDevice.Reason.UNEXPECTED
		return HostIdentification.Unverified(UnverifiedDevice(candidate.host, candidate.addresses, reason))
	}

	/**
	 * Whether a pinned probe failed because the pin rejected the Umbrel: it answered under the
	 * pinned CA with another id, or with a certificate the pinned CA didn't issue. The pinned
	 * probe follows a first-use proof on the same host, which showed the certificate is valid
	 * under the CA the host advertised, so a certificate the pin refuses is one it didn't issue.
	 */
	private fun rejectsPin(error: Exception): Boolean =
		isIdentityChange(error) ||
			(error is Error && error.kind == ErrorKind.TRUST && error.message == LocalHttpsTransportException.Kind.TRUST_FAILED.description)

	/**
	 * One identification attempt, bounded as a whole: however many addresses it tries, a host
	 * that hasn't proven itself by the deadline is reported as slow.
	 */
	internal suspend fun identifyWithinDeadline(
		candidate: Candidate,
		deadlineMillis: Long,
		identify: suspend (Candidate) -> HostIdentification,
	): HostIdentification = withTimeoutOrNull(deadlineMillis) { identify(candidate) }
		?: HostIdentification.Unverified(UnverifiedDevice(candidate.host, candidate.addresses, UnverifiedDevice.Reason.SLOW))

	/**
	 * Asks once more after a moment when an attempt failed in an unexpected way, as an Umbrel
	 * that's still starting can refuse connections briefly. A slow Umbrel isn't asked again:
	 * that would only double the wait.
	 */
	internal suspend fun identifyWithQuietRetry(retryDelayMillis: Long, attempt: suspend () -> HostIdentification): HostIdentification {
		val first = attempt()
		if ((first as? HostIdentification.Unverified)?.value?.reason != UnverifiedDevice.Reason.UNEXPECTED) return first
		delay(retryDelayMillis)
		return attempt()
	}

	// Shaped like an mDNS candidate: the hostname, then its IPv4 addresses in case the hostname's
	// own route fails while an address works
	private suspend fun fallbackCandidate(host: String): Candidate {
		val addresses = IPv4HostResolver.resolve(host, FALLBACK_ADDRESS_TIMEOUT_MS)
		return Candidate(host = host, addresses = addresses.filter(SavedDevice::isSupportedManualIPv4Address), name = fallbackDeviceName(host))
	}

	// mDNS names an Umbrel after its hostname, so "umbrel-2.local" becomes "umbrel-2"
	internal fun fallbackDeviceName(host: String): String = host.removeSuffix(".local")

	/**
	 * umbrelOS 2.0 introduced everything the apps need to connect: the _umbrel._tcp
	 * advertisement, system.localHttpsIdentity and system.discoveryInfo. Its betas shipped them
	 * too, so only the major version decides. A version that can't be read is never reported as
	 * too old.
	 *
	 * A default name such as umbrel.local is often an alias that a current Umbrel also answers
	 * to, sometimes only over a flaky IPv6 link-local route, so neither hostname matching nor a
	 * failed identity probe shows a host is old. The version it reports does: a current Umbrel
	 * reports 2.0 or later.
	 */
	internal fun requiresUpdate(version: String): Boolean {
		val major = version.takeWhile { it in '0'..'9' }.toIntOrNull() ?: return false
		return major < 2
	}

	@Serializable
	private data class SystemVersion(val version: String, val name: String)

	internal suspend fun fallbackVersion(host: String): String? {
		coroutineContext.ensureActive()
		return try {
			systemVersion(host)
		} catch (cancelled: CancellationException) {
			throw cancelled
		} catch (error: Exception) {
			null
		}
	}

	private suspend fun systemVersion(host: String): String {
		val request = LocalHttpsTransport.request(plainUrl(host, "/trpc/system.version")).build()
		val result = LocalHttpsTransport.fallbackDiscoveryData(request, FALLBACK_RESPONSE_MAXIMUM_BYTES)
		return validateFallbackSystemVersion(result)
	}

	// system.version has returned both fields since umbrelOS 1.0. Requiring its stable product
	// name avoids mistaking an unrelated service for an Umbrel. The version is still only an
	// untrusted HTTP hint; native identity is established elsewhere.
	internal fun validateFallbackSystemVersion(result: HttpResult): String {
		val response: SystemVersion = decodeEnvelope(result, "system.version")
		if (!response.name.startsWith("umbrelOS ") || response.version.isEmpty() ||
			response.version.toByteArray(Charsets.UTF_8).size > 64
		) {
			throw Error(result.status, "system.version: not an umbrelOS response")
		}
		return response.version
	}

	// ── Wallpaper and avatars ──

	suspend fun wallpaperData(host: String, deviceId: String, id: String, rendition: WallpaperImageRendition): ByteArray {
		if (id.isEmpty() || !id.all { it in '0'..'9' }) throw Error(0, "Invalid wallpaper id: $id")
		val request = Request.Builder().url(httpsUrl(host, rendition.path(id))).build()
		val result = guardTransport(host, protocolFailureMessage = "Couldn’t load the wallpaper") {
			LocalHttpsTransport.data(request, deviceId, REQUEST_TIMEOUT_MS)
		}
		if (result.status !in 200..299) throw Error(0, "Couldn’t load the wallpaper")
		return result.body
	}

	suspend fun wallpaperData(target: Target, id: String, rendition: WallpaperImageRendition): ByteArray =
		withResolvedHost(target, ReplayPolicy.SAFE) { host -> wallpaperData(host, target.deviceId, id, rendition) }

	suspend fun accountAvatarData(target: Target, path: String): ByteArray {
		if (!isValidAccountAvatarPath(path)) throw Error(0, "Invalid account avatar path", ErrorKind.PROTOCOL_FAILURE)
		return withResolvedHost(target, ReplayPolicy.SAFE) { host ->
			val request = LocalHttpsTransport.request(httpsUrl(host, path)).header("Accept", "image/webp").build()
			val result = guardTransport(host, protocolFailureMessage = "Couldn’t load the account avatar") {
				LocalHttpsTransport.data(request, target.deviceId, REQUEST_TIMEOUT_MS)
			}
			if (result.status !in 200..299 || !result.contentType.equals("image/webp", ignoreCase = true) ||
				result.body.size > 4 * 1024 * 1024
			) {
				throw Error(0, "Couldn’t load the account avatar", ErrorKind.PROTOCOL_FAILURE)
			}
			result.body
		}
	}

	/**
	 * Only accept the exact same-origin route emitted by umbreld. Reject absolute URLs,
	 * queries, fragments, and path traversal before combining server-provided presentation
	 * data with a verified Umbrel host.
	 */
	internal fun isValidAccountAvatarPath(path: String): Boolean {
		val segments = path.split('/')
		if (segments.size != 6) return false
		if (segments[0].isNotEmpty() || segments[1] != "api" || segments[2] != "accounts" || segments[4] != "avatar") return false
		if (!isValidAccountIdSegment(segments[3])) return false
		val filename = segments[5]
		if (filename.length != 69 || !filename.endsWith(".webp")) return false
		return filename.substring(0, 64).all { it in '0'..'9' || it in 'a'..'f' }
	}

	private fun isValidAccountIdSegment(segment: String): Boolean {
		if (segment.isEmpty() || !segment.first().isLetterOrDigitAscii() || !segment.last().isLetterOrDigitAscii()) return false
		var previousWasHyphen = false
		for (c in segment) {
			if (c == '-') {
				if (previousWasHyphen) return false
				previousWasHyphen = true
			} else {
				if (!c.isLetterOrDigitAscii()) return false
				previousWasHyphen = false
			}
		}
		return true
	}

	private fun Char.isLetterOrDigitAscii(): Boolean = this in '0'..'9' || this in 'A'..'Z' || this in 'a'..'z'

	// ── Endpoints ──

	suspend fun is2faEnabled(host: String, deviceId: String): Boolean = query(host, "user.is2faEnabled", deviceId = deviceId)
	suspend fun is2faEnabled(target: Target): Boolean =
		withResolvedHost(target, ReplayPolicy.SAFE) { is2faEnabled(it, target.deviceId) }

	/** Public by design: presentation metadata only, never account credentials. */
	suspend fun listAccounts(host: String, deviceId: String): List<Account> = query(host, "user.listAccounts", deviceId = deviceId)
	suspend fun listAccounts(target: Target): List<Account> =
		withResolvedHost(target, ReplayPolicy.SAFE) { listAccounts(it, target.deviceId) }

	/**
	 * A drive the Umbrel can see. Only what decides whether first-time setup offers RAID is
	 * decoded.
	 */
	@Serializable
	data class InternalStorageDevice(val id: String? = null, val isSystemDrive: Boolean? = null) {
		/**
		 * umbrelOS offers a drive for RAID when it has an id and isn't the drive umbrelOS runs
		 * from (getEligibleStorageDevices in packages/ui).
		 */
		val isRaidCandidate: Boolean get() = !id.isNullOrEmpty() && isSystemDrive != true
	}

	/** Answered without signing in only until the Umbrel has its first account. */
	suspend fun internalStorageDevices(target: Target): List<InternalStorageDevice> =
		withResolvedHost(target, ReplayPolicy.SAFE) { query(it, "hardware.internalStorage.getDevices", deviceId = target.deviceId) }

	@Serializable
	internal data class NativeLoginInput(
		val userId: String,
		val password: String,
		val totpToken: String? = null,
		val client: NativeClientInfo = NativeClientInfo.current,
	)

	@Serializable
	internal data class NativeRefreshInput(
		val deviceToken: String,
		val client: NativeClientInfo = NativeClientInfo.current,
		// Left out unless asked for, so a plain refresh reads exactly as it always has.
		val browserSession: Boolean? = null,
	)

	@Serializable
	internal data class PhotoBackupGrantInput(val sourceId: String, val suggestedName: String)

	@Serializable
	internal data class PhotoBackupResourceReceiptInput(val sourceId: String, val resources: List<PhotoBackupResourceQuery>)

	@Serializable
	internal data class HideCredentialsInput(val appId: String, val value: Boolean)

	@Serializable
	internal data class AddShareInput(val path: String)

	@Serializable
	internal class EmptyInput

	@Serializable
	internal data class NativeSessionResponse(
		val accountId: String,
		val accessToken: String,
		val accessExpiresAt: Long,
		val deviceToken: String,
	) {
		fun session(deviceId: String) = Session(deviceId, accountId, accessToken, accessExpiresAt, deviceToken)
	}

	@Serializable
	internal data class NativeAccessResponse(
		val accessToken: String,
		val accessExpiresAt: Long,
		// Only when a browser session was asked for, and umbrelOS can make one.
		val dashboardToken: String? = null,
	)

	/** A renewed native session, and the browser session made with it, if one was. */
	data class NativeRefresh(val session: Session, val browserSession: BrowserSession?)

	/** Native apps receive a revocable device grant instead of a browser session. */
	suspend fun login(host: String, deviceId: String, userId: String = "0", password: String, totpToken: String?): Session {
		val body = json.encodeToString(NativeLoginInput.serializer(), NativeLoginInput(userId, password, totpToken))
		val result = requestRaw(host, "user.loginNative", "POST", deviceId, null, body, REQUEST_TIMEOUT_MS)
		return decodeEnvelope<NativeSessionResponse>(result, "user.loginNative").session(deviceId)
	}

	suspend fun login(target: Target, userId: String = "0", password: String, totpToken: String?): Session =
		withResolvedHost(target, ReplayPolicy.NEVER) { login(it, target.deviceId, userId, password, totpToken) }

	/** Ensure a usable access credential on app activation. */
	suspend fun renewSession(host: String, session: Session): Session = coordinator.session(host, session)
	suspend fun renewSession(target: Target, session: Session): Session =
		withResolvedHost(target, ReplayPolicy.SAFE) { renewSession(it, session) }

	/**
	 * A browser session for the in-app browser, made from the app's own sign-in so the
	 * browser never asks for the password. umbrelOS links the two: they show as one login
	 * and end together. Each one replaces the last, and making one also renews access.
	 * Null when umbrelOS can't make them: an older one ignores the request and only renews.
	 */
	suspend fun makeBrowserSession(target: Target, session: Session): BrowserSession? =
		// Each refresh replaces the last one's browser session, so a retry is safe too.
		withResolvedHost(target, ReplayPolicy.SAFE) { coordinator.browserSession(it, session) }

	/**
	 * The same for a sign-in that isn't stored yet. Its access is renewed, so the session
	 * returned takes the place of the one passed in.
	 */
	suspend fun makeBrowserSessionSigningIn(target: Target, session: Session): NativeRefresh =
		withResolvedHost(target, ReplayPolicy.SAFE) { refreshDirect(it, session, browserSession = true) }

	suspend fun logout(host: String, session: Session) {
		val body = json.encodeToString(EmptyInput.serializer(), EmptyInput())
		var active = session
		var result = performRequestRaw(host, "user.logout", "POST", active.deviceId, active.accessToken, body, REQUEST_TIMEOUT_MS)
		if (result.status == 401) {
			// A caller may remove the local secret before this best-effort request. Refresh
			// from the captured device credential without storing anything.
			active = try {
				refreshSessionDirect(host, active)
			} catch (error: Error) {
				// Already ended: logging out its browser session ends it too.
				if (error.isAuthError) return
				throw error
			}
			result = performRequestRaw(host, "user.logout", "POST", active.deviceId, active.accessToken, body, REQUEST_TIMEOUT_MS)
		}
		decodeEnvelope<Boolean>(result, "user.logout")
	}

	suspend fun logout(target: Target, session: Session) {
		withResolvedHost(target, ReplayPolicy.NEVER) { logout(it, session); true }
	}

	/** Signing out keeps the enrolled CA. Removing the Umbrel discards first-use trust. */
	fun forgetLocalHttpsIdentity(deviceId: String) = LocalHttpsTransport.forget(deviceId)

	suspend fun createPhotoBackupGrant(host: String, session: Session, sourceId: String, suggestedName: String): PhotoBackupGrant =
		mutate(host, "photos.createBackupGrant", json.encodeToString(PhotoBackupGrantInput.serializer(), PhotoBackupGrantInput(sourceId, suggestedName)), session)

	suspend fun createPhotoBackupGrant(target: Target, session: Session, sourceId: String, suggestedName: String): PhotoBackupGrant =
		withResolvedHost(target, ReplayPolicy.NEVER) { createPhotoBackupGrant(it, session, sourceId, suggestedName) }

	suspend fun revokePhotoBackupGrant(host: String, session: Session) {
		mutate<Boolean>(host, "photos.revokeBackupGrant", json.encodeToString(EmptyInput.serializer(), EmptyInput()), session)
	}

	suspend fun revokePhotoBackupGrant(target: Target, session: Session) {
		withResolvedHost(target, ReplayPolicy.SAFE) { revokePhotoBackupGrant(it, session); true }
	}

	suspend fun confirmedPhotoBackupResources(
		host: String,
		session: Session,
		sourceId: String,
		resources: List<PhotoBackupResourceQuery>,
	): List<PhotoBackupResourceReceipt> = mutate(
		host,
		"photos.confirmedBackupResources",
		json.encodeToString(PhotoBackupResourceReceiptInput.serializer(), PhotoBackupResourceReceiptInput(sourceId, resources)),
		session,
	)

	suspend fun confirmedPhotoBackupResources(
		target: Target,
		session: Session,
		sourceId: String,
		resources: List<PhotoBackupResourceQuery>,
	): List<PhotoBackupResourceReceipt> {
		if (resources.isEmpty()) return emptyList()
		return withResolvedHost(target, ReplayPolicy.SAFE) { confirmedPhotoBackupResources(it, session, sourceId, resources) }
	}

	// The server totals the whole library for this, which can take a while
	suspend fun photoSources(host: String, session: Session): List<PhotoSourceSummary> =
		query(host, "photos.sources.list", session = session, timeoutMillis = 30_000)

	suspend fun photoSources(target: Target, session: Session): List<PhotoSourceSummary> =
		withResolvedHost(target, ReplayPolicy.SAFE) { photoSources(it, session) }

	suspend fun user(host: String, session: Session): UserInfo = query(host, "user.get", session = session)
	suspend fun user(target: Target, session: Session): UserInfo = withResolvedHost(target, ReplayPolicy.SAFE) { user(it, session) }

	suspend fun ipAddresses(host: String, session: Session): List<String> = query(host, "system.getIpAddresses", session = session)
	suspend fun ipAddresses(target: Target, session: Session): List<String> =
		withResolvedHost(target, ReplayPolicy.SAFE) { ipAddresses(it, session) }

	suspend fun tailscaleBrowserHostname(host: String, session: Session): String? =
		query(host, "system.getTailscaleBrowserHostname", session = session)

	suspend fun tailscaleBrowserHostname(target: Target, session: Session): String? =
		withResolvedHost(target, ReplayPolicy.SAFE) { tailscaleBrowserHostname(it, session) }

	suspend fun apps(host: String, session: Session): List<AppSummary> = query(host, "apps.list", session = session)
	suspend fun apps(target: Target, session: Session): List<AppSummary> =
		withResolvedHost(target, ReplayPolicy.SAFE) { apps(it, session) }

	suspend fun hideCredentialsBeforeOpen(host: String, session: Session, appId: String) {
		mutate<JsonElement>(host, "apps.hideCredentialsBeforeOpen", json.encodeToString(HideCredentialsInput.serializer(), HideCredentialsInput(appId, true)), session)
	}

	suspend fun hideCredentialsBeforeOpen(target: Target, session: Session, appId: String) {
		withResolvedHost(target, ReplayPolicy.NEVER) { hideCredentialsBeforeOpen(it, session, appId); true }
	}

	suspend fun appUpdates(host: String, session: Session): List<AppUpdate> = query(host, "apps.updates", session = session)
	suspend fun appUpdates(target: Target, session: Session): List<AppUpdate> =
		withResolvedHost(target, ReplayPolicy.SAFE) { appUpdates(it, session) }

	suspend fun diskUsage(host: String, session: Session): DiskUsage = query(host, "system.diskUsage", session = session)
	suspend fun diskUsage(target: Target, session: Session): DiskUsage =
		withResolvedHost(target, ReplayPolicy.SAFE) { diskUsage(it, session) }

	suspend fun favorites(host: String, session: Session): List<String> = query(host, "files.favorites", session = session)
	suspend fun favorites(target: Target, session: Session): List<String> =
		withResolvedHost(target, ReplayPolicy.SAFE) { favorites(it, session) }

	suspend fun shares(host: String, session: Session): List<Share> = query(host, "files.shares", session = session)
	suspend fun shares(target: Target, session: Session): List<Share> =
		withResolvedHost(target, ReplayPolicy.SAFE) { shares(it, session) }

	suspend fun sharePassword(host: String, session: Session): String = query(host, "files.sharePassword", session = session)
	suspend fun sharePassword(target: Target, session: Session): String =
		withResolvedHost(target, ReplayPolicy.SAFE) { sharePassword(it, session) }

	suspend fun addShare(host: String, session: Session, path: String) {
		mutate<JsonElement>(host, "files.addShare", json.encodeToString(AddShareInput.serializer(), AddShareInput(path)), session)
	}

	suspend fun addShare(target: Target, session: Session, path: String) {
		withResolvedHost(target, ReplayPolicy.NEVER) { addShare(it, session, path); true }
	}

	/**
	 * Browser routing has more hostname choices than native transport, but keeps the same
	 * identity rule: a name or address is usable only when the public identity endpoint
	 * reports the saved device id. No session or other secret is sent here. Over HTTPS it
	 * trusts only the certificates the phone's browser trusts. system.localHttpsIdentity
	 * answers over HTTP and HTTPS on every umbrelOS 2.0 and does no work beyond reading the
	 * id, so these short timeouts don't cut off a busy Umbrel.
	 */
	suspend fun isBrowserEndpoint(
		host: String,
		expectedDeviceId: String,
		timeoutMillis: Long = 3_000,
		secure: Boolean = false,
	): Boolean = try {
		val request = if (secure) LocalHttpsTransport.request(httpsUrl(host, "/trpc/system.localHttpsIdentity")).build()
		else LocalHttpsTransport.request(plainUrl(host, "/trpc/system.localHttpsIdentity")).build()
		val result = if (secure) LocalHttpsTransport.browserTrustData(request, FALLBACK_RESPONSE_MAXIMUM_BYTES, timeoutMillis)
		else LocalHttpsTransport.fallbackDiscoveryData(request, FALLBACK_RESPONSE_MAXIMUM_BYTES, timeoutMillis)
		decodeEnvelope<LocalHttpsIdentity>(result, "system.localHttpsIdentity").id == expectedDeviceId
	} catch (cancelled: CancellationException) {
		throw cancelled
	} catch (error: Exception) {
		false
	}

	// ── Plumbing ──

	/**
	 * Returns an origin only after that host proves the saved Umbrel's pinned HTTPS
	 * identity. No password, session token, or other credential is sent by this step.
	 */
	suspend fun resolvedHost(target: Target): String = when (storedLocalHttpsCa(target.deviceId)) {
		is SecretStore.LocalHttpsCaReadResult.Found -> resolvePinnedHost(target)
		is SecretStore.LocalHttpsCaReadResult.Missing -> throw transportError(LocalHttpsTransportException.Kind.NOT_ENROLLED)
		is SecretStore.LocalHttpsCaReadResult.Unavailable ->
			throw Error(0, LocalHttpsTransportException.Kind.STORAGE_UNAVAILABLE.description, ErrorKind.STORAGE)
	}

	/** A network change does not establish reachability; forget the cached winner so the next
	 * request re-verifies every known endpoint. */
	fun invalidateResolvedHost(target: Target) = endpointResolver.invalidate(target.deviceId)

	private suspend fun resolvePinnedHost(target: Target, excludedHost: String? = null): String = try {
		endpointResolver.resolve(target, { host, deviceId -> verifyEndpoint(host, deviceId) }, excludedHost)
	} catch (cancelled: CancellationException) {
		throw cancelled
	} catch (rejection: EndpointRejectionException) {
		throw endpointError(rejection)
	} catch (error: Exception) {
		throw Error(0, "Could not reach this Umbrel", ErrorKind.CONNECTIVITY)
	}

	private suspend fun verifyEndpoint(host: String, expectedDeviceId: String): EndpointVerification = try {
		// Treat every endpoint as an untrusted route. The device's pinned CA, not the shape
		// of its address, proves where native credentials may be sent.
		requirePinnedIdentity(host, expectedDeviceId)
		EndpointVerification.Verified
	} catch (cancelled: CancellationException) {
		EndpointVerification.Unavailable
	} catch (error: LocalHttpsTransportException) {
		if (error.kind == LocalHttpsTransportException.Kind.STORAGE_UNAVAILABLE) {
			EndpointVerification.Rejected(EndpointRejectionKind.STORAGE, error.message ?: "")
		} else {
			EndpointVerification.Rejected(EndpointRejectionKind.TRUST, error.message ?: "")
		}
	} catch (error: Error) {
		when (error.kind) {
			ErrorKind.CONNECTIVITY -> EndpointVerification.Unavailable
			ErrorKind.TRUST -> EndpointVerification.Rejected(EndpointRejectionKind.TRUST, error.message ?: "")
			ErrorKind.STORAGE -> EndpointVerification.Rejected(EndpointRejectionKind.STORAGE, error.message ?: "")
			else -> EndpointVerification.Rejected(EndpointRejectionKind.PROTOCOL_FAILURE, error.message ?: "")
		}
	} catch (error: Exception) {
		EndpointVerification.Rejected(EndpointRejectionKind.PROTOCOL_FAILURE, error.message ?: "")
	}

	private fun endpointError(rejection: EndpointRejectionException): Error = when (rejection.kind) {
		EndpointRejectionKind.TRUST -> Error(0, rejection.message ?: "", ErrorKind.TRUST)
		EndpointRejectionKind.STORAGE -> Error(0, rejection.message ?: "", ErrorKind.STORAGE)
		EndpointRejectionKind.PROTOCOL_FAILURE -> Error(0, rejection.message ?: "", ErrorKind.PROTOCOL_FAILURE)
	}

	internal enum class ReplayPolicy { SAFE, NEVER }

	internal suspend fun <T> withResolvedHost(target: Target, replay: ReplayPolicy, operation: suspend (String) -> T): T {
		val host = resolvedHost(target)
		try {
			return operation(host)
		} catch (error: Error) {
			if (!error.isConnectivityFailure) throw error
			endpointResolver.invalidate(target.deviceId, host)
			if (replay != ReplayPolicy.SAFE) throw error
			val alternate = try {
				resolvePinnedHost(target, excludedHost = host)
			} catch (cancelled: CancellationException) {
				throw cancelled
			} catch (resolution: Error) {
				if (!resolution.isConnectivityFailure) throw resolution
				throw error
			} catch (other: Exception) {
				throw error
			}
			try {
				return operation(alternate)
			} catch (alternateError: Error) {
				if (alternateError.isConnectivityFailure) endpointResolver.invalidate(target.deviceId, alternate)
				throw alternateError
			}
		}
	}

	/**
	 * Serializes access-token refreshes per login. refreshNativeAccess invalidates the
	 * previous access token immediately, so concurrent requests must share one refresh and
	 * retry a 401 exactly once after re-reading the stored session.
	 */
	internal class SessionCoordinator(
		private val read: (String) -> SecretStore.SessionReadResult = SecretStore::readSession,
		private val replace: (Session, Session) -> Boolean = SecretStore::replaceSession,
		private val delete: (Session) -> Unit = { SecretStore.deleteSession(it) },
		private val refresh: suspend (String, Session) -> Session = ::refreshSessionDirect,
		private val mint: suspend (String, Session) -> NativeRefresh = { host, session ->
			refreshDirect(host, session, browserSession = true)
		},
	) {
		private data class LoginIdentity(val deviceId: String, val accountId: String, val deviceToken: String)

		// Every refresh replaces the access credential, so a login has one at a time. One that
		// made a browser session serves a plain refresh as well.
		private class Pending(val result: Deferred<NativeRefresh>, val makesBrowserSession: Boolean)

		private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
		private val lock = Any()
		private val refreshTasks = HashMap<LoginIdentity, Pending>()

		suspend fun session(
			host: String,
			supplied: Session,
			forceRefresh: Boolean = false,
			rejectedAccessToken: String? = null,
		): Session {
			// Reading the stored session and joining or starting a refresh happen under one
			// lock, and a refresh stores its result before it leaves refreshTasks. A caller
			// therefore never acts on a session that an earlier refresh already replaced,
			// which would revoke the token that refresh handed out. The read blocks on
			// Keystore decryption, so this runs on the IO dispatcher.
			val pending = withContext(Dispatchers.IO) {
				synchronized(lock) { currentOrRefresh(host, supplied, forceRefresh, rejectedAccessToken) }
			}
			return pending.await().session
		}

		suspend fun browserSession(host: String, supplied: Session): BrowserSession? {
			while (true) {
				val pending = withContext(Dispatchers.IO) {
					synchronized(lock) {
						val stored = read(supplied.deviceId)
						val current = stored.sessionOrCached
						if (current == null || !current.belongsToSameLogin(supplied)) throw Error(401, "This account is no longer signed in")
						if (stored is SecretStore.SessionReadResult.Unavailable) {
							throw Error(0, "Session storage is temporarily unavailable", ErrorKind.STORAGE)
						}
						val identity = LoginIdentity(current.deviceId, current.accountId, current.deviceToken)
						refreshTasks[identity] ?: start(host, current, identity, makesBrowserSession = true)
					}
				}
				val refreshed = pending.result.await()
				// A plain refresh can't serve a browser session. It's finished now, so ask again.
				if (pending.makesBrowserSession) return refreshed.browserSession
			}
		}

		/** Must be called holding [lock]. */
		private fun currentOrRefresh(
			host: String,
			supplied: Session,
			forceRefresh: Boolean,
			rejectedAccessToken: String?,
		): Deferred<NativeRefresh> {
			val stored = read(supplied.deviceId)
			val current = stored.sessionOrCached
			if (current == null || !current.belongsToSameLogin(supplied)) throw Error(401, "This account is no longer signed in")
			// Another request may already have replaced the rejected credential while this one
			// waited; reuse that result instead of refreshing twice.
			if (rejectedAccessToken != null && current.accessToken != rejectedAccessToken) {
				return CompletableDeferred(NativeRefresh(current, null))
			}
			val now = System.currentTimeMillis()
			if (!forceRefresh && current.accessExpiresAt > now + REFRESH_LEEWAY_MS) return CompletableDeferred(NativeRefresh(current, null))
			// Refreshing replaces the active access credential, so do not do it while the
			// result cannot be stored durably.
			if (stored is SecretStore.SessionReadResult.Unavailable) {
				throw Error(0, "Session storage is temporarily unavailable", ErrorKind.STORAGE)
			}
			val identity = LoginIdentity(current.deviceId, current.accountId, current.deviceToken)
			return (refreshTasks[identity] ?: start(host, current, identity, makesBrowserSession = false)).result
		}

		/** Must be called holding [lock]. */
		private fun start(host: String, current: Session, identity: LoginIdentity, makesBrowserSession: Boolean): Pending =
			Pending(
				scope.async {
					try {
						val refreshed = if (makesBrowserSession) mint(host, current) else NativeRefresh(refresh(host, current), null)
						if (!replace(refreshed.session, current)) {
							throw Error(0, "Couldn’t save the renewed session", ErrorKind.STORAGE)
						}
						refreshed
					} catch (error: Error) {
						if (error.isAuthError) delete(current)
						throw error
					} finally {
						synchronized(lock) { refreshTasks.remove(identity) }
					}
				},
				makesBrowserSession,
			).also { refreshTasks[identity] = it }

		companion object {
			private const val REFRESH_LEEWAY_MS = 60_000L
		}
	}

	private suspend inline fun <reified T> query(
		host: String,
		path: String,
		deviceId: String? = null,
		session: Session? = null,
		timeoutMillis: Long = REQUEST_TIMEOUT_MS,
	): T = decodeEnvelope(requestRaw(host, path, "GET", deviceId, session, null, timeoutMillis), path)

	/** tRPC queries carry their input as a JSON string in the `input` query parameter. */
	@Suppress("unused")
	private suspend inline fun <reified T> queryWithInput(
		host: String,
		path: String,
		input: String,
		session: Session? = null,
	): T {
		val encoded = URLEncoder.encode(input, "UTF-8")
		return decodeEnvelope(requestRaw(host, "$path?input=$encoded", "GET", null, session, null, REQUEST_TIMEOUT_MS), path)
	}

	private suspend inline fun <reified T> mutate(host: String, path: String, body: String, session: Session?): T =
		decodeEnvelope(requestRaw(host, path, "POST", null, session, body, REQUEST_TIMEOUT_MS), path)

	private suspend fun refreshSessionDirect(host: String, session: Session): Session = refreshDirect(host, session).session

	private suspend fun refreshDirect(host: String, session: Session, browserSession: Boolean = false): NativeRefresh {
		val path = "user.refreshNativeAccess"
		val input = NativeRefreshInput(session.deviceToken, browserSession = browserSession.takeIf { it })
		val result = performRequestRaw(
			host, path, "POST", session.deviceId, null, json.encodeToString(NativeRefreshInput.serializer(), input), REQUEST_TIMEOUT_MS,
		)
		val access: NativeAccessResponse = decodeEnvelope(result, path)
		return NativeRefresh(
			session.copy(accessToken = access.accessToken, accessExpiresAt = access.accessExpiresAt),
			access.dashboardToken?.let { dashboardToken ->
				// Unreadable, it's treated as never made: the renewed access is still kept.
				try {
					issuedBrowserSession(host, result, path, session.deviceId, session.accountId, dashboardToken, linked = true)
				} catch (unreadable: Error) {
					null
				}
			},
		)
	}

	private suspend fun requestRaw(
		host: String,
		path: String,
		method: String,
		deviceId: String?,
		session: Session?,
		body: String?,
		timeoutMillis: Long,
	): HttpResult {
		if (session == null) {
			if (deviceId == null) throw Error(0, "Missing Umbrel identity for secure request")
			return performRequestRaw(host, path, method, deviceId, null, body, timeoutMillis)
		}
		if (deviceId != null && deviceId != session.deviceId) throw Error(0, "Umbrel identity does not match this session")
		val current = coordinator.session(host, session)
		val first = performRequestRaw(host, path, method, current.deviceId, current.accessToken, body, timeoutMillis)
		if (first.status != 401) return first
		val refreshed = coordinator.session(host, current, forceRefresh = true, rejectedAccessToken = current.accessToken)
		return performRequestRaw(host, path, method, refreshed.deviceId, refreshed.accessToken, body, timeoutMillis)
	}

	internal suspend fun performRequestRaw(
		host: String,
		path: String,
		method: String,
		deviceId: String,
		accessToken: String?,
		body: String?,
		timeoutMillis: Long,
		cookieHeader: String? = null,
		userAgent: String? = null,
	): HttpResult {
		val builder = LocalHttpsTransport.request(httpsUrl(host, "/trpc/$path"))
		if (accessToken != null) builder.header("Authorization", "Bearer $accessToken")
		if (cookieHeader != null) builder.header("Cookie", cookieHeader)
		if (userAgent != null) builder.header("User-Agent", userAgent)
		if (body != null) builder.method(method, body.toRequestBody(jsonMediaType)) else builder.method(method, null)
		val request = builder.build()
		return guardTransport(host) { LocalHttpsTransport.data(request, deviceId, timeoutMillis) }
	}

	internal fun httpsUrl(host: String, pathAndQuery: String): String {
		if (host.isEmpty() || host.any { it.isWhitespace() || it == '/' }) throw Error(0, "Invalid host: $host")
		return "https://$host$pathAndQuery"
	}

	private fun plainUrl(host: String, pathAndQuery: String): String {
		if (host.isEmpty() || host.any { it.isWhitespace() || it == '/' }) throw Error(0, "Invalid host: $host")
		return "http://$host$pathAndQuery"
	}

	/** Map transport failures onto the kit's error vocabulary. */
	private suspend fun guardTransport(
		host: String,
		protocolFailureMessage: String? = null,
		send: suspend () -> HttpResult,
	): HttpResult = try {
		send()
	} catch (error: Error) {
		throw error
	} catch (cancelled: CancellationException) {
		throw cancelled
	} catch (error: LocalHttpsTransportException) {
		throw transportError(error.kind)
	} catch (error: IOException) {
		if (isServerTrustError(error)) {
			throw Error(0, LocalHttpsTransportException.Kind.TRUST_FAILED.description, ErrorKind.TRUST)
		}
		if (isConnectivityError(error)) {
			val timedOut = failureTree(error).any { it is IOException && LocalHttpsTransport.isTimeout(it) }
			throw Error(0, "Could not reach $host", ErrorKind.CONNECTIVITY, timedOut)
		}
		throw Error(0, protocolFailureMessage ?: "Could not reach $host", ErrorKind.PROTOCOL_FAILURE)
	} catch (error: IllegalArgumentException) {
		throw Error(0, "Invalid host: $host")
	}

	private fun transportError(kind: LocalHttpsTransportException.Kind): Error = Error(
		0,
		kind.description,
		if (kind == LocalHttpsTransportException.Kind.STORAGE_UNAVAILABLE) ErrorKind.STORAGE else ErrorKind.TRUST,
	)

	/**
	 * Only a certificate the pinned CA doesn't vouch for is a trust failure. Any other TLS
	 * failure, such as a reset during the handshake, means the route failed, so the request
	 * can fail over to another one. OkHttp throws the first failed address and attaches the
	 * others as suppressed, so a host with several addresses can carry the certificate failure
	 * there.
	 */
	internal fun isServerTrustError(error: IOException): Boolean =
		failureTree(error).any { it is SSLPeerUnverifiedException || it is CertificateException }

	private fun failureTree(error: Throwable, depth: Int = 0): Sequence<Throwable> = sequence {
		yield(error)
		if (depth >= 8) return@sequence
		error.cause?.let { yieldAll(failureTree(it, depth + 1)) }
		for (suppressed in error.suppressed) yieldAll(failureTree(suppressed, depth + 1))
	}

	/**
	 * Like URLError.networkConnectionLost on Apple platforms, a connection that closes before
	 * the response completes (an EOFException underneath OkHttp's error) means the route
	 * failed, not the server.
	 */
	internal fun isConnectivityError(error: IOException): Boolean =
		LocalHttpsTransport.isTimeout(error) || error is ConnectException || error is UnknownHostException ||
			error is NoRouteToHostException || error is SocketException || error is SSLException ||
			failureTree(error).any { it is EOFException }

	internal inline fun <reified T> decodeEnvelope(result: HttpResult, path: String): T {
		val envelope: JsonObject? = try {
			json.parseToJsonElement(String(result.body, Charsets.UTF_8)).jsonObject
		} catch (error: IllegalArgumentException) {
			null
		} catch (error: kotlinx.serialization.SerializationException) {
			null
		}
		if (result.status !in 200..299) {
			// Surface the tRPC error message (e.g. "Invalid password") when present
			val message = (envelope?.get("error") as? JsonObject)?.get("message")?.let { (it as? JsonPrimitive)?.contentOrNull }
			throw Error(result.status, message ?: "$path failed (${result.status})")
		}
		val resultObject = envelope?.get("result") as? JsonObject ?: throw Error(result.status, "$path: unexpected response")
		val data = resultObject["data"] ?: throw Error(result.status, "$path: unexpected response")
		if (data is JsonNull && null !is T) throw Error(result.status, "$path: unexpected response")
		return try {
			json.decodeFromJsonElement<T>(data)
		} catch (error: IllegalArgumentException) {
			throw Error(result.status, "$path: unexpected response")
		} catch (error: kotlinx.serialization.SerializationException) {
			throw Error(result.status, "$path: unexpected response")
		}
	}

}
