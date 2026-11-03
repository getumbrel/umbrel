import BackgroundTasks
import Network
import Observation
import OSLog
import Photos
import UIKit
import UmbrelKit

// Backs up from the app itself, so people see backup happen instead of waiting on iOS:
// whenever the app is open, for the short time iOS allows after it leaves, and
// overnight while the iPhone charges. With Tailscale, PhotoKit's extension also uploads
// while the app is closed. One pass runs at a time. Anything that may mean new work (opening the app, a
// network change, new photos, setup, Try Again) asks for another, and a pass that
// couldn't reach the Umbrel tries again with backoff.
@MainActor
@Observable
final class PhotoBackupAppRunner {
	static let shared = PhotoBackupAppRunner()

	// What's holding backup up right now, for the status line while the app is open
	enum Activity: Equatable {
		case none
		case connecting
		case waitingForUmbrel
		// Cellular uploads are off and Wi-Fi isn't available
		case waitingForWiFi
	}

	private(set) var activity = Activity.none

	private nonisolated static let logger = Logger(subsystem: "com.umbrel.app", category: "PhotoBackup")
	private static let firstRetryDelay = 15
	private static let longestRetryDelay = 300
	private nonisolated static let overnightIdentifier = "\(bundleIdentifier).photo-backup-overnight"
	private nonisolated static var bundleIdentifier: String { Bundle.main.bundleIdentifier ?? "com.umbrel.app" }

	@ObservationIgnored private var isActive = false
	@ObservationIgnored private var requested = false
	// Reached since the app opened, so later passes don't show "Connecting" again
	@ObservationIgnored private var reachedUmbrel = false
	@ObservationIgnored private var task: Task<Void, Never>?
	@ObservationIgnored private var networkChanges: Task<Void, Never>?
	@ObservationIgnored private var path: NWPath?
	// The short time after the app leaves
	@ObservationIgnored private var backgroundTime: BackgroundTaskAssertion?
	// Longer time iOS gives overnight
	@ObservationIgnored private var backgroundTask: BGTask?
	// Where files the extension left registered were last released
	@ObservationIgnored private var releasedOrphans: String?
	@ObservationIgnored private let control = PassControl()

	private init() {}

	private var canRun: Bool { isActive || backgroundTask != nil }

	// iOS requires this before the app finishes launching
	nonisolated static func registerBackgroundTasks() {
		BGTaskScheduler.shared.register(forTaskWithIdentifier: overnightIdentifier, using: nil) { task in
			Task { @MainActor in PhotoBackupAppRunner.shared.begin(task) }
		}
	}

	func setActive(_ active: Bool) {
		guard isActive != active else { return }
		isActive = active
		reachedUmbrel = false
		activity = .none
		control.setAppActive(active)
		control.setLeaving(!canRun)
		if active {
			backgroundTime?.end()
			backgroundTime = nil
			// The current path starts the first pass, so it knows whether Wi-Fi is there
			watchNetworkChanges()
			run()
		} else {
			scheduleOvernight()
			// Background time iOS gave keeps the pass going
			guard backgroundTask == nil else { return }
			stopWatchingNetwork()
			// The pass finishes the file in flight, then ends. Everything is durable, so
			// the rest waits for later. Expiry cancels a file that takes longer.
			if task != nil, backgroundTime == nil {
				let control = control
				let assertion = BackgroundTaskAssertion(name: "Photo backup") { [weak self] in
					control.stopLedger()
					self?.task?.cancel()
				}
				if assertion.isValid {
					backgroundTime = assertion
				} else {
					control.stopLedger()
					task?.cancel()
				}
			}
		}
	}

	// Asks for a pass while the app is open or has background time. The first starts
	// once the current network path is known, so it knows whether Wi-Fi is there.
	func run() {
		guard canRun else { return }
		requested = true
		guard task == nil, path != nil else { return }
		task = Task { await loop() }
	}

	// Ends the pass in flight, as when backup is turned off, moved or set up again.
	// What it was sending stays queued, and it writes no status after this returns.
	func stop() {
		control.endPass()
		requested = false
		task?.cancel()
		activity = .none
	}

	func restart() {
		stop()
		run()
	}

	private func begin(_ newTask: BGTask) {
		// Every task iOS starts must be completed, even one a newer run replaces
		backgroundTask?.setTaskCompleted(success: true)
		backgroundTask = newTask
		let control = control
		newTask.expirationHandler = { [weak self] in
			// Right away on iOS's thread, since iOS may suspend the app moments after.
			// The main thread may be busy.
			control.stopLedgerUnlessActive()
			Task { @MainActor in self?.expire(newTask) }
		}
		// The task keeps the app running now
		backgroundTime?.end()
		backgroundTime = nil
		control.resumeLedger()
		control.setLeaving(false)
		watchNetworkChanges()
		run()
	}

	// iOS needs the time back. What was sending stays queued.
	private func expire(_ expired: BGTask) {
		guard backgroundTask === expired else { return }
		if !isActive {
			// Ending the task lets iOS suspend the app at once, so nothing may hold the
			// shared ledger. Usually already stopped by the expiry handler.
			control.stopLedger()
			task?.cancel()
		}
		// Nothing failed: the rest goes on next time
		finishBackgroundTask(success: true)
	}

	private func finishBackgroundTask(success: Bool) {
		guard let finished = backgroundTask else { return }
		backgroundTask = nil
		// Before completing: iOS may suspend the app as soon as it's told
		scheduleOvernight()
		finished.setTaskCompleted(success: success)
		control.setLeaving(!canRun)
		if !isActive { stopWatchingNetwork() }
	}

	// Ends the pass and any overnight run booked, as when backup is turned off or moved
	func forget() {
		stop()
		BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: Self.overnightIdentifier)
		PhotoBackupReminder.cancel()
	}

	// Overnight while charging, on a network. iOS picks the time, within a couple of
	// days as long as the app was used in the past week.
	private func scheduleOvernight() {
		guard PhotoBackupStore.configuration() != nil else { return }
		let request = BGProcessingTaskRequest(identifier: Self.overnightIdentifier)
		request.requiresNetworkConnectivity = true
		request.requiresExternalPower = true
		do {
			try BGTaskScheduler.shared.submit(request)
		} catch {
			let nsError = error as NSError
			Self.logger.error(
				"Could not schedule overnight photo backup: domain=\(nsError.domain, privacy: .public) code=\(nsError.code, privacy: .public)"
			)
		}
	}

	private func loop() async {
		var retryDelay = Self.firstRetryDelay
		var lastOutcome: PhotoBackupAppPass.Outcome?
		while requested, !Task.isCancelled {
			requested = false
			let outcome = await pass()
			lastOutcome = outcome
			guard !Task.isCancelled, !control.isLedgerStopped else { break }
			// Nothing is held up once there's nothing to send
			if outcome == .completed || outcome == .waitingForUser { activity = .none }
			// Backup ran: the "hasn't backed up" reminder moves a week out
			if outcome == .completed || outcome == .moreWork { PhotoBackupReminder.push() }
			switch outcome {
			case .moreWork:
				retryDelay = Self.firstRetryDelay
				requested = true
			case .unreachable, .retryLater:
				if outcome == .unreachable { unreachable() }
				// A charging run keeps going after server errors: the files that failed wait
				// for the end, so the next pass sends others. Otherwise in the background, the
				// next run or the app opening tries again.
				guard isActive || (outcome == .retryLater && backgroundTask != nil) else { break }
				await waitForRequest(seconds: retryDelay)
				retryDelay = min(retryDelay * 2, Self.longestRetryDelay)
				if !Task.isCancelled { requested = true }
			case .completed, .waitingForUser, nil:
				retryDelay = Self.firstRetryDelay
			}
			// After the app leaves without background time, start no other pass
			if !canRun { break }
		}
		task = nil
		backgroundTime?.end()
		backgroundTime = nil
		// A stop() and run() pair can land while the cancelled loop winds down
		if requested, canRun, !control.isLedgerStopped {
			run()
		} else {
			// Running out of time isn't a failure
			finishBackgroundTask(success: lastOutcome == .completed || control.isLedgerStopped)
		}
	}

	private func waitForRequest(seconds: Int) async {
		for _ in 0..<seconds {
			guard !requested, canRun, !Task.isCancelled else { return }
			try? await Task.sleep(for: .seconds(1))
		}
	}

	// The first value is the current path. Later ones mean the Umbrel may be
	// reachable on another route now.
	private func watchNetworkChanges() {
		guard networkChanges == nil else { return }
		networkChanges = Task { [weak self] in
			for await path in NWPathMonitor() {
				self?.path = path
				self?.run()
			}
		}
	}

	private func stopWatchingNetwork() {
		networkChanges?.cancel()
		networkChanges = nil
		// The network may change before the app opens again
		path = nil
	}

	private var onlyCellular: Bool {
		guard let path, path.status == .satisfied else { return false }
		return path.usesInterfaceType(.cellular)
			&& !path.usesInterfaceType(.wifi)
			&& !path.usesInterfaceType(.wiredEthernet)
	}

	private func connecting() {
		if !reachedUmbrel, activity == .none { activity = .connecting }
	}

	private func connected() {
		reachedUmbrel = true
		activity = .none
	}

	private func unreachable() {
		reachedUmbrel = false
		activity = .waitingForUmbrel
	}

	private func pass() async -> PhotoBackupAppPass.Outcome? {
		guard case .found(let configuration) = PhotoBackupStore.configurationRead(),
			PHPhotoLibrary.authorizationStatus(for: .readWrite) == .authorized
		else { return nil }
		// A network change starts the next pass
		guard configuration.allowsCellularAccess || !onlyCellular else {
			activity = .waitingForWiFi
			return nil
		}
		if activity == .waitingForWiFi { activity = .none }
		let saved = Config.load()
		guard saved.issue == nil, let device = saved.config.savedDevices[configuration.deviceId] else { return nil }
		// Setup restores a missing grant; until then there's nothing to send with
		guard case .found(let grant) = Keychain.readPhotoBackupGrant(
			deviceId: configuration.deviceId,
			accountId: configuration.source.accountId
		) else { return nil }
		// The app's time is up
		guard !control.isLedgerStopped else { return nil }
		guard let ledgerURL = PhotoBackupStore.ledgerURL, let ledger = PhotoBackupLedger(url: ledgerURL) else {
			Self.logger.error("Photo backup couldn't open the shared ledger")
			return .retryLater
		}
		let target = device.nativeTarget
		let sourceId = configuration.source.id
		// Once each launch and route is enough
		let orphansKey = "\(sourceId) \(configuration.route)"
		let control = control
		let token = control.beginPass()
		control.attach(ledger)
		defer { control.detach(ledger) }
		var state = PhotoBackupAppPass.SharedState.store
		state.publish = { snapshot in
			control.ifCurrent(token) { PhotoBackupStore.publish(snapshot) }
		}
		state.clearStorageRetryRequest = { control.ifCurrent(token) { PhotoBackupStore.clearStorageRetryRequest() } }
		state.clearRecoveryRetryRequest = { sourceId in
			control.ifCurrent(token) { PhotoBackupStore.clearRecoveryRetryRequest(for: sourceId) }
		}
		let pass = PhotoBackupAppPass(
			configuration: configuration,
			grant: grant,
			ledger: ledger,
			environment: .init(
				ingest: {
					switch try PhotoBackupLibraryIngest.ingest(
						ledger: ledger,
						sourceId: sourceId,
						logger: Self.logger,
						isCancelled: { Task.isCancelled || control.isLeaving }
					) {
					case .complete: .complete
					case .moreWork: .moreWork
					case .tokenReset: .restart
					}
				},
				lookup: { work, grant in
					guard let asset = PHAsset.fetchAssets(withLocalIdentifiers: [work.localIdentifier], options: nil)
						.firstObject
					else { return .removed }
					let cloudIdentifier = PhotoBackupPlanner.cloudIdentifiers(forUnedited: [asset])[asset.localIdentifier]
					return .resources(PhotoBackupPlanner.selectedResources(for: asset).map { selected in
						let planned = PhotoBackupPlanner.plan(
							selected.resource,
							role: selected.role,
							work: work,
							sourceId: sourceId
						)
						return PhotoBackupAppPass.Resource(
							plan: planned.ledgerPlan,
							headers: planned.uploadHeaders(grant: grant, cloudIdentifier: cloudIdentifier),
							claim: planned.claim(cloudIdentifier: cloudIdentifier)
						) { file in
							// Originals kept in iCloud download first
							let options = PHAssetResourceRequestOptions()
							options.isNetworkAccessAllowed = true
							do {
								try await PHAssetResourceManager.default().writeData(
									for: planned.resource,
									toFile: file,
									options: options
								)
							} catch {
								let nsError = error as NSError
								Self.logger.error(
									"Photo backup couldn't read a file from the library: domain=\(nsError.domain, privacy: .public) code=\(nsError.code, privacy: .public)"
								)
								throw error
							}
						}
					})
				},
				connect: { [weak self] in
					self?.connecting()
					do {
						_ = try await Umbreld.resolvedHost(for: target)
						self?.connected()
					} catch {
						if PhotoBackupUpload.outcome(failure: error) == .unreachable { self?.unreachable() }
						throw error
					}
				},
				upload: { file, headers in
					do {
						let response = try await Umbreld.uploadPhotoBackupResource(
							target: target,
							fileURL: file,
							headers: headers,
							allowsCellularAccess: configuration.allowsCellularAccess
						)
						// Which answer an upload got, so a failure can be told apart in the log
						if !(200..<300).contains(response.statusCode) {
							Self.logger.error("Photo backup upload answered \(response.statusCode, privacy: .public)")
						} else if response.headers["x-umbrel-photo-backup-key"] == nil {
							Self.logger.error("Photo backup upload answered \(response.statusCode, privacy: .public) without a receipt")
						}
						return response
					} catch is CancellationError {
						throw CancellationError()
					} catch {
						let nsError = error as NSError
						Self.logger.error(
							"Photo backup upload failed: domain=\(nsError.domain, privacy: .public) code=\(nsError.code, privacy: .public) \(nsError.localizedDescription, privacy: .public)"
						)
						throw error
					}
				},
				claim: { claims in
					do {
						let receipts = try await Umbreld.claimPhotoBackupResources(
							target: target,
							grant: grant,
							resources: claims
						)
						Self.logger.notice(
							"Photo backup claimed \(receipts.count, privacy: .public) of \(claims.count, privacy: .public) files"
						)
						return receipts
					} catch let error as Umbreld.Error {
						Self.logger.notice(
							"Photo backup claim answered \(error.status, privacy: .public): \(error.message, privacy: .public)"
						)
						throw error
					}
				},
				shouldYield: { control.isLeaving }
			),
			state: state,
			releasesOrphanedResources: releasedOrphans != orphansKey
		)
		do {
			let outcome = try await pass.run()
			// A local failure, such as a busy ledger, may have been the release itself
			if outcome != .retryLater { releasedOrphans = orphansKey }
			Self.logger.notice("Photo backup pass finished: \(String(describing: outcome), privacy: .public)")
			return outcome
		} catch {
			// A connection pool reset cancels the upload without this task being cancelled
			return Task.isCancelled || ledger.isStopped ? nil : .retryLater
		}
	}
}

// What the runner shares with a pass running off the main actor
private final class PassControl: @unchecked Sendable {
	private let lock = NSLock()
	private var pass = 0
	private var leaving = false
	// Apart from the lock above, which is held across coordinated snapshot writes,
	// so iOS's expiry handlers never wait on one
	private let ledgerLock = NSLock()
	private var appActive = false
	private var ledger: PhotoBackupLedger?
	private var ledgerStopped = false

	func beginPass() -> Int {
		lock.withLock {
			pass += 1
			return pass
		}
	}

	func endPass() {
		lock.withLock { pass += 1 }
	}

	// Writes only for the current pass, under the lock endPass() takes, so a stopped
	// pass can't write over what the code that stopped it writes next
	func ifCurrent(_ token: Int, _ write: () -> Void) {
		lock.withLock {
			if pass == token { write() }
		}
	}

	func setLeaving(_ value: Bool) {
		lock.withLock { leaving = value }
	}

	var isLeaving: Bool {
		lock.withLock { leaving }
	}

	// The app having time again lets passes use the ledger again
	func setAppActive(_ value: Bool) {
		ledgerLock.withLock {
			appActive = value
			if value { ledgerStopped = false }
		}
	}

	// The pass's ledger, stopped at once if the app's time is already up
	func attach(_ ledger: PhotoBackupLedger) {
		let stop = ledgerLock.withLock {
			self.ledger = ledger
			return ledgerStopped
		}
		if stop { ledger.stop() }
	}

	func detach(_ ledger: PhotoBackupLedger) {
		ledgerLock.withLock {
			if self.ledger === ledger { self.ledger = nil }
		}
	}

	// The app's time is up, and iOS may suspend it any moment. No pass touches the
	// shared ledger again until the app has time again.
	func stopLedger() {
		let ledger = ledgerLock.withLock {
			ledgerStopped = true
			return self.ledger
		}
		ledger?.stop()
	}

	// For iOS's expiry handlers, which may run on any thread while the app opens
	func stopLedgerUnlessActive() {
		let ledger: PhotoBackupLedger? = ledgerLock.withLock {
			guard !appActive else { return nil }
			ledgerStopped = true
			return self.ledger
		}
		ledger?.stop()
	}

	func resumeLedger() {
		ledgerLock.withLock { ledgerStopped = false }
	}

	var isLedgerStopped: Bool {
		ledgerLock.withLock { ledgerStopped }
	}
}
