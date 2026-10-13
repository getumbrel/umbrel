import AppKit
import Sparkle
import SwiftUI

// Hand-managed status item so the tray behaves like a normal macOS menu bar app:
// left click toggles the popup panel, right click shows the app context menu
// (About / Launch at Login / Quit). SwiftUI's MenuBarExtra treats both clicks the
// same, which is why it isn't used here.
@MainActor
final class StatusItemController: NSObject {
	private let state: AppState
	private let updateController: UpdateController
	private let statusItem: NSStatusItem
	private let panel: PopupPanel
	private var hasPendingPanelPresentation = false
	private var statusItemMoveObserver: NSObjectProtocol?

	init(state: AppState, updateController: UpdateController) {
		self.state = state
		self.updateController = updateController
		self.statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
		self.panel = PopupPanel()
		super.init()

		let hostingController = NSHostingController(
			rootView: PanelRoot(state: state, updateController: updateController)
		)
		// Keep the AppKit panel synchronized with SwiftUI's changing ideal size.
		// Measuring the rendered view would only report the panel's existing bounds.
		hostingController.sizingOptions = [.preferredContentSize]
		panel.contentViewController = hostingController

		if let button = statusItem.button {
			button.image = Assets.trayNormal
			button.target = self
			button.action = #selector(handleClick)
			button.sendAction(on: [.leftMouseUp, .rightMouseUp])
		}
		observeTrayIcon()

		// Dismiss when the user clicks anywhere else. Keep the panel visible while one
		// of its own sheets is attached or an operation is presenting a system dialog;
		// both take key status without meaning the user left this flow. The tray click
		// still toggles the panel closed at any time.
		NotificationCenter.default.addObserver(
			forName: NSWindow.didResignKeyNotification, object: panel, queue: .main
		) { [weak self] _ in
			Task { @MainActor [weak self] in
				guard let self,
					!self.state.hasForegroundActivity,
					self.panel.attachedSheet == nil
				else { return }
				self.hidePanel()
			}
		}
	}

	// A menu-bar-only app has no Dock or window feedback when explicitly launched.
	// applicationDidFinishLaunching runs before AppKit has processed its first event,
	// and the status button moves through placeholder frames before reaching its menu-
	// bar slot. Observe that window instead of guessing a delay. Checking on the next
	// main-actor turn coalesces each burst of moves before validating the final frame.
	func presentPanelWhenReady() {
		hasPendingPanelPresentation = true

		if statusItemMoveObserver == nil,
			let buttonWindow = statusItem.button?.window
		{
			statusItemMoveObserver = NotificationCenter.default.addObserver(
				forName: NSWindow.didMoveNotification, object: buttonWindow, queue: .main
			) { [weak self] _ in
				Task { @MainActor [weak self] in
					guard let self else { return }
					// The first valid menu-bar frame can still be temporary. Once visible,
					// keep the panel attached while AppKit settles the status item into its
					// final slot; ordinary later opens already use the final geometry.
					if self.panel.isVisible {
						self.layoutPanel(contentSize: self.preferredPanelSize)
					}
					self.presentPendingPanelWhenReady()
				}
			}
		}

		Task { @MainActor [weak self] in
			self?.presentPendingPanelWhenReady()
		}
	}

	// ── Clicks ──

	@objc private func handleClick() {
		if NSApp.currentEvent?.type == .rightMouseUp {
			showContextMenu()
		} else {
			togglePanel()
		}
	}

	// The status item's menu is assigned only for the duration of the click:
	// a permanently assigned menu would hijack left clicks too.
	private func showContextMenu() {
		let menu = NSMenu()

		let about = NSMenuItem(title: "About Umbrel", action: #selector(showAbout), keyEquivalent: "")
		about.target = self
		menu.addItem(about)

		let checkForUpdates = NSMenuItem(
			title: updateController.availableUpdateVersion == nil ? "Check for Updates…" : "Update Available…",
			action: #selector(UpdateController.checkForUpdates(_:)),
			keyEquivalent: ""
		)
		checkForUpdates.target = updateController
		checkForUpdates.isEnabled = updateController.canCheckForUpdates
		menu.addItem(checkForUpdates)

		menu.addItem(.separator())

		let launchStatus = state.launchAtLoginStatus
		let launchTitle = switch launchStatus {
		case .disabled, .enabled:
			"Launch at Login"
		case .requiresApproval:
			"Approve Launch at Login…"
		case .unavailable:
			"Launch at Login Unavailable"
		}
		let launch = NSMenuItem(title: launchTitle, action: #selector(performLaunchAtLoginAction), keyEquivalent: "")
		launch.target = self
		launch.state = launchStatus == .enabled ? .on : .off
		launch.isEnabled = launchStatus != .unavailable
		menu.addItem(launch)

		menu.addItem(.separator())

		let quit = NSMenuItem(title: "Quit Umbrel", action: #selector(quit), keyEquivalent: "q")
		quit.target = self
		menu.addItem(quit)

		statusItem.menu = menu
		statusItem.button?.performClick(nil)
		statusItem.menu = nil
	}

	@objc private func showAbout() {
		NSApp.activate(ignoringOtherApps: true)
		NSApp.orderFrontStandardAboutPanel(nil)
	}

	@objc private func performLaunchAtLoginAction() {
		state.performLaunchAtLoginAction()
	}

	@objc private func quit() {
		NSApp.terminate(nil)
	}

	// ── Panel ──

	private func togglePanel() {
		if panel.isVisible {
			hidePanel()
		} else {
			showPanel()
		}
	}

	private func showPanel() {
		panel.contentView?.layoutSubtreeIfNeeded()
		guard layoutPanel(contentSize: preferredPanelSize) else { return }
		hasPendingPanelPresentation = false
		panel.makeKeyAndOrderFront(nil)
		// Route keyboard input into the SwiftUI hierarchy (borderless panels don't
		// pick a first responder on their own)
		panel.makeFirstResponder(panel.contentView)
		state.panelDidOpen()
	}

	private func hidePanel() {
		panel.orderOut(nil)
		state.panelDidClose()
	}

	// Size to the SwiftUI content and place it with NSMenu geometry: left-aligned to
	// the status item and opening rightward, sliding left only when the screen edge
	// would clip it, floating the same small gap below the menu bar that system menus
	// use on modern macOS.
	@discardableResult
	private func layoutPanel(contentSize: CGSize) -> Bool {
		guard contentSize != .zero,
			let (buttonFrame, screen) = statusItemGeometry
		else { return false }
		var x = buttonFrame.minX
		let visibleFrame = screen.visibleFrame
		x = min(x, visibleFrame.maxX - contentSize.width - 4)
		x = max(x, visibleFrame.minX + 4)
		let frame = NSRect(
			x: x,
			y: buttonFrame.minY - 5 - contentSize.height,
			width: contentSize.width,
			height: contentSize.height
		)
		panel.setFrame(frame, display: true, animate: panel.isVisible)
		return true
	}

	// Convert the actual status button—not merely its containing window—to screen
	// coordinates. Requiring it to occupy the menu-bar band rejects AppKit's temporary
	// launch-time frame at the bottom-left of the screen.
	private var statusItemGeometry: (frame: NSRect, screen: NSScreen)? {
		guard let button = statusItem.button,
			let buttonWindow = button.window,
			let screen = buttonWindow.screen
		else { return nil }
		let frame = buttonWindow.convertToScreen(button.convert(button.bounds, to: nil))
		guard !frame.isEmpty,
			frame.intersects(screen.frame),
			frame.midY >= screen.frame.maxY - (frame.height * 2)
		else { return nil }
		return (frame, screen)
	}

	private func presentPendingPanelWhenReady() {
		guard hasPendingPanelPresentation, statusItemGeometry != nil else { return }
		showPanel()
	}

	// ── Tray icon (broken-umbrella alert when saved devices exist but none is connected) ──

	// withObservationTracking only fires once, so the change handler re-registers by
	// calling this again: render, observe, repeat.
	private func observeTrayIcon() {
		withObservationTracking {
			statusItem.button?.image = state.showsAlertIcon ? Assets.trayAlert : Assets.trayNormal
		} onChange: { [weak self] in
			Task { @MainActor [weak self] in
				self?.observeTrayIcon()
			}
		}
	}

	private var preferredPanelSize: CGSize {
		let preferred = panel.contentViewController?.preferredContentSize ?? .zero
		return preferred == .zero ? panel.contentView?.fittingSize ?? .zero : preferred
	}
}

// Borderless floating panel that can take keyboard focus (for the password field)
// without activating the app
private final class PopupPanel: NSPanel {
	init() {
		super.init(
			contentRect: .zero,
			styleMask: [.borderless, .nonactivatingPanel],
			backing: .buffered,
			defer: false
		)
		isOpaque = false
		backgroundColor = .clear
		hasShadow = true
		isFloatingPanel = true
		level = .popUpMenu
		hidesOnDeactivate = false
		isMovable = false
		animationBehavior = .none
		collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
	}

	override var canBecomeKey: Bool { true }
}

// Popup content wrapped with the popover material and rounded corners the panel
// itself doesn't provide. NSHostingController reports its changing ideal size to
// AppKit so the panel follows discovery and navigation state without manual geometry.
private struct PanelRoot: View {
	let state: AppState
	let updateController: UpdateController

	var body: some View {
		PopupView()
			.environment(state)
			.environment(updateController)
			.preferredColorScheme(.dark)
			.background(PanelMaterial())
			.clipShape(Panel.shape)
	}
}
