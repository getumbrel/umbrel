import Foundation
import XCTest
@testable import UmbrelKit

final class PhotoBackupAppPassTests: XCTestCase {
	private let sourceId = "source"
	private var directory: URL!
	private var ledger: PhotoBackupLedger!
	private var shared: SharedState!
	private var umbrel: FakeUmbrel!
	private var liveIdentifiers: Set<String> = []
	private var unreadable: Set<String> = []
	private var lookups: [String] = []
	private var leaving = false
	private var leaveAfterUploads: Int?
	private var route = PhotoBackupConfiguration.Route.app
	private var onUpload: (() throws -> Void)?

	override func setUpWithError() throws {
		directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
		try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
		ledger = try XCTUnwrap(PhotoBackupLedger(url: directory.appendingPathComponent("photo-backup.sqlite")))
		shared = SharedState()
		umbrel = FakeUmbrel()
		liveIdentifiers = []
		unreadable = []
		lookups = []
		leaving = false
		leaveAfterUploads = nil
		route = .app
		onUpload = nil
	}

	override func tearDownWithError() throws {
		try? FileManager.default.removeItem(at: directory)
	}

	func testUploadsNewestFirstAndFinishesUpToDate() async throws {
		try seed(["old": 1, "new": 3, "middle": 2])
		liveIdentifiers = ["new"]

		let outcome = try await makePass().run()

		XCTAssertEqual(outcome, .completed)
		// A Live Photo sends its still and its motion as two files
		XCTAssertEqual(umbrel.sent.map(\.name), ["new.photo", "new.motion", "middle.photo", "old.photo"])
		XCTAssertEqual(umbrel.sent.first?.headers["Authorization"], "Bearer grant")
		XCTAssertEqual(umbrel.sent.first?.body, Data("new.photo".utf8))
		XCTAssertEqual(shared.snapshot.phase, .upToDate)
		XCTAssertEqual(shared.snapshot.statistics?.uploadedPhotoCount, 3)
		// Each file is removed once it's sent
		let leftovers = try FileManager.default.contentsOfDirectory(atPath: directory.appendingPathComponent("files").path)
		XCTAssertEqual(leftovers, [])
	}

	func testUnreachableUmbrelReadsNothingUntilItAnswers() async throws {
		try seed(["a": 1, "b": 2])
		umbrel.connectError = Umbreld.Error(status: 0, message: "", kind: .connectivity)

		let away = try await makePass().run()

		XCTAssertEqual(away, .unreachable)
		XCTAssertEqual(lookups, [])
		XCTAssertEqual(shared.snapshot.phase, .waitingForUmbrel)

		// Back home, but the connection drops mid-upload: still waiting
		umbrel.connectError = nil
		umbrel.responses = ["b.photo": .failure(URLError(.timedOut))]
		let stillAway = try await makePass().run()
		XCTAssertEqual(stillAway, .unreachable)
		XCTAssertEqual(umbrel.sent.map(\.name), ["b.photo"])
		XCTAssertEqual(shared.snapshot.phase, .waitingForUmbrel)

		umbrel.responses = [:]
		let home = try await makePass().run()
		XCTAssertEqual(home, .completed)
		XCTAssertEqual(umbrel.sent.map(\.name), ["b.photo", "b.photo", "a.photo"])
		XCTAssertEqual(shared.snapshot.phase, .upToDate)
	}

	func testRefusedIdentityWaitsLikeAnUnreachableUmbrel() async throws {
		try seed(["a": 1])
		umbrel.responses = ["a.photo": .failure(Umbreld.Error(status: 0, message: "", kind: .trust))]

		let outcome = try await makePass().run()

		XCTAssertEqual(outcome, .unreachable)
		XCTAssertEqual(shared.snapshot.phase, .waitingForUmbrel)
		XCTAssertEqual(try ledger.statistics(deviceId: sourceId, includePhotos: true, includeVideos: true).failedCount, 0)
	}

	func testRefusedGrantPausesUntilTryAgain() async throws {
		try seed(["a": 1, "b": 2])
		umbrel.responses = ["b.photo": .status(401)]

		let refused = try await makePass().run()

		XCTAssertEqual(refused, .waitingForUser)
		XCTAssertEqual(shared.snapshot.phase, .needsAttention)
		XCTAssertEqual(shared.snapshot.issue, .authenticationRequired)
		XCTAssertEqual(umbrel.sent.map(\.name), ["b.photo"])

		// Nothing more is sent while the grant is refused
		umbrel.responses = [:]
		try await expectPass(.waitingForUser)
		XCTAssertEqual(umbrel.sent.count, 1)

		shared.recoveryRetry = sourceId
		try await expectPass(.completed)
		XCTAssertNil(shared.recoveryRetry)
		XCTAssertEqual(umbrel.sent.map(\.name), ["b.photo", "b.photo", "a.photo"])
		XCTAssertEqual(shared.snapshot.phase, .upToDate)
		XCTAssertNil(shared.snapshot.issue)
	}

	func testFullUmbrelPausesThenProbesWithOneResource() async throws {
		try seed(["a": 1, "b": 2, "c": 3])
		umbrel.responses = ["c.photo": .status(507)]

		try await expectPass(.waitingForUser)
		XCTAssertEqual(shared.snapshot.issue, .insufficientStorage)
		XCTAssertEqual(umbrel.sent.map(\.name), ["c.photo"])

		// Paused: nothing is sent until the user asks
		try await expectPass(.waitingForUser)
		XCTAssertEqual(umbrel.sent.count, 1)

		// Still full: the probe sends one file and pauses again
		shared.storageRetry = sourceId
		try await expectPass(.waitingForUser)
		XCTAssertEqual(umbrel.sent.map(\.name), ["c.photo", "c.photo"])
		XCTAssertNil(shared.storageRetry)
		XCTAssertEqual(shared.snapshot.issue, .insufficientStorage)

		// Space freed: the probe succeeds and the rest follow
		umbrel.responses = [:]
		shared.storageRetry = sourceId
		try await expectPass(.completed)
		XCTAssertEqual(umbrel.sent.map(\.name), ["c.photo", "c.photo", "c.photo", "b.photo", "a.photo"])
		XCTAssertNil(shared.snapshot.issue)
		XCTAssertEqual(shared.snapshot.phase, .upToDate)
	}

	func testServerErrorsInARowEndThePassAndRetryAfterTheRest() async throws {
		try seed(["a": 1, "b": 2, "c": 3, "d": 4])
		umbrel.responses = ["d.photo": .status(503), "c.photo": .status(500)]

		try await expectPass(.retryLater)
		XCTAssertEqual(umbrel.sent.map(\.name), ["d.photo", "c.photo"])
		XCTAssertEqual(shared.snapshot.phase, .waiting)

		// The rest go through, then the failed two are tried once more
		umbrel.responses = [:]
		try await expectPass(.moreWork)
		XCTAssertEqual(umbrel.sent.map(\.name), ["d.photo", "c.photo", "b.photo", "a.photo"])
		try await expectPass(.completed)
		XCTAssertEqual(umbrel.sent.map(\.name).suffix(2), ["d.photo", "c.photo"])
		XCTAssertEqual(shared.snapshot.phase, .upToDate)
	}

	func testOneServerErrorBetweenSuccessesKeepsGoing() async throws {
		try seed(["a": 1, "b": 2, "c": 3])
		umbrel.responses = ["b.photo": .status(500)]

		try await expectPass(.moreWork)
		XCTAssertEqual(umbrel.sent.map(\.name), ["c.photo", "b.photo", "a.photo"])
	}

	func testRejectedFileIsTriedOnceMoreThenNeedsAttention() async throws {
		try seed(["a": 1])
		umbrel.responses = ["a.photo": .status(415)]

		try await expectPass(.moreWork)
		// Without new progress, a file that fails again isn't retried in a loop
		try await expectPass(.completed)
		XCTAssertEqual(umbrel.sent.map(\.name), ["a.photo", "a.photo"])
		XCTAssertEqual(shared.snapshot.phase, .needsAttention)
		XCTAssertNil(shared.snapshot.issue)
		XCTAssertEqual(shared.snapshot.statistics?.failedCount, 1)
	}

	func testSuccessWithoutAReceiptIsNotABackup() async throws {
		try seed(["a": 1])
		umbrel.responses = ["a.photo": .receipt(key: "someone-else")]

		_ = try await makePass().run()

		XCTAssertEqual(shared.snapshot.statistics?.uploadedCount, 0)
	}

	func testRemovedAssetIsDroppedWithoutSending() async throws {
		try seed(["a": 1, "gone": 2])
		umbrel.removed = ["gone"]

		try await expectPass(.completed)
		XCTAssertEqual(umbrel.sent.map(\.name), ["a.photo"])
		XCTAssertEqual(shared.snapshot.phase, .upToDate)
	}

	func testCancellingLeavesTheFileQueued() async throws {
		try seed(["a": 1])
		umbrel.responses = ["a.photo": .failure(CancellationError())]

		do {
			_ = try await makePass().run()
			XCTFail("Expected cancellation")
		} catch is CancellationError {}

		umbrel.responses = [:]
		try await expectPass(.completed)
		XCTAssertEqual(umbrel.sent.map(\.name), ["a.photo", "a.photo"])
	}

	func testStoppedLedgerEndsThePassWithoutAnError() async throws {
		try seed(["a": 1, "b": 2])
		// The app's time runs out while the first file is sent
		onUpload = { [unowned self] in ledger.stop() }

		do {
			_ = try await makePass().run()
			XCTFail("Expected cancellation")
		} catch is CancellationError {}

		XCTAssertEqual(umbrel.sent.map(\.name), ["b.photo"])
		XCTAssertEqual(shared.snapshot.phase, .uploading)
		XCTAssertNil(shared.snapshot.lastError)
	}

	func testUnreadableFilesInARowEndThePassAndKeepAProbeOpen() async throws {
		try seed(["a": 1, "b": 2, "c": 3, "d": 4])
		unreadable = ["d.photo", "c.photo"]

		// Like a server error: two in a row back off instead of failing the library
		try await expectPass(.retryLater)
		// The batch is looked up so it can be claimed, but nothing after is read or sent
		XCTAssertEqual(lookups, ["d", "c", "b", "a"])
		XCTAssertEqual(umbrel.sent.count, 0)

		// A storage probe that can't read its file stays open
		shared.snapshot = PhotoBackupSnapshot(phase: .needsAttention, issue: .insufficientStorage, sourceId: sourceId)
		shared.storageRetry = sourceId
		try await expectPass(.retryLater)
		XCTAssertEqual(shared.snapshot.issue, .insufficientStorage)
		XCTAssertEqual(shared.snapshot.phase, .checkingStorage)
		XCTAssertEqual(shared.storageRetry, sourceId)
	}

	func testLivePhotoStillReachingTheUmbrelIsProgress() async throws {
		try seed(["live": 3, "b": 2, "a": 1])
		liveIdentifiers = ["live"]
		umbrel.responses = ["live.motion": .status(500), "b.photo": .status(500)]

		// The still went through, so one server error after it doesn't end the pass
		try await expectPass(.moreWork)
		XCTAssertEqual(umbrel.sent.map(\.name), ["live.photo", "live.motion", "b.photo", "a.photo"])
		// Only the motion is sent again
		umbrel.responses = [:]
		try await expectPass(.completed)
		XCTAssertEqual(umbrel.sent.map(\.name).suffix(2), ["live.motion", "b.photo"])
	}

	func testFilesTheAccountHasAreClaimedInsteadOfSent() async throws {
		try seed(["new": 3, "live": 2, "old": 1])
		liveIdentifiers = ["live"]
		umbrel.has = ["old.photo", "live.photo"]

		try await expectPass(.completed)

		// One question for the batch, before anything is sent
		XCTAssertEqual(umbrel.claims, [["new.photo", "live.photo", "live.motion", "old.photo"].map(key)])
		XCTAssertEqual(umbrel.sent.map(\.name), ["new.photo", "live.motion"])
		XCTAssertEqual(shared.snapshot.phase, .upToDate)
		XCTAssertEqual(shared.snapshot.statistics?.uploadedPhotoCount, 3)
	}

	func testAnUmbrelThatDoesntClaimGetsEveryFileAndIsAskedOnce() async throws {
		try seed(Dictionary(uniqueKeysWithValues: (1...20).map { ("asset\($0)", TimeInterval($0)) }))
		// umbrelOS before claims answers 401
		umbrel.claimError = Umbreld.Error(status: 401, message: "unauthorized")

		try await expectPass(.completed)

		XCTAssertEqual(umbrel.sent.count, 20)
		XCTAssertEqual(umbrel.claims.count, 1)
		XCTAssertEqual(shared.snapshot.phase, .upToDate)
	}

	func testAnUnansweredClaimSendsTheBatchAndAsksAgainForTheNext() async throws {
		try seed(Dictionary(uniqueKeysWithValues: (1...20).map { ("asset\($0)", TimeInterval($0)) }))
		umbrel.claimError = Umbreld.Error(status: 0, message: "offline", kind: .connectivity)

		try await expectPass(.completed)

		XCTAssertEqual(umbrel.sent.count, 20)
		XCTAssertEqual(umbrel.claims.count, 2)
	}

	func testAServerErrorSendsTheBatchAndTheNextIsStillClaimed() async throws {
		try seed(Dictionary(uniqueKeysWithValues: (1...20).map { ("asset\($0)", TimeInterval($0)) }))
		umbrel.has = Set((1...20).map { "asset\($0).photo" })
		umbrel.claimErrorsOnce = [Umbreld.Error(status: 503, message: "Service unavailable")]

		try await expectPass(.completed)

		// The first batch of 16 uploads, and the 4 after it are claimed
		XCTAssertEqual(umbrel.claims.count, 2)
		XCTAssertEqual(umbrel.sent.count, 16)
		XCTAssertEqual(shared.snapshot.phase, .upToDate)
	}

	func testFilesPhotoKitHoldsAreClaimedBeforeTheAppSendsThem() async throws {
		route = .tailscale
		try seed(["a": 1, "b": 2])
		try holdForPhotoKit("a")
		umbrel.has = ["a.photo"]

		try await expectPass(.completed)

		XCTAssertEqual(umbrel.sent.map(\.name), ["b.photo"])
		XCTAssertEqual(umbrel.claims, [[key("b.photo")], [key("a.photo")]])
		XCTAssertEqual(try resourceState("a"), PhotoBackupLedger.resourceSucceeded)
	}

	func testLeavingTheAppFinishesTheFileInFlightAndStops() async throws {
		try seed(["a": 1, "b": 2, "c": 3])
		leaveAfterUploads = 1

		try await expectPass(.moreWork)
		XCTAssertEqual(umbrel.sent.map(\.name), ["c.photo"])
		XCTAssertEqual(shared.snapshot.phase, .waiting)
	}

	func testCopiesLeftByAKilledAppAreRemoved() async throws {
		let files = directory.appendingPathComponent("files", isDirectory: true)
		try FileManager.default.createDirectory(at: files, withIntermediateDirectories: true)
		try Data("leftover".utf8).write(to: files.appendingPathComponent("leftover"))

		try await expectPass(.completed)

		XCTAssertFalse(FileManager.default.fileExists(atPath: files.appendingPathComponent("leftover").path))
	}

	func testWithoutBackgroundUploadsFilesLeftWithPhotoKitAreSentInOrder() async throws {
		try seed(["a": 1, "b": 2, "c": 3])
		try holdForPhotoKit("c")

		try await expectPass(.completed)
		XCTAssertEqual(umbrel.sent.map(\.name), ["c.photo", "b.photo", "a.photo"])
	}

	func testFilesPhotoKitHoldsGoLastAndStayItsOnFailure() async throws {
		route = .tailscale
		try seed(["a": 1, "b": 2, "c": 3, "d": 4, "e": 5])
		try holdForPhotoKit("e")
		try holdForPhotoKit("d")
		try holdForPhotoKit("c")
		umbrel.responses = ["d.photo": .status(500), "c.photo": .status(503)]

		try await expectPass(.completed)

		// The rest first, so its job may still deliver the held files
		XCTAssertEqual(umbrel.sent.map(\.name), ["b.photo", "a.photo", "e.photo", "d.photo", "c.photo"])
		XCTAssertEqual(try resourceState("e"), PhotoBackupLedger.resourceSucceeded)
		// A server error is the job's to retry, and doesn't end the pass
		XCTAssertEqual(try resourceState("d"), PhotoBackupLedger.resourceRegistered)
		XCTAssertEqual(try resourceState("c"), PhotoBackupLedger.resourceRegistered)
		XCTAssertEqual(shared.snapshot.statistics?.failedCount, 0)
	}

	func testUmbrelRefusingAHeldFileCountsAsFailed() async throws {
		route = .tailscale
		try seed(["a": 1])
		try holdForPhotoKit("a")
		umbrel.responses = ["a.photo": .status(415)]

		// Tried once more after the rest, then it needs attention like any refused file
		try await expectPass(.moreWork)
		try await expectPass(.completed)
		XCTAssertEqual(umbrel.sent.map(\.name), ["a.photo", "a.photo"])
		XCTAssertEqual(shared.snapshot.statistics?.failedCount, 1)
		XCTAssertEqual(shared.snapshot.phase, .needsAttention)
	}

	func testFilesPhotoKitTakesMidPassAreStillSent() async throws {
		route = .tailscale
		try seed(["a": 1, "b": 2, "c": 3, "d": 4])
		// The extension creates jobs for c and b while the app sends d
		onUpload = { [unowned self] in
			guard umbrel.sent.count == 1 else { return }
			try holdForPhotoKit("c")
			try holdForPhotoKit("b")
		}

		try await expectPass(.completed)
		XCTAssertEqual(umbrel.sent.map(\.name), ["d.photo", "a.photo", "c.photo", "b.photo"])
		XCTAssertEqual(shared.snapshot.statistics?.uploadedCount, 4)
	}

	func testTailscaleWaitDoesNotHoldTheAppBack() async throws {
		route = .tailscale
		try seed(["a": 1, "b": 2])
		// PhotoKit's extension couldn't reach the Umbrel over Tailscale
		shared.snapshot = PhotoBackupSnapshot(phase: .waitingForUmbrel, sourceId: sourceId)

		try await expectPass(.completed)
		XCTAssertEqual(umbrel.sent.map(\.name), ["b.photo", "a.photo"])
		// Reaching the Umbrel another way doesn't end the extension's wait for Tailscale
		XCTAssertEqual(shared.snapshot.phase, .waitingForUmbrel)
		XCTAssertEqual(shared.snapshot.statistics?.uploadedCount, 2)
	}

	// MARK: - Harness

	private func makePass() -> PhotoBackupAppPass {
		let configuration = PhotoBackupConfiguration(
			deviceId: "device",
			route: route,
			uploadBaseURL: route == .tailscale ? "http://100.64.0.1" : "",
			source: PhotoBackupSource(id: sourceId, accountId: "account", name: "iPhone"),
			includePhotos: true,
			includeVideos: true
		)
		return PhotoBackupAppPass(
			configuration: configuration,
			grant: "grant",
			ledger: ledger,
			environment: .init(
				ingest: { .complete },
				lookup: { [unowned self] work, grant in
					lookups.append(work.localIdentifier)
					if umbrel.removed.contains(work.localIdentifier) { return .removed }
					let names = liveIdentifiers.contains(work.localIdentifier)
						? ["\(work.localIdentifier).photo", "\(work.localIdentifier).motion"]
						: ["\(work.localIdentifier).photo"]
					return .resources(names.map { name in
						PhotoBackupAppPass.Resource(
							plan: plan(name),
							headers: ["Authorization": "Bearer \(grant)", "X-Name": name],
							claim: .init(resourceKey: key(name), fileExtension: "heic", identity: nil),
							write: { [unowned self] url in
								if unreadable.contains(name) { throw CocoaError(.fileReadUnknown) }
								try Data(name.utf8).write(to: url)
							}
						)
					})
				},
				connect: { [unowned self] in
					if let error = umbrel.connectError { throw error }
				},
				upload: { [unowned self] file, headers in
					let response = try umbrel.receive(file: file, headers: headers, key: key)
					try onUpload?()
					if let leaveAfterUploads, umbrel.sent.count >= leaveAfterUploads { leaving = true }
					return response
				},
				claim: { [unowned self] claims in
					try umbrel.claim(claims, key: key)
				},
				shouldYield: { [unowned self] in leaving }
			),
			state: shared.state,
			directory: directory.appendingPathComponent("files", isDirectory: true)
		)
	}

	// As PhotoKit's extension does when it creates the asset's upload job
	private func holdForPhotoKit(_ identifier: String) throws {
		let work = try XCTUnwrap(
			ledger.nextAssets(deviceId: sourceId, includePhotos: true, includeVideos: true, limit: 100)
				.first { $0.localIdentifier == identifier }
		)
		try ledger.prepareAsset(
			deviceId: sourceId,
			localIdentifier: identifier,
			revision: work.revision,
			resources: [plan("\(identifier).photo")]
		)
		try ledger.markResourcesRegistered([key("\(identifier).photo")])
	}

	private func resourceState(_ identifier: String) throws -> Int64? {
		try ledger.resources(deviceId: sourceId, localIdentifier: identifier, revision: 1).first?.state
	}

	private func expectPass(
		_ expected: PhotoBackupAppPass.Outcome,
		file: StaticString = #filePath,
		line: UInt = #line
	) async throws {
		let outcome = try await makePass().run()
		XCTAssertEqual(outcome, expected, file: file, line: line)
	}

	private func seed(_ assets: [String: TimeInterval]) throws {
		try ledger.seedInventory(
			assets.map { identifier, created in
				PhotoBackupLedger.AssetCandidate(
					localIdentifier: identifier,
					mediaType: 1,
					creationDate: Date(timeIntervalSince1970: created),
					modificationDate: Date(timeIntervalSince1970: created)
				)
			},
			deviceId: sourceId,
			changeToken: Data()
		)
	}

	private func key(_ name: String) -> String {
		PhotoBackupResourceKey.stableKey(namespace: "test", parts: [name])
	}

	private func plan(_ name: String) -> PhotoBackupLedger.ResourcePlan {
		.init(resourceKey: key(name), filename: name, destinationPath: "\(sourceId)/\(name)")
	}

	private final class SharedState {
		var snapshot = PhotoBackupSnapshot.disabled
		var storageRetry: String?
		var recoveryRetry: String?

		var state: PhotoBackupAppPass.SharedState {
			.init(
				snapshot: { [unowned self] in snapshot },
				publish: { [unowned self] in snapshot = $0 },
				storageRetryRequested: { [unowned self] in storageRetry == $0 },
				clearStorageRetryRequest: { [unowned self] in storageRetry = nil },
				recoveryRetryRequested: { [unowned self] in recoveryRetry == $0 },
				clearRecoveryRetryRequest: { [unowned self] in if recoveryRetry == $0 { recoveryRetry = nil } }
			)
		}
	}

	private final class FakeUmbrel {
		enum Response {
			case status(Int)
			case receipt(key: String)
			case failure(Error)
		}

		var connectError: Error?
		var responses: [String: Response] = [:]
		var removed: Set<String> = []
		// Files this backup already has
		var has: Set<String> = []
		var claimError: Error?
		// Answered in turn before claimError
		var claimErrorsOnce: [Error] = []
		private(set) var sent: [(name: String, headers: [String: String], body: Data)] = []
		private(set) var claims: [[String]] = []

		func claim(
			_ resources: [Umbreld.PhotoBackupResourceClaim],
			key: (String) -> String
		) throws -> [Umbreld.PhotoBackupResourceReceipt] {
			claims.append(resources.map(\.resourceKey))
			if !claimErrorsOnce.isEmpty { throw claimErrorsOnce.removeFirst() }
			if let claimError { throw claimError }
			let keys = Set(has.map(key))
			return resources.filter { keys.contains($0.resourceKey) }.map { .init(resourceKey: $0.resourceKey, bytes: 7) }
		}

		func receive(
			file: URL,
			headers: [String: String],
			key: (String) -> String
		) throws -> Umbreld.PhotoBackupUploadResponse {
			let name = headers["X-Name"] ?? ""
			sent.append((name, headers, try Data(contentsOf: file)))
			switch responses[name] {
			case .status(let status):
				return .init(statusCode: status, headers: [:])
			case .receipt(let otherKey):
				return .init(statusCode: 200, headers: ["x-umbrel-photo-backup-key": otherKey, "x-umbrel-upload-bytes": "9"])
			case .failure(let error):
				throw error
			case nil:
				return .init(statusCode: 200, headers: ["x-umbrel-photo-backup-key": key(name), "x-umbrel-upload-bytes": "9"])
			}
		}
	}
}
