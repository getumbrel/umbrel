import Testing
@testable import UmbrelKit

@Suite("Umbrel device kind")
struct DeviceKindTests {
	@Test("Recognizes every supported hardware family", arguments: [
		("Umbrel Home (2025)", UmbrelDeviceKind.home),
		("Umbrel Pro", UmbrelDeviceKind.pro),
		("ASUS NUC 14 Essential", UmbrelDeviceKind.asusNuc14Essential),
		("ASUS NUC 16 Pro", UmbrelDeviceKind.asusNuc16Pro),
		("ASUS ROG NUC 16", UmbrelDeviceKind.asusRogNuc16),
		("Raspberry Pi 5", UmbrelDeviceKind.raspberryPi),
		("Raspberry Pi 4", UmbrelDeviceKind.raspberryPi),
		// umbreld names an ASUS NUC it has no render for just "ASUS NUC"
		("ASUS NUC", UmbrelDeviceKind.generic),
		("Standard PC (Q35 + ICH9, 2009)", UmbrelDeviceKind.generic),
	])
	func recognizedModel(model: String, expected: UmbrelDeviceKind) {
		#expect(UmbrelDeviceKind(model: model) == expected)
	}

	@Test("Missing model uses generic hardware")
	func missingModel() {
		#expect(UmbrelDeviceKind(model: nil) == .generic)
	}
}
