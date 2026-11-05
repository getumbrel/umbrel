package com.umbrel.kit

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.net.InetAddress
import java.net.UnknownHostException
import java.util.concurrent.CountDownLatch

// Not in the Swift suite, which covers only the system lookup of localhost
// (SavedDeviceDiscoveryTest.systemIpv4ResolverUsesLocalDnsConfiguration).
class HostResolverTest {
	private val stalled: (String) -> Array<InetAddress> = {
		Thread.sleep(10_000)
		emptyArray()
	}

	@Test
	fun aStalledLookupEndsAtTheThreeSecondBudget() = runBlocking {
		val started = System.nanoTime()

		val addresses = IPv4HostResolver.resolve("umbrel", lookup = stalled)

		val elapsed = (System.nanoTime() - started) / 1_000_000
		assertTrue(addresses.isEmpty())
		assertTrue("Waited $elapsed ms", elapsed in 3_000..4_500)
	}

	@Test
	fun cancellingTheCallerStopsWaitingForTheLookup() = runBlocking {
		val lookupStarted = CountDownLatch(1)
		var outcome: Throwable? = null
		val job = launch(Dispatchers.Default) {
			try {
				IPv4HostResolver.resolve("umbrel", lookup = {
					lookupStarted.countDown()
					stalled(it)
				})
			} catch (error: Throwable) {
				outcome = error
				throw error
			}
		}
		withContext(Dispatchers.IO) { lookupStarted.await() }
		val started = System.nanoTime()

		job.cancel()
		job.join()

		assertTrue("Expected a cancellation, got $outcome", outcome is CancellationException)
		assertTrue((System.nanoTime() - started) / 1_000_000 < 1_000)
	}

	@Test
	fun onlyDistinctIpv4AddressesAreReturnedInResolverOrder() = runBlocking {
		val loopback = InetAddress.getByAddress(byteArrayOf(127, 0, 0, 1))
		val ipv6Loopback = InetAddress.getByAddress(ByteArray(16).also { it[15] = 1 })
		val lan = InetAddress.getByAddress(byteArrayOf(192.toByte(), 168.toByte(), 1, 20))

		val addresses = IPv4HostResolver.resolve("umbrel", lookup = { arrayOf(ipv6Loopback, lan, loopback, lan) })

		assertEquals(listOf("192.168.1.20", "127.0.0.1"), addresses)
	}

	@Test
	fun aFailedLookupResolvesToNothing() = runBlocking {
		assertEquals(emptyList<String>(), IPv4HostResolver.resolve("umbrel", lookup = { throw UnknownHostException(it) }))
	}
}
