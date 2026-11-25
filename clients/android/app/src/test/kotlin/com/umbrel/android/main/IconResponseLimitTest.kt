package com.umbrel.android.main

import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Request
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertThrows
import org.junit.Test
import java.io.IOException

class IconResponseLimitTest {
	private val bytes = "icon".toByteArray()

	// The second interceptor answers in place of the network.
	private fun fetch(type: String?, code: Int = 200): ByteArray {
		val client = OkHttpClient.Builder()
			.addInterceptor(IconResponseLimit)
			.addInterceptor { chain ->
				Response.Builder()
					.request(chain.request())
					.protocol(Protocol.HTTP_1_1)
					.code(code)
					.message("OK")
					.body(bytes.toResponseBody(type?.toMediaType()))
					.build()
			}
			.build()
		val request = Request.Builder().url("https://icons.invalid/icon").build()
		return client.newCall(request).execute().use { it.body.bytes() }
	}

	@Test
	fun acceptsIconTypes() {
		assertArrayEquals(bytes, fetch("image/svg+xml"))
		assertArrayEquals(bytes, fetch("IMAGE/PNG; charset=binary"))
	}

	@Test
	fun refusesOtherTypes() {
		for (type in listOf("video/mp4", null, "text/plain")) {
			assertThrows(IOException::class.java) { fetch(type) }
		}
		// Coil decodes the body of a 304 too.
		assertThrows(IOException::class.java) { fetch("video/mp4", code = 304) }
	}
}
