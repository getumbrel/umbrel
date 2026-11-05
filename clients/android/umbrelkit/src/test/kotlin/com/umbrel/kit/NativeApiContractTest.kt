package com.umbrel.kit

import kotlinx.serialization.KSerializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import java.net.SocketTimeoutException

class NativeApiContractTest {
	private val nativeClient = NativeClientInfo(
		id = "umbrel",
		platform = "android",
		deviceClass = "phone",
		appVersion = "0.1",
		appBuild = "20",
		osVersion = "16",
	)
	private val nativeClientJson = """{"id":"umbrel","platform":"android","deviceClass":"phone","appVersion":"0.1","appBuild":"20","osVersion":"16"}"""

	@Test
	fun identityAndAccountResponsesDecodeWithAdditionalFields() {
		val localIdentity: Umbreld.LocalHttpsIdentity = decode("""{"result":{"data":{"id":"device-id","caCertificate":"pem","future":true}}}""")
		assertEquals("device-id", localIdentity.id)
		assertEquals("pem", localIdentity.caCertificate)

		val discovery: Umbreld.DiscoveryInfo = decode("""{"result":{"data":{"id":"device-id","device":"umbrel-home","onboarded":true,"version":"2.0"}}}""")
		assertEquals("device-id", discovery.id)
		assertEquals("umbrel-home", discovery.device)
		assertTrue(discovery.onboarded)

		val avatar = "/api/accounts/alice/avatar/${"a".repeat(64)}.webp"
		val accounts: List<Umbreld.Account> = decode(
			"""{"result":{"data":[{"userId":"alice","name":"Alice","wallpaper":{"id":"1","brandColorHsl":"259 100% 59%"},"avatarUrl":"$avatar","future":"value"},{"userId":"bob","name":"Bob","wallpaper":{"id":"2","brandColorHsl":"6 56% 54%"}}]}}""",
		)
		assertEquals(2, accounts.size)
		assertEquals("alice", accounts[0].userId)
		assertEquals("Alice", accounts[0].name)
		assertEquals("1", accounts[0].wallpaper.id)
		assertEquals("259 100% 59%", accounts[0].wallpaper.brandColorHsl)
		assertEquals(avatar, accounts[0].avatarUrl)
		assertNull(accounts[1].avatarUrl)
	}

	@Test
	fun internalStorageDevicesDecodeAndMarkRaidCandidates() {
		val devices: List<Umbreld.InternalStorageDevice> = decode(
			"""{"result":{"data":[{"type":"ssd","device":"nvme0n1","id":"nvme-system","isSystemDrive":true,"future":1},{"type":"hdd","device":"sda","id":"ata-disk"},{"type":"ssd","device":"nvme1n1","isSystemDrive":false}]}}""",
		)
		assertEquals(listOf(false, true, false), devices.map { it.isRaidCandidate })
	}

	@Test
	fun nativeSessionResponsesDecode() {
		val login: Umbreld.NativeSessionResponse = decode(
			"""{"result":{"data":{"accountId":"alice","accessToken":"access","accessExpiresAt":1787000000000,"deviceToken":"device","future":true}}}""",
		)
		val session = login.session("umbrel-id")
		assertEquals("umbrel-id", session.deviceId)
		assertEquals("alice", session.accountId)
		assertEquals("access", session.accessToken)
		assertEquals(1_787_000_000_000, session.accessExpiresAt)
		assertEquals("device", session.deviceToken)

		val refresh: Umbreld.NativeAccessResponse = decode("""{"result":{"data":{"accessToken":"new-access","accessExpiresAt":1787000001000}}}""")
		assertEquals("new-access", refresh.accessToken)
		assertEquals(1_787_000_001_000, refresh.accessExpiresAt)
		assertNull(refresh.dashboardToken)

		val withBrowserSession: Umbreld.NativeAccessResponse = decode(
			"""{"result":{"data":{"accessToken":"new-access","accessExpiresAt":1787000001000,"dashboardToken":"dashboard"}}}""",
		)
		assertEquals("dashboard", withBrowserSession.dashboardToken)
	}

	@Test
	fun userAndDashboardResponsesDecode() {
		val user: Umbreld.UserInfo = decode(
			"""{"result":{"data":{"userId":"alice","name":"Alice","role":"member","homePath":"/Users/alice","sambaEnabled":true,"sambaUsername":"umbrel-user-alice","wallpaper":{"id":"2","brandColorHsl":"6 56% 54%"},"language":"en"}}}""",
		)
		assertEquals("alice", user.userId)
		assertEquals("member", user.role)
		assertEquals("/Users/alice", user.homePath)
		assertTrue(user.sambaEnabled)
		assertEquals("umbrel-user-alice", user.sambaUsername)
		assertEquals("2", user.wallpaper.id)
		assertEquals("6 56% 54%", user.wallpaper.brandColorHsl)

		val apps: List<Umbreld.AppSummary> = decode(
			"""
			{"result":{"data":[
			  {"id":"files","name":"Files","version":"1.0.0","icon":"https://example.com/icon.svg","state":"ready","port":3000,"path":"/web","torOnly":false,"requiresHttps":true,"credentials":{"defaultUsername":"umbrel","showBeforeOpen":true},"future":"value"},
			  {"id":"broken","error":"manifest unavailable"}
			]}}
			""".trimIndent(),
		)
		assertEquals(2, apps.size)
		assertEquals("files", apps[0].id)
		assertEquals(true, apps[0].requiresHttps)
		assertEquals("umbrel", apps[0].credentials?.defaultUsername)
		assertNull(apps[0].credentials?.defaultPassword)
		assertEquals("broken", apps[1].id)
		assertNull(apps[1].name)

		val updates: List<Umbreld.AppUpdate> = decode("""{"result":{"data":[{"id":"files","version":"1.1.0","future":1}]}}""")
		assertEquals("files", updates.first().id)
		assertEquals("1.1.0", updates.first().version)

		val usage: Umbreld.DiskUsage = decode(
			"""{"result":{"data":{"size":1000,"totalUsed":650.5,"system":100,"files":200.25,"apps":[{"id":"files","used":300.25}],"machines":[{"id":"ubuntu","name":"Ubuntu","osId":"ubuntu","used":50}]}}}""",
		)
		assertEquals(1000.0, usage.size, 0.0)
		assertEquals(650.5, usage.totalUsed, 0.0)
		assertEquals(300.25, usage.appsUsed, 0.0)
		assertEquals(50.0, usage.machinesUsed, 0.0)

		val legacyUsage: Umbreld.DiskUsage = decode(
			"""{"result":{"data":{"size":1000,"totalUsed":600.5,"system":100,"files":200.25,"apps":[{"id":"files","used":300.25}]}}}""",
		)
		assertEquals(0.0, legacyUsage.machinesUsed, 0.0)
	}

	@Test
	fun photoGrantAndFinderResponsesDecode() {
		val grant: Umbreld.PhotoBackupGrant = decode(
			"""{"result":{"data":{"token":"photo-token","source":{"id":"123e4567-e89b-12d3-a456-426614174000","accountId":"alice","name":"Alice’s iPhone","createdAt":1787000000000}}}}""",
		)
		assertEquals("photo-token", grant.token)
		assertEquals("alice", grant.source.accountId)

		val receipts: List<Umbreld.PhotoBackupResourceReceipt> = decode("""{"result":{"data":[{"resourceKey":"${"a".repeat(64)}","bytes":42}]}}""")
		assertEquals(42L, receipts.first().bytes)

		val favorites: List<String> = decode("""{"result":{"data":["/Home/Downloads"]}}""")
		assertEquals(listOf("/Home/Downloads"), favorites)

		val shares: List<Umbreld.Share> = decode("""{"result":{"data":[{"name":"Home","path":"/Home","sharename":"Home","available":true}]}}""")
		assertEquals("Home", shares.first().name)
		assertEquals("/Home", shares.first().path)
		assertEquals("Home", shares.first().sharename)

		val password: String = decode("""{"result":{"data":"smb-password"}}""")
		assertEquals("smb-password", password)

		val result: Boolean = decode("""{"result":{"data":true}}""")
		assertTrue(result)
	}

	@Test
	fun photoSourcesDecodeAndFindPhoneBackups() {
		val sources: List<Umbreld.PhotoSourceSummary> = decode(
			"""{"result":{"data":[{"id":"umbrel","type":"umbrel","name":"Umbrel","createdAt":0,"stats":{"photos":120,"videos":4,"sizeBytes":9},"scope":{"mode":"everything","paths":[]}},{"id":"iphone:a","type":"iphone","name":"Pixel","createdAt":1,"stats":{"photos":0,"videos":0,"sizeBytes":0}},{"id":"iphone:b","type":"iphone","name":"Nate’s Pixel","createdAt":1,"stats":{"photos":0,"videos":3,"sizeBytes":5},"future":true},{"id":"iphone:c","type":"iphone","name":"Old Pixel","createdAt":1,"lastImportAt":1700000000000,"stats":{"photos":0,"videos":0,"sizeBytes":0}}]}}""",
		)
		assertEquals(listOf("Umbrel", "Pixel", "Nate’s Pixel", "Old Pixel"), sources.map { it.name })
		// This Umbrel's own library and a phone that never imported anything don't count. One
		// whose counts read 0 while the index rebuilds still does.
		assertEquals(listOf(false, false, true, true), sources.map { it.isPhoneWithBackups })
	}

	@Test
	fun newSourceCheckAsksOnlyWhenTheAccountHasPhoneBackups() {
		val library = Umbreld.PhotoSourceSummary("umbrel", "Umbrel", Umbreld.PhotoSourceSummary.Stats(500, 9))
		val older = Umbreld.PhotoSourceSummary("iphone", "Old Pixel", Umbreld.PhotoSourceSummary.Stats(10, 0), lastImportAt = 1.0)
		val newer = Umbreld.PhotoSourceSummary("iphone", "Nate’s Pixel", Umbreld.PhotoSourceSummary.Stats(10, 0), lastImportAt = 2.0)
		val empty = Umbreld.PhotoSourceSummary("iphone", "Pixel", Umbreld.PhotoSourceSummary.Stats(0, 0))
		// umbrelOS records Android phones as "iphone" for now; "android" is the type they get later
		val tablet = Umbreld.PhotoSourceSummary("android", "Tablet", Umbreld.PhotoSourceSummary.Stats(3, 0))

		assertEquals(Umbreld.NewPhotoBackupSourceCheck.Proceed, Umbreld.NewPhotoBackupSourceCheck.resolve(Result.success(listOf(library, empty))))
		assertEquals(
			Umbreld.NewPhotoBackupSourceCheck.Ask(listOf("Nate’s Pixel", "Old Pixel")),
			Umbreld.NewPhotoBackupSourceCheck.resolve(Result.success(listOf(library, older, newer))),
		)
		assertEquals(Umbreld.NewPhotoBackupSourceCheck.Ask(listOf("Tablet")), Umbreld.NewPhotoBackupSourceCheck.resolve(Result.success(listOf(library, tablet))))
	}

	// Wait means the request didn't get through, timed out included. Setup then waits only while
	// the Umbrel can't be reached (PhotoBackupManagerTest), so a slow Umbrel isn't asked again on
	// every refresh.
	@Test
	fun newSourceCheckWaitsOnlyWhenTheRequestDidNotGetThrough() {
		assertEquals(
			Umbreld.NewPhotoBackupSourceCheck.Wait,
			Umbreld.NewPhotoBackupSourceCheck.resolve(Result.failure(Umbreld.Error(0, "offline", Umbreld.ErrorKind.CONNECTIVITY))),
		)
		assertEquals(
			Umbreld.NewPhotoBackupSourceCheck.Wait,
			Umbreld.NewPhotoBackupSourceCheck.resolve(Result.failure(Umbreld.Error(0, "Could not reach umbrel.local", Umbreld.ErrorKind.CONNECTIVITY, timedOut = true))),
		)
		assertEquals(Umbreld.NewPhotoBackupSourceCheck.Wait, Umbreld.NewPhotoBackupSourceCheck.resolve(Result.failure(SocketTimeoutException())))
		// A server or decoding error is a real failure, never a wait
		assertEquals(
			Umbreld.NewPhotoBackupSourceCheck.Fail("Photos library is unavailable"),
			Umbreld.NewPhotoBackupSourceCheck.resolve(Result.failure(Umbreld.Error(500, "Photos library is unavailable"))),
		)
		assertEquals(
			Umbreld.NewPhotoBackupSourceCheck.Fail("photos.sources.list: unexpected response"),
			Umbreld.NewPhotoBackupSourceCheck.resolve(Result.failure(Umbreld.Error(200, "photos.sources.list: unexpected response"))),
		)
	}

	@Test
	fun shippedMutationPayloadsKeepTheirWireKeys() {
		assertWire(
			"""{"userId":"alice","password":"secret","client":$nativeClientJson}""",
			Umbreld.NativeLoginInput.serializer(),
			Umbreld.NativeLoginInput(userId = "alice", password = "secret", totpToken = null, client = nativeClient),
		)
		assertWire(
			"""{"userId":"alice","password":"secret","totpToken":"123456","client":$nativeClientJson}""",
			Umbreld.NativeLoginInput.serializer(),
			Umbreld.NativeLoginInput(userId = "alice", password = "secret", totpToken = "123456", client = nativeClient),
		)
		assertWire(
			"""{"deviceToken":"device-token","client":$nativeClientJson}""",
			Umbreld.NativeRefreshInput.serializer(),
			Umbreld.NativeRefreshInput(deviceToken = "device-token", client = nativeClient),
		)
		assertWire(
			"""{"deviceToken":"device-token","client":$nativeClientJson,"browserSession":true}""",
			Umbreld.NativeRefreshInput.serializer(),
			Umbreld.NativeRefreshInput(deviceToken = "device-token", client = nativeClient, browserSession = true),
		)
		assertWire(
			"""{"sourceId":"123e4567-e89b-12d3-a456-426614174000","suggestedName":"Alice’s iPhone"}""",
			Umbreld.PhotoBackupGrantInput.serializer(),
			Umbreld.PhotoBackupGrantInput(sourceId = "123e4567-e89b-12d3-a456-426614174000", suggestedName = "Alice’s iPhone"),
		)
		assertWire(
			"""{"sourceId":"123e4567-e89b-12d3-a456-426614174000","resources":[{"resourceKey":"${"a".repeat(64)}","fileExtension":"heic"}]}""",
			Umbreld.PhotoBackupResourceReceiptInput.serializer(),
			Umbreld.PhotoBackupResourceReceiptInput(
				sourceId = "123e4567-e89b-12d3-a456-426614174000",
				resources = listOf(Umbreld.PhotoBackupResourceQuery(resourceKey = "a".repeat(64), fileExtension = "heic")),
			),
		)
		assertWire("""{"appId":"files","value":true}""", Umbreld.HideCredentialsInput.serializer(), Umbreld.HideCredentialsInput(appId = "files", value = true))
		assertWire("""{"path":"/Home/Documents"}""", Umbreld.AddShareInput.serializer(), Umbreld.AddShareInput(path = "/Home/Documents"))
		assertWire("{}", Umbreld.EmptyInput.serializer(), Umbreld.EmptyInput())
	}

	@Test
	fun trpcErrorEnvelopePreservesStatusAndTwoFactorSignal() {
		val error = assertThrows(Umbreld.Error::class.java) { decode<Boolean>("""{"error":{"message":"Missing 2FA code"}}""", status = 401) }

		assertEquals(401, error.status)
		assertTrue(error.isAuthError)
		assertTrue(error.requiresTwoFactorAuthentication)
		assertEquals("Missing 2FA code", error.message)
	}

	@Test
	fun malformedSuccessEnvelopeIsRejected() {
		val error = assertThrows(Umbreld.Error::class.java) {
			decode<Umbreld.NativeAccessResponse>("""{"result":{"data":{"accessToken":"missing-expiry"}}}""")
		}

		assertEquals(200, error.status)
		assertEquals("native.contract: unexpected response", error.message)
	}

	// Not in the Swift suite: envelope edge cases the Kotlin decoder handles explicitly.

	@Test
	fun missingDataOrABodyThatIsNotJsonIsRejected() {
		for (body in listOf("""{"result":{}}""", "not json", """{"result":{"data":null}}""")) {
			val error = assertThrows(body, Umbreld.Error::class.java) { decode<Boolean>(body) }
			assertEquals("native.contract: unexpected response", error.message)
		}
	}

	@Test
	fun aNullableResultMayBeNull() {
		val hostname: String? = decode("""{"result":{"data":null}}""")
		assertNull(hostname)
	}

	@Test
	fun anErrorStatusWithoutAMessageNamesTheProcedure() {
		val error = assertThrows(Umbreld.Error::class.java) { decode<Boolean>("<html>Bad gateway</html>", status = 502) }

		assertEquals(502, error.status)
		assertEquals("native.contract failed (502)", error.message)
	}

	private inline fun <reified T> decode(json: String, status: Int = 200): T =
		Umbreld.decodeEnvelope(HttpResult(status, json.toByteArray(), "application/json"), "native.contract")

	private fun <T> assertWire(expected: String, serializer: KSerializer<T>, value: T) {
		val encoded: JsonElement = Json.parseToJsonElement(Umbreld.json.encodeToString(serializer, value))
		assertEquals(Json.parseToJsonElement(expected), encoded)
	}
}
