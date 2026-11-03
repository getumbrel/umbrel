import UIKit

// The photo backup ledger is a SQLite database in the shared App Group container.
// If the app is suspended while a write transaction holds its lock, the system
// terminates the app with 0xdead10cc. Apple's remedy for that code is to request
// background execution time on the main thread before the write and release it as
// soon as the lock is relinquished, which is all this type does.
@MainActor
final class BackgroundTaskAssertion {
	private var identifier: UIBackgroundTaskIdentifier = .invalid

	init(name: String, onExpiration: (() -> Void)? = nil) {
		identifier = UIApplication.shared.beginBackgroundTask(withName: name) { [weak self] in
			// Runs on the main thread shortly before background time expires. Ending the
			// task here keeps an overrunning write from becoming an unbalanced assertion,
			// which the system also punishes with termination.
			onExpiration?()
			self?.end()
		}
	}

	// False when iOS gave no time, as when the app's time is already up
	var isValid: Bool { identifier != .invalid }

	func end() {
		guard identifier != .invalid else { return }
		UIApplication.shared.endBackgroundTask(identifier)
		identifier = .invalid
	}

	// Holds an assertion across a short synchronous write and always releases it. An
	// invalid identifier (background execution unavailable) degrades to running the
	// work exactly as before.
	static func perform<T>(_ name: String, _ work: () throws -> T) rethrows -> T {
		let assertion = BackgroundTaskAssertion(name: name)
		defer { assertion.end() }
		return try work()
	}
}
