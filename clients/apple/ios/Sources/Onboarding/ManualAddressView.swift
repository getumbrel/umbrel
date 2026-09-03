import SwiftUI

// A verified alternate route for an Umbrel the completed scan did not show. A
// successful check opens sign-in directly; the device is not saved beforehand.
struct ManualAddressView: View {
	@Environment(OnboardingModel.self) private var model
	@Environment(\.openURL) private var openURL
	@State private var address = ""
	@State private var error: String?
	@State private var updateRequiredHost: String?
	@State private var isConnecting = false
	@State private var showingSignIn = false
	@State private var connectionTask: Task<Void, Never>?
	@FocusState private var addressFocused: Bool

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
				title: "Connect by IP address",
				subtitle: "Enter your Umbrel’s IP address. If you’re away from home, use its Tailscale IP address. Tailscale must already be set up on this iPhone and your Umbrel."
			)
			.padding(.top, 26)

			Spacer().frame(height: 40)

			VStack(alignment: .leading, spacing: 12) {
				TextField("e.g. 100.101.102.103", text: $address)
					.keyboardType(.numbersAndPunctuation)
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
					}
					.accessibilityLabel("Umbrel IP address")

				if let error {
					Text(error)
						.font(.footnote)
						.foregroundStyle(Palette.error)
						.fixedSize(horizontal: false, vertical: true)
				}

				if updateRequiredHost != nil {
					VStack(alignment: .leading, spacing: 5) {
						Text("Update required")
							.font(.headline)
							.foregroundStyle(.white)
						Text("This Umbrel needs to be updated before it can connect to the app.")
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
					OnboardingButton(title: "Open Umbrel", style: .prominent) {
						guard let url = URL(string: "http://\(updateRequiredHost)") else { return }
						openURL(url)
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
				switch result {
				case .device(let device):
					guard !model.savedIds.contains(device.id) else {
						error = "This Umbrel has already been added."
						break
					}
					model.selectedDevice = device
					showingSignIn = true
				case .updateRequired(let device):
					updateRequiredHost = device.host
				}
			} catch is CancellationError {
				return
			} catch let connectionError {
				error = connectionError.localizedDescription
			}
			isConnecting = false
			connectionTask = nil
		}
	}
}
