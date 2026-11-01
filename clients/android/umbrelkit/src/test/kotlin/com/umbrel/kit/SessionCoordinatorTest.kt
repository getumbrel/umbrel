package com.umbrel.kit

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import kotlinx.coroutines.yield
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger

/**
 * Drives the coordinator against an in-memory store and a fake refreshNativeAccess that
 * behaves like umbreld: the device token never rotates, and each refresh revokes every
 * access token issued before it. The Swift kit has no coordinator tests; its actor makes
 * reading the stored session and joining a refresh one step, which these tests pin down.
 */
class SessionCoordinatorTest {
	private val lock = Any()
	private var stored: Umbreld.Session? = null
	private val refreshes = AtomicInteger()

	private fun now() = System.currentTimeMillis()

	// Inside the 60 s refresh leeway, so every caller wants a refresh.
	private fun expiring(access: String = "acc-0") = Umbreld.Session("dev", "0", access, now() + 10_000, "device")

	private fun read(deviceId: String): SecretStore.SessionReadResult = synchronized(lock) {
		stored?.let { SecretStore.SessionReadResult.Found(it) } ?: SecretStore.SessionReadResult.Missing
	}

	private val mints = AtomicInteger()

	private fun browserSession(count: Int) = BrowserSession("dev", "0", "dashboard-$count", "browser-$count", linked = true)

	private fun coordinator(
		read: (String) -> SecretStore.SessionReadResult = ::read,
		refresh: suspend (String, Umbreld.Session) -> Umbreld.Session = { _, session ->
			yield()
			val count = refreshes.incrementAndGet()
			session.copy(accessToken = "acc-$count", accessExpiresAt = now() + 3_600_000)
		},
		mint: suspend (String, Umbreld.Session) -> Umbreld.NativeRefresh = { _, session ->
			yield()
			val count = refreshes.incrementAndGet()
			mints.incrementAndGet()
			Umbreld.NativeRefresh(session.copy(accessToken = "acc-$count", accessExpiresAt = now() + 3_600_000), browserSession(count))
		},
	) = Umbreld.SessionCoordinator(
		read = read,
		replace = { session, expected ->
			synchronized(lock) {
				if (stored?.belongsToSameLogin(expected) != true) return@synchronized false
				stored = session
				true
			}
		},
		delete = { expected -> synchronized(lock) { if (stored?.belongsToSameLogin(expected) == true) stored = null } },
		refresh = refresh,
		mint = mint,
	)

	@Test
	fun concurrentCallersShareOneRefresh() = runBlocking {
		stored = expiring()
		val coordinator = coordinator()

		val results = (0 until 8).map { async(Dispatchers.IO) { coordinator.session("h", expiring()) } }.awaitAll()

		assertEquals(List(8) { "acc-1" }, results.map { it.accessToken })
		assertEquals(1, refreshes.get())
		assertEquals("acc-1", stored!!.accessToken)
	}

	// A caller that read the stored session just before another caller's refresh stored its
	// token and finished must not start a second refresh: that would revoke acc-1, which the
	// first refresh already handed out.
	@Test
	fun aStaleReadNeverStartsASecondRefresh() = runBlocking {
		stored = expiring()
		val firstReadStarted = CountDownLatch(1)
		val otherCallerFinished = CountDownLatch(1)
		val paused = AtomicBoolean(false)
		val coordinator = coordinator(read = { deviceId ->
			val result = read(deviceId)
			if (paused.compareAndSet(false, true)) {
				// Hold this caller's read while the other caller runs as far as it can.
				firstReadStarted.countDown()
				otherCallerFinished.await(500, TimeUnit.MILLISECONDS)
			}
			result
		})

		val stale = async(Dispatchers.IO) { coordinator.session("h", expiring()) }
		withContext(Dispatchers.IO) { firstReadStarted.await() }
		val other = async(Dispatchers.IO) {
			try {
				coordinator.session("h", expiring())
			} finally {
				otherCallerFinished.countDown()
			}
		}

		assertEquals(listOf("acc-1", "acc-1"), listOf(stale.await(), other.await()).map { it.accessToken })
		assertEquals(1, refreshes.get())
	}

	@Test
	fun aRejectedTokenThatWasAlreadyReplacedIsNotRefreshedAgain() = runBlocking {
		stored = expiring("acc-5").copy(accessExpiresAt = now() + 3_600_000)

		val session = coordinator().session("h", expiring(), forceRefresh = true, rejectedAccessToken = "acc-0")

		assertEquals("acc-5", session.accessToken)
		assertEquals(0, refreshes.get())
	}

	@Test
	fun aRevokedLoginIsDeletedAndReportedAsSignedOut() = runBlocking {
		stored = expiring()
		val coordinator = coordinator(refresh = { _, _ -> throw Umbreld.Error(401, "Invalid native session") })

		val error = failure { coordinator.session("h", expiring()) }

		assertTrue(error.isAuthError)
		assertNull(stored)
	}

	@Test
	fun anotherLoginIsNeverRefreshedOrReplaced() = runBlocking {
		stored = expiring().copy(accountId = "member-1", deviceToken = "other")

		val error = failure { coordinator().session("h", expiring()) }

		assertTrue(error.isAuthError)
		assertEquals(0, refreshes.get())
		assertEquals("member-1", stored!!.accountId)
	}

	@Test
	fun unavailableStorageServesAFreshCachedSessionButNeverRefreshes() = runBlocking {
		val fresh = expiring().copy(accessExpiresAt = now() + 3_600_000)
		val cached = { session: Umbreld.Session -> { _: String -> SecretStore.SessionReadResult.Unavailable("IOException", session) } }

		assertEquals(fresh, coordinator(read = cached(fresh)).session("h", fresh))
		val error = failure { coordinator(read = cached(expiring())).session("h", expiring()) }

		assertEquals(Umbreld.ErrorKind.STORAGE, error.kind)
		assertEquals(0, refreshes.get())
	}

	@Test
	fun aRefreshThatCannotBeStoredIsNotHandedOut() = runBlocking {
		stored = expiring()
		val coordinator = coordinator(refresh = { _, session ->
			// Another sign-in replaced the login while this refresh was in flight.
			synchronized(lock) { stored = session.copy(deviceToken = "new-login") }
			session.copy(accessToken = "acc-1")
		})

		val error = failure { coordinator.session("h", expiring()) }

		assertEquals(Umbreld.ErrorKind.STORAGE, error.kind)
		assertEquals("new-login", stored!!.deviceToken)
	}

	@Test
	fun makingABrowserSessionStoresTheRenewedAccessToo() = runBlocking {
		stored = expiring()

		val made = coordinator().browserSession("h", expiring())

		assertEquals(browserSession(1), made)
		assertEquals("acc-1", stored!!.accessToken)
	}

	// Both replace the access credential, so the browser session is made after the plain
	// refresh rather than alongside it.
	@Test
	fun aBrowserSessionWaitsForAPlainRefreshThenMakesItsOwn() = runBlocking {
		stored = expiring()
		val plainStarted = CountDownLatch(1)
		val releasePlain = CountDownLatch(1)
		val coordinator = coordinator(refresh = { _, session ->
			plainStarted.countDown()
			withContext(Dispatchers.IO) { releasePlain.await(2, TimeUnit.SECONDS) }
			session.copy(accessToken = "acc-${refreshes.incrementAndGet()}", accessExpiresAt = now() + 3_600_000)
		})

		val plain = async(Dispatchers.IO) { coordinator.session("h", expiring()) }
		withContext(Dispatchers.IO) { plainStarted.await() }
		val made = async(Dispatchers.IO) { coordinator.browserSession("h", expiring()) }
		yield()
		assertEquals(0, mints.get())
		releasePlain.countDown()

		assertEquals("acc-1", plain.await().accessToken)
		assertEquals(browserSession(2), made.await())
		assertEquals("acc-2", stored!!.accessToken)
	}

	@Test
	fun plainRefreshesShareTheOneThatMakesABrowserSession() = runBlocking {
		stored = expiring()
		val mintStarted = CountDownLatch(1)
		val releaseMint = CountDownLatch(1)
		val coordinator = coordinator(mint = { _, session ->
			mintStarted.countDown()
			withContext(Dispatchers.IO) { releaseMint.await(2, TimeUnit.SECONDS) }
			val count = refreshes.incrementAndGet()
			Umbreld.NativeRefresh(session.copy(accessToken = "acc-$count", accessExpiresAt = now() + 3_600_000), browserSession(count))
		})

		val made = async(Dispatchers.IO) { coordinator.browserSession("h", expiring()) }
		withContext(Dispatchers.IO) { mintStarted.await() }
		val plain = (0 until 4).map { async(Dispatchers.IO) { coordinator.session("h", expiring()) } }
		releaseMint.countDown()

		assertEquals(browserSession(1), made.await())
		assertEquals(List(4) { "acc-1" }, plain.awaitAll().map { it.accessToken })
		assertEquals(1, refreshes.get())
	}

	// An older umbrelOS ignores the request and only renews.
	@Test
	fun anUmbrelThatMakesNoBrowserSessionStillRenewsAccess() = runBlocking {
		stored = expiring()
		val coordinator = coordinator(mint = { _, session ->
			Umbreld.NativeRefresh(session.copy(accessToken = "acc-1", accessExpiresAt = now() + 3_600_000), null)
		})

		assertNull(coordinator.browserSession("h", expiring()))
		assertEquals("acc-1", stored!!.accessToken)
	}

	@Test
	fun aBrowserSessionForARevokedLoginSignsItOut() = runBlocking {
		stored = expiring()
		val coordinator = coordinator(mint = { _, _ -> throw Umbreld.Error(401, "Invalid native session") })

		val error = failure { coordinator.browserSession("h", expiring()) }

		assertTrue(error.isAuthError)
		assertNull(stored)
	}

	private suspend fun failure(block: suspend () -> Unit): Umbreld.Error {
		try {
			block()
		} catch (error: Umbreld.Error) {
			return error
		}
		fail("Expected the coordinator to fail")
		throw AssertionError()
	}
}
