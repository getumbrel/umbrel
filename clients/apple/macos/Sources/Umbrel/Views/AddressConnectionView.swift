import SwiftUI

// Alternate first-connection route for networks where Bonjour cannot find the
// Umbrel, including remote access over an already-configured Tailscale connection.
// Results stay on this screen until a verified device can move directly to sign-in.
struct AddressConnectionView: View {
	@Environment(AppState.self) private var state
	@Environment(\.openURL) private var openURL
	let onBack: () -> Void
	let onSelect: (String) -> Void

	@State private var address = ""
	@State private var error: String?
	@State private var updateRequiredHost: String?
	@State private var isConnecting = false
	@State private var connectionTask: Task<Void, Never>?
	@FocusState private var addressFocused: Bool

	var body: some View {
		VStack(alignment: .leading, spacing: 0) {
			Image(nsImage: Assets.logo)
				.resizable()
				.scaledToFit()
				.frame(width: 48, height: 48)

			Text("Connect by address")
				.font(.system(size: 17, weight: .bold))
				.foregroundStyle(.white.opacity(0.85))
				.padding(.top, 16)

			Text("Enter your Umbrel’s IP address or hostname. If you’re away from home, use its Tailscale IP address or MagicDNS name. Tailscale must already be set up on this Mac and your Umbrel.")
				.font(.system(size: 11))
				.foregroundStyle(Palette.gray)
				.fixedSize(horizontal: false, vertical: true)
				.padding(.top, 4)

			TextField("e.g. umbrel.local, umbrel, or 100.64.0.1", text: $address)
				.textFieldStyle(.plain)
				.font(.system(size: 12))
				.foregroundStyle(.white.opacity(0.85))
				.padding(.horizontal, 12)
				.frame(height: 38)
				.background(RoundedRectangle(cornerRadius: 10).fill(.black.opacity(0.22)))
				.overlay {
					RoundedRectangle(cornerRadius: 10)
						.stroke(error == nil ? .white.opacity(0.1) : Palette.red, lineWidth: 1)
				}
				.focused($addressFocused)
				.disabled(isConnecting)
				.onSubmit(connect)
				.onChange(of: address) {
					error = nil
					updateRequiredHost = nil
				}
				.accessibilityLabel("Umbrel address")
				.padding(.top, 18)

			if let error {
				Text(error)
					.font(.system(size: 10))
					.foregroundStyle(Palette.red)
					.fixedSize(horizontal: false, vertical: true)
					.padding(.top, 7)
			}

			if let updateRequiredHost {
				VStack(alignment: .leading, spacing: 8) {
					Text("Update required")
						.font(.system(size: 12, weight: .semibold))
						.foregroundStyle(.white.opacity(0.85))
					Text("This Umbrel needs to be updated before it can connect to the app.")
						.font(.system(size: 10))
						.foregroundStyle(Palette.gray)
						.fixedSize(horizontal: false, vertical: true)
					Button("Open Umbrel") {
						guard let url = URL(string: "http://\(updateRequiredHost)") else { return }
						openURL(url)
					}
					.buttonStyle(PillButtonStyle())
				}
				.padding(.top, 14)
			} else {
				Button {
					connect()
				} label: {
					Group {
						if isConnecting {
							ProgressView().controlSize(.small)
						} else {
							Text("Connect")
						}
					}
					.frame(height: 16)
				}
				.buttonStyle(PillButtonStyle(tint: Palette.indigo, pressedTint: Color(hex: 0x4840B8)))
				.disabled(isConnecting || address.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
				.padding(.top, 12)
			}

			Button {
				connectionTask?.cancel()
				onBack()
			} label: {
				HStack(spacing: 2) {
					Image(systemName: "chevron.left")
						.font(.system(size: 9, weight: .semibold))
					Text("All devices")
				}
			}
			.buttonStyle(.plain)
			.font(.system(size: 10, weight: .medium))
			.foregroundStyle(Palette.gray)
			.padding(.top, 22)
		}
		.padding(.horizontal, 30)
		.padding(.vertical, 28)
		.onAppear { addressFocused = true }
		.onDisappear {
			connectionTask?.cancel()
			connectionTask = nil
		}
	}

	private func connect() {
		guard !isConnecting else { return }
		let submittedAddress = address.trimmingCharacters(in: .whitespacesAndNewlines)
		guard !submittedAddress.isEmpty else { return }

		error = nil
		updateRequiredHost = nil
		isConnecting = true
		addressFocused = false
		connectionTask = Task {
			do {
				let result = try await state.connectByAddress(submittedAddress)
				try Task.checkCancellation()
				isConnecting = false
				connectionTask = nil
				switch result {
				case .device(let deviceId):
					onSelect(deviceId)
				case .updateRequired(let host):
					updateRequiredHost = host
				}
			} catch is CancellationError {
				return
			} catch {
				self.error = error.localizedDescription
				isConnecting = false
				connectionTask = nil
				addressFocused = true
			}
		}
	}
}
