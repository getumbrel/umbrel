import XCTest

final class MounterSecurityTests: XCTestCase {
	func testRecoveryReturnsOnlyTheUniqueSystemReportedMountPath() {
		let mounts = [
			Mounter.MountedShare(
				host: "umbrel.local.",
				sharename: "Documents",
				path: "/Volumes/Documents-1"
			),
			Mounter.MountedShare(
				host: "nas.local",
				sharename: "Documents",
				path: "/Volumes/Documents"
			),
		]

		XCTAssertEqual(
			Mounter.recoveredMountPath(host: "UMBREL.LOCAL", sharename: "Documents", from: mounts),
			"/Volumes/Documents-1"
		)
		XCTAssertNil(Mounter.recoveredMountPath(host: "umbrel.local", sharename: "Backup", from: mounts))
	}

	func testRecoveryRejectsAmbiguousSystemMetadataInsteadOfGuessing() {
		let mounts = [
			Mounter.MountedShare(host: "umbrel.local", sharename: "Documents", path: "/Volumes/Documents"),
			Mounter.MountedShare(host: "umbrel.local", sharename: "Documents", path: "/Volumes/Documents-1"),
		]

		XCTAssertNil(Mounter.recoveredMountPath(host: "umbrel.local", sharename: "Documents", from: mounts))
	}

	func testOwnershipFilterLeavesAnotherNASUntouched() {
		let umbrel = Mounter.MountedShare(
			host: "umbrel.local.",
			sharename: "Documents",
			path: "/Volumes/Documents-1"
		)
		let otherNAS = Mounter.MountedShare(
			host: "nas.local",
			sharename: "Backup",
			path: "/Volumes/Backup"
		)

		let owned = Mounter.shares([umbrel, otherNAS], ownedByHosts: ["UMBREL.LOCAL"])

		XCTAssertEqual(owned.count, 1)
		XCTAssertEqual(owned.first?.path, umbrel.path)
	}

	func testOwnershipFilterKeepsAKnownMountWhenItsHostIsOffline() {
		let staleRoute = Mounter.MountedShare(
			host: "192.168.1.20",
			sharename: "Documents",
			path: "/Volumes/Documents-1"
		)
		let unowned = Mounter.MountedShare(
			host: "192.168.1.30",
			sharename: "Backup",
			path: "/Volumes/Backup"
		)

		let owned = Mounter.shares(
			[staleRoute, unowned],
			ownedByHosts: [],
			orKnown: [staleRoute]
		)

		XCTAssertEqual(owned.count, 1)
		XCTAssertEqual(owned.first?.path, staleRoute.path)
	}

	func testSameMountIgnoresHostCaseAndTrailingDotOnly() {
		let known = Mounter.MountedShare(host: "umbrel.local.", sharename: "Documents", path: "/Volumes/Documents")

		XCTAssertTrue(Mounter.isSameMount(
			known,
			Mounter.MountedShare(host: "UMBREL.LOCAL", sharename: "Documents", path: "/Volumes/Documents")
		))
		XCTAssertFalse(Mounter.isSameMount(
			known,
			Mounter.MountedShare(host: "umbrel.local", sharename: "Documents", path: "/Volumes/Documents-1")
		))
		XCTAssertFalse(Mounter.isSameMount(
			known,
			Mounter.MountedShare(host: "umbrel-2.local", sharename: "Documents", path: "/Volumes/Documents")
		))
	}

	func testOwnershipFilterRejectsAKnownPathThatNowHoldsAnotherShare() {
		let known = Mounter.MountedShare(
			host: "umbrel.local",
			sharename: "Documents",
			path: "/Volumes/Documents"
		)
		let sameNameOtherServer = Mounter.MountedShare(
			host: "nas.local",
			sharename: "Documents",
			path: "/Volumes/Documents"
		)
		let otherShareSameServer = Mounter.MountedShare(
			host: "umbrel.local",
			sharename: "Backup",
			path: "/Volumes/Documents"
		)

		let owned = Mounter.shares(
			[sameNameOtherServer, otherShareSameServer],
			ownedByHosts: [],
			orKnown: [known]
		)

		XCTAssertTrue(owned.isEmpty)
	}
}
