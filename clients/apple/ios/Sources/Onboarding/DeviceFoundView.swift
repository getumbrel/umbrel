import SwiftUI
import UmbrelKit

// Onboarding step 6. Shows one discovered Umbrel as a centered hero and multiple
// devices in a swipeable card carousel. Connect opens the appropriate setup or
// login drawer for the chosen device.
struct DeviceFoundView: View {
	@Environment(OnboardingModel.self) private var model
	@Environment(\.openURL) private var openURL
	@ScaledMetric(relativeTo: .largeTitle) private var singleDeviceNameSize = 32.0
	@ScaledMetric(relativeTo: .title) private var cardDeviceNameSize = 27.0

	var body: some View {
		Group {
			if model.discoveryResults.count > 1 {
				multiple
			} else {
				single
			}
		}
		.sheet(
			isPresented: Binding(
				get: { model.step == .signIn },
				set: { if !$0 { model.advance(to: .deviceFound) } }
			)
		) {
			SignInSheet()
		}
	}

	// ── Single device ──

	private var single: some View {
		VStack(spacing: 0) {
			Spacer()

			VStack(spacing: 2) {
				Text("Found 1 device")
					.font(.callout.weight(.semibold))
					.foregroundStyle(Palette.textMuted)
				ManualAddressPrompt()
			}

			Spacer().frame(height: 60)

			if let result = model.discoveryResults.first {
				deviceHero(result, nameSize: singleDeviceNameSize)
					.entrance()
			}

			Spacer()
			Spacer()

			resultAction(model.discoveryResults.first, fullWidth: true)
			.padding(.horizontal, 31)
			.padding(.bottom, 8)
			.entrance()
		}
	}

	// ── Multiple devices ──

	private var multiple: some View {
		// The carousel sits a fixed 24pt below the title rather than floating
		// in the leftover space.
		VStack(alignment: .leading, spacing: 24) {
			VStack(alignment: .leading, spacing: 2) {
				Text("Found \(model.discoveryResults.count) devices")
					.font(.title3.weight(.semibold))
					.foregroundStyle(Palette.textMuted)
				ManualAddressPrompt(isLeading: true)
			}
				.padding(.horizontal, 33)
				.padding(.top, 120)

			ScrollView(.horizontal) {
				HStack(spacing: 20) {
					ForEach(model.discoveryResults) { result in
						card(result)
							.frame(width: 340, height: 513)
					}
				}
				.scrollTargetLayout()
			}
			.scrollTargetBehavior(.viewAligned)
			.scrollIndicators(.hidden)
			.contentMargins(.horizontal, 20, for: .scrollContent)
			.entrance()

			Spacer()
		}
	}

	private func card(_ result: OnboardingModel.DiscoveryResult) -> some View {
		let shape = RoundedRectangle(cornerRadius: 42, style: .continuous)
		return VStack(spacing: 0) {
			Spacer()
			deviceHero(result, nameSize: cardDeviceNameSize)
			Spacer()
			resultAction(result, fullWidth: false)
		}
		.padding(30)
		.background(.white.opacity(0.04), in: shape)
		.glassGlint(in: shape)
	}

	// ── Shared bits ──

	private func deviceHero(_ result: OnboardingModel.DiscoveryResult, nameSize: CGFloat) -> some View {
		let modelName: String? = switch result {
		case .device(let device): device.model
		case .updateRequired: nil
		}
		return VStack(spacing: 31) {
			UmbrelDeviceRender(model: modelName)
				.frame(width: 161)
				.shadow(color: .black.opacity(0.5), radius: 16, y: 16)
				.accessibilityHidden(true)
			VStack(spacing: 4) {
				Text(result.title)
					.font(.system(size: nameSize, weight: .semibold))
					.foregroundStyle(.white)
				Text(result.subtitle)
					.font(.callout)
					.foregroundStyle(Palette.textMuted)
			}
		}
	}

	@ViewBuilder
	private func resultAction(_ result: OnboardingModel.DiscoveryResult?, fullWidth: Bool) -> some View {
		switch result {
		case .device(let device):
			if isAdded(device) {
				alreadyAdded
			} else if fullWidth {
				OnboardingButton(title: "Connect") { connect(device) }
			} else {
				connectButton(title: "Connect") { connect(device) }
			}
		case .updateRequired(let device):
			if fullWidth {
				OnboardingButton(title: "Update umbrelOS") { open(device) }
			} else {
				connectButton(title: "Update umbrelOS") { open(device) }
			}
		case nil:
			EmptyView()
		}
	}

	private func connectButton(title: String, _ action: @escaping () -> Void) -> some View {
		Button(action: action) {
			Text(title)
				.font(.headline)
				.foregroundStyle(.white)
				.frame(maxWidth: .infinity, minHeight: 48)
				.background(Color(hex: 0x6155F5), in: .capsule)
				.overlay { SolidButtonRim() }
		}
		.buttonStyle(.plain)
	}

	private func isAdded(_ device: IdentifiedDevice) -> Bool {
		model.savedIds.contains(device.id)
	}

	private var alreadyAdded: some View {
		Label("Already added", systemImage: "checkmark")
			.font(.headline)
			.foregroundStyle(Palette.textMuted)
			.frame(maxWidth: .infinity, minHeight: 48)
			.background(.white.opacity(0.06), in: .capsule)
	}

	private func connect(_ device: IdentifiedDevice?) {
		model.selectedDevice = device
		model.advance(to: .signIn)
	}

	private func open(_ device: Umbreld.UpdateRequiredDevice) {
		guard let url = URL(string: "http://\(device.host)") else { return }
		openURL(url)
	}
}

private extension OnboardingModel.DiscoveryResult {
	var title: String {
		switch self {
		case .device(let device): device.model
		case .updateRequired: "Update to connect"
		}
	}

	var subtitle: String {
		switch self {
		case .device(let device): device.host
		case .updateRequired(let device): device.host
		}
	}
}
