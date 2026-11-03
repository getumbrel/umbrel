import SwiftUI
import UmbrelKit

// Device list: header with logo + subtitle, then one card per device. A single
// unsaved device gets the larger onboarding "welcome" card instead.
struct DeviceListView: View {
	@Environment(AppState.self) private var state
	let devices: [Device]
	let unverifiedDevices: [Umbreld.UnverifiedDevice]
	let updateRequiredDevices: [Umbreld.UpdateRequiredDevice]
	let onSelect: (String) -> Void
	let onConnectByAddress: () -> Void

	private var singleUnsaved: Device? {
		devices.count == 1 && unverifiedDevices.isEmpty && updateRequiredDevices.isEmpty && !devices[0].saved
			? devices[0] : nil
	}

	private var resultCount: Int {
		devices.count + unverifiedDevices.count + updateRequiredDevices.count
	}

	private var subtitle: String {
		if state.initialDiscoveryInProgress || state.scanning {
			return "Searching for devices\u{2026}"
		}
		if resultCount == 0 { return "No Umbrel devices found on your network" }
		if let device = singleUnsaved {
			return device.onboarded == true
				? "Your device is ready to connect" : "Your device is ready for setup"
		}
		return "Found \(resultCount) device\(resultCount == 1 ? "" : "s") on your network"
	}

	var body: some View {
		VStack(alignment: .leading, spacing: 0) {
			header

			if resultCount == 0 {
				Group {
					if state.initialDiscoveryInProgress {
						ProgressView()
							.controlSize(.small)
							.frame(height: 28)
					} else {
						ScanButton()
					}
				}
					.padding(.top, 16)
					.padding(.horizontal, 6)
					.padding(.bottom, 4)
			} else {
				Rectangle().fill(.white.opacity(0.1)).frame(height: 1)
					.padding(.top, 18)
					.padding(.bottom, 18)
			}

			if let device = singleUnsaved {
				WelcomeCard(device: device) {
					onSelect(device.id)
				}
			} else {
				// The bounded list keeps the menu-bar panel on screen even when every
				// fallback hostname answers alongside several saved devices.
				ScrollView(.vertical) {
					VStack(spacing: 4) {
						ForEach(devices) { device in
							DeviceCard(device: device) {
								onSelect(device.id)
							}
						}
						ForEach(unverifiedDevices, id: \.host) { device in
							UnverifiedDeviceCard(device: device, isRetrying: state.retryingHosts.contains(device.host)) {
								Task { await state.retry(device) }
							}
						}
						ForEach(updateRequiredDevices, id: \.host) { device in
							UpdateRequiredDeviceCard(device: device)
						}
					}
				}
				.frame(maxHeight: 480)
			}

			if !state.initialDiscoveryInProgress && !state.scanning {
				manualAddressFooter
					.padding(.top, 14)
					.padding(.horizontal, 6)
			}
		}
		.padding(.horizontal, 24)
		.padding(.bottom, 24)
	}

	private var header: some View {
		VStack(alignment: .leading, spacing: 0) {
			HStack(alignment: .top) {
				Image(nsImage: Assets.logo)
					.resizable()
					.scaledToFit()
					.frame(width: 48, height: 48)
				Spacer()
				if resultCount > 0 {
					RefreshButton()
				}
			}
			Text("Welcome to umbrelOS")
				.font(.system(size: 17, weight: .bold))
				.foregroundStyle(.white.opacity(0.85))
				.padding(.top, 16)
				.padding(.bottom, 2)
			Text(subtitle)
				.font(.system(size: 11))
				.foregroundStyle(.secondary)
		}
		.padding(.top, 28) // balances the detail view's 20pt top inset
		.padding(.horizontal, 6)
		.padding(.bottom, 2)
	}

	private var manualAddressFooter: some View {
		Button(action: onConnectByAddress) {
			HStack(spacing: 4) {
				(
					Text("Can’t find your Umbrel? ")
						+ Text("Connect by address").fontWeight(.semibold)
				)
					.font(.system(size: 11))
					.foregroundStyle(.secondary)
				Image(systemName: "chevron.right")
					.font(.system(size: 9, weight: .semibold))
					.foregroundStyle(.secondary)
			}
			.contentShape(Rectangle())
		}
		.buttonStyle(.plain)
	}
}

// Manual rescan (discovery itself is always live). While the scan runs the button
// becomes a small system spinner so the click visibly lands even when nothing changes.
private struct RefreshButton: View {
	@Environment(AppState.self) private var state

	var body: some View {
		Button {
			Task { await state.rescan() }
		} label: {
			Group {
				if state.scanning {
					ProgressView()
						.controlSize(.small)
				} else {
					RefreshIcon()
						.stroke(.secondary, style: StrokeStyle(lineWidth: 1.33, lineCap: .round, lineJoin: .round))
				}
			}
			.frame(width: 16, height: 16)
			// Generous hit target; without this only the stroke pixels are clickable
			.padding(8)
			.contentShape(Rectangle())
		}
		.buttonStyle(.plain)
		.padding(-8)
	}
}

// A circular-arrow glyph drawn as an open arc with an arrowhead notch at the
// top right of a 16pt box.
private struct RefreshIcon: Shape {
	func path(in rect: CGRect) -> Path {
		let scale = rect.width / 16
		var path = Path()
		path.addArc(
			center: CGPoint(x: 8 * scale, y: 8 * scale),
			radius: 5.33 * scale,
			startAngle: .degrees(7.4),
			endAngle: .degrees(-22),
			clockwise: false
		)
		path.move(to: CGPoint(x: 13.33 * scale, y: 2.67 * scale))
		path.addLine(to: CGPoint(x: 13.33 * scale, y: 6 * scale))
		path.addLine(to: CGPoint(x: 10 * scale, y: 6 * scale))
		return path
	}
}

// Primary action on the empty list: restarts the browse and probes known hosts.
// Discovery only finds devices on the umbrelOS version that advertises _umbrel._tcp.
private struct ScanButton: View {
	@Environment(AppState.self) private var state

	var body: some View {
		Button(state.scanning ? "Scanning\u{2026}" : "Scan network") {
			Task { await state.rescan() }
		}
		.buttonStyle(PillButtonStyle(tint: Palette.indigo, pressedTint: Color(hex: 0x4840B8)))
		.fixedSize()
		.disabled(state.scanning)
	}
}

// Compact card in the device list
private struct DeviceCard: View {
	let device: Device
	let onClick: () -> Void

	@State private var hovered = false

	var body: some View {
		Button(action: onClick) {
			HStack(spacing: 16) {
				DeviceIcon(model: device.model, placement: .listRow)
					.frame(width: 45)

				VStack(alignment: .leading, spacing: 2) {
					Text(device.displayName)
						.font(.system(size: 13, weight: .bold))
						.foregroundStyle(.white.opacity(0.85))
						.lineLimit(1)
						.truncationMode(.tail)
					// In a multi-device list, the stable host is more useful for telling
					// similar Umbrels apart than repeating the active connection route.
					StatusLine(status: statusInfo(for: device), secondaryLabel: device.host)
						.help(device.host)
				}

				Spacer()
				Image(systemName: "chevron.right")
					.font(.system(size: 12, weight: .semibold))
					.foregroundStyle(.secondary)
			}
			.padding(16)
			.background(RoundedRectangle(cornerRadius: 16).fill(.white.opacity(hovered ? 0.12 : 0.06)))
			.contentShape(RoundedRectangle(cornerRadius: 16))
		}
		.buttonStyle(.plain)
		.onHover { hovered = $0 }
	}
}

// Version-only fallback results are deliberately not `Device`s: without the native
// discovery identity they may open in a browser for updating, but can never be
// selected, authenticated, or saved by the Mac app.
private struct UpdateRequiredDeviceCard: View {
	@Environment(\.openURL) private var openURL
	let device: Umbreld.UpdateRequiredDevice
	@State private var hovered = false

	var body: some View {
		Button {
			guard let url = URL(string: "http://\(device.host)") else { return }
			openURL(url)
		} label: {
			HStack(spacing: 16) {
				DeviceIcon(model: nil, placement: .listRow)
					.frame(width: 45)

				VStack(alignment: .leading, spacing: 2) {
					Text("Update to connect")
						.font(.system(size: 13, weight: .bold))
						.foregroundStyle(.white.opacity(0.85))
					Text(device.host)
						.font(.system(size: 11))
						.foregroundStyle(.white)
				}

				Spacer()
				Image(systemName: "arrow.up.right")
					.font(.system(size: 11, weight: .semibold))
					.foregroundStyle(.secondary)
			}
			.padding(16)
			.background(RoundedRectangle(cornerRadius: 16).fill(.white.opacity(hovered ? 0.12 : 0.06)))
			.contentShape(RoundedRectangle(cornerRadius: 16))
		}
		.buttonStyle(.plain)
		.onHover { hovered = $0 }
	}
}

// A current Umbrel at a common hostname that answered but couldn't prove its identity.
// Like an update hint it's not a `Device`: it can't be selected, authenticated, or
// saved. It offers another try, or the browser, where umbrelOS may still open.
private struct UnverifiedDeviceCard: View {
	@Environment(\.openURL) private var openURL
	let device: Umbreld.UnverifiedDevice
	let isRetrying: Bool
	let onRetry: () -> Void

	var body: some View {
		HStack(alignment: .top, spacing: 16) {
			DeviceIcon(model: nil, placement: .listRow)
				.frame(width: 45)

			VStack(alignment: .leading, spacing: 2) {
				Text("Couldn\u{2019}t connect")
					.font(.system(size: 13, weight: .bold))
					.foregroundStyle(.white.opacity(0.85))
				Text(device.host)
					.font(.system(size: 11))
					.foregroundStyle(.white)
				Text(device.reason.explanation)
					.font(.system(size: 10))
					.foregroundStyle(.secondary)
					.fixedSize(horizontal: false, vertical: true)
					.padding(.top, 4)

				HStack(spacing: 14) {
					Button {
						onRetry()
					} label: {
						Group {
							if isRetrying {
								ProgressView().controlSize(.small)
							} else {
								Text("Try again")
							}
						}
						.frame(height: 16)
					}
					.buttonStyle(PillButtonStyle())
					.fixedSize()
					.disabled(isRetrying)

					Button("Open in browser") {
						guard let url = URL(string: "http://\(device.host)") else { return }
						openURL(url)
					}
					.buttonStyle(.plain)
					.font(.system(size: 10, weight: .medium))
					.foregroundStyle(.secondary)
				}
				.padding(.top, 10)
			}

			Spacer(minLength: 0)
		}
		.padding(16)
		.background(RoundedRectangle(cornerRadius: 16).fill(.white.opacity(0.06)))
	}
}

// Prominent onboarding card when exactly one unsaved device is on the network
private struct WelcomeCard: View {
	let device: Device
	let onClick: () -> Void

	var body: some View {
		VStack(spacing: 0) {
			DeviceIcon(model: device.model, placement: .welcomeCard)

			Text(device.displayName)
				.font(.system(size: 17, weight: .bold))
				.foregroundStyle(.white.opacity(0.85))
				.lineLimit(1)
				.truncationMode(.tail)
				.padding(.top, 16)
				.padding(.bottom, 8)

			StatusLine(status: statusInfo(for: device), secondaryLabel: connectionRouteLabel(for: device))

			Button(device.onboarded == true ? "Connect" : "Set up", action: onClick)
				.buttonStyle(PillButtonStyle())
				.fixedSize()
				.padding(.top, 16)
		}
		.frame(maxWidth: .infinity)
		.padding(20)
		.background(RoundedRectangle(cornerRadius: 20).fill(.white.opacity(0.06)))
	}
}

// Harness for finessing the "Couldn't connect" card in the Xcode canvas
#Preview("Couldn't Connect") {
	VStack(spacing: 4) {
		UnverifiedDeviceCard(
			device: Umbreld.UnverifiedDevice(host: "umbrel.local", reason: .slow),
			isRetrying: false
		) {}
		UnverifiedDeviceCard(
			device: Umbreld.UnverifiedDevice(host: "umbrel-2.local", reason: .unexpected),
			isRetrying: true
		) {}
	}
	.padding(24)
	.frame(width: 360)
	.background(.black)
}
