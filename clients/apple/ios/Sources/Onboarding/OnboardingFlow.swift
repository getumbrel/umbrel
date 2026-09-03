import SwiftUI

// Container for the onboarding flow. Renders the current step over the shared
// background and crossfades between steps.
struct OnboardingFlow: View {
	@Environment(\.accessibilityReduceMotion) private var reduceMotion
	var onCancel: () -> Void = {}
	var onFinished: (String) -> Void
	@State private var model: OnboardingModel

	init(
		mode: OnboardingModel.Mode = .firstRun,
		onCancel: @escaping () -> Void = {},
		onFinished: @escaping (String) -> Void
	) {
		self.onCancel = onCancel
		self.onFinished = onFinished
		_model = State(initialValue: OnboardingModel(mode: mode))
	}

	var body: some View {
		ZStack {
			if model.step == .noDevice {
				OnboardingBackground(tint: Palette.error, secondaryTint: Palette.error)
			} else {
				OnboardingBackground()
			}

			Group {
				switch model.step {
				case .splash:
					SplashView()
				case .welcome:
					WelcomeView()
				case .localNetwork:
					LocalNetworkView()
				case .finding:
					FindingView()
				case .deviceFound, .signIn:
					DeviceFoundView()
				case .manualAddress:
					ManualAddressView()
				case .noDevice:
					NoDeviceView()
				case .connected:
					ConnectedView()
				}
			}
			// Directional push: content slides through a fixed background, so moving
			// forward reads as traveling through the flow (and backing up reverses).
			// The background never transitions; it's the continuity anchor.
			.transition(stepTransition)

			// Adding a device is escapable at every step (there may be nothing to
			// find); first-run onboarding has no "out" until a device is connected.
			if model.mode == .addDevice, model.step != .connected {
				VStack {
					HStack {
						Spacer()
						CircleIconButton(system: "xmark", accessibilityLabel: "Cancel", action: onCancel)
					}
					Spacer()
				}
				.padding(.trailing, Theme.contentInset)
			}
		}
		.environment(model)
		.onAppear {
			model.onFinished = onFinished
			model.onCancel = onCancel
			// Add-device mode skips the "Enable access" screen that normally starts
			// the browse (permission was granted on first run)
			if model.mode == .addDevice {
				model.startDiscoveryIfNeeded()
			}
		}
		.alert(
			item: Binding(
				get: { model.configStorageIssue },
				set: { if $0 == nil { model.dismissConfigStorageIssue() } }
			)
		) { issue in
			Alert(
				title: Text(issue.title),
				message: Text(issue.localizedDescription),
				dismissButton: .default(Text("OK"))
			)
		}
	}

	private var stepTransition: AnyTransition {
		guard !reduceMotion else { return .opacity }
		let push: CGFloat = 28
		return .asymmetric(
			insertion: .opacity.combined(with: .offset(x: model.movingForward ? push : -push)),
			removal: .opacity.combined(with: .offset(x: model.movingForward ? -push : push))
		)
	}
}
