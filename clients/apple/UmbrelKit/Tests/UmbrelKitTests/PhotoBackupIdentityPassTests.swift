import Foundation
import XCTest
@testable import UmbrelKit

final class PhotoBackupIdentityPassTests: XCTestCase {
	private var directory: URL!
	private var ledger: PhotoBackupLedger!

	override func setUpWithError() throws {
		directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
		try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
		ledger = try XCTUnwrap(PhotoBackupLedger(url: directory.appendingPathComponent("photo-backup.sqlite")))
	}

	override func tearDownWithError() throws {
		ledger = nil
		try? FileManager.default.removeItem(at: directory)
	}

	func testAssetWorkVisitsEachAssetOnceInPages() throws {
		try ledger.seedInventory(["a", "b", "c"].map { candidate($0) }, deviceId: "source", changeToken: Data())
		let first = try ledger.assetWork(
			deviceId: "source", states: [.pending], includePhotos: true, includeVideos: true, limit: 2)
		XCTAssertEqual(first.assets.map(\.localIdentifier), ["a", "b"])
		// Left as they were, the first two don't come round again
		let second = try ledger.assetWork(
			deviceId: "source", states: [.pending], includePhotos: true, includeVideos: true,
			after: try XCTUnwrap(first.nextRow), limit: 2)
		XCTAssertEqual(second.assets.map(\.localIdentifier), ["c"])
		XCTAssertNil(second.nextRow)
		// Another source's assets, or ones in other states, aren't part of the walk
		XCTAssertTrue(try ledger.assetWork(
			deviceId: "other", states: [.pending], includePhotos: true, includeVideos: true, limit: 2).assets.isEmpty)
		XCTAssertTrue(try ledger.assetWork(
			deviceId: "source", states: [.uploaded], includePhotos: true, includeVideos: true, limit: 2).assets.isEmpty)
	}

	func testIdentitiesAreSentOnlyForFilesAlreadyBackedUp() async throws {
		try seedSentLivePhotoAndEditedPhoto()
		var sent = [String]()
		var ingested = false
		let pass = makePass(
			// So a photo edited since the ledger last looked isn't named with its original's identity
			ingest: {
				ingested = true
				return .complete
			},
			claim: { claims in
				XCTAssertTrue(ingested)
				sent += claims.map(\.resourceKey)
				return []
			}
		)

		let outcome = try await pass.run()

		XCTAssertEqual(outcome, .completed)
		XCTAssertEqual(sent, ["live-still"])
	}

	func testAnErrorFromTheUmbrelIsAskedAgainAndOneThatLastsEndsThePass() async throws {
		try seedSentLivePhotoAndEditedPhoto()
		var asked = 0
		let passing = makePass(claim: { _ in
			asked += 1
			if asked == 1 { throw Umbreld.Error(status: 500, message: "database is locked") }
			return []
		})
		let passingOutcome = try await passing.run()
		XCTAssertEqual(passingOutcome, .completed)
		XCTAssertEqual(asked, 2)

		asked = 0
		let lasting = makePass(claim: { _ in
			asked += 1
			throw Umbreld.Error(status: 500, message: "Internal server error")
		})
		let lastingOutcome = try await lasting.run()
		XCTAssertEqual(lastingOutcome, .declined)
		// Once, then once after each wait
		XCTAssertEqual(asked, 3)
	}

	func testAnUmbrelThatWontTakeClaimsEndsThePassAndOneOutOfReachWaits() async throws {
		try seedSentLivePhotoAndEditedPhoto()
		// umbrelOS without claims answers 401, which asking again won't change
		var asked = 0
		let declined = makePass(claim: { _ in
			asked += 1
			throw Umbreld.Error(status: 401, message: "unauthorized")
		})
		let declinedOutcome = try await declined.run()
		XCTAssertEqual(declinedOutcome, .declined)
		XCTAssertEqual(asked, 1)

		let unreachable = makePass(claim: { _ in
			throw Umbreld.Error(status: 0, message: "offline", kind: .connectivity)
		})
		let unreachableOutcome = try await unreachable.run()
		XCTAssertEqual(unreachableOutcome, .interrupted)
	}

	func testAStoppedPassSendsNothing() async throws {
		try seedSentLivePhotoAndEditedPhoto()
		let pass = makePass(claim: { _ in
			XCTFail("A stopped pass sent identities")
			return []
		})
		pass.stop()
		let outcome = try await pass.run()
		XCTAssertEqual(outcome, .interrupted)
	}

	// MARK: - Helpers

	// A Live Photo whose still was sent and whose motion wasn't, a sent photo edited since,
	// and a photo still waiting to upload
	private func seedSentLivePhotoAndEditedPhoto() throws {
		try ledger.seedInventory(
			[candidate("live-photo"), candidate("waiting"), candidate("edited")],
			deviceId: "source",
			changeToken: Data()
		)
		try ledger.prepareAsset(
			deviceId: "source",
			localIdentifier: "live-photo",
			revision: 1,
			resources: [
				.init(resourceKey: "live-still", filename: "a.heic", destinationPath: "source/live-still.heic"),
				.init(resourceKey: "live-motion", filename: "a.mov", destinationPath: "source/live-motion.mov"),
			]
		)
		try ledger.recordResourceSucceeded(resourceKey: "live-still", bytes: 3)
		try ledger.prepareAsset(
			deviceId: "source",
			localIdentifier: "edited",
			revision: 1,
			resources: [.init(resourceKey: "edited-still", filename: "b.heic", destinationPath: "source/edited-still.heic")]
		)
		try ledger.recordResourceSucceeded(resourceKey: "edited-still", bytes: 3)
	}

	private func makePass(
		ingest: @escaping () throws -> PhotoBackupAppPass.Ingestion = { .complete },
		claim: @escaping ([Umbreld.PhotoBackupResourceClaim]) async throws -> [Umbreld.PhotoBackupResourceReceipt]
	) -> PhotoBackupIdentityPass {
		PhotoBackupIdentityPass(
			sourceId: "source",
			includePhotos: true,
			includeVideos: true,
			ledger: ledger,
			environment: .init(
				ingest: ingest,
				identify: { works in
					works.flatMap { work in
						switch work.localIdentifier {
						case "live-photo": self.files(work, ["live-still", "live-motion"])
						// An edited asset has no identity
						case "edited": self.files(work, ["edited-still"], identified: false)
						default: self.files(work, ["waiting-still"])
						}
					}
				},
				claim: claim
			),
			retryDelays: [0, 0]
		)
	}

	private func files(
		_ work: PhotoBackupLedger.AssetWork,
		_ keys: [String],
		identified: Bool = true
	) -> [Umbreld.PhotoBackupResourceClaim] {
		keys.map { key in
			.init(
				resourceKey: key,
				fileExtension: "heic",
				identity: identified
					? PhotoBackupCloudIdentity(cloudIdentifier: "cloud-\(work.localIdentifier)", role: .photo)!
					: nil
			)
		}
	}

	private func candidate(_ identifier: String) -> PhotoBackupLedger.AssetCandidate {
		.init(
			localIdentifier: identifier,
			mediaType: 1,
			creationDate: Date(timeIntervalSince1970: 1),
			modificationDate: Date(timeIntervalSince1970: 1)
		)
	}
}
