package com.umbrel.kit

import kotlinx.coroutines.runBlocking
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import okhttp3.OkHttpClient
import okhttp3.tls.HeldCertificate
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Assume.assumeTrue
import org.junit.Before
import org.junit.Test
import java.net.InetAddress
import java.security.cert.CertificateFactory
import java.util.Collections

class LocalHttpsTest {
	private val server = MockWebServer()
	private val client = OkHttpClient()

	@Before
	fun start() = server.start(InetAddress.getLoopbackAddress(), 0)

	@After
	fun stop() = server.close()

	// ── Bounded bodies ──

	@Test
	fun boundedDataAcceptsAResponseAtTheLimit() = runBlocking {
		server.enqueue(MockResponse.Builder().body("A".repeat(64)).build())

		val result = LocalHttpsTransport.sendBounded(client, request(), maximumBytes = 64)

		assertEquals(64, result.body.size)
	}

	@Test
	fun boundedDataRejectsAnOversizedDeclaredLength() = runBlocking {
		server.enqueue(MockResponse.Builder().body("A".repeat(65)).build())

		assertDataLimitExceeded { LocalHttpsTransport.sendBounded(client, request(), maximumBytes = 64) }
	}

	@Test
	fun boundedDataRejectsAnOversizedStreamWithoutADeclaredLength() = runBlocking {
		server.enqueue(MockResponse.Builder().chunkedBody("A".repeat(65), maxChunkSize = 16).build())

		assertDataLimitExceeded { LocalHttpsTransport.sendBounded(client, request(), maximumBytes = 64) }
	}

	// ── Identity probes ──

	@Test
	fun unsavedCandidateUsesOnlyFirstUseVerification() = runBlocking {
		val recorder = IdentityProbeRecorder { _, _ ->
			Umbreld.IdentityProbeResult(Umbreld.DiscoveryInfo("new-device", "Umbrel Pro", true), "candidate-ca".toByteArray())
		}

		val result = Umbreld.identifyCandidate(
			Candidate(host = "new-umbrel.local", name = "New Umbrel", id = "new-device"),
			knownDeviceIds = emptySet(),
			probe = recorder,
		)

		assertEquals("new-device", result?.id)
		assertArrayEquals("candidate-ca".toByteArray(), result?.candidateCaCertificate)
		assertEquals(listOf(Call("new-umbrel.local", null)), recorder.calls)
	}

	@Test
	fun savedTxtHintRequiresPinnedVerificationImmediately() = runBlocking {
		val recorder = IdentityProbeRecorder { _, _ ->
			Umbreld.IdentityProbeResult(Umbreld.DiscoveryInfo("saved-device", "Umbrel", true), null)
		}

		val result = Umbreld.identifyCandidate(
			Candidate(host = "known.local", name = "Known", id = "saved-device"),
			knownDeviceIds = setOf("saved-device"),
			probe = recorder,
		)

		assertEquals("saved-device", result?.id)
		assertEquals(listOf(Call("known.local", "saved-device")), recorder.calls)
	}

	@Test
	fun authoritativeSavedIdentityWithoutTxtHintIsRevalidatedWithPin() = runBlocking {
		val recorder = IdentityProbeRecorder { _, expectedDeviceId ->
			if (expectedDeviceId == null) {
				Umbreld.IdentityProbeResult(Umbreld.DiscoveryInfo("saved-device", "Spoof", true), "spoof-ca".toByteArray())
			} else {
				null
			}
		}

		val result = Umbreld.identifyCandidate(
			Candidate(host = "claimed.local", name = "Claimed", id = "untrusted-hint"),
			knownDeviceIds = setOf("saved-device"),
			probe = recorder,
		)

		assertNull(result)
		assertEquals(listOf(Call("claimed.local", null), Call("claimed.local", "saved-device")), recorder.calls)
	}

	@Test
	fun explicitManualCandidateMayUseTailscaleHost() = runBlocking {
		val recorder = IdentityProbeRecorder { _, _ ->
			Umbreld.IdentityProbeResult(Umbreld.DiscoveryInfo("remote-device", "Umbrel Home", true), "candidate-ca".toByteArray())
		}

		val result = Umbreld.identifyCandidate(
			Candidate(host = "100.90.0.1", name = "100.90.0.1"),
			knownDeviceIds = emptySet(),
			allowsTailscaleHost = true,
			probe = recorder,
		)

		assertEquals("remote-device", result?.id)
		assertEquals("100.90.0.1", result?.host)
		assertEquals(listOf(Call("100.90.0.1", null)), recorder.calls)
	}

	// Not in the Swift suite: the rest of the probe matrix.

	@Test
	fun passiveCandidateNeverProbesATailscaleRoute() = runBlocking {
		val recorder = IdentityProbeRecorder { host, _ ->
			Umbreld.IdentityProbeResult(Umbreld.DiscoveryInfo("device", "Umbrel", true), host.toByteArray())
		}

		assertNull(Umbreld.identifyCandidate(Candidate(host = "100.90.0.1", name = "x"), emptySet(), probe = recorder))
		val local = Umbreld.identifyCandidate(Candidate("umbrel.local", listOf("100.90.0.1", "192.168.1.20"), "x"), emptySet(), probe = recorder)

		assertEquals(listOf("192.168.1.20"), local?.addresses)
		assertEquals(listOf(Call("umbrel.local", null)), recorder.calls)
	}

	@Test
	fun anUnreachableHostnameFallsBackToItsAdvertisedAddresses() = runBlocking {
		val recorder = IdentityProbeRecorder { host, _ ->
			if (host == "192.168.1.21") Umbreld.IdentityProbeResult(Umbreld.DiscoveryInfo("device", "Umbrel Home", false), "ca".toByteArray()) else null
		}

		val result = Umbreld.identifyCandidate(
			Candidate("umbrel.local", listOf("192.168.1.20", "umbrel.local", "192.168.1.21"), "Umbrel"),
			emptySet(),
			probe = recorder,
		)

		assertEquals("192.168.1.21", result?.host)
		assertEquals("umbrel.local", result?.discoveryHost)
		assertEquals("Umbrel Home", result?.model)
		assertEquals(false, result?.onboarded)
		// The repeated hostname is probed once.
		assertEquals(listOf("umbrel.local", "192.168.1.20", "192.168.1.21"), recorder.calls.map { it.host })
	}

	@Test
	fun aRequiredSavedIdentityRejectsAnyOtherDevice() = runBlocking {
		val recorder = IdentityProbeRecorder { host, _ ->
			val id = if (host == "192.168.1.20") "other-device" else "saved-device"
			Umbreld.IdentityProbeResult(Umbreld.DiscoveryInfo(id, "Umbrel", true), null)
		}

		val result = Umbreld.identifyCandidate(
			Candidate("192.168.1.20", listOf("192.168.1.21"), "Umbrel", id = "other-device"),
			knownDeviceIds = setOf("saved-device"),
			requiredDeviceId = "saved-device",
			probe = recorder,
		)

		assertEquals("192.168.1.21", result?.host)
		assertEquals(listOf(Call("192.168.1.20", "saved-device"), Call("192.168.1.21", "saved-device")), recorder.calls)
	}

	// ── Why an identification failed ──
	// Not in the Swift suite: how the fallback scan and Connect by address report a host that
	// answered but didn't prove its identity.

	@Test
	fun anUmbrelThatProvedItselfAndThenRanOutOfTimeIsSlowAndNotTriedElsewhere() = runBlocking {
		val hosts = mutableListOf<String>()

		val result = Umbreld.identifyReportingFailure(Candidate("umbrel.local", listOf("192.168.1.20"), "umbrel"), emptySet()) { host, _ ->
			hosts += host
			throw Umbreld.IdentityResponseTimeoutException()
		}

		assertEquals(unverified("umbrel.local", listOf("192.168.1.20"), Umbreld.UnverifiedDevice.Reason.SLOW), result)
		assertEquals(listOf("umbrel.local"), hosts)
	}

	@Test
	fun aProofThatRanOutOfTimeIsSlowAfterEveryAddressIsTried() = runBlocking {
		val hosts = mutableListOf<String>()

		val result = Umbreld.identifyReportingFailure(Candidate("umbrel.local", listOf("192.168.1.20"), "umbrel"), emptySet()) { host, _ ->
			hosts += host
			throw if (host == "umbrel.local") timedOut else refused
		}

		assertEquals(unverified("umbrel.local", listOf("192.168.1.20"), Umbreld.UnverifiedDevice.Reason.SLOW), result)
		assertEquals(listOf("umbrel.local", "192.168.1.20"), hosts)
	}

	@Test
	fun aRefusedConnectionIsUnexpected() = runBlocking {
		val result = Umbreld.identifyReportingFailure(Candidate("umbrel.local", name = "umbrel"), emptySet()) { _, _ -> throw refused }

		assertEquals(unverified("umbrel.local", emptyList(), Umbreld.UnverifiedDevice.Reason.UNEXPECTED), result)
	}

	@Test
	fun onlyARejectedPinMeansASavedUmbrelsIdentityChanged() = runBlocking {
		val rejected = listOf(
			LocalHttpsTransportException(LocalHttpsTransportException.Kind.IDENTITY_CHANGED),
			Umbreld.Error(0, LocalHttpsTransportException.Kind.IDENTITY_CHANGED.description, Umbreld.ErrorKind.TRUST),
			// A certificate the pinned CA refused, after the same host proved the id under the CA it advertised
			Umbreld.Error(0, LocalHttpsTransportException.Kind.TRUST_FAILED.description, Umbreld.ErrorKind.TRUST),
		)
		val temporary = listOf(
			refused,
			LocalHttpsTransportException(LocalHttpsTransportException.Kind.STORAGE_UNAVAILABLE),
			Umbreld.Error(0, LocalHttpsTransportException.Kind.STORAGE_UNAVAILABLE.description, Umbreld.ErrorKind.STORAGE),
			Umbreld.Error(0, LocalHttpsTransportException.Kind.NOT_ENROLLED.description, Umbreld.ErrorKind.TRUST),
			Umbreld.Error(0, LocalHttpsTransportException.Kind.INVALID_CERTIFICATE.description, Umbreld.ErrorKind.TRUST),
		)

		for (failure in rejected) {
			assertEquals("$failure", Umbreld.HostIdentification.SavedIdentityChanged, identifyAfterFirstUse(failure))
		}
		for (failure in temporary) {
			assertEquals("$failure", unverified("umbrel.local", emptyList(), Umbreld.UnverifiedDevice.Reason.UNEXPECTED), identifyAfterFirstUse(failure))
		}
	}

	@Test
	fun aRefusedCertificateOnFirstUseIsNotAChangedIdentity() = runBlocking {
		val refusedCertificate = Umbreld.Error(0, LocalHttpsTransportException.Kind.TRUST_FAILED.description, Umbreld.ErrorKind.TRUST)

		val result = Umbreld.identifyReportingFailure(Candidate("umbrel.local", name = "umbrel"), setOf("saved-device")) { _, _ ->
			throw refusedCertificate
		}

		assertEquals(unverified("umbrel.local", emptyList(), Umbreld.UnverifiedDevice.Reason.UNEXPECTED), result)
	}

	private val timedOut = Umbreld.Error(0, "Could not reach umbrel.local", Umbreld.ErrorKind.CONNECTIVITY, timedOut = true)
	private val refused = Umbreld.Error(0, "Could not reach umbrel.local", Umbreld.ErrorKind.CONNECTIVITY)

	// The first-use proof names a saved id, so the same host is then probed with that id's pin.
	private suspend fun identifyAfterFirstUse(pinnedFailure: Exception): Umbreld.HostIdentification =
		Umbreld.identifyReportingFailure(Candidate("umbrel.local", name = "umbrel"), setOf("saved-device")) { _, expectedDeviceId ->
			if (expectedDeviceId != null) throw pinnedFailure
			Umbreld.IdentityProbeResult(Umbreld.DiscoveryInfo("saved-device", "Umbrel Home", true), "reset-ca".toByteArray())
		}

	private fun unverified(host: String, addresses: List<String>, reason: Umbreld.UnverifiedDevice.Reason) =
		Umbreld.HostIdentification.Unverified(Umbreld.UnverifiedDevice(host, addresses, reason))

	@Test
	fun discoveryResultsWithDifferentCandidateAnchorsAreDifferent() {
		// Swift's synthesized Equatable compares the candidate anchor too, so a rescan that
		// finds a new anchor for the same id replaces the result an explicit claim will use.
		val device = IdentifiedDevice("umbrel.local", "umbrel.local", emptyList(), "Umbrel", "device", "Umbrel Home", true, "ca-1".toByteArray())

		assertEquals(device, device.copy(candidateCaCertificate = "ca-1".toByteArray()))
		assertEquals(device.hashCode(), device.copy(candidateCaCertificate = "ca-1".toByteArray()).hashCode())
		assertNotEquals(device, device.copy(candidateCaCertificate = "ca-2".toByteArray()))
		assertNotEquals(device, device.copy(candidateCaCertificate = null))
	}

	@Test
	fun livePassiveIdentificationUsesCandidateTrust() = runBlocking {
		val host = System.getenv("UMBRELKIT_HTTPS_TEST_HOST")
		assumeTrue("Set UMBRELKIT_HTTPS_TEST_HOST to run against an Umbrel", host != null)

		val device = Umbreld.identify(Candidate(host = host!!, name = "Live test"))

		assertNotNull(device)
		assertNotNull(device!!.candidateCaCertificate)
	}

	// ── Certificates ──

	@Test
	fun pemCertificateIsParsedAndCanonicalized() {
		val data = LocalHttpsTransport.certificateDataFromPem(testCertificatePem)
		val certificate = CertificateFactory.getInstance("X.509").generateCertificate(data.inputStream())

		assertArrayEquals(data, certificate.encoded)
	}

	@Test
	fun malformedPemCertificateIsRejected() {
		for (pem in listOf("-----BEGIN CERTIFICATE-----\nnot-a-certificate\n-----END CERTIFICATE-----", "-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----", "")) {
			val error = assertThrows(pem, LocalHttpsTransportException::class.java) { LocalHttpsTransport.certificateDataFromPem(pem) }
			assertEquals(LocalHttpsTransportException.Kind.INVALID_CERTIFICATE, error.kind)
		}
	}

	@Test
	fun onlyAnIdentityChangedFailureIsAnIdentityChange() {
		val changed = LocalHttpsTransportException.Kind.IDENTITY_CHANGED
		val untrusted = LocalHttpsTransportException.Kind.TRUST_FAILED
		assertTrue(Umbreld.isIdentityChange(LocalHttpsTransportException(changed)))
		assertTrue(Umbreld.isIdentityChange(Umbreld.Error(0, changed.description, Umbreld.ErrorKind.TRUST)))
		assertFalse(Umbreld.isIdentityChange(Umbreld.Error(0, untrusted.description, Umbreld.ErrorKind.TRUST)))
		assertFalse(Umbreld.isIdentityChange(LocalHttpsTransportException(untrusted)))
		assertFalse(Umbreld.isIdentityChange(java.io.IOException(changed.description)))
	}

	// ── Page certificates ──

	// The pin proves identity; the names a certificate carries lag behind the Umbrel's real
	// addresses (a userspace Tailscale address, a new DHCP lease), so they aren't matched.
	@Test
	fun pageCertificateFromThePinnedCaIsTrustedWhateverAddressItNames() {
		assertTrue(LocalHttpsTransport.trustsPageCertificate(pageCa.certificate, pageLeaf(pageCa).certificate))
		val namesNothingUseful = HeldCertificate.Builder().signedBy(pageCa).addSubjectAlternativeName("other.local").build()
		assertTrue(LocalHttpsTransport.trustsPageCertificate(pageCa.certificate, namesNothingUseful.certificate))
	}

	@Test
	fun pageCertificateFromAnotherCaIsRefusedAndDiffers() {
		val otherCa = HeldCertificate.Builder().certificateAuthority(0).commonName("Umbrel CA").build()
		val leaf = pageLeaf(otherCa)

		assertFalse(LocalHttpsTransport.trustsPageCertificate(pageCa.certificate, leaf.certificate))
		assertFalse(LocalHttpsTransport.isIssued(pageCa.certificate, leaf.certificate))
	}

	@Test
	fun expiredPageCertificateIsRefusedButStillIssuedByThePin() {
		val now = System.currentTimeMillis()
		val leaf = pageLeaf(pageCa) { validityInterval(now - 2 * 86_400_000L, now - 86_400_000L) }

		assertFalse(LocalHttpsTransport.trustsPageCertificate(pageCa.certificate, leaf.certificate))
		assertTrue(LocalHttpsTransport.isIssued(pageCa.certificate, leaf.certificate))
	}

	@Test
	fun thePinnedCaItselfIsIssuedByThePin() {
		assertTrue(LocalHttpsTransport.isIssued(pageCa.certificate, pageCa.certificate))
	}

	private val pageCa = HeldCertificate.Builder().certificateAuthority(0).commonName("Umbrel CA").build()

	private fun pageLeaf(issuer: HeldCertificate, configure: HeldCertificate.Builder.() -> Unit = {}): HeldCertificate =
		HeldCertificate.Builder()
			.signedBy(issuer)
			.addSubjectAlternativeName("umbrel.local")
			.addSubjectAlternativeName("192.168.1.5")
			.addSubjectAlternativeName("fd7a:115c:a1e0::1")
			.apply(configure)
			.build()

	// ── Saved-device recovery ──

	@Test
	fun savedDeviceRecoveryUsesOnlyPrimaryLocalHostWhenBothSecretsAreMissing() {
		val target = Umbreld.Target("saved-device", listOf("saved-umbrel.local", "192.168.1.50"))

		val decision = Umbreld.decideSavedIdentityRecovery(target, SecretStore.LocalHttpsCaReadResult.Missing, SecretStore.SessionReadResult.Missing)

		assertEquals(Umbreld.SavedIdentityRecoveryDecision.Claim("saved-umbrel.local"), decision)
	}

	@Test
	fun savedDeviceRecoveryDoesNothingWhenPinExists() {
		val target = Umbreld.Target("saved-device", listOf("saved-umbrel.local"))

		val decision = Umbreld.decideSavedIdentityRecovery(
			target,
			SecretStore.LocalHttpsCaReadResult.Found("ca".toByteArray()),
			SecretStore.SessionReadResult.Found(session),
		)

		assertEquals(Umbreld.SavedIdentityRecoveryDecision.AlreadyEnrolled, decision)
	}

	@Test
	fun savedDeviceRecoveryRejectsExistingOrMalformedSessionWithoutAPin() {
		val target = Umbreld.Target("saved-device", listOf("saved-umbrel.local"))

		for (sessionRead in listOf(SecretStore.SessionReadResult.Found(session), SecretStore.SessionReadResult.Invalid)) {
			assertRecoveryFails(LocalHttpsTransportException.Kind.NOT_ENROLLED, target, SecretStore.LocalHttpsCaReadResult.Missing, sessionRead)
		}
	}

	@Test
	fun savedDeviceRecoveryRejectsTailscalePrimaryHost() {
		val target = Umbreld.Target("saved-device", listOf("100.100.10.20", "saved-umbrel.local"))

		assertRecoveryFails(LocalHttpsTransportException.Kind.TRUST_FAILED, target, SecretStore.LocalHttpsCaReadResult.Missing, SecretStore.SessionReadResult.Missing)
	}

	// Not in the Swift suite: the remaining branches of the same decision.

	@Test
	fun savedDeviceRecoveryWaitsForUnavailableStorage() {
		val target = Umbreld.Target("saved-device", listOf("saved-umbrel.local"))

		assertRecoveryFails(
			LocalHttpsTransportException.Kind.STORAGE_UNAVAILABLE,
			target,
			SecretStore.LocalHttpsCaReadResult.Unavailable("IOException"),
			SecretStore.SessionReadResult.Missing,
		)
		assertRecoveryFails(
			LocalHttpsTransportException.Kind.STORAGE_UNAVAILABLE,
			target,
			SecretStore.LocalHttpsCaReadResult.Missing,
			SecretStore.SessionReadResult.Unavailable("IOException", null),
		)
	}

	@Test
	fun savedDeviceRecoveryRejectsAPrimaryHostOutsideTheLocalNetwork() {
		for (hosts in listOf(listOf("umbrel.example.com", "saved-umbrel.local"), emptyList())) {
			assertRecoveryFails(
				LocalHttpsTransportException.Kind.TRUST_FAILED,
				Umbreld.Target("saved-device", hosts),
				SecretStore.LocalHttpsCaReadResult.Missing,
				SecretStore.SessionReadResult.Missing,
			)
		}
	}

	private val session = Umbreld.Session("saved-device", "0", "access", 1, "device")

	private data class Call(val host: String, val expectedDeviceId: String?)

	private class IdentityProbeRecorder(
		private val answer: (String, String?) -> Umbreld.IdentityProbeResult?,
	) : Umbreld.IdentityProbe {
		val calls: MutableList<Call> = Collections.synchronizedList(mutableListOf())

		override suspend fun probe(host: String, expectedDeviceId: String?): Umbreld.IdentityProbeResult? {
			calls += Call(host, expectedDeviceId)
			return answer(host, expectedDeviceId)
		}
	}

	private fun request() = LocalHttpsTransport.request(server.url("/trpc/system.version").toString()).build()

	private suspend fun assertDataLimitExceeded(operation: suspend () -> HttpResult) {
		try {
			operation()
			fail("Expected the response body limit to be enforced")
		} catch (error: ResponseTooLargeException) {
		}
	}

	private fun assertRecoveryFails(
		kind: LocalHttpsTransportException.Kind,
		target: Umbreld.Target,
		caRead: SecretStore.LocalHttpsCaReadResult,
		sessionRead: SecretStore.SessionReadResult,
	) {
		val error = assertThrows(LocalHttpsTransportException::class.java) { Umbreld.decideSavedIdentityRecovery(target, caRead, sessionRead) }
		assertEquals(kind, error.kind)
	}

	private val testCertificatePem = """
		-----BEGIN CERTIFICATE-----
		MIIDLDCCAhSgAwIBAgIUQN+vZuip6m95yaEcLuqGiALn47IwDQYJKoZIhvcNAQEL
		BQAwHDEaMBgGA1UEAwwRVW1icmVsS2l0LVRlc3QtQ0EwHhcNMjYwODEzMDMyNzQ0
		WhcNMzYwODEwMDMyNzQ0WjAcMRowGAYDVQQDDBFVbWJyZWxLaXQtVGVzdC1DQTCC
		ASIwDQYJKoZIhvcNAQEBBQADggEPADCCAQoCggEBALHtaPqHCHtQCD7XGFkHTFAk
		XlU9mZra/7zocYZUK2l7QwxuxIkbar2YlYHVhm4CM47kLVmi+OGFPOpndeymfX1o
		gYCn60ycylKoVcx6gobNJzBETuWSDI2D1QIrWvItnEUYuJK7sl9LEmXa4RHq3H/R
		KclbxMtuZf71R1JqzsRKeD0zShNipSJ5etpDKWdW2KxTQFHtRqfjG+gmAaxhr42E
		YvB1TZ08S2xepq/iNc8vEpfMgzwyxyDXV61WRBkNYCWzcTJZ4TpxFF6+z1FbUSdA
		iYymrr99WExgqk+y9XLI3sk6gvTW+/U13RzeozCH6voZVPBguiDzmzPrhPYQXpUC
		AwEAAaNmMGQwHQYDVR0OBBYEFBLj2Fz36XxyX1U5VgDp6BjiThN2MB8GA1UdIwQY
		MBaAFBLj2Fz36XxyX1U5VgDp6BjiThN2MBIGA1UdEwEB/wQIMAYBAf8CAQAwDgYD
		VR0PAQH/BAQDAgEGMA0GCSqGSIb3DQEBCwUAA4IBAQA0oHmWc659wIAVzmfYpl+q
		h9JZe0uJd+eGG1X9PSClqX8okS5IXhI2lqyn6Wy9TkKHBrUsul76g0GJAqeP4YqJ
		Bn0/xwjL0ZwybzfiKUX/IWjfksMufc3wtDkiZ7AqW9HuzhQCLa3CQRTBZ/bFzSkp
		k4x4zY3+XHzJkkcHAWkRD2qIdNXGbguHiBVBk1ZV+T/0W89efW+tQJ8dPooJX+Ng
		cypSJJWGClLjW7zSTYK8Nl1iMEsY9O8OpAg5e+WwImL7JgXssTOPj3I5rdLoKP7K
		wuGHe9yRHVZ5PZI5rUQWTY6ST5aN8rbMsOegQFJj18lPdvQAd9kfm2NI9wYKAHSC
		-----END CERTIFICATE-----
	""".trimIndent()
}
