import UmbrelKit
import XCTest
@testable import Umbrel

@MainActor
final class OnboardingModelTests: XCTestCase {
	func testManualAddressReturnTracksDiscoveryChanges() {
		XCTAssertEqual(
			OnboardingModel.manualAddressReturnDestination(from: .noDevice, hasDiscoveryResults: true),
			.deviceFound
		)
		XCTAssertEqual(
			OnboardingModel.manualAddressReturnDestination(from: .deviceFound, hasDiscoveryResults: false),
			.noDevice
		)
	}

	func testManualAddressReturnPreservesValidOrigin() {
		XCTAssertEqual(
			OnboardingModel.manualAddressReturnDestination(from: .noDevice, hasDiscoveryResults: false),
			.noDevice
		)
		XCTAssertEqual(
			OnboardingModel.manualAddressReturnDestination(from: .deviceFound, hasDiscoveryResults: true),
			.deviceFound
		)
		XCTAssertEqual(
			OnboardingModel.manualAddressReturnDestination(from: .localNetwork, hasDiscoveryResults: false),
			.localNetwork
		)
	}

	func testTryAgainShowsTheLatestReason() async {
		let model = OnboardingModel.preview(unverified: [Umbreld.UnverifiedDevice(host: "umbrel.local", reason: .slow)])

		await model.retry(model.unverifiedDevices[0]) { device, _ in
			.unverified(Umbreld.UnverifiedDevice(host: device.host, reason: .unexpected))
		}

		XCTAssertEqual(model.unverifiedDevices, [Umbreld.UnverifiedDevice(host: "umbrel.local", reason: .unexpected)])
		XCTAssertTrue(model.retryingHosts.isEmpty)
	}

	func testTryAgainFromBeforeARescanIsDropped() async {
		let model = OnboardingModel.preview(unverified: [Umbreld.UnverifiedDevice(host: "umbrel.local", reason: .slow)])
		let gate = Gate()
		let retry = Task {
			await model.retry(model.unverifiedDevices[0]) { device, _ in
				await gate.wait()
				return .unverified(Umbreld.UnverifiedDevice(host: device.host, reason: .unexpected))
			}
		}
		while !(await gate.isWaiting) { await Task.yield() }
		XCTAssertEqual(model.retryingHosts, ["umbrel.local"])

		model.scanAgain()
		await gate.open()
		await retry.value

		XCTAssertTrue(model.unverifiedDevices.isEmpty)
		XCTAssertTrue(model.retryingHosts.isEmpty)
	}

	func testASavedUmbrelWithAChangedCertificateLeavesTheResults() async {
		let model = OnboardingModel.preview(unverified: [Umbreld.UnverifiedDevice(host: "umbrel.local", reason: .slow)])

		await model.retry(model.unverifiedDevices[0]) { _, _ in .savedIdentityChanged }

		XCTAssertTrue(model.discoveryResults.isEmpty)
	}
}

private actor Gate {
	private var waiter: CheckedContinuation<Void, Never>?

	var isWaiting: Bool { waiter != nil }

	func wait() async {
		await withCheckedContinuation { waiter = $0 }
	}

	func open() {
		waiter?.resume()
		waiter = nil
	}
}
