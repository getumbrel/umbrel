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
}
