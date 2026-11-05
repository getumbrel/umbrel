import SwiftUI
import UmbrelKit

// A verified alternate route for an Umbrel the completed scan did not show. A
// successful check opens sign-in directly; the device is not saved beforehand.
struct ManualAddressView: View {
	@Environment(OnboardingModel.self) private var model
	@Environment(\.openURL) private var openURL
	@State private var address = ""
	@State private var error: String?
	@State private var updateRequiredHost: String?
	// A current Umbrel answered here but couldn't prove its identity
	@State private var unverified: Umbreld.UnverifiedDevice?
	@State private var isConnecting = false
	@State private var showingSignIn = false
	@State private var connectionTask: Task<Void, Never>?
	@FocusState private var addressFocused: Bool

	// The arguments seed the canvas preview; the flow starts empty
	init(address: String = "", unverified: Umbreld.UnverifiedDevice? = nil) {
		_address = State(initialValue: address)
		_unverified = State(initialValue: unverified)
	}

	var body: some View {
		VStack(spacing: 0) {
			HStack {
				CircleIconButton(system: "chevron.left", accessibilityLabel: "Back") {
					connectionTask?.cancel()
					model.leaveManualAddress()
				}
				Spacer()
			}
			.padding(.horizontal, Theme.contentInset)
			.padding(.top, 8)

			OnboardingHeader(
				title: "Connect by address",
				subtitle: "Enter your Umbrel’s IP address or hostname. If you’re away from home, use its Tailscale IP address or MagicDNS name. Tailscale must already be set up on this iPhone and your Umbrel."
			)
			.padding(.top, 26)

			Spacer().frame(height: 40)

			VStack(alignment: .leading, spacing: 12) {
				TextField("e.g. umbrel.local, umbrel, or 100.64.0.1", text: $address)
					.keyboardType(.URL)
					.textInputAutocapitalization(.never)
					.autocorrectionDisabled()
					.padding(.horizontal, 16)
					.frame(height: 52)
					.background(Color(hex: 0x2C2C2E), in: RoundedRectangle(cornerRadius: 14))
					.overlay {
						if error != nil {
							RoundedRectangle(cornerRadius: 14)
								.stroke(Palette.error, lineWidth: 1)
						}
					}
					.focused($addressFocused)
					.disabled(isConnecting)
					.onChange(of: address) {
						error = nil
						updateRequiredHost = nil
						unverified = nil
					}
					.accessibilityLabel("Umbrel address")

				if let error {
					Text(error)
						.font(.footnote)
						.foregroundStyle(Palette.error)
						.fixedSize(horizontal: false, vertical: true)
				}

				if updateRequiredHost != nil {
					VStack(alignment: .leading, spacing: 5) {
						Text("Update to connect")
							.font(.headline)
							.foregroundStyle(.white)
						Text("This Umbrel needs to be updated before it can connect to the app.")
							.font(.footnote)
							.foregroundStyle(Palette.textMuted)
							.fixedSize(horizontal: false, vertical: true)
					}
					.padding(.top, 4)
				}

				if let unverified {
					VStack(alignment: .leading, spacing: 5) {
						Text("Couldn\u{2019}t connect")
							.font(.headline)
							.foregroundStyle(.white)
						Text(unverified.reason.explanation)
							.font(.footnote)
							.foregroundStyle(Palette.textMuted)
							.fixedSize(horizontal: false, vertical: true)
					}
					.padding(.top, 4)
				}
			}
			.padding(.horizontal, 31)

			Spacer(minLength: 20)

			Group {
				if let updateRequiredHost {
					OnboardingButton(title: "Update umbrelOS", style: .prominent) {
						guard let url = URL(string: "http://\(updateRequiredHost)") else { return }
						openURL(url)
					}
				} else if let unverified {
					VStack(spacing: 6) {
						OnboardingButton(title: "Try again", style: .prominent, isBusy: isConnecting, action: connect)
						// umbrelOS may still open there
						Button {
							guard let url = URL(string: "http://\(unverified.host)") else { return }
							openURL(url)
						} label: {
							Text("Open in browser")
								.font(.subheadline.weight(.semibold))
								.foregroundStyle(Palette.textMuted)
								.frame(maxWidth: .infinity, minHeight: 44)
								.contentShape(Rectangle())
						}
						.buttonStyle(.plain)
					}
				} else {
					OnboardingButton(
						title: "Connect",
						style: .prominent,
						isBusy: isConnecting,
						action: connect
					)
					.disabled(address.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
				}
			}
			.padding(.horizontal, 31)
			.padding(.bottom, 8)
		}
		.sheet(isPresented: $showingSignIn) {
			SignInSheet(onCancel: { showingSignIn = false })
		}
		.onAppear { addressFocused = true }
		.onChange(of: showingSignIn) { _, presented in
			if !presented { addressFocused = true }
		}
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
				let result = try await model.discoverManually(at: submittedAddress)
				try Task.checkCancellation()
				// Try again keeps the previous answer on screen until this one arrives
				unverified = nil
				switch result {
				case .device(let device):
					guard !model.savedIds.contains(device.id) else {
						error = "This Umbrel has already been added."
						break
					}
					model.selectedDevice = device
					showingSignIn = true
				case .unverified(let device):
					unverified = device
				case .updateRequired(let device):
					updateRequiredHost = device.host
				}
			} catch is CancellationError {
				return
			} catch let connectionError {
				unverified = nil
				error = connectionError.localizedDescription
			}
			isConnecting = false
			connectionTask = nil
		}
	}
}

// Harness for finessing the "Couldn't connect" answer in the Xcode canvas
#Preview("Couldn't Connect") {
	ZStack {
		OnboardingBackground()
		ManualAddressView(
			address: "192.168.1.20",
			unverified: Umbreld.UnverifiedDevice(host: "192.168.1.20", reason: .slow)
		)
	}
	.environment(OnboardingModel())
}
