package com.umbrel.kit

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.Headers
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.coroutines.executeAsync
import java.io.ByteArrayOutputStream
import java.io.EOFException
import java.io.File
import java.io.IOException
import java.io.InterruptedIOException
import java.net.ProtocolException
import java.net.Proxy
import java.security.KeyStore
import java.security.cert.CertificateException
import java.security.cert.CertificateFactory
import java.security.cert.X509Certificate
import java.util.Base64
import java.util.concurrent.TimeUnit
import javax.net.ssl.SSLContext
import javax.net.ssl.TrustManagerFactory
import javax.net.ssl.X509TrustManager

class LocalHttpsTransportException(val kind: Kind) : Exception(kind.description) {
	enum class Kind(val description: String) {
		NOT_ENROLLED("This Umbrel has not established a secure connection yet"),
		INVALID_CERTIFICATE("This Umbrel returned an invalid security certificate"),
		IDENTITY_CHANGED("This Umbrel’s security identity changed. Remove it and add it again to reconnect"),
		STORAGE_UNAVAILABLE("Secure connection storage is temporarily unavailable"),
		TRUST_FAILED("Couldn’t verify this Umbrel’s secure connection"),
	}
}

/** Thrown when a bounded response exceeds its byte budget. */
class ResponseTooLargeException : IOException("Response exceeded the allowed size")

/**
 * A completed HTTP exchange with its fully read, size-bounded body. [headers] keeps every
 * value of a repeated header, such as the two Set-Cookie headers of a browser login.
 */
class HttpResult(val status: Int, val body: ByteArray, val contentType: String?, val headers: Headers = Headers.headersOf())

/**
 * UmbrelKit trusts one device-local CA per Umbrel. The trust applies only to the
 * OkHttpClient evaluating that Umbrel; it is never installed as a user or system
 * certificate. The platform TrustManager still evaluates the complete chain, validity,
 * and server usage, but not the address (see [pinnedClient]).
 *
 * Timeouts follow the Apple client: a request timeout is the longest wait for the next
 * bytes (OkHttp's connect, read and write timeouts), and a resource timeout bounds the
 * whole exchange (OkHttp's call timeout). Every client connects directly, never through a
 * configured proxy, because Umbrel routes are LAN and Tailscale addresses a proxy can't reach.
 *
 * Every suspend function here is safe to call from the main thread.
 */
object LocalHttpsTransport {
	private const val BOOTSTRAP_RESPONSE_MAXIMUM_BYTES = 64 * 1024
	private const val CANDIDATE_RESPONSE_MAXIMUM_BYTES = 64 * 1024
	private const val BOOTSTRAP_REQUEST_TIMEOUT_MS = 3_000L
	private const val BOOTSTRAP_RESOURCE_TIMEOUT_MS = 10_000L
	internal const val FALLBACK_DISCOVERY_TIMEOUT_MS = 2_000L

	private val pool = LocalHttpsClientPool()

	// Building a client builds a trust manager, and on Android that reads the platform's
	// certificate blocklists from disk. Clients are therefore created lazily, and every
	// suspend function below touches them only on the IO dispatcher.

	// Plain-HTTP bootstrap: no credentials, no cookies, no redirects, small responses.
	private val bootstrapClient: OkHttpClient by lazy { plainClient(BOOTSTRAP_REQUEST_TIMEOUT_MS, BOOTSTRAP_RESOURCE_TIMEOUT_MS) }

	// Legacy discovery asks a handful of untrusted LAN hosts for one tiny JSON value.
	private val fallbackDiscoveryClient: OkHttpClient by lazy {
		plainClient(FALLBACK_DISCOVERY_TIMEOUT_MS, FALLBACK_DISCOVERY_TIMEOUT_MS)
	}

	// These clients only send credential-free GET probes, so OkHttp may resend one on a
	// fresh connection; see resendsOnConnectionFailure.
	private fun plainClient(requestTimeoutMillis: Long, resourceTimeoutMillis: Long): OkHttpClient = OkHttpClient.Builder()
		.proxy(Proxy.NO_PROXY)
		.followRedirects(false)
		.followSslRedirects(false)
		.retryOnConnectionFailure(true)
		.connectTimeout(requestTimeoutMillis, TimeUnit.MILLISECONDS)
		.readTimeout(requestTimeoutMillis, TimeUnit.MILLISECONDS)
		.writeTimeout(requestTimeoutMillis, TimeUnit.MILLISECONDS)
		.callTimeout(resourceTimeoutMillis, TimeUnit.MILLISECONDS)
		.build()

	/**
	 * The fallback discovery policy over HTTPS that trusts what the phone's browser trusts:
	 * the system CAs plus any the user installed in Settings, as Chrome does. The trust store
	 * is read on every call, so a certificate installed while the app runs counts at once.
	 */
	suspend fun browserTrustData(request: Request, maximumBytes: Int, timeoutMillis: Long): HttpResult =
		withContext(Dispatchers.IO) {
			val trustManager = browserTrustManager()
			val sslContext = SSLContext.getInstance("TLS").apply { init(null, arrayOf(trustManager), null) }
			val client = fallbackDiscoveryClient.newBuilder()
				.sslSocketFactory(sslContext.socketFactory, trustManager)
				.connectTimeout(timeoutMillis, TimeUnit.MILLISECONDS)
				.readTimeout(timeoutMillis, TimeUnit.MILLISECONDS)
				.writeTimeout(timeoutMillis, TimeUnit.MILLISECONDS)
				.callTimeout(timeoutMillis, TimeUnit.MILLISECONDS)
				.build()
			sendBounded(client, request, maximumBytes)
		}

	/**
	 * Android's AndroidCAStore holds the system CAs and the user-installed ones. Handing a
	 * KeyStore to the factory bypasses the app's network security config, which trusts only
	 * system CAs. Tests replace this, since the JVM has no AndroidCAStore.
	 */
	@Volatile
	internal var browserTrustManager: () -> X509TrustManager = {
		val keyStore = KeyStore.getInstance("AndroidCAStore").apply { load(null, null) }
		val factory = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm()).apply { init(keyStore) }
		factory.trustManagers.singleOrNull() as? X509TrustManager
			?: throw LocalHttpsTransportException(LocalHttpsTransportException.Kind.TRUST_FAILED)
	}

	suspend fun bootstrapData(request: Request): HttpResult = withContext(Dispatchers.IO) {
		sendBounded(bootstrapClient, request, BOOTSTRAP_RESPONSE_MAXIMUM_BYTES)
	}

	suspend fun fallbackDiscoveryData(request: Request, maximumBytes: Int): HttpResult = withContext(Dispatchers.IO) {
		sendBounded(fallbackDiscoveryClient, request, maximumBytes)
	}

	/** The fallback discovery policy with the caller's deadline for the whole exchange. */
	suspend fun fallbackDiscoveryData(request: Request, maximumBytes: Int, timeoutMillis: Long): HttpResult =
		withContext(Dispatchers.IO) {
			val client = fallbackDiscoveryClient.newBuilder()
				.connectTimeout(timeoutMillis, TimeUnit.MILLISECONDS)
				.readTimeout(timeoutMillis, TimeUnit.MILLISECONDS)
				.writeTimeout(timeoutMillis, TimeUnit.MILLISECONDS)
				.callTimeout(timeoutMillis, TimeUnit.MILLISECONDS)
				.build()
			sendBounded(client, request, maximumBytes)
		}

	/** Send through the pooled client pinned to the saved Umbrel's CA. */
	suspend fun data(request: Request, deviceId: String, timeoutMillis: Long): HttpResult =
		// The first request for a host decrypts the stored CA and builds its client.
		withContext(Dispatchers.IO) { pool.data(request, deviceId, timeoutMillis) }

	/**
	 * The pooled client pinned to the saved Umbrel's CA for [host], for a caller that streams
	 * its own request and response, such as a photo upload.
	 */
	internal suspend fun pinnedClient(deviceId: String, host: String): OkHttpClient =
		withContext(Dispatchers.IO) { pool.client(deviceId, host) }

	/**
	 * Candidate anchors remain in memory until the live HTTPS endpoint proves both
	 * possession of the corresponding private key and the same discovery id.
	 */
	suspend fun data(request: Request, candidateCertificate: ByteArray, timeoutMillis: Long): HttpResult =
		withContext(Dispatchers.IO) {
			val anchor = parseCertificate(candidateCertificate)
			val client = pinnedClient(anchor, timeoutMillis)
				.newBuilder()
				.callTimeout(timeoutMillis, TimeUnit.MILLISECONDS)
				.build()
			try {
				sendBounded(client, request, CANDIDATE_RESPONSE_MAXIMUM_BYTES)
			} finally {
				client.dispatcher.executorService.shutdown()
				client.connectionPool.evictAll()
			}
		}

	/**
	 * Saves a web page's download from the Umbrel into [destination], over the Umbrel's pinned
	 * connection and with the page's cookies. Blocks; call off the main thread.
	 */
	fun download(deviceId: String, url: String, cookieFor: (String) -> String?, userAgent: String, destination: File) {
		val request = downloadRequest(url, userAgent)
		save(downloadClient(pool.client(deviceId, request.url.host), cookieFor), request, destination)
	}

	/**
	 * Saves a download from another website into [destination], with the system's trust and
	 * redirects, as a browser would. Blocks; call off the main thread.
	 */
	fun downloadFromWeb(url: String, cookieFor: (String) -> String?, userAgent: String, destination: File) {
		save(downloadClient(webDownloadClient, cookieFor), downloadRequest(url, userAgent), destination)
	}

	private val webDownloadClient: OkHttpClient by lazy {
		OkHttpClient.Builder().readTimeout(30, TimeUnit.SECONDS).build()
	}

	/**
	 * Follows redirects as a browser does, but never from HTTPS to plain HTTP, and gives every
	 * request, each redirect included, only the cookies for its own address.
	 */
	private fun downloadClient(base: OkHttpClient, cookieFor: (String) -> String?): OkHttpClient = base.newBuilder()
		.followRedirects(true)
		.followSslRedirects(false)
		.readTimeout(30, TimeUnit.SECONDS)
		.addNetworkInterceptor { chain ->
			val request = chain.request()
			val cookie = cookieFor(request.url.toString())
			chain.proceed(if (cookie.isNullOrEmpty()) request else request.newBuilder().header("Cookie", cookie).build())
		}
		.build()

	private fun downloadRequest(url: String, userAgent: String): Request =
		Request.Builder().url(url).header("User-Agent", userAgent).build()

	private fun save(client: OkHttpClient, request: Request, destination: File) {
		client.newCall(request).execute().use { response ->
			if (!response.isSuccessful) throw IOException("HTTP ${response.code}")
			response.body.byteStream().use { input -> destination.outputStream().use { input.copyTo(it) } }
		}
	}

	/** Decode one PEM certificate to DER, rejecting anything that isn't a certificate. */
	fun certificateDataFromPem(pem: String): ByteArray {
		val body = pem
			.replace("-----BEGIN CERTIFICATE-----", "")
			.replace("-----END CERTIFICATE-----", "")
			.filterNot { it.isWhitespace() }
		if (body.isEmpty()) throw LocalHttpsTransportException(LocalHttpsTransportException.Kind.INVALID_CERTIFICATE)
		val decoded = try {
			Base64.getDecoder().decode(body)
		} catch (error: IllegalArgumentException) {
			throw LocalHttpsTransportException(LocalHttpsTransportException.Kind.INVALID_CERTIFICATE)
		}
		return parseCertificate(decoded).encoded
	}

	internal fun parseCertificate(der: ByteArray): X509Certificate = try {
		CertificateFactory.getInstance("X.509").generateCertificate(der.inputStream()) as X509Certificate
	} catch (error: CertificateException) {
		throw LocalHttpsTransportException(LocalHttpsTransportException.Kind.INVALID_CERTIFICATE)
	} catch (error: ClassCastException) {
		throw LocalHttpsTransportException(LocalHttpsTransportException.Kind.INVALID_CERTIFICATE)
	}

	internal fun enroll(
		certificate: ByteArray,
		deviceId: String,
		replacingExisting: Boolean = false,
	): SecretStore.LocalHttpsCaStoreResult {
		val result = if (replacingExisting) SecretStore.replaceLocalHttpsCa(certificate, deviceId)
		else SecretStore.storeLocalHttpsCaIfAbsent(certificate, deviceId)
		// Drop every cached client after an explicit claim so subsequent requests can only
		// use the newly selected identity.
		if (replacingExisting && result == SecretStore.LocalHttpsCaStoreResult.STORED) pool.remove(deviceId)
		return result
	}

	internal fun forget(deviceId: String) {
		SecretStore.deleteLocalHttpsCa(deviceId)
		pool.remove(deviceId)
	}

	/**
	 * A client whose only trust anchor is the enrolled CA, built the way OkHttp documents
	 * custom trust: a KeyStore holding just that certificate feeds the platform
	 * TrustManagerFactory, and the resulting X509TrustManager is handed to the client
	 * together with its SSLSocketFactory.
	 *
	 * The anchor is the Umbrel's own CA, which signs only that Umbrel's server certificate,
	 * so the anchor alone proves identity. The certificate's names come from the Umbrel's
	 * network interfaces and can miss addresses it's really reachable at (a Tailscale address
	 * in userspace mode, a new DHCP or Tailscale address, NAT), so they aren't matched.
	 */
	internal fun pinnedClient(anchor: X509Certificate, requestTimeoutMillis: Long): OkHttpClient {
		val trustManager = pinnedTrustManager(anchor)
		val sslContext = SSLContext.getInstance("TLS").apply { init(null, arrayOf(trustManager), null) }
		return OkHttpClient.Builder()
			.proxy(Proxy.NO_PROXY)
			// API requests can carry native access credentials. Never forward them to a
			// redirected origin, even if that origin presents a certificate from the CA.
			.followRedirects(false)
			.followSslRedirects(false)
			.retryOnConnectionFailure(false)
			.sslSocketFactory(sslContext.socketFactory, trustManager)
			.hostnameVerifier { _, _ -> true }
			.connectTimeout(requestTimeoutMillis, TimeUnit.MILLISECONDS)
			.readTimeout(requestTimeoutMillis, TimeUnit.MILLISECONDS)
			.writeTimeout(requestTimeoutMillis, TimeUnit.MILLISECONDS)
			.build()
	}

	private fun pinnedTrustManager(anchor: X509Certificate): X509TrustManager {
		val keyStore = KeyStore.getInstance(KeyStore.getDefaultType()).apply { load(null, null) }
		keyStore.setCertificateEntry("umbrel-local-ca", anchor)
		val factory = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm()).apply { init(keyStore) }
		return factory.trustManagers.singleOrNull() as? X509TrustManager
			?: throw LocalHttpsTransportException(LocalHttpsTransportException.Kind.TRUST_FAILED)
	}

	/**
	 * Whether a web page's server [certificate] is one the saved Umbrel's CA issued, the check
	 * the in-app browser makes before a page on one of the Umbrel's addresses may load. As for
	 * the app's own requests, the address isn't matched. The CA is read from storage on every
	 * call, so a forgotten or replaced CA takes effect at once, and a CA the store can't read
	 * trusts nothing. Reads storage; call off the main thread.
	 */
	fun trustsPageCertificate(deviceId: String, certificate: X509Certificate): Boolean {
		val anchor = storedAnchor(deviceId) ?: return false
		return trustsPageCertificate(anchor, certificate)
	}

	/**
	 * For a page certificate [trustsPageCertificate] refused: whether the saved Umbrel's CA
	 * didn't issue it at all, which is what a reset certificate or a reset Umbrel looks like,
	 * as opposed to the right certificate refused for its dates. Reads storage; call off the
	 * main thread.
	 */
	fun pageCertificateIdentityDiffers(deviceId: String, certificate: X509Certificate): Boolean {
		val anchor = storedAnchor(deviceId) ?: return false
		return !isIssued(anchor, certificate)
	}

	// WebView hands over only the server's own certificate. umbreld's CA signs its server
	// certificates directly (pathlen 0), so that certificate and the anchor are the whole
	// chain, and the platform TrustManager checks validity dates and server usage as it does
	// for the app's own requests.
	internal fun trustsPageCertificate(anchor: X509Certificate, certificate: X509Certificate): Boolean = try {
		// "UNKNOWN" is the authType both Conscrypt and the JDK accept for a server certificate
		// whose key exchange the caller doesn't know.
		pinnedTrustManager(anchor).checkServerTrusted(arrayOf(certificate), "UNKNOWN")
		true
	} catch (error: CertificateException) {
		false
	} catch (error: LocalHttpsTransportException) {
		false
	}

	// Whether the anchor issued the certificate, however else it fails: dates a wrong clock
	// disagrees with, or the wrong usage.
	internal fun isIssued(anchor: X509Certificate, certificate: X509Certificate): Boolean {
		if (certificate.encoded.contentEquals(anchor.encoded)) return true
		if (certificate.issuerX500Principal != anchor.subjectX500Principal) return false
		return try {
			certificate.verify(anchor.publicKey)
			true
		} catch (error: Exception) {
			false
		}
	}

	private fun storedAnchor(deviceId: String): X509Certificate? =
		when (val read = SecretStore.readLocalHttpsCa(deviceId)) {
			is SecretStore.LocalHttpsCaReadResult.Found -> try {
				parseCertificate(read.certificate)
			} catch (error: LocalHttpsTransportException) {
				null
			}
			else -> null
		}

	internal fun normalizeHost(host: String): String = host.trimEnd('.').lowercase()

	/**
	 * umbreld's ingress is a Node server that closes connections idle for 5 s. Android's TLS
	 * socket reports itself open until it is read, and OkHttp's pool reads from an idle
	 * connection before reusing it only for a non-GET request idle 10 s or more, so a GET can
	 * go out on a connection the server already closed. A GET is idempotent, so OkHttp may
	 * resend it on a fresh connection, as URLSession does. Other methods are never resent:
	 * Umbreld decides whether a mutation may be replayed.
	 */
	internal fun resendsOnConnectionFailure(request: Request): Boolean = request.method == "GET"

	/**
	 * Build a request that bypasses caches. The clients keep no cookie jar, so a request
	 * carries cookies only when its caller sets them, as a browser login does.
	 */
	fun request(url: String): Request.Builder = Request.Builder().url(url).header("Cache-Control", "no-store")

	/**
	 * Send with a hard byte budget. The body is streamed so an oversized response is
	 * abandoned before it is buffered.
	 */
	internal suspend fun sendBounded(client: OkHttpClient, request: Request, maximumBytes: Int): HttpResult =
		client.newCall(request).executeAsync().use { response ->
			// Reading the body blocks, so it runs on the IO dispatcher.
			withContext(Dispatchers.IO) { readBounded(response, maximumBytes) }
		}

	private fun readBounded(response: Response, maximumBytes: Int): HttpResult {
		val body = response.body
		val contentLength = body.contentLength()
		if (contentLength > maximumBytes) throw ResponseTooLargeException()
		val buffer = ByteArrayOutputStream(if (contentLength > 0) contentLength.toInt() else 4096)
		val chunk = ByteArray(16 * 1024)
		body.byteStream().use { stream ->
			while (true) {
				val read = try {
					stream.read(chunk)
				} catch (truncated: ProtocolException) {
					// OkHttp reports a body cut short by the connection closing this way.
					throw EOFException("The connection closed before the response completed").apply { initCause(truncated) }
				}
				if (read < 0) break
				if (buffer.size() + read > maximumBytes) throw ResponseTooLargeException()
				buffer.write(chunk, 0, read)
			}
		}
		return HttpResult(response.code, buffer.toByteArray(), body.contentType()?.let { "${it.type}/${it.subtype}" }, response.headers)
	}

	internal fun isTimeout(error: IOException): Boolean =
		error is java.net.SocketTimeoutException || (error is InterruptedIOException && error.message == "timeout")
}

/** One pinned client per (device, host), created lazily from the stored CA. */
internal class LocalHttpsClientPool {
	private data class Key(val deviceId: String, val host: String)

	private val lock = Any()
	private val entries = HashMap<Key, OkHttpClient>()

	suspend fun data(request: Request, deviceId: String, timeoutMillis: Long): HttpResult {
		val client = client(deviceId, request.url.host)
		val scoped = client.newBuilder()
			.retryOnConnectionFailure(LocalHttpsTransport.resendsOnConnectionFailure(request))
			.connectTimeout(timeoutMillis, TimeUnit.MILLISECONDS)
			.readTimeout(timeoutMillis, TimeUnit.MILLISECONDS)
			.writeTimeout(timeoutMillis, TimeUnit.MILLISECONDS)
			.build()
		return LocalHttpsTransport.sendBounded(scoped, request, PINNED_RESPONSE_MAXIMUM_BYTES)
	}

	fun remove(deviceId: String) {
		synchronized(lock) {
			val keys = entries.keys.filter { it.deviceId == deviceId }
			for (key in keys) {
				entries.remove(key)?.connectionPool?.evictAll()
			}
		}
	}

	fun client(deviceId: String, host: String): OkHttpClient = entry(Key(deviceId, LocalHttpsTransport.normalizeHost(host)))

	private fun entry(key: Key): OkHttpClient = synchronized(lock) {
		entries[key]?.let { return it }
		val certificate = when (val read = SecretStore.readLocalHttpsCa(key.deviceId)) {
			is SecretStore.LocalHttpsCaReadResult.Found -> read.certificate
			is SecretStore.LocalHttpsCaReadResult.Missing ->
				throw LocalHttpsTransportException(LocalHttpsTransportException.Kind.NOT_ENROLLED)
			is SecretStore.LocalHttpsCaReadResult.Unavailable ->
				throw LocalHttpsTransportException(LocalHttpsTransportException.Kind.STORAGE_UNAVAILABLE)
		}
		val client = LocalHttpsTransport.pinnedClient(LocalHttpsTransport.parseCertificate(certificate), DEFAULT_TIMEOUT_MS)
		entries[key] = client
		client
	}

	companion object {
		const val DEFAULT_TIMEOUT_MS = 10_000L
		private const val PINNED_RESPONSE_MAXIMUM_BYTES = 32 * 1024 * 1024
	}
}
