import AppKit
import SwiftUI
import UmbrelKit

// ── Palette ──
// Shared menu bar palette.

enum Palette {
	static let blue = Color(hex: 0x0088FF)
	static let green = Color(hex: 0x34C759)
	static let orange = Color(hex: 0xFF9F0A)
	static let red = Color(hex: 0xFF2D55)
	static let buttonBlue = Color(hex: 0x0078F0)
	static let indigo = Color(hex: 0x6155F5)
	static let gray = Color(hex: 0x8E8E93)
}

extension Color {
	init(hex: UInt32) {
		self.init(
			.sRGB,
			red: Double((hex >> 16) & 0xFF) / 255,
			green: Double((hex >> 8) & 0xFF) / 255,
			blue: Double(hex & 0xFF) / 255
		)
	}
}

// ── Bundled images ──

enum Assets {
	static let logo = image("umbrel-logo", "webp")
	static let deviceHome = image("umbrel-home", "webp")
	static let devicePro = image("umbrel-pro", "webp")
	static let devicePi = image("system-pi", "svg")
	static let deviceGeneric = image("system-generic-device", "svg")
	static let folder = image("folder", "webp")
	static let tailscale = image("tailscale", "svg")
	static let statusConnected = image("status-connected", "png")
	static let statusDisconnected = image("status-disconnected", "png")
	static let statusSecure = image("status-secure", "png")
	static let trayNormal = template("IconTemplate")
	static let trayAlert = template("IconAlertTemplate")

	// Model strings come from umbreld's detectDevice() via the TXT hint or the
	// discoveryInfo probe: "Umbrel Home (2025)", "Umbrel Pro", "Raspberry Pi 5",
	// or a raw SMBIOS product name for generic x86. nil = offline saved device
	// with no stored model, shown as generic hardware.
	static func deviceImage(model: String?) -> NSImage {
		switch UmbrelDeviceKind(model: model) {
		case .home: deviceHome
		case .pro: devicePro
		case .raspberryPi: devicePi
		case .generic: deviceGeneric
		}
	}

	private static func image(_ name: String, _ ext: String) -> NSImage {
		guard let url = Bundle.main.url(forResource: name, withExtension: ext),
			let image = NSImage(contentsOf: url)
		else { return NSImage() }
		return image
	}

	// Menu bar icons are macOS template images (black + alpha), so the OS tints them
	// for light and dark menu bars. Xcode combines the 1x and 2x files into a single
	// optimized resource, and AppKit selects the appropriate representation.
	private static func template(_ name: String) -> NSImage {
		guard let image = NSImage(named: name) else { return NSImage() }
		image.isTemplate = true
		return image
	}
}

// ── Window background ──

// The panel's rounded shape, shared by the glass material and the content clip so
// they can't drift apart
enum Panel {
	static var shape: RoundedRectangle { RoundedRectangle(cornerRadius: 34, style: .continuous) }
}

// Material behind the panel content (the panel itself is borderless and transparent).
// Liquid Glass on macOS 26, matching what system menus render; the popover vibrancy
// material on older systems.
struct PanelMaterial: View {
	var body: some View {
		if #available(macOS 26.0, *) {
			Color.clear.glassEffect(.regular, in: Panel.shape)
		} else {
			VisualEffectBackground()
		}
	}
}

struct VisualEffectBackground: NSViewRepresentable {
	func makeNSView(context: Context) -> NSVisualEffectView {
		let view = NSVisualEffectView()
		view.material = .popover
		view.blendingMode = .behindWindow
		view.state = .active
		return view
	}

	func updateNSView(_ nsView: NSVisualEffectView, context: Context) {}
}

// ── Device art ──

// Device images must get explicit width AND height: letting scaledToFit derive the
// height from the aspect ratio collapses the image inside these row layouts.
struct DeviceIcon: View {
	let model: String?
	let width: CGFloat
	let height: CGFloat

	var body: some View {
		let kind = UmbrelDeviceKind(model: model)
		// Match umbrelOS: the bare Pi mark sits in a device-shaped tile so it has
		// comparable visual weight to the hardware renders.
		if kind == .raspberryPi {
			GeometryReader { proxy in
				let size = min(proxy.size.width, proxy.size.height)
				let shape = RoundedRectangle(cornerRadius: size * 27 / 128, style: .continuous)
				ZStack {
					shape.fill(Color(hex: 0x525252).opacity(0.48))
					shape.strokeBorder(
						LinearGradient(
							colors: [.white.opacity(0.33), .clear],
							startPoint: .top,
							endPoint: .center
						),
						lineWidth: 1
					)
					Image(nsImage: Assets.devicePi)
						.resizable()
						.scaledToFit()
						.frame(width: size / 2, height: size / 2)
				}
				.frame(width: size, height: size)
				.frame(maxWidth: .infinity, maxHeight: .infinity)
			}
			.frame(width: width, height: height)
		} else {
			Image(nsImage: Assets.deviceImage(model: model))
				.resizable()
				.scaledToFit()
				.frame(width: width, height: height)
		}
	}
}

// ── Status ──

struct StatusInfo {
	let label: String
	let color: Color
	var showsProgress = false
}

func statusInfo(for device: Device) -> StatusInfo {
	if device.connection == .connecting {
		return StatusInfo(label: "Connecting\u{2026}", color: Palette.orange)
	}
	if device.connection == .disconnecting {
		return StatusInfo(label: "Disconnecting\u{2026}", color: Palette.orange)
	}
	if device.saved && device.reachability == .unverified {
		return StatusInfo(label: "", color: Palette.gray, showsProgress: true)
	}
	if device.saved && !device.online {
		return StatusInfo(label: "Offline", color: Palette.red)
	}
	if !device.saved {
		return StatusInfo(label: device.onboarded == true ? "Ready to connect" : "Ready for setup", color: Palette.blue)
	}
	switch device.connection {
	case .connected:
		return StatusInfo(label: "Connected", color: Palette.green)
	case .expired:
		return StatusInfo(label: "Session expired", color: Palette.orange)
	default:
		return StatusInfo(label: "Disconnected", color: Palette.red)
	}
}

// Keep connection health and transport separate: the status stays easy to scan,
// while the verified endpoint explains whether native traffic is currently local or
// using Tailscale. Finder uses the same endpoint for new and recovered SMB mounts.
func connectionRouteLabel(for device: Device) -> String? {
	guard device.connection == .connected, let host = device.connectionHost else { return nil }
	return SavedDevice.isTailscaleAddress(host) ? "Tailscale" : "Local network"
}

struct StatusDot: View {
	let color: Color

	var body: some View {
		ZStack {
			Circle().fill(color.opacity(0.2)).frame(width: 14, height: 14)
			Circle().fill(color).frame(width: 6, height: 6)
		}
	}
}

// Status dot + label + optional secondary context, used under every device name.
struct StatusLine: View {
	let status: StatusInfo
	var secondaryLabel: String? = nil
	@State private var showsProgress = false

	var body: some View {
		HStack(spacing: 4) {
			if status.showsProgress {
				ProgressView()
					.controlSize(.small)
					.opacity(showsProgress ? 1 : 0)
					.accessibilityLabel("Checking connection")
					.accessibilityHidden(!showsProgress)
			} else {
				StatusDot(color: status.color)
				Text(status.label)
					.foregroundStyle(.white)
					.fixedSize(horizontal: true, vertical: false)
			}
			if let secondaryLabel {
				Text("\u{00B7}").foregroundStyle(.white.opacity(0.5))
				Text(secondaryLabel)
					.foregroundStyle(.white.opacity(0.7))
					.lineLimit(1)
					.truncationMode(.middle)
			}
		}
		.font(.system(size: 11))
		.task(id: status.showsProgress) {
			showsProgress = false
			guard status.showsProgress else { return }
			try? await Task.sleep(for: .milliseconds(400))
			guard !Task.isCancelled, status.showsProgress else { return }
			showsProgress = true
		}
	}
}

// ── Buttons ──

struct PillButtonStyle: ButtonStyle {
	var prominent = true
	var tint = Palette.buttonBlue
	var pressedTint = Color(hex: 0x0055B0)

	func makeBody(configuration: Configuration) -> some View {
		configuration.label
			.font(.system(size: 13, weight: .medium))
			.foregroundStyle(prominent ? .white : .white.opacity(0.85))
			.padding(.horizontal, 16)
			.padding(.vertical, 8)
			.frame(maxWidth: .infinity)
			.background(
				Capsule().fill(
					prominent
						? (configuration.isPressed ? pressedTint : tint)
						: (configuration.isPressed ? Color(hex: 0x2A2A2A) : Color(hex: 0x141414))
				)
			)
	}
}

// ── Section box (dark rounded container with hairline-divided rows) ──

struct SectionBox<Content: View>: View {
	@ViewBuilder let content: Content

	var body: some View {
		VStack(spacing: 0) {
			content
		}
		.background(Color.black.opacity(0.22))
		.clipShape(RoundedRectangle(cornerRadius: 12))
		.overlay(RoundedRectangle(cornerRadius: 12).stroke(.white.opacity(0.1), lineWidth: 1))
	}
}

// ── Access row (URL row with copy + open) ──

struct AccessRow: View {
	let url: URL
	let label: String
	var accessType: String? = nil
	var isAvailable: Bool? = nil
	var hasDivider = false

	@State private var copied = false
	@State private var hovered = false

	var body: some View {
		Button(action: open) {
			HStack(spacing: 8) {
				Text(label).foregroundStyle(.white.opacity(0.85))
				if accessType == "Tailscale" {
					HStack(spacing: 4) {
						Image(nsImage: Assets.tailscale)
							.resizable()
							.scaledToFit()
							.frame(width: 12, height: 12)
							.clipShape(RoundedRectangle(cornerRadius: 3, style: .continuous))
						Text("Tailscale")
					}
					.font(.system(size: 9, weight: .medium))
					.foregroundStyle(Palette.gray)
				}
				Spacer()
				// The copy control is overlaid in this reserved slot so it remains a
				// sibling of the row button rather than an invalid nested control.
				Color.clear
					.frame(width: 12, height: 12)
					.accessibilityHidden(true)
				Image(systemName: "arrow.up.right")
					.font(.system(size: 12))
					.foregroundStyle(Palette.gray)
			}
			.font(.system(size: 11, weight: .medium))
			.padding(10)
			.background(hovered ? Color.white.opacity(0.06) : .clear)
			.overlay(alignment: .top) {
				if hasDivider {
					Rectangle().fill(.white.opacity(0.06)).frame(height: 0.5)
				}
			}
			.contentShape(Rectangle())
		}
		.buttonStyle(.plain)
		.accessibilityLabel("Open \(label) in your browser")
		.accessibilityValue(isAvailable.map { $0 ? "Available" : "Unavailable" } ?? "Checking availability")
		.overlay(alignment: .trailing) {
			Button(action: copy) {
				Image(systemName: copied ? "checkmark" : "doc.on.doc")
					.font(.system(size: 12))
					.foregroundStyle(Palette.gray)
					.padding(6)
					.contentShape(Rectangle())
			}
			.buttonStyle(.plain)
			.padding(.trailing, 24)
			.accessibilityLabel(copied ? "Address copied" : "Copy address")
			.help(copied ? "Copied" : "Copy address")
		}
		.onHover { hovered = $0 }
		.opacity(isAvailable == true ? 1 : (isAvailable == false ? 0.4 : 0.65))
	}

	private func open() {
		NSWorkspace.shared.open(url)
	}

	private func copy() {
		NSPasteboard.general.clearContents()
		NSPasteboard.general.setString(url.absoluteString, forType: .string)
		copied = true
		Task {
			try? await Task.sleep(for: .seconds(1.5))
			copied = false
		}
	}
}

// ── Password form (shared by connect + reconnect, with optional 2FA field) ──

struct PasswordForm: View {
	private enum Field: Hashable {
		case password
		case twoFactor
	}

	let label: String
	var requiresTotp = false
	let loading: Bool
	let error: String?
	let onCodeEntry: () -> Void
	let onSubmit: (_ password: String, _ totpToken: String?) -> Void

	@State private var password = ""
	@State private var totp = ""
	@State private var showPassword = false
	@FocusState private var focusedField: Field?

	var body: some View {
		VStack(alignment: .leading, spacing: 12) {
			Text(label)
				.font(.system(size: 12))
				.foregroundStyle(.white.opacity(0.5))
				.lineLimit(1)
				.truncationMode(.tail)

			if requiresTotp {
				ZStack {
					TextField("", text: $totp)
						.textFieldStyle(.plain)
						.textContentType(.oneTimeCode)
						.focused($focusedField, equals: .twoFactor)
						.onSubmit(submit)
						.onChange(of: totp) {
							let code = String(totp.filter { "0123456789".contains($0) }.prefix(6))
							if totp != code {
								totp = code
							}
							if error != nil, !code.isEmpty {
								onCodeEntry()
							}
							if code.count == 6 {
								submit()
							}
						}
						.foregroundStyle(.clear)
						.tint(.clear)
						.frame(width: 256, height: 40)
						.accessibilityLabel("Verification code")
						.onAppear {
							focus(.twoFactor)
						}

					HStack(spacing: 8) {
						ForEach(0..<6, id: \.self) { index in
							Text(digit(at: index))
								.font(.system(size: 17, weight: .semibold, design: .monospaced))
								.foregroundStyle(.white.opacity(0.9))
								.frame(width: 36, height: 40)
								.background(RoundedRectangle(cornerRadius: 10).fill(.white.opacity(0.05)))
								.overlay {
									RoundedRectangle(cornerRadius: 10)
										.stroke(slotBorder(at: index), lineWidth: 1)
								}
						}
					}
					.allowsHitTesting(false)
					.accessibilityHidden(true)
				}
				.frame(maxWidth: .infinity, alignment: .center)
					.overlay(alignment: .trailing) {
						if loading {
							ProgressView().controlSize(.small)
						}
					}
					.disabled(loading)
			} else {
				HStack(spacing: 8) {
					Group {
						if showPassword {
							TextField("Password", text: $password)
						} else {
							SecureField("Password", text: $password)
						}
					}
					.textFieldStyle(.plain)
					.font(.system(size: 13, weight: .medium))
					.textContentType(.password)
					.focused($focusedField, equals: .password)
					.onSubmit(submit)

					if loading {
						ProgressView().controlSize(.small)
					} else {
						Button {
							showPassword.toggle()
						} label: {
							Image(systemName: showPassword ? "eye.slash" : "eye")
								.font(.system(size: 12))
								.foregroundStyle(.white.opacity(0.4))
						}
						.buttonStyle(.plain)
					}
				}
				.padding(.horizontal, 14)
				.frame(height: 40)
				.background(Capsule().fill(.white.opacity(0.05)))
				.overlay(Capsule().stroke(error != nil ? Palette.red : .white.opacity(0.1), lineWidth: 1))
			}

			if let error {
				Text(error).font(.system(size: 12)).foregroundStyle(Palette.red)
			}
		}
		.onAppear {
			focus(requiresTotp ? .twoFactor : .password)
		}
		.onChange(of: error) {
			guard requiresTotp, error != nil else { return }
			totp = ""
			focusedField = .twoFactor
		}
	}

	private func digit(at index: Int) -> String {
		guard index < totp.count else { return "" }
		let position = totp.index(totp.startIndex, offsetBy: index)
		return String(totp[position])
	}

	private func slotBorder(at index: Int) -> Color {
		if error != nil {
			return Palette.red
		}
		let activeIndex = min(totp.count, 5)
		if focusedField == .twoFactor, index == activeIndex {
			return .white.opacity(0.4)
		}
		return .white.opacity(0.1)
	}

	private func focus(_ field: Field) {
		// A field inserted by the 2FA state change must join AppKit's responder
		// chain before SwiftUI can focus it.
		Task { @MainActor in
			try? await Task.sleep(for: .milliseconds(50))
			focusedField = field
		}
	}

	private func submit() {
		guard !password.isEmpty, !loading, !requiresTotp || totp.count == 6 else { return }
		onSubmit(password, requiresTotp && !totp.isEmpty ? totp : nil)
	}
}
