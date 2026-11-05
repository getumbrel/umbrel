package com.umbrel.kit

import mockwebserver3.Dispatcher
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import mockwebserver3.RecordedRequest
import okhttp3.Protocol
import okhttp3.tls.HandshakeCertificates
import okhttp3.tls.HeldCertificate
import java.io.Closeable
import java.io.IOException
import java.io.InputStream
import java.io.PushbackInputStream
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.util.Collections
import kotlin.concurrent.thread

/**
 * An Umbrel on loopback: plain HTTP and pinned HTTPS on one port, like umbreld's LAN
 * ingress. Each connection goes to an HTTP or an HTTPS MockWebServer by its first byte
 * (0x16 starts a TLS handshake). [host] includes the port, which the kit's URL builders
 * accept.
 */
class FakeUmbrel(
	val deviceId: String = "device",
	val ca: HeldCertificate = HeldCertificate.Builder().certificateAuthority(0).commonName("Umbrel CA").build(),
	leafIssuer: HeldCertificate = ca,
) : Closeable {
	private val http = MockWebServer()
	private val https = MockWebServer()
	private val listener = ServerSocket(0, 50, InetAddress.getLoopbackAddress())
	private val sockets: MutableList<Socket> = Collections.synchronizedList(mutableListOf())

	/** The CA the HTTP bootstrap advertises; a different one than [ca] simulates a spoof. */
	var advertisedCa: HeldCertificate = ca
	var bootstrapId: String = deviceId
	var discoveryId: String = deviceId

	/** Answers for authenticated procedures, queued per path. */
	private val queued = HashMap<String, ArrayDeque<MockResponse>>()
	private val dropped = HashMap<String, Int>()
	val requests: MutableList<RecordedRequest> = Collections.synchronizedList(mutableListOf())

	val host: String get() = "localhost:${listener.localPort}"
	val caCertificate: ByteArray get() = ca.certificate.encoded

	init {
		val leaf = HeldCertificate.Builder().signedBy(leafIssuer).addSubjectAlternativeName("localhost").build()
		https.useHttps(HandshakeCertificates.Builder().heldCertificate(leaf).build().sslSocketFactory())
		// umbreld's ingress is a Node https server, which speaks only HTTP/1.1.
		https.protocols = listOf(Protocol.HTTP_1_1)
		http.dispatcher = dispatcher()
		https.dispatcher = dispatcher()
		http.start(InetAddress.getLoopbackAddress(), 0)
		https.start(InetAddress.getLoopbackAddress(), 0)
		thread(isDaemon = true, name = "FakeUmbrel accept") {
			while (true) {
				val client = try {
					listener.accept()
				} catch (closed: IOException) {
					break
				}
				sockets += client
				thread(isDaemon = true) { forward(client) }
			}
		}
	}

	fun enqueue(path: String, response: MockResponse) {
		synchronized(queued) { queued.getOrPut(path) { ArrayDeque() }.addLast(response) }
	}

	/** Close the connection instead of answering the next request to [path]. */
	fun dropNextRequest(path: String) {
		synchronized(queued) { dropped[path] = (dropped[path] ?: 0) + 1 }
	}

	private fun dispatcher() = object : Dispatcher() {
		override fun dispatch(request: RecordedRequest): MockResponse {
			requests += request
			val path = request.url.encodedPath
			val drop = synchronized(queued) { (dropped[path] ?: 0).also { if (it > 0) dropped[path] = it - 1 } > 0 }
			if (drop) {
				closeIdleConnections()
				return MockResponse.Builder().code(500).build()
			}
			synchronized(queued) { queued[path]?.removeFirstOrNull() }?.let { return it }
			return when (path) {
				"/trpc/system.localHttpsIdentity" ->
					json("""{"result":{"data":{"id":"$bootstrapId","caCertificate":${quoted(advertisedCa.certificatePem())}}}}""")
				"/trpc/system.discoveryInfo" -> json("""{"result":{"data":{"id":"$discoveryId","device":"Umbrel Home","onboarded":true}}}""")
				else -> MockResponse.Builder().code(404).body("""{"error":{"message":"No procedure found"}}""").build()
			}
		}
	}

	private fun forward(client: Socket) {
		val input = PushbackInputStream(client.getInputStream(), 1)
		val first = try {
			input.read()
		} catch (closed: IOException) {
			-1
		}
		if (first < 0) return client.close()
		input.unread(first)
		val upstream = Socket(InetAddress.getLoopbackAddress(), if (first == 0x16) https.port else http.port)
		sockets += upstream
		thread(isDaemon = true) { pump(upstream.getInputStream(), client) }
		pump(input, upstream)
	}

	private fun pump(from: InputStream, to: Socket) {
		try {
			from.copyTo(to.getOutputStream())
			to.shutdownOutput()
		} catch (closed: IOException) {
		}
	}

	/** Close every open connection, as umbreld does to one idle past its keep-alive timeout. */
	fun closeIdleConnections() {
		synchronized(sockets) {
			sockets.forEach { it.close() }
			sockets.clear()
		}
	}

	override fun close() {
		listener.close()
		synchronized(sockets) { sockets.forEach { it.close() } }
		http.close()
		https.close()
	}

	companion object {
		fun json(body: String, code: Int = 200): MockResponse = MockResponse.Builder().code(code).body(body).build()

		private fun quoted(value: String) = "\"" + value.replace("\n", "\\n") + "\""
	}
}
