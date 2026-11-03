import Foundation
@testable import UmbrelKit
import XCTest

final class PhotoBackupConfigurationTests: XCTestCase {
	private let source = PhotoBackupSource(id: "source", accountId: "0", name: "iPhone")

	func testPhotoBackupStorageIsExcludedFromDeviceBackups() throws {
		let directory = FileManager.default.temporaryDirectory
			.appendingPathComponent(UUID().uuidString, isDirectory: true)
		addTeardownBlock { try? FileManager.default.removeItem(at: directory) }

		try PhotoBackupStore.prepareStorageDirectory(at: directory)

		let values = try directory.resourceValues(forKeys: [.isExcludedFromBackupKey])
		XCTAssertEqual(values.isExcludedFromBackup, true)
	}

	func testUploadDestinationMatchesSameOrigin() {
		let configuration = makeConfiguration(base: "http://100.90.0.1")
		var request = URLRequest(url: URL(string: "http://100.90.0.1:80/api/photos/upload")!)
		request.allowsCellularAccess = false
		request.setValue("Bearer current-grant", forHTTPHeaderField: "Authorization")

		XCTAssertTrue(configuration.matchesUploadDestination(request, grant: "current-grant"))
	}

	func testUploadDestinationRejectsChangedOriginOrCellularPolicy() {
		let configuration = makeConfiguration(base: "http://100.90.0.1")
		var renamed = URLRequest(url: URL(string: "http://100.90.0.2/api/photos/upload")!)
		renamed.allowsCellularAccess = false
		renamed.setValue("Bearer current-grant", forHTTPHeaderField: "Authorization")
		var secure = URLRequest(url: URL(string: "https://100.90.0.1/api/photos/upload")!)
		secure.allowsCellularAccess = false
		secure.setValue("Bearer current-grant", forHTTPHeaderField: "Authorization")
		var cellular = URLRequest(url: URL(string: "http://100.90.0.1/api/photos/upload")!)
		cellular.allowsCellularAccess = true
		cellular.setValue("Bearer current-grant", forHTTPHeaderField: "Authorization")

		XCTAssertFalse(configuration.matchesUploadDestination(renamed, grant: "current-grant"))
		XCTAssertFalse(configuration.matchesUploadDestination(secure, grant: "current-grant"))
		XCTAssertFalse(configuration.matchesUploadDestination(cellular, grant: "current-grant"))
	}

	func testUploadDestinationRequiresCurrentGrant() {
		let configuration = makeConfiguration(base: "http://100.90.0.1")
		var request = URLRequest(url: URL(string: "http://100.90.0.1/api/photos/upload")!)
		request.allowsCellularAccess = false

		XCTAssertFalse(configuration.matchesUploadDestination(request, grant: "current-grant"))
		request.setValue("Bearer previous-grant", forHTTPHeaderField: "Authorization")
		XCTAssertFalse(configuration.matchesUploadDestination(request, grant: "current-grant"))
		request.setValue("Bearer current-grant", forHTTPHeaderField: "Authorization")
		XCTAssertTrue(configuration.matchesUploadDestination(request, grant: "current-grant"))
	}

	func testRetargetPreservesUploadRequestAndReplacesOrigin() throws {
		let configuration = makeConfiguration(base: "http://100.90.0.2")
		var request = URLRequest(url: URL(string: "http://100.90.0.1/api/photos/upload?part=1")!)
		request.httpMethod = "POST"
		request.setValue("value", forHTTPHeaderField: "X-Test")
		request.allowsCellularAccess = true

		let retargeted = try XCTUnwrap(configuration.retargetUploadDestination(request))

		XCTAssertEqual(retargeted.url?.absoluteString, "http://100.90.0.2/api/photos/upload?part=1")
		XCTAssertEqual(retargeted.httpMethod, "POST")
		XCTAssertEqual(retargeted.value(forHTTPHeaderField: "X-Test"), "value")
		XCTAssertFalse(retargeted.allowsCellularAccess)
	}

	func testOnlyHTTPOverTailscaleIsAnEligibleDestination() {
		XCTAssertTrue(makeConfiguration(base: "http://100.64.0.1").isTailscaleDestination)
		XCTAssertTrue(makeConfiguration(base: "http://100.127.255.254").isTailscaleDestination)
		XCTAssertFalse(makeConfiguration(base: "http://192.168.1.10").isTailscaleDestination)
		XCTAssertFalse(makeConfiguration(base: "http://100.128.0.1").isTailscaleDestination)
		XCTAssertFalse(makeConfiguration(base: "https://100.90.0.1").isTailscaleDestination)
		XCTAssertFalse(makeConfiguration(base: "http://100.90.0.invalid.1").isTailscaleDestination)
	}

	func testNonTailscaleDestinationCannotMatchOrRetargetARequest() {
		let configuration = makeConfiguration(base: "http://umbrel.local")
		var request = URLRequest(url: URL(string: "http://umbrel.local/api/photos/upload")!)
		request.allowsCellularAccess = false

		XCTAssertFalse(configuration.matchesUploadDestination(request, grant: "current-grant"))
		XCTAssertNil(configuration.retargetUploadDestination(request))
	}

	func testConfigurationRequiresCellularPreference() {
		for json in [
			#"{"deviceId":"device","uploadBaseURL":"http://umbrel.local","source":{"id":"source","accountId":"0","name":"iPhone"},"includePhotos":true,"includeVideos":false}"#,
			#"{"deviceId":"device","uploadBaseURL":"http://umbrel.local","source":{"id":"source","accountId":"0","name":"iPhone"},"includePhotos":true,"includeVideos":false,"allowsCellularAccess":null}"#,
		] {
			XCTAssertThrowsError(
				try JSONDecoder().decode(PhotoBackupConfiguration.self, from: Data(json.utf8))
			)
		}
	}

	func testConfigurationSavedBeforeRoutesIsTailscale() throws {
		let json = #"{"deviceId":"device","uploadBaseURL":"http://100.90.0.1","source":{"id":"source","accountId":"0","name":"iPhone"},"includePhotos":true,"includeVideos":false,"allowsCellularAccess":false}"#
		let configuration = try JSONDecoder().decode(PhotoBackupConfiguration.self, from: Data(json.utf8))

		XCTAssertEqual(configuration.route, .tailscale)
		XCTAssertTrue(configuration.hasValidRoute)
		let appRoute = PhotoBackupConfiguration(
			deviceId: "device",
			route: .app,
			uploadBaseURL: "",
			source: source,
			includePhotos: true,
			includeVideos: true
		)
		XCTAssertEqual(
			try JSONDecoder().decode(PhotoBackupConfiguration.self, from: JSONEncoder().encode(appRoute)),
			appRoute
		)
	}

	func testAppRouteNeverGivesPhotoKitADestination() {
		let configuration = PhotoBackupConfiguration(
			deviceId: "device",
			route: .app,
			uploadBaseURL: "",
			source: source,
			includePhotos: true,
			includeVideos: true
		)
		var request = URLRequest(url: URL(string: "http://100.90.0.1/api/photos/upload")!)
		request.allowsCellularAccess = false
		request.setValue("Bearer current-grant", forHTTPHeaderField: "Authorization")

		XCTAssertTrue(configuration.hasValidRoute)
		XCTAssertFalse(configuration.isTailscaleDestination)
		XCTAssertFalse(configuration.matchesUploadDestination(request, grant: "current-grant"))
		XCTAssertNil(configuration.retargetUploadDestination(request))
		// A Tailscale address on the app route, or none on the Tailscale route, is invalid
		XCTAssertFalse(PhotoBackupConfiguration(
			deviceId: "device", route: .app, uploadBaseURL: "http://100.90.0.1", source: source,
			includePhotos: true, includeVideos: true
		).hasValidRoute)
		XCTAssertFalse(makeConfiguration(base: "").hasValidRoute)
	}

	func testPresentationIsOffForDormantRememberedIntent() {
		XCTAssertEqual(
			presentation(intentEnabled: true, targetActive: false),
			.off
		)
	}

	func testPresentationSetsUpUntilEveryActiveFactMatches() {
		XCTAssertEqual(presentation(configurationMatchesTarget: false), .settingUp)
		XCTAssertEqual(presentation(extensionEnabled: false), .settingUp)
		XCTAssertEqual(presentation(snapshotMatchesSource: false), .settingUp)
		XCTAssertEqual(presentation(snapshotPhase: .disabled), .settingUp)
	}

	func testPresentationKeepsPreconfigurationFailureVisible() {
		XCTAssertEqual(
			presentation(
				configurationMatchesTarget: false,
				extensionEnabled: false,
				snapshotMatchesSource: false,
				snapshotPhase: .disabled,
				setupFailed: true
			),
			.failed
		)
	}

	func testPresentationIsActiveOnlyWhenPhotoKitAndSourceAreActive() {
		XCTAssertEqual(presentation(), .active)
	}

	private func presentation(
		intentEnabled: Bool = true,
		targetActive: Bool = true,
		configurationMatchesTarget: Bool = true,
		extensionEnabled: Bool = true,
		snapshotMatchesSource: Bool = true,
		snapshotPhase: PhotoBackupPhase = .waiting,
		setupInProgress: Bool = false,
		setupFailed: Bool = false
	) -> PhotoBackupPresentationMode {
		PhotoBackupPresentationMode.resolve(
			intentEnabled: intentEnabled,
			targetActive: targetActive,
			configurationMatchesTarget: configurationMatchesTarget,
			extensionEnabled: extensionEnabled,
			snapshotMatchesSource: snapshotMatchesSource,
			snapshotPhase: snapshotPhase,
			setupInProgress: setupInProgress,
			setupFailed: setupFailed
		)
	}

	private func makeConfiguration(base: String) -> PhotoBackupConfiguration {
		PhotoBackupConfiguration(
			deviceId: "device",
			uploadBaseURL: base,
			source: source,
			includePhotos: true,
			includeVideos: true
		)
	}
}
