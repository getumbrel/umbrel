package com.umbrel.kit

import kotlinx.coroutines.asCoroutineDispatcher
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import mockwebserver3.SocketEffect
import okhttp3.tls.HandshakeCertificates
import okhttp3.tls.HeldCertificate
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test
import java.io.IOException
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.Proxy
import java.net.ProxySelector
import java.net.ServerSocket
import java.net.SocketAddress
import java.net.URI
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread

// The server listens on 127.0.0.1 only, so on a machine where localhost also resolves to ::1
// the trust tests cover a host with several addresses, where OkHttp reports the refused
// address first.
class TransportTest {
	private val server = MockWebServer()
	private val umbrelCa = HeldCertificate.Builder().certificateAuthority(0).commonName("Umbrel CA").build()

	@Before
	fun start() = server.start(InetAddress.getLoopbackAddress(), 0)

	@After
	fun stop() = server.close()

	@Test
	fun aCertificateFromThePinnedCaIsAccepted() = runBlocking {
		serveHttps(leafSignedBy(umbrelCa, "localhost"))
		server.enqueue(MockResponse.Builder().body("ok").build())

		val result = LocalHttpsTransport.data(request("localhost"), umbrelCa.certificate.encoded, 3_000)

		assertEquals(200, result.status)
		assertEquals("ok", String(result.body))
	}

	@Test
	fun aCertificateFromAnotherCaIsATrustFailure() = runBlocking {
		val otherCa = HeldCertificate.Builder().certificateAuthority(0).commonName("Other CA").build()
		serveHttps(leafSignedBy(otherCa, "localhost"))

		val error = failure { LocalHttpsTransport.data(request("localhost"), umbrelCa.certificate.encoded, 3_000) }

		assertTrue("Expected a trust failure, got $error", Umbreld.isServerTrustError(error))
	}

	// The pinned CA signs only its own Umbrel's certificate, so it alone proves identity. The
	// names the certificate carries can miss an address the Umbrel is really reachable at.
	@Test
	fun aCertificateFromThePinnedCaIsAcceptedAtAnAddressItDoesNotName() = runBlocking {
		serveHttps(leafSignedBy(umbrelCa, "other.local"))
		server.enqueue(MockResponse.Builder().body("ok").build())

		val result = LocalHttpsTransport.data(request("localhost"), umbrelCa.certificate.encoded, 3_000)

		assertEquals(200, result.status)
	}

	@Test
	fun aResetDuringTheTlsHandshakeIsAConnectivityFailure() = runBlocking {
		ServerSocket(0, 1, InetAddress.getLoopbackAddress()).use { listener ->
			thread {
				// Abort the connection (RST) as soon as the client starts its handshake.
				listener.accept().use { it.setSoLinger(true, 0) }
			}
			val url = "https://localhost:${listener.localPort}/trpc/system.discoveryInfo"

			val error = failure {
				LocalHttpsTransport.data(LocalHttpsTransport.request(url).build(), umbrelCa.certificate.encoded, 3_000)
			}

			assertFalse("A reset is not a trust failure: $error", Umbreld.isServerTrustError(error))
			assertTrue("Expected a connectivity failure, got $error", Umbreld.isConnectivityError(error))
		}
	}

	// Swift reports both of these as URLError.networkConnectionLost, a connectivity failure,
	// and the Windows client tests the same.

	@Test
	fun aConnectionClosedBeforeTheResponseIsAConnectivityFailure() = runBlocking {
		server.enqueue(MockResponse.Builder().body("x").onResponseStart(SocketEffect.ShutdownConnection).build())

		val error = failure { LocalHttpsTransport.fallbackDiscoveryData(request("127.0.0.1", "http"), 64) }

		assertTrue("Expected a connectivity failure, got $error", Umbreld.isConnectivityError(error))
	}

	@Test
	fun aBodyCutOffMidTransferIsAConnectivityFailure() = runBlocking {
		for (reset in listOf(false, true)) {
			ServerSocket(0, 1, InetAddress.getLoopbackAddress()).use { listener ->
				thread {
					listener.accept().use { socket ->
						socket.getInputStream().read(ByteArray(4096))
						socket.getOutputStream().write("HTTP/1.1 200 OK\r\nContent-Length: 20\r\n\r\npartial".toByteArray())
						socket.getOutputStream().flush()
						Thread.sleep(100)
						if (reset) socket.setSoLinger(true, 0)
					}
				}
				val url = "http://127.0.0.1:${listener.localPort}/trpc/system.version"

				val error = failure { LocalHttpsTransport.fallbackDiscoveryData(LocalHttpsTransport.request(url).build(), 64) }

				assertTrue("Expected a connectivity failure (reset=$reset), got $error", Umbreld.isConnectivityError(error))
			}
		}
	}

	// umbreld's Node server closes connections idle for 5 s, and OkHttp's pool doesn't notice
	// before reusing one for a GET. URLSession resends an idempotent request in that case.
	@Test
	fun aProbeIsResentWhenThePooledConnectionWasClosed() = runBlocking {
		FakeUmbrel().use { umbrel ->
			assertTrue(Umbreld.isBrowserEndpoint(umbrel.host, umbrel.deviceId))

			umbrel.closeIdleConnections()

			assertTrue(Umbreld.isBrowserEndpoint(umbrel.host, umbrel.deviceId))
		}
	}

	// Open in Browser uses HTTPS for a local name only when the phone's browser would trust
	// the Umbrel's certificate, as it does once the user installs it in Settings.
	@Test
	fun aSecureBrowserProbeTrustsOnlyWhatTheBrowserTrusts() = runBlocking {
		val original = LocalHttpsTransport.browserTrustManager
		FakeUmbrel().use { umbrel ->
			try {
				LocalHttpsTransport.browserTrustManager = { trustManager(umbrel.ca) }
				assertTrue(Umbreld.isBrowserEndpoint(umbrel.host, umbrel.deviceId, secure = true))
				assertFalse(Umbreld.isBrowserEndpoint(umbrel.host, "other-device", secure = true))

				LocalHttpsTransport.browserTrustManager = { trustManager(HeldCertificate.Builder().certificateAuthority(0).build()) }
				assertFalse(Umbreld.isBrowserEndpoint(umbrel.host, umbrel.deviceId, secure = true))
			} finally {
				LocalHttpsTransport.browserTrustManager = original
			}
		}
	}

	private fun trustManager(ca: HeldCertificate) =
		HandshakeCertificates.Builder().addTrustedCertificate(ca.certificate).build().trustManager

	@Test
	fun anOversizedResponseIsRejected() = runBlocking {
		server.enqueue(MockResponse.Builder().body("x".repeat(65)).build())

		val error = failure { LocalHttpsTransport.fallbackDiscoveryData(request("localhost", "http"), 64) }

		assertTrue(error is ResponseTooLargeException)
	}

	@Test
	fun requestsNeverGoThroughAConfiguredProxy() = runBlocking {
		val proxy = MockWebServer().apply { start(InetAddress.getLoopbackAddress(), 0) }
		val previous = ProxySelector.getDefault()
		ProxySelector.setDefault(object : ProxySelector() {
			override fun select(uri: URI): List<Proxy> =
				listOf(Proxy(Proxy.Type.HTTP, InetSocketAddress(proxy.hostName, proxy.port)))

			override fun connectFailed(uri: URI, address: SocketAddress, error: IOException) = Unit
		})
		try {
			server.enqueue(MockResponse.Builder().body("direct").build())
			proxy.enqueue(MockResponse.Builder().body("proxied").build())

			val result = LocalHttpsTransport.fallbackDiscoveryData(request("localhost", "http"), 64)

			assertEquals("direct", String(result.body))
			assertEquals(0, proxy.requestCount)
		} finally {
			ProxySelector.setDefault(previous)
			proxy.close()
		}
	}

	@Test
	fun aBrowserEndpointThatAnswersWithinItsTimeoutIsAccepted() = runBlocking {
		server.enqueue(localHttpsIdentity("device").headersDelay(2_500, TimeUnit.MILLISECONDS).build())

		assertTrue(Umbreld.isBrowserEndpoint("127.0.0.1:${server.port}", "device", timeoutMillis = 3_000))
		// The public identity endpoint only reads the id, so a busy Umbrel still answers in time
		assertEquals("/trpc/system.localHttpsIdentity", server.takeRequest().url.encodedPath)
	}

	@Test
	fun aBrowserEndpointThatOutlastsItsTimeoutIsRejected() = runBlocking {
		server.enqueue(localHttpsIdentity("device").headersDelay(1_000, TimeUnit.MILLISECONDS).build())

		assertFalse(Umbreld.isBrowserEndpoint("127.0.0.1:${server.port}", "device", timeoutMillis = 300))
	}

	@Test
	fun aBrowserEndpointMustReportTheSavedDevice() = runBlocking {
		server.enqueue(localHttpsIdentity("other-device").build())

		assertFalse(Umbreld.isBrowserEndpoint("127.0.0.1:${server.port}", "device"))
	}

	private fun localHttpsIdentity(id: String) =
		MockResponse.Builder().body("""{"result":{"data":{"id":"$id","caCertificate":"-----BEGIN CERTIFICATE-----"}}}""")

	@Test
	fun candidateTrustIsBuiltOffTheCallersThread() = runBlocking {
		serveHttps(leafSignedBy(umbrelCa, "localhost"))
		server.enqueue(MockResponse.Builder().body("ok").build())
		val caller = Executors.newSingleThreadExecutor { Thread(it, "caller") }.asCoroutineDispatcher()

		// On Android, building a trust manager reads the platform's certificate blocklists
		// from disk, so it must not happen on a caller that may be the main thread.
		val builders = TrustManagerThreads.record {
			withContext(caller) { LocalHttpsTransport.data(request("localhost"), umbrelCa.certificate.encoded, 3_000) }
		}
		caller.close()

		// Coroutine debug mode appends the coroutine name to the thread name.
		assertTrue("Trust managers built on $builders", builders.isNotEmpty() && builders.none { it.startsWith("caller") })
	}

	private fun leafSignedBy(ca: HeldCertificate, name: String): HeldCertificate =
		HeldCertificate.Builder().signedBy(ca).addSubjectAlternativeName(name).build()

	private fun serveHttps(leaf: HeldCertificate) {
		server.useHttps(HandshakeCertificates.Builder().heldCertificate(leaf).build().sslSocketFactory())
	}

	private fun request(host: String, scheme: String = "https") =
		LocalHttpsTransport.request("$scheme://$host:${server.port}/trpc/system.discoveryInfo").build()

	private suspend fun failure(block: suspend () -> Unit): IOException {
		try {
			block()
		} catch (error: IOException) {
			return error
		}
		fail("Expected the request to fail")
		throw AssertionError()
	}
}
