import Foundation
import XCTest
@testable import UmbrelKit

final class NativeAPIContractTests: XCTestCase {
	private let nativeClient = Umbreld.NativeClient(
		id: "umbrel",
		platform: "ios",
		deviceClass: "phone",
		appVersion: "0.1",
		appBuild: "20",
		osVersion: "26.6.1")

	func testIdentityAndAccountResponsesDecodeWithAdditionalFields() throws {
		let localIdentity: Umbreld.LocalHTTPSIdentity = try decode(
			#"{"result":{"data":{"id":"device-id","caCertificate":"pem","future":true}}}"#)
		XCTAssertEqual(localIdentity.id, "device-id")
		XCTAssertEqual(localIdentity.caCertificate, "pem")

		let discovery: Umbreld.DiscoveryInfo = try decode(
			#"{"result":{"data":{"id":"device-id","device":"umbrel-home","onboarded":true,"version":"2.0"}}}"#)
		XCTAssertEqual(discovery.id, "device-id")
		XCTAssertEqual(discovery.device, "umbrel-home")
		XCTAssertTrue(discovery.onboarded)

		let accounts: [Umbreld.Account] = try decode(
			#"{"result":{"data":[{"userId":"alice","name":"Alice","wallpaper":{"id":"1","brandColorHsl":"259 100% 59%"},"avatarUrl":"/api/accounts/alice/avatar/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.webp","future":"value"},{"userId":"bob","name":"Bob","wallpaper":{"id":"2","brandColorHsl":"6 56% 54%"}}]}}"#)
		XCTAssertEqual(accounts.count, 2)
		XCTAssertEqual(accounts[0].userId, "alice")
		XCTAssertEqual(accounts[0].name, "Alice")
		XCTAssertEqual(accounts[0].wallpaper.id, "1")
		XCTAssertEqual(accounts[0].wallpaper.brandColorHsl, "259 100% 59%")
		XCTAssertEqual(
			accounts[0].avatarUrl,
			"/api/accounts/alice/avatar/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.webp")
		XCTAssertNil(accounts[1].avatarUrl)
	}

	func testInternalStorageDevicesDecodeAndMarkRAIDCandidates() throws {
		let devices: [Umbreld.InternalStorageDevice] = try decode(
			#"{"result":{"data":[{"type":"ssd","device":"nvme0n1","id":"nvme-system","isSystemDrive":true,"future":1},{"type":"hdd","device":"sda","id":"ata-disk"},{"type":"ssd","device":"nvme1n1","isSystemDrive":false}]}}"#)
		XCTAssertEqual(devices.map(\.isRAIDCandidate), [false, true, false])
	}

	func testNativeSessionResponsesDecode() throws {
		let login: Umbreld.NativeSessionResponse = try decode(
			#"{"result":{"data":{"accountId":"alice","accessToken":"access","accessExpiresAt":1787000000000,"deviceToken":"device","future":true}}}"#)
		let session = login.session(deviceId: "umbrel-id")
		XCTAssertEqual(session.deviceId, "umbrel-id")
		XCTAssertEqual(session.accountId, "alice")
		XCTAssertEqual(session.accessToken, "access")
		XCTAssertEqual(session.accessExpiresAt, 1_787_000_000_000)
		XCTAssertEqual(session.deviceToken, "device")

		let refresh: Umbreld.NativeAccessResponse = try decode(
			#"{"result":{"data":{"accessToken":"new-access","accessExpiresAt":1787000001000}}}"#)
		XCTAssertEqual(refresh.accessToken, "new-access")
		XCTAssertEqual(refresh.accessExpiresAt, 1_787_000_001_000)
	}

	func testUserAndDashboardResponsesDecode() throws {
		let user: Umbreld.UserInfo = try decode(
			#"{"result":{"data":{"userId":"alice","name":"Alice","role":"member","homePath":"/Users/alice","sambaEnabled":true,"sambaUsername":"umbrel-user-alice","wallpaper":{"id":"2","brandColorHsl":"6 56% 54%"},"language":"en"}}}"#)
		XCTAssertEqual(user.userId, "alice")
		XCTAssertEqual(user.role, "member")
		XCTAssertEqual(user.homePath, "/Users/alice")
		XCTAssertTrue(user.sambaEnabled)
		XCTAssertEqual(user.sambaUsername, "umbrel-user-alice")
		XCTAssertEqual(user.wallpaper.id, "2")
		XCTAssertEqual(user.wallpaper.brandColorHsl, "6 56% 54%")

		let apps: [Umbreld.AppSummary] = try decode(
			"""
			{"result":{"data":[
			  {"id":"files","name":"Files","version":"1.0.0","icon":"https://example.com/icon.svg","state":"ready","port":3000,"path":"/web","torOnly":false,"requiresHttps":true,"credentials":{"defaultUsername":"umbrel","showBeforeOpen":true},"future":"value"},
			  {"id":"broken","error":"manifest unavailable"}
			]}}
			""")
		XCTAssertEqual(apps.count, 2)
		XCTAssertEqual(apps[0].id, "files")
		XCTAssertEqual(apps[0].requiresHttps, true)
		XCTAssertEqual(apps[0].credentials?.defaultUsername, "umbrel")
		XCTAssertNil(apps[0].credentials?.defaultPassword)
		XCTAssertEqual(apps[1].id, "broken")
		XCTAssertNil(apps[1].name)

		let updates: [Umbreld.AppUpdate] = try decode(
			#"{"result":{"data":[{"id":"files","version":"1.1.0","future":1}]}}"#)
		XCTAssertEqual(updates.first?.id, "files")
		XCTAssertEqual(updates.first?.version, "1.1.0")

		let usage: Umbreld.DiskUsage = try decode(
			#"{"result":{"data":{"size":1000,"totalUsed":650.5,"system":100,"files":200.25,"apps":[{"id":"files","used":300.25}],"machines":[{"id":"ubuntu","name":"Ubuntu","osId":"ubuntu","used":50}]}}}"#)
		XCTAssertEqual(usage.size, 1000)
		XCTAssertEqual(usage.totalUsed, 650.5)
		XCTAssertEqual(usage.appsUsed, 300.25)
		XCTAssertEqual(usage.machinesUsed, 50)

		let legacyUsage: Umbreld.DiskUsage = try decode(
			#"{"result":{"data":{"size":1000,"totalUsed":600.5,"system":100,"files":200.25,"apps":[{"id":"files","used":300.25}]}}}"#)
		XCTAssertEqual(legacyUsage.machinesUsed, 0)
	}

	func testPhotoGrantAndFinderResponsesDecode() throws {
		let grant: Umbreld.PhotoBackupGrant = try decode(
			#"{"result":{"data":{"token":"photo-token","source":{"id":"123e4567-e89b-12d3-a456-426614174000","accountId":"alice","name":"Alice’s iPhone","createdAt":1787000000000}}}}"#)
		XCTAssertEqual(grant.token, "photo-token")
		XCTAssertEqual(grant.source.accountId, "alice")

		let receipts: [Umbreld.PhotoBackupResourceReceipt] = try decode(
			#"{"result":{"data":[{"resourceKey":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","bytes":42}]}}"#)
		XCTAssertEqual(receipts.first?.bytes, 42)

		let favorites: [String] = try decode(#"{"result":{"data":["/Home/Downloads"]}}"#)
		XCTAssertEqual(favorites, ["/Home/Downloads"])

		let shares: [Umbreld.Share] = try decode(
			#"{"result":{"data":[{"name":"Home","path":"/Home","sharename":"Home","available":true}]}}"#)
		XCTAssertEqual(shares.first?.name, "Home")
		XCTAssertEqual(shares.first?.path, "/Home")
		XCTAssertEqual(shares.first?.sharename, "Home")

		let password: String = try decode(#"{"result":{"data":"smb-password"}}"#)
		XCTAssertEqual(password, "smb-password")

		let result: Bool = try decode(#"{"result":{"data":true}}"#)
		XCTAssertTrue(result)
	}

	func testShippedMutationPayloadsKeepTheirWireKeys() throws {
		XCTAssertEqual(
			try jsonObject(
				Umbreld.NativeLoginInput(
					userId: "alice", password: "secret", totpToken: nil, client: nativeClient)),
			[
				"userId": "alice",
				"password": "secret",
				"client": nativeClientJson,
			])
		XCTAssertEqual(
			try jsonObject(
				Umbreld.NativeLoginInput(
					userId: "alice", password: "secret", totpToken: "123456", client: nativeClient)),
			[
				"userId": "alice",
				"password": "secret",
				"totpToken": "123456",
				"client": nativeClientJson,
			])
		XCTAssertEqual(
			try jsonObject(Umbreld.NativeRefreshInput(deviceToken: "device-token", client: nativeClient)),
			["deviceToken": "device-token", "client": nativeClientJson])
		XCTAssertEqual(
			try jsonObject(
				Umbreld.PhotoBackupGrantInput(
					sourceId: "123e4567-e89b-12d3-a456-426614174000",
					suggestedName: "Alice’s iPhone")),
			[
				"sourceId": "123e4567-e89b-12d3-a456-426614174000",
				"suggestedName": "Alice’s iPhone",
			])
		XCTAssertEqual(
			try jsonObject(
				Umbreld.PhotoBackupResourceReceiptInput(
					sourceId: "123e4567-e89b-12d3-a456-426614174000",
					resources: [
						.init(
							resourceKey: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
							fileExtension: "heic"
						),
					]
				)
			),
			[
				"sourceId": "123e4567-e89b-12d3-a456-426614174000",
				"resources": [[
					"resourceKey": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
					"fileExtension": "heic",
				]],
			]
		)
		XCTAssertEqual(
			try jsonObject(Umbreld.HideCredentialsInput(appId: "files", value: true)),
			["appId": "files", "value": true])
		XCTAssertEqual(
			try jsonObject(Umbreld.AddShareInput(path: "/Home/Documents")),
			["path": "/Home/Documents"])
		XCTAssertEqual(try jsonObject(Umbreld.EmptyInput()), [:])
	}

	private var nativeClientJson: NSDictionary {
		[
			"id": "umbrel",
			"platform": "ios",
			"deviceClass": "phone",
			"appVersion": "0.1",
			"appBuild": "20",
			"osVersion": "26.6.1",
		]
	}

	func testTRPCErrorEnvelopePreservesStatusAndTwoFactorSignal() throws {
		XCTAssertThrowsError(
			try decode(#"{"error":{"message":"Missing 2FA code"}}"#, status: 401) as Bool
		) { error in
			guard let error = error as? Umbreld.Error else {
				return XCTFail("Expected Umbreld.Error, got \(error)")
			}
			XCTAssertEqual(error.status, 401)
			XCTAssertTrue(error.isAuthError)
			XCTAssertTrue(error.requiresTwoFactorAuthentication)
			XCTAssertEqual(error.message, "Missing 2FA code")
		}
	}

	func testMalformedSuccessEnvelopeIsRejected() throws {
		XCTAssertThrowsError(
			try decode(#"{"result":{"data":{"accessToken":"missing-expiry"}}}"#) as Umbreld.NativeAccessResponse
		) { error in
			guard let error = error as? Umbreld.Error else {
				return XCTFail("Expected Umbreld.Error, got \(error)")
			}
			XCTAssertEqual(error.status, 200)
			XCTAssertEqual(error.message, "native.contract: unexpected response")
		}
	}

	private func decode<T: Decodable>(_ json: String, status: Int = 200) throws -> T {
		try Umbreld.decodeEnvelope(
			data: Data(json.utf8),
			status: status,
			path: "native.contract")
	}

	private func jsonObject<T: Encodable>(_ value: T) throws -> [String: AnyHashable] {
		let object = try JSONSerialization.jsonObject(with: JSONEncoder().encode(value))
		return try XCTUnwrap(object as? [String: AnyHashable])
	}
}
