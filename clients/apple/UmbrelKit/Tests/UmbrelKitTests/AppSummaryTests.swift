import XCTest
@testable import UmbrelKit

final class AppSummaryTests: XCTestCase {
	func testHTTPSRequirementDecodesAndBuildsSecureURL() throws {
		let data = try XCTUnwrap(
			"""
			{
			  "id": "camera",
			  "name": "Camera",
			  "port": 8080,
			  "path": "/web/",
			  "requiresHttps": true
			}
			""".data(using: .utf8)
		)

		let app = try JSONDecoder().decode(Umbreld.AppSummary.self, from: data)

		XCTAssertEqual(app.requiresHttps, true)
		XCTAssertEqual(app.webURL(host: "umbrel.local", scheme: "https")?.absoluteString, "https://umbrel.local:8080/web/")
	}

	func testAppWithoutHTTPSRequirementStillDecodes() throws {
		let data = try XCTUnwrap(
			"""
			{"id":"notes","port":3000}
			""".data(using: .utf8)
		)

		let app = try JSONDecoder().decode(Umbreld.AppSummary.self, from: data)

		XCTAssertNil(app.requiresHttps)
		XCTAssertEqual(app.webURL(host: "umbrel.local")?.absoluteString, "http://umbrel.local:3000")
	}

	func testLifecycleProgressDecodesAndSurvivesCacheCopy() throws {
		let data = try XCTUnwrap(
			"""
			{"id":"files","state":"updating","progress":42.5}
			""".data(using: .utf8)
		)

		let app = try JSONDecoder().decode(Umbreld.AppSummary.self, from: data)

		XCTAssertEqual(app.progress, 42.5)
		XCTAssertEqual(app.withoutCredentials.progress, 42.5)
	}

	func testRelativeAppPathIsNormalized() throws {
		let data = try XCTUnwrap(
			"""
			{"id":"notes","port":3000,"path":"admin"}
			""".data(using: .utf8)
		)
		let app = try JSONDecoder().decode(Umbreld.AppSummary.self, from: data)

		XCTAssertEqual(app.webURL(host: "umbrel.local")?.absoluteString, "http://umbrel.local:3000/admin")
	}

	func testAppPathCannotReplaceURLAuthority() throws {
		let data = try XCTUnwrap(
			"""
			{"id":"notes","port":3000,"path":"@evil.example/login"}
			""".data(using: .utf8)
		)
		let app = try JSONDecoder().decode(Umbreld.AppSummary.self, from: data)
		let url = try XCTUnwrap(app.webURL(host: "umbrel.local"))

		XCTAssertEqual(url.host, "umbrel.local")
		XCTAssertNil(url.user)
		XCTAssertNil(url.password)
		XCTAssertEqual(url.path, "/@evil.example/login")
	}

	func testCacheCopyOmitsDefaultCredentials() throws {
		let data = try XCTUnwrap(
			"""
			{
			  "id": "camera",
			  "name": "Camera",
			  "port": 8080,
			  "credentials": {
			    "defaultUsername": "umbrel",
			    "defaultPassword": "secret",
			    "showBeforeOpen": true
			  }
			}
			""".data(using: .utf8)
		)

		let app = try JSONDecoder().decode(Umbreld.AppSummary.self, from: data)
		let cached = app.withoutCredentials

		XCTAssertEqual(cached.id, app.id)
		XCTAssertEqual(cached.name, app.name)
		XCTAssertEqual(cached.port, app.port)
		XCTAssertNil(cached.credentials)
		XCTAssertFalse(String(decoding: try JSONEncoder().encode(cached), as: UTF8.self).contains("secret"))
	}
}
