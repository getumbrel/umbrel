package com.umbrel.kit

import androidx.test.ext.junit.runners.AndroidJUnit4
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import okhttp3.tls.HeldCertificate
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import org.junit.runner.RunWith
import java.util.concurrent.TimeUnit

/**
 * The identity and session flows end to end: real plain HTTP and pinned HTTPS against a
 * fake Umbrel, with SecretStore sealing through an in-memory Keystore.
 */
@RunWith(AndroidJUnit4::class)
class UmbreldIntegrationTest {
	@get:Rule
	val temporary = TemporaryFolder()

	private val umbrels = mutableListOf<FakeUmbrel>()
	private val otherCa = HeldCertificate.Builder().certificateAuthority(0).commonName("Other CA").build()

	@Before
	fun setUp() {
		SoftwareKeyStore.install()
		SecretStore.initialize(temporary.newFolder("secrets"))
	}

	@After
	fun tearDown() {
		for (umbrel in umbrels) {
			Umbreld.forgetLocalHttpsIdentity(umbrel.deviceId)
			umbrel.close()
		}
		SoftwareKeyStore.clear()
	}

	private fun umbrel(leafIssuer: HeldCertificate? = null): FakeUmbrel {
		val ca = HeldCertificate.Builder().certificateAuthority(0).commonName("Umbrel CA").build()
		return FakeUmbrel(ca = ca, leafIssuer = leafIssuer ?: ca).also { umbrels += it }
	}

	// ── Identity ──

	// Hermetic port of the Swift live test testLivePassiveIdentificationDoesNotEnrollUntilExplicitClaim.
	@Test
	fun passiveIdentificationDoesNotEnrollUntilExplicitClaim() = runBlocking {
		val umbrel = umbrel()

		val device = Umbreld.identify(Candidate(host = umbrel.host, name = "Live test"))

		assertNotNull("Passive HTTPS identification failed", device)
		assertArrayEquals(umbrel.caCertificate, device!!.candidateCaCertificate)
		assertEquals(SecretStore.LocalHttpsCaReadResult.Missing, SecretStore.readLocalHttpsCa(device.id))

		Umbreld.claimLocalHttpsIdentity(device)

		assertEquals(device.id, Umbreld.identify(umbrel.host, expectedDeviceId = device.id)?.id)
		assertArrayEquals(umbrel.caCertificate, (SecretStore.readLocalHttpsCa(device.id) as SecretStore.LocalHttpsCaReadResult.Found).certificate)
	}

	@Test
	fun anAdvertisedCaThatDoesNotSignTheEndpointIsRejected() = runBlocking {
		val umbrel = umbrel().apply { advertisedCa = otherCa }

		assertNull(Umbreld.identify(Candidate(host = umbrel.host, name = "Spoof")))
	}

	@Test
	fun aBootstrapForAnotherDeviceIsRejected() = runBlocking {
		val umbrel = umbrel().apply { bootstrapId = "other-device" }

		assertNull(Umbreld.identify(Candidate(host = umbrel.host, name = "Spoof")))
	}

	@Test
	fun aSavedDeviceIsVerifiedOnlyWithItsPin() = runBlocking {
		val umbrel = umbrel()
		SecretStore.storeLocalHttpsCaIfAbsent(otherCa.certificate.encoded, umbrel.deviceId)

		assertNull(Umbreld.identify(umbrel.host, expectedDeviceId = umbrel.deviceId))
		assertFalse(Umbreld.isKnownEndpointAvailable(umbrel.host, umbrel.deviceId))
		// The candidate path ignores the stale pin, so the real device can still be claimed.
		val device = Umbreld.identify(Candidate(host = umbrel.host, name = "Umbrel"))!!
		Umbreld.claimLocalHttpsIdentity(device)
		assertTrue(Umbreld.isKnownEndpointAvailable(umbrel.host, umbrel.deviceId))
	}

	// The Umbrel's certificate names its network interfaces, which can miss an address it's
	// really reachable at, like the Tailscale app's address in userspace mode. The pin alone
	// proves it's the Umbrel.
	@Test
	fun aPinnedUmbrelIsTrustedAtAnAddressItsCertificateDoesNotName() = runBlocking {
		val umbrel = enrolledUmbrel()
		val unnamed = "127.0.0.1:${umbrel.host.substringAfterLast(':')}"

		assertTrue(Umbreld.isKnownEndpointAvailable(unnamed, umbrel.deviceId))
		assertEquals(umbrel.deviceId, Umbreld.identify(unnamed, expectedDeviceId = umbrel.deviceId)?.id)
		// Another CA at that address still isn't this Umbrel.
		SecretStore.replaceLocalHttpsCa(otherCa.certificate.encoded, umbrel.deviceId)
		Umbreld.forgetLocalHttpsIdentity(umbrel.deviceId)
		SecretStore.storeLocalHttpsCaIfAbsent(otherCa.certificate.encoded, umbrel.deviceId)
		assertFalse(Umbreld.isKnownEndpointAvailable(unnamed, umbrel.deviceId))
	}

	@Test
	fun anUnenrolledSavedDeviceIsNeverProbed() = runBlocking {
		val umbrel = umbrel()

		assertNull(Umbreld.identify(umbrel.host, expectedDeviceId = umbrel.deviceId))
		assertNull(Umbreld.identify(Candidate(host = umbrel.host, name = "Umbrel"), expectedDeviceId = umbrel.deviceId))
		assertTrue(umbrel.requests.isEmpty())
	}

	@Test
	fun aResetUmbrelAtASavedAddressIsAnIdentityChange() = runBlocking {
		val umbrel = umbrel()
		SecretStore.storeLocalHttpsCaIfAbsent(otherCa.certificate.encoded, umbrel.deviceId)

		assertTrue(Umbreld.identityChanged(Umbreld.Target(umbrel.deviceId, listOf(umbrel.host))))
	}

	@Test
	fun anotherServerAtASavedAddressIsNotAnIdentityChange() = runBlocking {
		val umbrel = umbrel().apply { bootstrapId = "other-device" }
		SecretStore.storeLocalHttpsCaIfAbsent(otherCa.certificate.encoded, umbrel.deviceId)

		assertFalse(Umbreld.identityChanged(Umbreld.Target(umbrel.deviceId, listOf(umbrel.host))))
	}

	@Test
	fun theSameUmbrelAtAnyAddressIsNotAnIdentityChange() = runBlocking {
		val umbrel = enrolledUmbrel()
		val reset = umbrel()
		val target = Umbreld.Target(umbrel.deviceId, listOf(umbrel.host, reset.host))
		reset.bootstrapId = umbrel.deviceId
		reset.discoveryId = umbrel.deviceId

		assertFalse(Umbreld.identityChanged(target))
		assertFalse(Umbreld.identityChanged(Umbreld.Target(umbrel.deviceId, listOf(umbrel.host))))
	}

	@Test
	fun anUnreachableUmbrelIsNotAnIdentityChange() = runBlocking {
		val umbrel = enrolledUmbrel()
		val target = Umbreld.Target(umbrel.deviceId, listOf(umbrel.host))
		umbrel.close()

		assertFalse(Umbreld.identityChanged(target))
	}

	// ── Proving identity on umbrelOS 2.0 ──
	// Not in the Swift suite, which checked healthy, slow and wrong-certificate Umbrels against a
	// fake umbreld by hand.

	@Test
	fun aSavedUmbrelsRoutesAreProvenOverPinnedHttpsWithoutDiscoveryInfo() = runBlocking {
		val umbrel = enrolledUmbrel()
		val session = signIn(umbrel)
		umbrel.enqueue("/trpc/files.favorites", FakeUmbrel.json("""{"result":{"data":["/Home"]}}"""))

		assertTrue(Umbreld.isKnownEndpointAvailable(umbrel.host, umbrel.deviceId))
		assertEquals(listOf("/Home"), Umbreld.favorites(umbrel.target, session))
		assertFalse(Umbreld.identityChanged(umbrel.target))

		assertTrue(umbrel.requests.none { it.url.encodedPath == "/trpc/system.discoveryInfo" })
		val proofs = umbrel.requests.filter { it.url.encodedPath == "/trpc/system.localHttpsIdentity" }
		assertTrue(proofs.isNotEmpty() && proofs.all { it.handshake != null && it.headers["Authorization"] == null })
	}

	@Test
	fun aBusyUmbrelIsIdentifiedWhenDiscoveryInfoOutlastsTheProbeTimeout() = runBlocking {
		val umbrel = umbrel()
		// umbrelOS 2.0.0 can take seconds to read its hardware for discoveryInfo
		umbrel.enqueue(
			"/trpc/system.discoveryInfo",
			FakeUmbrel.json("""{"result":{"data":{"id":"${umbrel.deviceId}","device":"Umbrel Home","onboarded":true}}}""")
				.newBuilder()
				.headersDelay(4, TimeUnit.SECONDS)
				.build(),
		)

		val result = Umbreld.identifyReportingFailure(Candidate(host = umbrel.host, name = "umbrel"), emptySet())

		assertEquals(umbrel.deviceId, (result as Umbreld.HostIdentification.Device).value.id)
	}

	@Test
	fun anUmbrelThatDoesNotAnswerInTimeIsSlow() = runBlocking {
		val umbrel = umbrel()
		umbrel.enqueue(
			"/trpc/system.localHttpsIdentity",
			FakeUmbrel.json("""{"result":{"data":{"id":"${umbrel.deviceId}","caCertificate":""}}}""")
				.newBuilder()
				.headersDelay(5, TimeUnit.SECONDS)
				.build(),
		)

		val result = Umbreld.identifyReportingFailure(Candidate(host = umbrel.host, name = "umbrel"), emptySet())

		assertEquals(unverified(umbrel.host, Umbreld.UnverifiedDevice.Reason.SLOW), result)
	}

	@Test
	fun anUmbrelServingACertificateItsCaDidNotIssueCouldNotConnect() = runBlocking {
		val umbrel = umbrel(leafIssuer = otherCa)

		val result = Umbreld.identifyReportingFailure(Candidate(host = umbrel.host, name = "umbrel"), emptySet())

		assertEquals(unverified(umbrel.host, Umbreld.UnverifiedDevice.Reason.UNEXPECTED), result)
	}

	@Test
	fun aSavedUmbrelWhoseCertificateWasResetIsLeftToItsOwnHandling() = runBlocking {
		val umbrel = umbrel()
		SecretStore.storeLocalHttpsCaIfAbsent(otherCa.certificate.encoded, umbrel.deviceId)

		val result = Umbreld.identifyReportingFailure(Candidate(host = umbrel.host, name = "umbrel"), setOf(umbrel.deviceId))

		assertEquals(Umbreld.HostIdentification.SavedIdentityChanged, result)
	}

	@Test
	fun aHealthySavedUmbrelIsIdentifiedWithItsPin() = runBlocking {
		val umbrel = enrolledUmbrel()

		val result = Umbreld.identifyReportingFailure(Candidate(host = umbrel.host, name = "umbrel"), setOf(umbrel.deviceId))

		val device = (result as Umbreld.HostIdentification.Device).value
		assertEquals(umbrel.deviceId, device.id)
		// Proven with the pin, so there's no first-use anchor to claim
		assertNull(device.candidateCaCertificate)
	}

	@Test
	fun aPinnedRouteThatAnswersWithAnotherIdIsNotAvailable() = runBlocking {
		val umbrel = enrolledUmbrel()
		assertTrue(Umbreld.isKnownEndpointAvailable(umbrel.host, umbrel.deviceId))

		umbrel.bootstrapId = "other-device"

		assertFalse(Umbreld.isKnownEndpointAvailable(umbrel.host, umbrel.deviceId))
	}

	@Test
	fun anUmbrelThatProvedItselfButKeepsDiscoveryInfoWaitingIsSlowAndNotTriedElsewhere() = runBlocking {
		val umbrel = umbrel()
		val address = "127.0.0.1:${umbrel.host.substringAfterLast(':')}"
		// discoveryInfo is asked for only over HTTPS, after the proof, so the delay can't hit the
		// plain bootstrap. A second ask would get a prompt answer.
		umbrel.enqueue(
			"/trpc/system.discoveryInfo",
			FakeUmbrel.json("""{"result":{"data":{"id":"${umbrel.deviceId}","device":"Umbrel Home","onboarded":true}}}""")
				.newBuilder()
				.headersDelay(9, TimeUnit.SECONDS)
				.build(),
		)

		val result = Umbreld.identifyReportingFailure(Candidate(umbrel.host, listOf(address), "umbrel"), emptySet())

		assertEquals(
			Umbreld.HostIdentification.Unverified(Umbreld.UnverifiedDevice(umbrel.host, listOf(address), Umbreld.UnverifiedDevice.Reason.SLOW)),
			result,
		)
		assertEquals(1, umbrel.requests.count { it.url.encodedPath == "/trpc/system.discoveryInfo" })
		assertTrue(umbrel.requests.none { it.headers["Host"] == address })
	}

	@Test
	fun anotherDeviceClaimingAnUmbrelsIdUnderItsOwnCaDoesNotHideIt() = runBlocking {
		val real = umbrel()
		val claimant = umbrel()
		assertEquals(real.deviceId, claimant.deviceId)

		val devices = Umbreld.identify(listOf(Candidate(real.host, name = "real"), Candidate(claimant.host, name = "claimant")))

		assertEquals(setOf(real.host, claimant.host), devices.map { it.host }.toSet())
	}

	private fun unverified(host: String, reason: Umbreld.UnverifiedDevice.Reason) =
		Umbreld.HostIdentification.Unverified(Umbreld.UnverifiedDevice(host, reason = reason))

	// ── Native sessions ──

	@Test
	fun loginSendsTheNativeClientWithoutCredentialsInTheUrl() = runBlocking {
		val umbrel = enrolledUmbrel()
		umbrel.enqueue(
			"/trpc/user.loginNative",
			FakeUmbrel.json("""{"result":{"data":{"accountId":"0","accessToken":"acc-0","accessExpiresAt":${later()},"deviceToken":"device-token"}}}"""),
		)

		val session = Umbreld.login(umbrel.host, umbrel.deviceId, password = "secret", totpToken = null)

		assertEquals(Umbreld.Session(umbrel.deviceId, "0", "acc-0", session.accessExpiresAt, "device-token"), session)
		val request = umbrel.requests.single { it.url.encodedPath == "/trpc/user.loginNative" }
		assertEquals("POST", request.method)
		assertNull(request.url.query)
		assertNull(request.headers["Authorization"])
		val body = Umbreld.json.parseToJsonElement(request.body!!.utf8()).jsonObject
		assertEquals(setOf("userId", "password", "client"), body.keys)
		assertEquals(JsonPrimitive("android"), (body["client"] as JsonObject)["platform"])
	}

	@Test
	fun aRejectedAccessTokenIsRefreshedOnceAndTheRequestRetried() = runBlocking {
		val umbrel = enrolledUmbrel()
		val session = signIn(umbrel)
		umbrel.enqueue("/trpc/files.favorites", FakeUmbrel.json("""{"error":{"message":"Invalid token"}}""", code = 401))
		umbrel.enqueue("/trpc/user.refreshNativeAccess", FakeUmbrel.json("""{"result":{"data":{"accessToken":"acc-1","accessExpiresAt":${later()}}}}"""))
		umbrel.enqueue("/trpc/files.favorites", FakeUmbrel.json("""{"result":{"data":["/Home"]}}"""))

		assertEquals(listOf("/Home"), Umbreld.favorites(umbrel.host, session))

		assertEquals(
			listOf("GET /trpc/files.favorites Bearer acc-0", "POST /trpc/user.refreshNativeAccess null", "GET /trpc/files.favorites Bearer acc-1"),
			umbrel.authenticatedRequests(),
		)
		val refresh = Umbreld.json.parseToJsonElement(umbrel.requests.single { it.url.encodedPath == "/trpc/user.refreshNativeAccess" }.body!!.utf8()).jsonObject
		assertEquals(JsonPrimitive("device-token"), refresh["deviceToken"])
		assertEquals("acc-1", (SecretStore.readSession(umbrel.deviceId) as SecretStore.SessionReadResult.Found).session.accessToken)
	}

	@Test
	fun aSecondRejectionIsReportedWithoutAnotherRefresh() = runBlocking {
		val umbrel = enrolledUmbrel()
		val session = signIn(umbrel)
		repeat(2) { umbrel.enqueue("/trpc/files.favorites", FakeUmbrel.json("""{"error":{"message":"Invalid token"}}""", code = 401)) }
		umbrel.enqueue("/trpc/user.refreshNativeAccess", FakeUmbrel.json("""{"result":{"data":{"accessToken":"acc-1","accessExpiresAt":${later()}}}}"""))

		try {
			Umbreld.favorites(umbrel.host, session)
			fail("Expected the second rejection to surface")
		} catch (error: Umbreld.Error) {
			assertTrue(error.isAuthError)
		}

		assertEquals(1, umbrel.requests.count { it.url.encodedPath == "/trpc/user.refreshNativeAccess" })
	}

	@Test
	fun logoutRefreshesARejectedAccessTokenWithoutStoringIt() = runBlocking {
		val umbrel = enrolledUmbrel()
		val session = signIn(umbrel)
		// The caller removed the stored session before this best-effort request.
		SecretStore.deleteSession(umbrel.deviceId)
		umbrel.enqueue("/trpc/user.logout", FakeUmbrel.json("""{"error":{"message":"Invalid token"}}""", code = 401))
		umbrel.enqueue("/trpc/user.refreshNativeAccess", FakeUmbrel.json("""{"result":{"data":{"accessToken":"acc-1","accessExpiresAt":${later()}}}}"""))
		umbrel.enqueue("/trpc/user.logout", FakeUmbrel.json("""{"result":{"data":true}}"""))

		Umbreld.logout(umbrel.host, session)

		assertEquals(
			listOf("POST /trpc/user.logout Bearer acc-0", "POST /trpc/user.refreshNativeAccess null", "POST /trpc/user.logout Bearer acc-1"),
			umbrel.authenticatedRequests(),
		)
		assertEquals(SecretStore.SessionReadResult.Missing, SecretStore.readSession(umbrel.deviceId))
	}

	// umbreld's Node server closes connections idle for 5 s, and OkHttp's pool doesn't notice
	// before reusing one for a GET, or for a POST idle under 10 s. Dropping a request on a
	// reused connection takes the same path through OkHttp.

	@Test
	fun aQueryIsResentWhenThePooledConnectionWasClosedWhileIdle() = runBlocking {
		val umbrel = enrolledUmbrel()
		val session = signIn(umbrel)
		repeat(2) { umbrel.enqueue("/trpc/files.favorites", FakeUmbrel.json("""{"result":{"data":["/Home"]}}""")) }
		assertEquals(listOf("/Home"), Umbreld.favorites(umbrel.host, session))

		umbrel.closeIdleConnections()

		assertEquals(listOf("/Home"), Umbreld.favorites(umbrel.host, session))
	}

	@Test
	fun aQueryIsResentWhenAReusedConnectionClosesWithoutAnAnswer() = runBlocking {
		val umbrel = enrolledUmbrel()
		val session = signIn(umbrel)
		repeat(2) { umbrel.enqueue("/trpc/files.favorites", FakeUmbrel.json("""{"result":{"data":["/Home"]}}""")) }
		assertEquals(listOf("/Home"), Umbreld.favorites(umbrel.host, session))
		umbrel.dropNextRequest("/trpc/files.favorites")

		assertEquals(listOf("/Home"), Umbreld.favorites(umbrel.host, session))
		assertEquals(3, umbrel.requests.count { it.url.encodedPath == "/trpc/files.favorites" })
	}

	@Test
	fun aMutationIsNeverResentAndALostConnectionIsAConnectivityFailure() = runBlocking {
		val umbrel = enrolledUmbrel()
		val session = signIn(umbrel)
		umbrel.enqueue("/trpc/files.favorites", FakeUmbrel.json("""{"result":{"data":["/Home"]}}"""))
		umbrel.enqueue("/trpc/apps.hideCredentialsBeforeOpen", FakeUmbrel.json("""{"result":{"data":true}}"""))
		Umbreld.favorites(umbrel.host, session)
		umbrel.dropNextRequest("/trpc/apps.hideCredentialsBeforeOpen")

		try {
			Umbreld.hideCredentialsBeforeOpen(umbrel.host, session, "files")
			fail("Expected the lost connection to surface")
		} catch (error: Umbreld.Error) {
			assertEquals(Umbreld.ErrorKind.CONNECTIVITY, error.kind)
		}

		assertEquals(1, umbrel.requests.count { it.url.encodedPath == "/trpc/apps.hideCredentialsBeforeOpen" })
	}

	@Test
	fun aSessionForAnotherLoginIsNeverSent() = runBlocking {
		val umbrel = enrolledUmbrel()
		val session = signIn(umbrel)

		try {
			Umbreld.favorites(umbrel.host, session.copy(deviceToken = "old-login"))
			fail("Expected the replaced login to be signed out")
		} catch (error: Umbreld.Error) {
			assertTrue(error.isAuthError)
		}

		assertTrue(umbrel.authenticatedRequests().isEmpty())
	}

	// Read before a new backup source would store the account's phone backups again.
	@Test
	fun photoSourcesAreAnAuthenticatedQuery() = runBlocking {
		val umbrel = enrolledUmbrel()
		val session = signIn(umbrel)
		umbrel.enqueue(
			"/trpc/photos.sources.list",
			FakeUmbrel.json("""{"result":{"data":[{"id":"iphone:a","type":"iphone","name":"Nate’s Pixel","createdAt":1,"stats":{"photos":2,"videos":0,"sizeBytes":9}}]}}"""),
		)

		val sources = Umbreld.photoSources(umbrel.target, session)

		assertEquals(listOf("Nate’s Pixel"), sources.map { it.name })
		assertEquals(listOf("GET /trpc/photos.sources.list Bearer acc-0"), umbrel.authenticatedRequests())
	}

	// ── Browser sessions ──

	@Test
	fun browserLoginReturnsTheTokenAndBothCookiesUnderTheAppsUserAgent() = runBlocking {
		val umbrel = enrolledUmbrel()
		umbrel.enqueue(
			"/trpc/user.login",
			FakeUmbrel.json("""{"result":{"data":"dashboard-token"}}""")
				.newBuilder()
				.addHeader("Set-Cookie", "__Host-UMBREL_APP_SESSION_HTTPS=app-value; Path=/; HttpOnly; Secure; SameSite=Lax")
				.addHeader("Set-Cookie", "__Host-UMBREL_BROWSER_SESSION_HTTPS=browser-value; Path=/; HttpOnly; Secure; SameSite=Lax")
				.build(),
		)

		val session = Umbreld.loginBrowser(umbrel.target, userId = "1", password = "secret", totpToken = "123456")

		assertEquals(BrowserSession(umbrel.deviceId, "1", "dashboard-token", "browser-value", "app-value"), session)
		val request = umbrel.requests.single { it.url.encodedPath == "/trpc/user.login" }
		assertNull(request.headers["Authorization"])
		assertNull(request.headers["Cookie"])
		assertEquals(BrowserSession.userAgentToken, request.headers["User-Agent"])
		val body = Umbreld.json.parseToJsonElement(request.body!!.utf8()).jsonObject
		assertEquals(setOf("userId", "password", "totpToken"), body.keys)
	}

	@Test
	fun browserLoginWithoutABrowserCookieIsAProtocolFailure() = runBlocking {
		val umbrel = enrolledUmbrel()
		umbrel.enqueue("/trpc/user.login", FakeUmbrel.json("""{"result":{"data":"dashboard-token"}}"""))

		try {
			Umbreld.loginBrowser(umbrel.target, userId = "0", password = "secret", totpToken = null)
			fail("Expected a login without a browser session to fail")
		} catch (error: Umbreld.Error) {
			assertEquals(Umbreld.ErrorKind.PROTOCOL_FAILURE, error.kind)
		}
		val body = Umbreld.json.parseToJsonElement(umbrel.requests.single { it.url.encodedPath == "/trpc/user.login" }.body!!.utf8()).jsonObject
		assertEquals(setOf("userId", "password"), body.keys)
	}

	@Test
	fun browserSessionRenewalReportsWhatTheUmbrelSaid() = runBlocking {
		val umbrel = enrolledUmbrel()
		val session = BrowserSession(umbrel.deviceId, "0", "dashboard-token", "browser-value", null)
		for ((code, expected) in listOf(
			200 to BrowserSessionStatus.VALID,
			401 to BrowserSessionStatus.INVALID,
			403 to BrowserSessionStatus.INVALID,
			500 to BrowserSessionStatus.UNKNOWN,
		)) {
			umbrel.enqueue("/trpc/user.renewToken", FakeUmbrel.json("""{"result":{"data":true}}""", code = code))

			assertEquals("HTTP $code", expected, Umbreld.renewBrowserSession(umbrel.target, session))
		}
		val request = umbrel.requests.last { it.url.encodedPath == "/trpc/user.renewToken" }
		assertEquals("Bearer dashboard-token", request.headers["Authorization"])
		assertEquals("__Host-UMBREL_BROWSER_SESSION_HTTPS=browser-value", request.headers["Cookie"])
	}

	@Test
	fun browserSessionRenewalIsUnknownWhenTheUmbrelCantBeReached() = runBlocking {
		val umbrel = enrolledUmbrel()
		val session = BrowserSession(umbrel.deviceId, "0", "dashboard-token", "browser-value", null)
		val target = umbrel.target
		umbrel.close()

		assertEquals(BrowserSessionStatus.UNKNOWN, Umbreld.renewBrowserSession(target, session))
	}

	@Test
	fun browserSessionAccountIdIsTheAccountUmbrelOsSignsIn() = runBlocking {
		val umbrel = enrolledUmbrel()
		val session = BrowserSession(umbrel.deviceId, "0", "dashboard-token", "browser-value", "app-value")
		umbrel.enqueue(
			"/trpc/user.get",
			FakeUmbrel.json("""{"result":{"data":{"userId":"1","name":"Member","role":"member","homePath":"/Home","wallpaper":{"id":"1","brandColorHsl":"0 0% 0%"}}}}"""),
		)
		umbrel.enqueue("/trpc/user.get", FakeUmbrel.json("""{"error":{"message":"Invalid token"}}""", code = 401))

		assertEquals("1", Umbreld.browserSessionAccountId(umbrel.target, session))
		assertNull(Umbreld.browserSessionAccountId(umbrel.target, session))
		val request = umbrel.requests.first { it.url.encodedPath == "/trpc/user.get" }
		assertEquals("Bearer dashboard-token", request.headers["Authorization"])
		assertEquals("__Host-UMBREL_BROWSER_SESSION_HTTPS=browser-value; __Host-UMBREL_APP_SESSION_HTTPS=app-value", request.headers["Cookie"])
	}

	@Test
	fun browserLogoutSendsTheSessionOnce() = runBlocking {
		val umbrel = enrolledUmbrel()
		val session = BrowserSession(umbrel.deviceId, "0", "dashboard-token", "browser-value", null)
		umbrel.enqueue("/trpc/user.logout", FakeUmbrel.json("""{"result":{"data":true}}"""))

		Umbreld.logoutBrowser(umbrel.target, session)

		val request = umbrel.requests.single { it.url.encodedPath == "/trpc/user.logout" }
		assertEquals("POST", request.method)
		assertEquals("Bearer dashboard-token", request.headers["Authorization"])
		assertEquals("__Host-UMBREL_BROWSER_SESSION_HTTPS=browser-value", request.headers["Cookie"])
	}

	private fun enrolledUmbrel(): FakeUmbrel = umbrel().also {
		assertEquals(SecretStore.LocalHttpsCaStoreResult.STORED, SecretStore.storeLocalHttpsCaIfAbsent(it.caCertificate, it.deviceId))
	}

	private fun signIn(umbrel: FakeUmbrel): Umbreld.Session =
		Umbreld.Session(umbrel.deviceId, "0", "acc-0", later(), "device-token").also { assertTrue(SecretStore.setSession(it, umbrel.deviceId)) }

	private fun later() = System.currentTimeMillis() + 3_600_000

	private val FakeUmbrel.target: Umbreld.Target get() = Umbreld.Target(deviceId, listOf(host))

	private fun FakeUmbrel.authenticatedRequests(): List<String> = requests
		.filter { it.url.encodedPath != "/trpc/system.discoveryInfo" && it.url.encodedPath != "/trpc/system.localHttpsIdentity" }
		.map { "${it.method} ${it.url.encodedPath} ${it.headers["Authorization"]}" }
}
