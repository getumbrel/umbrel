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
	@State private var multipleHeaderHeight: CGFloat = 50
	@State private var carouselTrailingInset: CGFloat = 0
	@Environment(\.carouselEndsAtFold) private var carouselEndsAtFold

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
		// The last result can go while it's shown, as when Try again finds a saved
		// Umbrel's identity changed. Move on the same way leaving the address screen does.
		.onChange(of: model.discoveryResults.isEmpty) { _, empty in
			guard empty, model.step == .deviceFound else { return }
			model.advance(to: OnboardingModel.manualAddressReturnDestination(from: .deviceFound, hasDiscoveryResults: false))
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
		// in the leftover space. Short windows, like the iPhone SE and both
		// displays of iPhone Duo, take the room from the space above the title
		// first, then from the cards' height.
		GeometryReader { proxy in
			let cardHeight = min(513, max(380, proxy.size.height - multipleHeaderHeight - 24 - 48))
			// Beside a side column or the fold, like on iPhone Duo's outer display, a narrow
			// space narrows the cards so about 40pt of the next one still shows and it's clear
			// they scroll. Other iPhones keep the full-size card.
			let cardWidth: CGFloat =
				(carouselTrailingInset > 0 || carouselEndsAtFold) && proxy.size.width - 20 - 20 - 340 < 20
				? proxy.size.width - 20 - 20 - 40 : 340
			// While adding a device the Cancel bar already sits above this space, so the
			// title needs less room above it to land where it does in first-run setup.
			let maxTopPadding: CGFloat = model.mode == .addDevice ? 64 : 120
			let topPadding = min(maxTopPadding, max(24, proxy.size.height - multipleHeaderHeight - 24 - cardHeight - 24))
			VStack(alignment: .leading, spacing: 24) {
				VStack(alignment: .leading, spacing: 2) {
					Text("Found \(model.discoveryResults.count) devices")
						.font(.title3.weight(.semibold))
						.foregroundStyle(Palette.textMuted)
					ManualAddressPrompt(isLeading: true)
				}
				.onGeometryChange(for: CGFloat.self) { $0.size.height } action: { multipleHeaderHeight = $0 }
				.padding(.horizontal, 33)
				.padding(.top, topPadding)

				ScrollView(.horizontal) {
					HStack(spacing: 20) {
						ForEach(model.discoveryResults) { result in
							card(result)
								.frame(width: cardWidth, height: cardHeight)
						}
					}
					.scrollTargetLayout()
				}
				.scrollTargetBehavior(.viewAligned)
				.scrollIndicators(.hidden)
				.contentMargins(.horizontal, 20, for: .scrollContent)
				// The cards have buttons, so they stop at iPhone Duo's side column or fold rather
				// than sliding under the controls or across the crease (the mask keeps to the
				// safe area), fading out there instead of ending in a hard cut. At the edge of
				// the screen there's no fade.
				.mask(alignment: .leading) {
					HStack(spacing: 0) {
						Color.black
						if carouselTrailingInset > 0 || carouselEndsAtFold {
							LinearGradient(colors: [.black, .clear], startPoint: .leading, endPoint: .trailing)
								.frame(width: 24)
						}
					}
				}
				.onGeometryChange(for: CGFloat.self) { $0.safeAreaInsets.trailing } action: {
					carouselTrailingInset = $0
				}
				.entrance()

				Spacer(minLength: 0)
			}
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
		// The fixed card has room for the "Couldn't connect" explanation and two
		// actions only up to this size
		.dynamicTypeSize(result.isUnverified ? ...DynamicTypeSize.xxxLarge : ...DynamicTypeSize.accessibility5)
	}

	// ── Shared bits ──

	private func deviceHero(_ result: OnboardingModel.DiscoveryResult, nameSize: CGFloat) -> some View {
		let modelName: String? = switch result {
		case .device(let device): device.model
		case .unverified, .updateRequired: nil
		}
		return VStack(spacing: 31) {
			UmbrelDeviceRender(model: modelName, placement: .hero)
				.shadow(color: .black.opacity(0.5), radius: 16, y: 16)
				.accessibilityHidden(true)
			VStack(spacing: 4) {
				Text(result.title)
					.font(.system(size: nameSize, weight: .semibold))
					.multilineTextAlignment(.center)
					.foregroundStyle(.white)
				Text(result.subtitle)
					.font(.callout)
					.foregroundStyle(Palette.textMuted)
				if case .unverified(let device) = result {
					Text(device.reason.explanation)
						.font(.footnote)
						.foregroundStyle(Palette.textMuted)
						.multilineTextAlignment(.center)
						.fixedSize(horizontal: false, vertical: true)
						.frame(maxWidth: 280)
						.padding(.top, 8)
				}
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
		case .unverified(let device):
			let isRetrying = model.retryingHosts.contains(device.host)
			VStack(spacing: 6) {
				if fullWidth {
					OnboardingButton(title: "Try again", isBusy: isRetrying) { retry(device) }
				} else {
					connectButton(title: "Try again", isBusy: isRetrying) { retry(device) }
				}
				// umbrelOS may still open there
				Button {
					open(host: device.host)
				} label: {
					Text("Open in browser")
						.font(.subheadline.weight(.semibold))
						.foregroundStyle(Palette.textMuted)
						.frame(maxWidth: .infinity, minHeight: 44)
						.contentShape(Rectangle())
				}
				.buttonStyle(.plain)
			}
		case .updateRequired(let device):
			if fullWidth {
				OnboardingButton(title: "Update umbrelOS") { open(host: device.host) }
			} else {
				connectButton(title: "Update umbrelOS") { open(host: device.host) }
			}
		case nil:
			EmptyView()
		}
	}

	private func connectButton(title: String, isBusy: Bool = false, _ action: @escaping () -> Void) -> some View {
		Button(action: action) {
			ZStack {
				Text(title)
					.font(.headline)
					.foregroundStyle(.white)
					.opacity(isBusy ? 0 : 1)
				if isBusy {
					ProgressView()
						.tint(.white)
				}
			}
			.frame(maxWidth: .infinity, minHeight: 48)
			.background(Color(hex: 0x6155F5), in: .capsule)
			.overlay { SolidButtonRim() }
		}
		.buttonStyle(.plain)
		.disabled(isBusy)
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

	private func retry(_ device: Umbreld.UnverifiedDevice) {
		Task { await model.retry(device) }
	}

	private func open(host: String) {
		guard let url = URL(string: "http://\(host)") else { return }
		openURL(url)
	}
}

private extension OnboardingModel.DiscoveryResult {
	var isUnverified: Bool {
		if case .unverified = self { true } else { false }
	}

	var title: String {
		switch self {
		case .device(let device): device.model
		case .unverified: "Couldn\u{2019}t connect"
		case .updateRequired: "Update to connect"
		}
	}

	var subtitle: String {
		switch self {
		case .device(let device): device.host
		case .unverified(let device): device.host
		case .updateRequired(let device): device.host
		}
	}
}

// Harnesses for finessing the "Couldn't connect" card in the Xcode canvas: seeded
// scan results, no discovery.
#if DEBUG
#Preview("Couldn't Connect") {
	ZStack {
		OnboardingBackground()
		DeviceFoundView()
	}
	.environment(OnboardingModel.preview(
		unverified: [Umbreld.UnverifiedDevice(host: "umbrel.local", reason: .slow)]
	))
}

#Preview("Couldn't Connect, Among Others") {
	ZStack {
		OnboardingBackground()
		DeviceFoundView()
	}
	.environment(OnboardingModel.preview(
		unverified: [
			Umbreld.UnverifiedDevice(host: "umbrel.local", reason: .slow),
			Umbreld.UnverifiedDevice(host: "umbrel-2.local", reason: .unexpected),
		]
	))
}
#endif
