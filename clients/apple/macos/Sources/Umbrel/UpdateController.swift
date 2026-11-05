import AppKit
import Sparkle

// Sparkle still owns the entire update lifecycle: scheduling, appcast parsing,
// signature verification, download, extraction, installation, and relaunch. The
// user driver below changes only how those states are presented.
@MainActor
@Observable
final class UpdateController: NSObject, SPUUpdaterDelegate {
	private(set) var availableUpdateVersion: String?
	private let userDriver: UmbrelUpdateUserDriver
	@ObservationIgnored private lazy var updater = SPUUpdater(
		hostBundle: .main,
		applicationBundle: .main,
		userDriver: userDriver,
		delegate: self
	)
	private static let availableVersionKey = "availableUpdateVersion"

	override init() {
		let userDriver = UmbrelUpdateUserDriver()
		self.userDriver = userDriver
		self.availableUpdateVersion = Self.restoredAvailableUpdateVersion()
		super.init()
		userDriver.onAvailabilityChange = { [weak self] version in
			self?.setAvailableUpdateVersion(version)
		}
	}

	var canCheckForUpdates: Bool {
		updater.canCheckForUpdates
	}

	func start() {
		do {
			try updater.start()
		} catch {
			userDriver.showConfigurationError(error)
		}
	}

	@objc func checkForUpdates(_ sender: Any?) {
		guard updater.canCheckForUpdates else {
			userDriver.showUpdateInFocus()
			return
		}
		updater.checkForUpdates()
	}

	// The update window shows only release notes embedded in the appcast
	// (scripts/generate-appcast.sh embeds them), so Sparkle has nothing to download.
	func updater(_ updater: SPUUpdater, shouldDownloadReleaseNotesForUpdate updateItem: SUAppcastItem) -> Bool {
		false
	}

	private func setAvailableUpdateVersion(_ version: String?) {
		availableUpdateVersion = version
		let defaults = UserDefaults.standard
		if let version {
			defaults.set(version, forKey: Self.availableVersionKey)
		} else {
			defaults.removeObject(forKey: Self.availableVersionKey)
		}
	}

	private static func restoredAvailableUpdateVersion() -> String? {
		let defaults = UserDefaults.standard
		guard let version = defaults.string(forKey: availableVersionKey),
			let availableBuild = Int(version),
			let currentVersion = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String,
			let currentBuild = Int(currentVersion),
			availableBuild > currentBuild
		else {
			defaults.removeObject(forKey: availableVersionKey)
			return nil
		}
		return version
	}
}

@MainActor
private final class UmbrelUpdateUserDriver: NSObject, SPUUserDriver {
	private static let presentedVersionKey = "automaticallyPresentedUpdateVersion"
	var onAvailabilityChange: ((String?) -> Void)?
	private var windowController: UpdateWindowController?
	private var updateVersion: String?
	private var expectedDownloadLength: UInt64 = 0
	private var receivedDownloadLength: UInt64 = 0

	func show(
		_ request: SPUUpdatePermissionRequest,
		reply: @escaping (SUUpdatePermissionResponse) -> Void
	) {
		// Automatic checks are part of the app's declared update policy. Umbrel does
		// not attach a system profile to its appcast requests.
		reply(SUUpdatePermissionResponse(automaticUpdateChecks: true, sendSystemProfile: false))
	}

	func showUserInitiatedUpdateCheck(cancellation: @escaping () -> Void) {
		present(
			.title("Checking for updates…"),
			message: "Looking for a newer version of Umbrel.",
			progress: .indeterminate,
			buttons: [.cancel(cancellation)]
		)
	}

	func showUpdateFound(
		with appcastItem: SUAppcastItem,
		state: SPUUserUpdateState,
		reply: @escaping (SPUUserUpdateChoice) -> Void
	) {
		updateVersion = appcastItem.displayVersionString
		onAvailabilityChange?(appcastItem.versionString)

		// A scheduled check presents each version at most once. Keep using Sparkle's
		// ordinary dismiss response rather than its stronger skip response: skipping
		// a major upgrade can also suppress later releases in that upgrade line.
		if !state.userInitiated,
			UserDefaults.standard.string(forKey: Self.presentedVersionKey) == appcastItem.versionString
		{
			reply(.dismiss)
			return
		}
		// Persist before presentation so quitting, installing, or following an
		// informational link all count as the one automatic presentation. Manual
		// checks deliberately bypass this gate.
		UserDefaults.standard.set(appcastItem.versionString, forKey: Self.presentedVersionKey)

		let dismiss = {
			reply(SPUUserUpdateChoice.dismiss)
		}

		let primaryTitle: String
		if appcastItem.isInformationOnlyUpdate {
			primaryTitle = "Learn More…"
		} else {
			primaryTitle = state.stage == .notDownloaded ? "Install Update" : "Install and Relaunch"
		}

		let secondaryTitle = state.stage == .installing ? "Install on Quit" : "Not Now"
		var buttons: [UpdateWindowButton] = [
			.init(title: secondaryTitle, keyEquivalent: "\u{1B}", action: dismiss)
		]
		buttons.append(.init(title: primaryTitle, keyEquivalent: "\r") {
			if appcastItem.isInformationOnlyUpdate {
				if let infoURL = appcastItem.infoURL {
					NSWorkspace.shared.open(infoURL)
				}
				dismiss()
			} else {
				reply(.install)
			}
		})

		present(
			.title("Version \(appcastItem.displayVersionString) is available."),
			message: "You’re currently using version \(currentDisplayVersion).",
			buttons: buttons,
			onClose: dismiss,
			notes: Self.windowNotes(for: appcastItem)
		)
	}

	// The section is titled with the version its notes describe, matching the version
	// named in the line above it, so it never reads as new compared to something else.
	private static func windowNotes(for item: SUAppcastItem) -> UpdateWindowNotes? {
		releaseNotes(for: item).map {
			UpdateWindowNotes(title: "What’s New in \(item.displayVersionString)", text: $0)
		}
	}

	// Markdown or plain-text notes embedded in the appcast. Inline Markdown (bold,
	// links) is rendered and line breaks are kept, so each note is written on its own
	// line. HTML notes would need a web view and aren't shown.
	private static func releaseNotes(for item: SUAppcastItem) -> NSAttributedString? {
		guard let text = item.itemDescription?.trimmingCharacters(in: .whitespacesAndNewlines),
			!text.isEmpty
		else { return nil }
		let notes: NSMutableAttributedString
		switch item.itemDescriptionFormat {
		case "markdown":
			let options = AttributedString.MarkdownParsingOptions(
				interpretedSyntax: .inlineOnlyPreservingWhitespace
			)
			guard let parsed = try? AttributedString(markdown: text, options: options) else { return nil }
			notes = NSMutableAttributedString(parsed)
		case "plain-text":
			notes = NSMutableAttributedString(string: text)
		default:
			return nil
		}
		let font = NSFont.systemFont(ofSize: NSFont.smallSystemFontSize)
		notes.addAttributes([
			.font: font,
			.foregroundColor: NSColor.labelColor,
		], range: NSRange(location: 0, length: notes.length))
		// Each line is one note. A line starting with "• " or "- " shows as a bullet,
		// with wrapped lines indented to the text after it.
		let bulletWidth = ("• " as NSString).size(withAttributes: [.font: font]).width
		let lines = notes.string as NSString
		lines.enumerateSubstrings(
			in: NSRange(location: 0, length: lines.length),
			options: .byParagraphs
		) { line, lineRange, enclosingRange, _ in
			let style = NSMutableParagraphStyle()
			style.paragraphSpacing = 3
			if let line, line.hasPrefix("• ") || line.hasPrefix("- ") {
				notes.replaceCharacters(in: NSRange(location: lineRange.location, length: 1), with: "•")
				style.headIndent = bulletWidth
			}
			notes.addAttribute(.paragraphStyle, value: style, range: enclosingRange)
		}
		return notes
	}

	// Required user-driver hooks. UpdateController prevents these downloads because
	// the window shows only notes embedded in the appcast (see releaseNotes(for:)).
	func showUpdateReleaseNotes(with downloadData: SPUDownloadData) {}

	func showUpdateReleaseNotesFailedToDownloadWithError(_ error: Error) {}

	func showUpdateNotFoundWithError(_ error: Error, acknowledgement: @escaping () -> Void) {
		onAvailabilityChange?(nil)
		let nsError = error as NSError
		// On the latest version, Sparkle's newest feed entry is the running version, so
		// its notes are what's new in the version the user already has.
		let reason = (nsError.userInfo[SPUNoUpdateFoundReasonKey] as? NSNumber)?.int32Value
		let latestItem = nsError.userInfo[SPULatestAppcastItemFoundKey] as? SUAppcastItem
		let notes = reason == SPUNoUpdateFoundReason.onLatestVersion.rawValue
			? latestItem.flatMap(Self.windowNotes(for:))
			: nil
		present(
			.title(nsError.localizedDescription),
			message: nsError.localizedRecoverySuggestion,
			buttons: [.ok(acknowledgement)],
			onClose: acknowledgement,
			expandedMessage: true,
			notes: notes
		)
	}

	func showUpdaterError(_ error: Error, acknowledgement: @escaping () -> Void) {
		let nsError = error as NSError
		present(
			.title(nsError.localizedDescription),
			message: nsError.localizedRecoverySuggestion,
			buttons: [.ok(acknowledgement)],
			onClose: acknowledgement,
			expandedMessage: true
		)
	}

	func showDownloadInitiated(cancellation: @escaping () -> Void) {
		expectedDownloadLength = 0
		receivedDownloadLength = 0
		present(
			.title("Downloading update…"),
			message: versionMessage,
			progress: .indeterminate,
			buttons: [.cancel(cancellation)]
		)
	}

	func showDownloadDidReceiveExpectedContentLength(_ expectedContentLength: UInt64) {
		expectedDownloadLength = expectedContentLength
		refreshDownloadProgress()
	}

	func showDownloadDidReceiveData(ofLength length: UInt64) {
		receivedDownloadLength += length
		refreshDownloadProgress()
	}

	func showDownloadDidStartExtractingUpdate() {
		present(
			.title("Preparing update…"),
			message: versionMessage,
			progress: .indeterminate
		)
	}

	func showExtractionReceivedProgress(_ progress: Double) {
		windowController?.updateProgress(.value(progress))
	}

	func showReady(toInstallAndRelaunch reply: @escaping (SPUUserUpdateChoice) -> Void) {
		present(
			.title("Umbrel is ready to update"),
			message: "Umbrel will quit, install the update, and reopen.",
			buttons: [
				.init(title: "Install on Quit", keyEquivalent: "") { reply(.dismiss) },
				.init(title: "Install and Relaunch", keyEquivalent: "\r") {
					reply(.install)
				}
			]
		)
	}

	func showInstallingUpdate(
		withApplicationTerminated applicationTerminated: Bool,
		retryTerminatingApplication: @escaping () -> Void
	) {
		let buttons: [UpdateWindowButton] = applicationTerminated
			? []
			: [
				.init(
					title: "Try Again",
					keyEquivalent: "\r",
					disablesAfterAction: false,
					action: retryTerminatingApplication
				)
			]
		present(
			.title("Installing update…"),
			message: applicationTerminated
				? "Umbrel will reopen when the update is complete."
				: "Waiting for Umbrel to quit.",
			progress: .indeterminate,
			buttons: buttons
		)
	}

	func showUpdateInstalledAndRelaunched(_ relaunched: Bool, acknowledgement: @escaping () -> Void) {
		onAvailabilityChange?(nil)
		guard !relaunched else {
			acknowledgement()
			return
		}
		present(
			.title("Umbrel was updated"),
			message: "The update was installed successfully.",
			buttons: [.ok(acknowledgement)],
			onClose: acknowledgement
		)
	}

	func dismissUpdateInstallation() {
		windowController?.dismiss()
		windowController = nil
	}

	func showUpdateInFocus() {
		windowController?.focus()
	}

	func showConfigurationError(_ error: Error) {
		present(
			.title("Software Update is unavailable"),
			message: error.localizedDescription,
			buttons: [.ok { [weak self] in self?.dismissUpdateInstallation() }],
			expandedMessage: true
		)
	}

	private var currentDisplayVersion: String {
		Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "this version"
	}

	private var versionMessage: String {
		updateVersion.map { "Version \($0)" } ?? "The latest version of Umbrel"
	}

	private func refreshDownloadProgress() {
		let progress: UpdateWindowProgress = expectedDownloadLength > 0
			? .value(min(Double(receivedDownloadLength) / Double(expectedDownloadLength), 1))
			: .indeterminate
		windowController?.updateProgress(progress)
	}

	private func present(
		_ title: UpdateWindowTitle,
		message: String? = nil,
		progress: UpdateWindowProgress? = nil,
		buttons: [UpdateWindowButton] = [],
		onClose: (() -> Void)? = nil,
		expandedMessage: Bool = false,
		notes: UpdateWindowNotes? = nil
	) {
		let controller = windowController ?? UpdateWindowController()
		windowController = controller
		controller.present(
			title: title.value,
			message: message,
			progress: progress,
			buttons: buttons,
			onClose: onClose,
			expandedMessage: expandedMessage,
			notes: notes
		)
	}
}

private struct UpdateWindowNotes {
	let title: String
	let text: NSAttributedString
}

private struct UpdateWindowTitle {
	let value: String

	static func title(_ value: String) -> Self { .init(value: value) }
}

private enum UpdateWindowProgress {
	case indeterminate
	case value(Double)
}

private struct UpdateWindowButton {
	let title: String
	let keyEquivalent: String
	var disablesAfterAction = true
	let action: () -> Void

	static func cancel(_ action: @escaping () -> Void) -> Self {
		.init(title: "Cancel", keyEquivalent: "\u{1B}", action: action)
	}

	static func ok(_ action: @escaping () -> Void) -> Self {
		.init(title: "OK", keyEquivalent: "\r", action: action)
	}
}

@MainActor
private final class UpdateWindowController: NSWindowController, NSWindowDelegate {
	private var closeAction: (() -> Void)?
	private weak var progressIndicator: NSProgressIndicator?
	// "What's New" starts collapsed so the window keeps its compact size. Expanded,
	// the notes grow to at most about eight lines and scroll beyond that.
	// The buttons sit 16 pt below the notes, the spacing macOS alerts use between their
	// content and buttons.
	private static let notesSpacing: CGFloat = 6
	private static let notesButtonSpacing: CGFloat = 16
	private static let maximumNotesHeight: CGFloat = 116
	// The notes scroll inside a rounded well, so it's clear where the scrolling area ends.
	private static let notesPadding = NSSize(width: 10, height: 8)
	private weak var notesWell: NSBox?
	private weak var notesScrollView: NSScrollView?
	private weak var notesDisclosure: NSButton?
	private var notesTopConstraint: NSLayoutConstraint?
	private var notesHeightConstraint: NSLayoutConstraint?
	private var notesHeight: CGFloat = 0

	init() {
		let window = NSPanel(
			contentRect: NSRect(x: 0, y: 0, width: 360, height: 250),
			styleMask: [.titled, .closable],
			backing: .buffered,
			defer: false
		)
		window.title = "Software Update"
		window.titleVisibility = .hidden
		window.titlebarAppearsTransparent = true
		window.isMovableByWindowBackground = true
		window.animationBehavior = .alertPanel
		super.init(window: window)
		window.delegate = self
	}

	@available(*, unavailable)
	required init?(coder: NSCoder) {
		fatalError("init(coder:) has not been implemented")
	}

	func present(
		title: String,
		message: String?,
		progress: UpdateWindowProgress?,
		buttons: [UpdateWindowButton],
		onClose: (() -> Void)?,
		expandedMessage: Bool,
		notes: UpdateWindowNotes?
	) {
		guard let window else { return }
		closeAction = onClose
		window.contentView = makeContentView(
			title: title,
			message: message,
			progress: progress,
			buttons: buttons,
			notes: notes
		)
		if onClose == nil {
			window.styleMask.remove(.closable)
		} else {
			window.styleMask.insert(.closable)
		}
		// With notes the layout runs top to bottom, so it sets its own height.
		let height: CGFloat = notes != nil
			? window.contentView?.fittingSize.height ?? 250
			: progress == nil ? (expandedMessage ? 250 : 228) : 232
		window.setContentSize(NSSize(width: 360, height: height))
		NSApp.activate(ignoringOtherApps: true)
		window.center()
		window.makeKeyAndOrderFront(nil)
	}

	func focus() {
		NSApp.activate(ignoringOtherApps: true)
		window?.makeKeyAndOrderFront(nil)
	}

	func updateProgress(_ progress: UpdateWindowProgress) {
		guard let progressIndicator else { return }
		configure(progressIndicator, for: progress)
	}

	func dismiss() {
		closeAction = nil
		window?.orderOut(nil)
	}

	func windowWillClose(_ notification: Notification) {
		takeCloseAction()?()
	}

	private func makeContentView(
		title: String,
		message: String?,
		progress: UpdateWindowProgress?,
		buttons: [UpdateWindowButton],
		notes: UpdateWindowNotes?
	) -> NSView {
		let content = NSView()
		progressIndicator = nil
		notesWell = nil
		notesScrollView = nil
		notesDisclosure = nil
		notesTopConstraint = nil
		notesHeightConstraint = nil

		let icon = NSImageView(image: NSApp.applicationIconImage)
		icon.imageScaling = .scaleProportionallyUpOrDown
		icon.translatesAutoresizingMaskIntoConstraints = false

		let titleLabel = label(title, font: .systemFont(ofSize: NSFont.systemFontSize, weight: .semibold))
		let messageLabel = message.map { label($0, font: .systemFont(ofSize: NSFont.systemFontSize)) }

		let textStack = NSStackView(views: [titleLabel] + [messageLabel].compactMap { $0 })
		textStack.orientation = .vertical
		textStack.alignment = .centerX
		textStack.spacing = 5
		textStack.translatesAutoresizingMaskIntoConstraints = false

		content.addSubview(icon)
		content.addSubview(textStack)

		var constraints = [
			icon.topAnchor.constraint(equalTo: content.topAnchor, constant: 25),
			icon.centerXAnchor.constraint(equalTo: content.centerXAnchor),
			icon.widthAnchor.constraint(equalToConstant: 64),
			icon.heightAnchor.constraint(equalToConstant: 64),
			textStack.topAnchor.constraint(equalTo: icon.bottomAnchor, constant: 12),
			textStack.leadingAnchor.constraint(greaterThanOrEqualTo: content.leadingAnchor, constant: 24),
			textStack.trailingAnchor.constraint(lessThanOrEqualTo: content.trailingAnchor, constant: -24),
			textStack.centerXAnchor.constraint(equalTo: content.centerXAnchor),
		]

		if let progress {
			let indicator = NSProgressIndicator()
			indicator.style = .bar
			indicator.minValue = 0
			indicator.maxValue = 1
			indicator.translatesAutoresizingMaskIntoConstraints = false
			configure(indicator, for: progress)
			progressIndicator = indicator
			content.addSubview(indicator)
			constraints += [
				indicator.topAnchor.constraint(greaterThanOrEqualTo: textStack.bottomAnchor, constant: 20),
				indicator.leadingAnchor.constraint(equalTo: content.leadingAnchor, constant: 40),
				indicator.trailingAnchor.constraint(equalTo: content.trailingAnchor, constant: -40),
			]
		}

		if let notes {
			let disclosure = ClosureButton(title: "", action: { [weak self] in self?.toggleNotes() })
			disclosure.bezelStyle = .disclosure
			disclosure.setButtonType(.pushOnPushOff)
			disclosure.setAccessibilityLabel(notes.title)
			notesDisclosure = disclosure
			let notesTitle = ClosureButton(title: notes.title, action: { [weak self] in self?.toggleNotes() })
			notesTitle.isBordered = false
			notesTitle.font = .systemFont(ofSize: NSFont.smallSystemFontSize, weight: .semibold)
			notesTitle.contentTintColor = .secondaryLabelColor
			let row = NSStackView(views: [disclosure, notesTitle])
			row.orientation = .horizontal
			row.spacing = 2
			row.translatesAutoresizingMaskIntoConstraints = false

			let notesWidth = 312 - 2 * Self.notesPadding.width
			let textView = NSTextView(frame: NSRect(x: 0, y: 0, width: notesWidth, height: 0))
			textView.isEditable = false
			textView.isSelectable = true
			textView.drawsBackground = false
			textView.textContainerInset = .zero
			textView.textContainer?.lineFragmentPadding = 0
			textView.textContainer?.widthTracksTextView = true
			textView.isVerticallyResizable = true
			textView.autoresizingMask = [.width]
			textView.textStorage?.setAttributedString(notes.text)
			textView.setSelectedRange(NSRange(location: 0, length: 0))
			if let layoutManager = textView.layoutManager, let container = textView.textContainer {
				layoutManager.ensureLayout(for: container)
				notesHeight = min(ceil(layoutManager.usedRect(for: container).height), Self.maximumNotesHeight)
			}

			let scrollView = NSScrollView()
			scrollView.drawsBackground = false
			scrollView.hasVerticalScroller = true
			scrollView.autohidesScrollers = true
			scrollView.documentView = textView
			scrollView.translatesAutoresizingMaskIntoConstraints = false
			notesScrollView = scrollView

			// NSBox redraws its fill when the appearance changes, so the well follows
			// light and dark mode.
			let well = NSBox()
			well.boxType = .custom
			well.titlePosition = .noTitle
			well.borderWidth = 0
			well.cornerRadius = 8
			well.fillColor = .quaternarySystemFill
			well.contentViewMargins = .zero
			well.isHidden = true
			well.translatesAutoresizingMaskIntoConstraints = false
			well.contentView?.addSubview(scrollView)
			notesWell = well
			let heightConstraint = well.heightAnchor.constraint(equalToConstant: 0)
			notesHeightConstraint = heightConstraint
			// Collapsed, the notes take no space at all, including the gap above them.
			let topConstraint = well.topAnchor.constraint(equalTo: row.bottomAnchor)
			notesTopConstraint = topConstraint

			content.addSubview(row)
			content.addSubview(well)
			constraints += [
				row.topAnchor.constraint(equalTo: textStack.bottomAnchor, constant: 14),
				row.leadingAnchor.constraint(equalTo: content.leadingAnchor, constant: 20),
				topConstraint,
				well.leadingAnchor.constraint(equalTo: content.leadingAnchor, constant: 24),
				well.trailingAnchor.constraint(equalTo: content.trailingAnchor, constant: -24),
				heightConstraint,
				// The scroll view keeps its full height while the well is collapsed and hidden,
				// so the two never conflict.
				scrollView.topAnchor.constraint(equalTo: well.topAnchor, constant: Self.notesPadding.height),
				scrollView.leadingAnchor.constraint(equalTo: well.leadingAnchor, constant: Self.notesPadding.width),
				scrollView.trailingAnchor.constraint(equalTo: well.trailingAnchor, constant: -Self.notesPadding.width),
				scrollView.heightAnchor.constraint(equalToConstant: notesHeight),
			]
		}

		if !buttons.isEmpty {
			let buttonViews = buttons.map(makeButton)
			let buttonStack = NSStackView(views: buttonViews)
			buttonStack.orientation = .horizontal
			buttonStack.alignment = .centerY
			buttonStack.spacing = 12
			buttonStack.translatesAutoresizingMaskIntoConstraints = false
			content.addSubview(buttonStack)
			constraints += [
				buttonStack.trailingAnchor.constraint(equalTo: content.trailingAnchor, constant: -20),
				buttonStack.bottomAnchor.constraint(equalTo: content.bottomAnchor, constant: -20),
			]
			if let notesWell {
				constraints.append(
					buttonStack.topAnchor.constraint(equalTo: notesWell.bottomAnchor, constant: Self.notesButtonSpacing)
				)
			}
		}

		NSLayoutConstraint.activate(constraints)
		return content
	}

	// Grow or shrink the window by the notes' height, keeping its top edge in place.
	private func toggleNotes() {
		guard let window, let well = notesWell, let scrollView = notesScrollView,
			let heightConstraint = notesHeightConstraint
		else { return }
		let expanding = well.isHidden
		let wellHeight = notesHeight + 2 * Self.notesPadding.height
		notesDisclosure?.state = expanding ? .on : .off
		notesTopConstraint?.constant = expanding ? Self.notesSpacing : 0
		heightConstraint.constant = expanding ? wellHeight : 0
		well.isHidden = !expanding
		let expandedHeight = wellHeight + Self.notesSpacing
		let delta = expanding ? expandedHeight : -expandedHeight
		var frame = window.frame
		frame.size.height += delta
		frame.origin.y -= delta
		window.setFrame(frame, display: true, animate: true)
		guard expanding else { return }
		// Open at the first note, and flash the scroller so longer notes read as scrollable.
		scrollView.layoutSubtreeIfNeeded()
		scrollView.documentView?.scroll(.zero)
		scrollView.flashScrollers()
	}

	private func label(_ text: String, font: NSFont) -> NSTextField {
		let label = NSTextField(wrappingLabelWithString: text)
		label.font = font
		label.alignment = .center
		label.maximumNumberOfLines = 4
		label.preferredMaxLayoutWidth = 312
		return label
	}

	private func makeButton(_ model: UpdateWindowButton) -> NSButton {
		let button = ClosureButton(title: model.title, action: { [weak self] in
			guard let self else { return }
			if model.disablesAfterAction {
				self.closeAction = nil
				self.setButtonsEnabled(false)
			}
			model.action()
		})
		button.bezelStyle = .rounded
		button.keyEquivalent = model.keyEquivalent
		if #available(macOS 16, *) {
			button.controlSize = .large
		}
		return button
	}

	private func configure(_ indicator: NSProgressIndicator, for progress: UpdateWindowProgress) {
		switch progress {
		case .indeterminate:
			indicator.isIndeterminate = true
			indicator.startAnimation(nil)
		case .value(let value):
			indicator.stopAnimation(nil)
			indicator.isIndeterminate = false
			indicator.doubleValue = min(max(value, 0), 1)
		}
	}

	private func setButtonsEnabled(_ enabled: Bool) {
		func visit(_ view: NSView) {
			if let button = view as? NSButton {
				button.isEnabled = enabled
			}
			view.subviews.forEach(visit)
		}
		if let contentView = window?.contentView {
			visit(contentView)
		}
	}

	private func takeCloseAction() -> (() -> Void)? {
		defer { closeAction = nil }
		return closeAction
	}
}

@MainActor
private final class ClosureButton: NSButton {
	private let handler: () -> Void

	init(title: String, action: @escaping () -> Void) {
		self.handler = action
		super.init(frame: .zero)
		self.title = title
		self.target = self
		self.action = #selector(performAction)
	}

	@available(*, unavailable)
	required init?(coder: NSCoder) {
		fatalError("init(coder:) has not been implemented")
	}

	@objc private func performAction() {
		handler()
	}
}
