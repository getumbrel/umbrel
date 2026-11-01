package com.umbrel.kit.backup

import com.umbrel.kit.LocalHttpsTransport
import com.umbrel.kit.Umbreld
import kotlinx.coroutines.runBlocking
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import mockwebserver3.SocketEffect
import okhttp3.Protocol
import okhttp3.tls.HandshakeCertificates
import okhttp3.tls.HeldCertificate
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.io.ByteArrayInputStream
import java.net.InetAddress
import java.net.ServerSocket
import java.util.Base64

/** Uploads over the pinned HTTPS transport, against a server with a certificate from a test CA. */
class PhotoBackupUploadTest {
	private val server = MockWebServer()
	private val umbrelCa = HeldCertificate.Builder().certificateAuthority(0).commonName("Umbrel CA").build()
	private val forgotten = mutableListOf<Umbreld.Target>()

	// Built the way the kit's pool builds the one client it keeps for a saved Umbrel's
	// address: only the pinned CA is trusted.
	private val pinned = LocalHttpsTransport.pinnedClient(umbrelCa.certificate, 5_000)
	private val uploader = UmbrelPhotoBackupServer(
		clientFor = { _, _ -> UmbrelPhotoBackupServer.uploadClient(pinned) },
		forgetRoute = { forgotten += it },
	)
	private val key = "a".repeat(64)

	@Before
	fun start() {
		serveHttps(signedBy(umbrelCa))
		server.start(InetAddress.getLoopbackAddress(), 0)
	}

	@After
	fun stop() = server.close()

	@Test
	fun theRequestMatchesTheUmbreldContract() = runBlocking {
		server.enqueue(receipt(key, 4))
		val upload = PhotoUpload(key, "jpg", "Été 2024.jpg", "image/jpeg", 1_700_000_000_123)

		val result = uploader.upload(endpoint(), "grant", upload, source(byteArrayOf(1, 2, 3, 4)))

		assertEquals(PhotoUploadResult.Succeeded(4), result)
		val request = server.takeRequest()
		assertEquals("POST", request.method)
		assertEquals("https", request.url.scheme)
		assertEquals("/api/photos/upload", request.url.encodedPath)
		assertEquals("Bearer grant", request.headers["Authorization"])
		assertEquals(key, request.headers["X-Umbrel-Photo-Backup-Key"])
		assertEquals("jpg", request.headers["X-Umbrel-Photo-Backup-Extension"])
		assertEquals(Base64.getEncoder().encodeToString("Été 2024.jpg".toByteArray()), request.headers["X-Umbrel-Photo-Original-Filename-Base64"])
		assertEquals("1700000000123", request.headers["X-Umbrel-Photo-Creation-Date-Ms"])
		assertEquals("image/jpeg", request.headers["Content-Type"])
		assertEquals("4", request.headers["Content-Length"])
		assertNull(request.headers["Transfer-Encoding"])
		assertNull(request.chunkSizes)
		assertEquals(4L, request.bodySize)
	}

	// A certificate the pinned CA doesn't vouch for ends the connection in the handshake, so
	// the grant is never sent, and the route is verified again before the next upload.
	@Test
	fun anUntrustedCertificateIsRefusedBeforeTheGrantIsSent() = runBlocking {
		val otherCa = HeldCertificate.Builder().certificateAuthority(0).commonName("Other CA").build()
		serveHttps(signedBy(otherCa))
		server.enqueue(receipt(key, 4))

		val result = uploader.upload(endpoint(), "grant", photo(), source(ByteArray(4)))

		assertTrue("$result", result is PhotoUploadResult.TransportFailed)
		val error = (result as PhotoUploadResult.TransportFailed).error
		assertTrue("$error", PhotoBackupTransportFailure.isTrustFailure(error))
		assertEquals(0, server.requestCount)
		assertEquals(listOf(endpoint().target), forgotten)
	}

	@Test
	fun uploadsUseHttp11EvenWhenTheServerOffersHttp2() = runBlocking {
		server.protocols = listOf(Protocol.HTTP_2, Protocol.HTTP_1_1)
		server.enqueue(receipt(key, 4))

		assertEquals(PhotoUploadResult.Succeeded(4), uploader.upload(endpoint(), "grant", photo(), source(ByteArray(4))))
		assertEquals("HTTP/1.1", server.takeRequest().version)
	}

	// umbreld closes an idle connection after 5 s, but OkHttp hands out a pooled connection
	// idle for less than 10 s without probing it. A request that meets a connection the
	// server closed is sent again on a fresh one, with its whole body from the first byte.
	@Test
	fun aRequestOnAConnectionTheServerClosedIsSentAgainWithTheWholeBody() = runBlocking {
		// The server closes the connection right after its answer, as umbreld does to an idle one.
		server.enqueue(receipt(key, 4).newBuilder().onResponseEnd(SocketEffect.CloseSocket()).build())
		server.enqueue(receipt(key, 4))
		val bytes = byteArrayOf(1, 2, 3, 4)
		var opens = 0
		val source = UploadSource(4) {
			opens++
			OpenedResource(4, ByteArrayInputStream(bytes))
		}

		assertEquals(PhotoUploadResult.Succeeded(4), uploader.upload(endpoint(), "grant", photo(), source))
		assertEquals(PhotoUploadResult.Succeeded(4), uploader.upload(endpoint(), "grant", photo(), source))

		assertEquals(3, opens)
		assertEquals(0, server.takeRequest().connectionIndex)
		val resent = server.takeRequest()
		assertEquals(1, resent.connectionIndex)
		assertEquals(4L, resent.bodySize)
	}

	@Test
	fun anImplausibleCaptureDateIsOmitted() = runBlocking {
		server.enqueue(receipt(key, 4))

		uploader.upload(endpoint(), "grant", PhotoUpload(key, "jpg", "a.jpg", "image/jpeg", Long.MAX_VALUE), source(ByteArray(4)))

		assertNull(server.takeRequest().headers["X-Umbrel-Photo-Creation-Date-Ms"])
	}

	@Test
	fun aReceiptForAnotherResourceIsNotASuccess() = runBlocking {
		server.enqueue(receipt("b".repeat(64), 4))
		assertEquals(PhotoUploadResult.Rejected(200, null), uploader.upload(endpoint(), "grant", photo(), source(ByteArray(4))))
	}

	@Test
	fun authenticationAndStorageAnswersAreClassified() = runBlocking {
		server.enqueue(MockResponse.Builder().code(401).build())
		server.enqueue(MockResponse.Builder().code(507).build())
		server.enqueue(MockResponse.Builder().code(500).addHeader("X-Umbrel-Photo-Backup-Error", "insufficient-storage").build())
		server.enqueue(MockResponse.Builder().code(500).build())

		assertEquals(PhotoUploadResult.Rejected(401, PhotoBackupIssue.AUTHENTICATION_REQUIRED), uploader.upload(endpoint(), "grant", photo(), source(ByteArray(4))))
		assertEquals(PhotoUploadResult.Rejected(507, PhotoBackupIssue.INSUFFICIENT_STORAGE), uploader.upload(endpoint(), "grant", photo(), source(ByteArray(4))))
		assertEquals(PhotoUploadResult.Rejected(500, PhotoBackupIssue.INSUFFICIENT_STORAGE), uploader.upload(endpoint(), "grant", photo(), source(ByteArray(4))))
		assertEquals(PhotoUploadResult.Rejected(500, null), uploader.upload(endpoint(), "grant", photo(), source(ByteArray(4))))
	}

	// MediaStore's SIZE can disagree with the file. The declared length now comes from the
	// opened descriptor, and a file that changes mid-upload is the item's problem, not a
	// lost connection.
	@Test
	fun aSourceShorterThanItsLengthIsAnItemFailure() {
		server.enqueue(receipt(key, 4))
		val truncated = UploadSource(8) { OpenedResource(8, ByteArrayInputStream(ByteArray(4))) }

		assertThrows(PhotoBackupSourceException::class.java) { runBlocking { uploader.upload(endpoint(), "grant", photo(), truncated) } }
	}

	@Test
	fun aSourceLongerThanItsLengthIsAnItemFailure() {
		server.enqueue(receipt(key, 4))
		val grown = UploadSource(4) { OpenedResource(4, ByteArrayInputStream(ByteArray(8))) }

		assertThrows(PhotoBackupSourceException::class.java) { runBlocking { uploader.upload(endpoint(), "grant", photo(), grown) } }
	}

	@Test
	fun aFileThatChangedSinceItWasMeasuredIsNotSent() {
		val changed = UploadSource(4) { OpenedResource(8, ByteArrayInputStream(ByteArray(8))) }

		assertThrows(PhotoBackupSourceException::class.java) { runBlocking { uploader.upload(endpoint(), "grant", photo(), changed) } }
	}

	@Test
	fun anUnreachableDestinationIsAConnectivityFailure() = runBlocking {
		val closedPort = ServerSocket(0, 1, InetAddress.getLoopbackAddress()).use { it.localPort }
		val unreachable = UploadEndpoint(Umbreld.Target("umbrel", listOf("127.0.0.1")), "127.0.0.1:$closedPort")

		val result = uploader.upload(unreachable, "grant", photo(), source(ByteArray(4)))

		assertTrue(result is PhotoUploadResult.TransportFailed)
		assertTrue(PhotoBackupTransportFailure.isConnectivityFailure((result as PhotoUploadResult.TransportFailed).error))
		assertEquals(listOf(unreachable.target), forgotten)
	}

	// An IP literal, as the Umbrel's addresses are, so the route has exactly one address.
	private fun endpoint() = UploadEndpoint(Umbreld.Target("umbrel", listOf("127.0.0.1")), "127.0.0.1:${server.port}")

	private fun photo() = PhotoUpload(key, "jpg", "a.jpg", "image/jpeg", null)

	private fun source(bytes: ByteArray) = UploadSource(bytes.size.toLong()) { OpenedResource(bytes.size.toLong(), ByteArrayInputStream(bytes)) }

	private fun signedBy(ca: HeldCertificate) = HeldCertificate.Builder().signedBy(ca).addSubjectAlternativeName("127.0.0.1").build()

	private fun serveHttps(leaf: HeldCertificate) {
		server.useHttps(HandshakeCertificates.Builder().heldCertificate(leaf).build().sslSocketFactory())
	}

	private fun receipt(resourceKey: String, bytes: Long) = MockResponse.Builder()
		.addHeader("X-Umbrel-Photo-Backup-Key", resourceKey)
		.addHeader("X-Umbrel-Upload-Bytes", bytes.toString())
		.body("""{"resourceKey":"$resourceKey","bytes":$bytes}""")
		.build()
}
