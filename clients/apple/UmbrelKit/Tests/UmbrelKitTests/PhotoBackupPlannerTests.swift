import Foundation
import XCTest
@testable import UmbrelKit

final class PhotoBackupPlannerTests: XCTestCase {
	// Fixed vectors computed outside Swift from the formula. Every backed-up resource on
	// every Umbrel is keyed this way: if one of these changes, every library uploads again.
	func testResourceKeysNeverChange() {
		let source = "3f2504e0-4f89-41d3-9a0c-0305e82c3301"
		let photo = "1A2B3C4D-0000-4000-8000-ABCDEFABCDEF/L0/001"
		let edited = Date(timeIntervalSince1970: 1_700_000_000.25)
		XCTAssertEqual(
			PhotoBackupResourceKey.make(sourceId: source, localIdentifier: photo, contentVersionDate: edited, role: .photo),
			"9759be4eddded58e55293f24df3c03a312692f319a28b6234ab7846db42534a0")
		XCTAssertEqual(
			PhotoBackupResourceKey.make(sourceId: source, localIdentifier: photo, contentVersionDate: edited, role: .livePhotoMotion),
			"ef3d183dc2424df6d331a177a4c10e589fd261f3d169a267ba5d6dbf5d507111")
		XCTAssertEqual(
			PhotoBackupResourceKey.make(
				sourceId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
				localIdentifier: "VIDEO-ID/L0/001",
				contentVersionDate: Date(timeIntervalSince1970: 0),
				role: .video),
			"f000cc1be1a3a71d1e3f22115a2318599cef530dac71497d662e5cf767d07602")
		XCTAssertEqual(PhotoBackupResourceRole.livePhotoMotion.rawValue, "live-photo-motion")
	}

	func testResourceKeyValidation() {
		XCTAssertTrue(PhotoBackupResourceKey.isValid(String(repeating: "a1", count: 32)))
		XCTAssertFalse(PhotoBackupResourceKey.isValid(String(repeating: "A1", count: 32)))
		XCTAssertFalse(PhotoBackupResourceKey.isValid("abc"))
	}

	func testUploadHeadersMatchWhatUmbreldReads() {
		let headers = PhotoBackupUpload.headers(
			resourceKey: "key",
			fileExtension: "heic",
			originalFilename: "IMG_0001 \u{2014} \u{1F600}.HEIC",
			sourceCreationDateMilliseconds: 1_700_000_000_250,
			mimeType: "image/heic",
			grant: "grant-token")
		XCTAssertEqual(headers["Authorization"], "Bearer grant-token")
		XCTAssertEqual(headers["X-Umbrel-Photo-Backup-Key"], "key")
		XCTAssertEqual(headers["X-Umbrel-Photo-Backup-Extension"], "heic")
		XCTAssertEqual(
			headers["X-Umbrel-Photo-Original-Filename-Base64"].flatMap { Data(base64Encoded: $0) }
				.flatMap { String(data: $0, encoding: .utf8) },
			"IMG_0001 \u{2014} \u{1F600}.HEIC")
		XCTAssertEqual(headers["X-Umbrel-Photo-Creation-Date-Ms"], "1700000000250")
		XCTAssertEqual(headers["Content-Type"], "image/heic")

		let undated = PhotoBackupUpload.headers(
			resourceKey: "key", fileExtension: "bin", originalFilename: "x", sourceCreationDateMilliseconds: nil,
			mimeType: nil, grant: "g")
		XCTAssertNil(undated["X-Umbrel-Photo-Creation-Date-Ms"])
		XCTAssertEqual(undated["Content-Type"], "application/octet-stream")
		// An edited file has no identity, and sends neither header
		XCTAssertNil(undated["X-Umbrel-Photo-Cloud-Identifier-Base64"])
		XCTAssertNil(undated["X-Umbrel-Photo-Resource-Role"])
	}

	func testCloudIdentityIsSentTogetherAndOnlyWhenUmbreldCanStoreIt() throws {
		let identity = try XCTUnwrap(PhotoBackupCloudIdentity(cloudIdentifier: "9F2A\u{2014}:001:AbC", role: .livePhotoMotion))
		let headers = PhotoBackupUpload.headers(
			resourceKey: "key", fileExtension: "mov", originalFilename: "x.mov", sourceCreationDateMilliseconds: nil,
			mimeType: nil, grant: "g", cloudIdentity: identity)
		XCTAssertEqual(
			headers["X-Umbrel-Photo-Cloud-Identifier-Base64"].flatMap { Data(base64Encoded: $0) }
				.flatMap { String(data: $0, encoding: .utf8) },
			"9F2A\u{2014}:001:AbC")
		XCTAssertEqual(headers["X-Umbrel-Photo-Resource-Role"], "live-photo-motion")

		// umbreld refuses the whole upload over an identity it can't store, so these never go
		XCTAssertNil(PhotoBackupCloudIdentity(cloudIdentifier: "", role: .photo))
		XCTAssertNil(PhotoBackupCloudIdentity(cloudIdentifier: "a\nb", role: .photo))
		XCTAssertNil(PhotoBackupCloudIdentity(cloudIdentifier: String(repeating: "a", count: 1_025), role: .photo))
		XCTAssertNotNil(PhotoBackupCloudIdentity(cloudIdentifier: String(repeating: "a", count: 1_024), role: .video))
	}

	func testFileExtensionAndCreationDate() {
		XCTAssertEqual(PhotoBackupUpload.fileExtension(originalFilename: "IMG_1.HEIC", preferredFilenameExtension: "jpeg"), "heic")
		XCTAssertEqual(PhotoBackupUpload.fileExtension(originalFilename: "noext", preferredFilenameExtension: "MOV"), "mov")
		XCTAssertEqual(PhotoBackupUpload.fileExtension(originalFilename: "a.we!rd", preferredFilenameExtension: nil), "bin")
		XCTAssertNil(PhotoBackupUpload.sourceCreationDateMilliseconds(.distantPast))
		XCTAssertEqual(PhotoBackupUpload.sourceCreationDateMilliseconds(Date(timeIntervalSince1970: 1.25)), 1250)
	}

	func testUploadOutcomes() {
		let key = String(repeating: "ab", count: 32)
		func outcome(_ status: Int, _ headers: [String: String] = [:]) -> PhotoBackupUpload.Outcome {
			PhotoBackupUpload.outcome(statusCode: status, responseHeaders: headers, expectedResourceKey: key)
		}
		XCTAssertEqual(
			outcome(200, ["X-Umbrel-Photo-Backup-Key": key, "X-Umbrel-Upload-Bytes": "1234"]),
			.succeeded(bytes: 1234))
		// A success that doesn't name this resource isn't a receipt
		XCTAssertEqual(outcome(200, ["X-Umbrel-Photo-Backup-Key": "other", "X-Umbrel-Upload-Bytes": "1"]), .temporaryFailure)
		XCTAssertEqual(outcome(507), .insufficientStorage)
		XCTAssertEqual(outcome(500, ["x-umbrel-photo-backup-error": "insufficient-storage"]), .insufficientStorage)
		XCTAssertEqual(outcome(401), .authenticationRequired)
		XCTAssertEqual(outcome(503), .temporaryFailure)
		XCTAssertEqual(outcome(429), .temporaryFailure)
		XCTAssertEqual(outcome(415), .rejected("The Umbrel rejected this file (415)"))

		XCTAssertEqual(PhotoBackupUpload.outcome(failure: URLError(.timedOut)), .unreachable)
		XCTAssertEqual(
			PhotoBackupUpload.outcome(failure: Umbreld.Error(status: 0, message: "", kind: .connectivity)),
			.unreachable)
		XCTAssertEqual(PhotoBackupUpload.outcome(failure: Umbreld.Error(status: 401, message: "")), .authenticationRequired)
		XCTAssertEqual(
			PhotoBackupUpload.outcome(failure: Umbreld.Error(status: 0, message: "", kind: .trust)),
			.unreachable)
		XCTAssertEqual(
			PhotoBackupUpload.outcome(failure: Umbreld.Error(status: 0, message: "", kind: .protocolFailure)),
			.temporaryFailure)
	}
	func testClaimRequestMatchesWhatUmbreldReads() throws {
		let claim = Umbreld.PhotoBackupResourceClaim(
			resourceKey: String(repeating: "a", count: 64),
			fileExtension: "heic",
			identity: try XCTUnwrap(PhotoBackupCloudIdentity(cloudIdentifier: "ABC:001:xyz", role: .photo))
		)
		let request = try PhotoBackupUpload.claimRequest(
			url: try XCTUnwrap(URL(string: "http://100.64.0.1/api/photos/claim")),
			grant: "photo-grant",
			resources: [claim]
		)
		XCTAssertEqual(request.httpMethod, "POST")
		// The grant names the backup, as it does for uploads
		XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer photo-grant")
		XCTAssertEqual(request.value(forHTTPHeaderField: "Content-Type"), "application/json")
		let body = try XCTUnwrap(JSONSerialization.jsonObject(with: try XCTUnwrap(request.httpBody)) as? NSDictionary)
		XCTAssertEqual(body, [
			"resources": [[
				"resourceKey": String(repeating: "a", count: 64),
				"fileExtension": "heic",
				"cloudIdentifier": "ABC:001:xyz",
				"role": "photo",
			]],
		])
	}

	func testClaimAnswers() {
		let asked = ["a", "b"].map {
			Umbreld.PhotoBackupResourceClaim(resourceKey: String(repeating: $0, count: 64), fileExtension: "heic", identity: nil)
		}
		let answer = Data("""
			[
				{"resourceKey": "\(String(repeating: "a", count: 64))", "bytes": 5},
				{"resourceKey": "\(String(repeating: "b", count: 64))", "bytes": -1},
				{"resourceKey": "\(String(repeating: "c", count: 64))", "bytes": 5}
			]
			""".utf8)
		// Only files that were asked about, with a size a file can have
		XCTAssertEqual(
			PhotoBackupUpload.claimedResources(statusCode: 200, data: answer, requested: asked)?.map(\.resourceKey),
			[String(repeating: "a", count: 64)]
		)
		XCTAssertEqual(PhotoBackupUpload.claimedResources(statusCode: 200, data: Data("[]".utf8), requested: asked), [])
		// umbrelOS before claims answers 401, and the files upload as before
		XCTAssertNil(PhotoBackupUpload.claimedResources(statusCode: 401, data: Data(#"{"error":"unauthorized"}"#.utf8), requested: asked))
		XCTAssertNil(PhotoBackupUpload.claimedResources(statusCode: 200, data: Data("<html>".utf8), requested: asked))
	}
}
