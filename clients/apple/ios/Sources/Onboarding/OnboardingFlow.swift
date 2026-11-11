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
		NavigationStack {
			// The background reaches the screen edges while the steps stay in the safe
			// area, which includes the Cancel bar while adding a device.
			steps
				.toolbar {
					// Adding a device is escapable at every step (there may be nothing to
					// find); first-run onboarding has no "out" until a device is connected.
					if showsCancel {
						ToolbarItem(placement: .cancellationAction) {
							Button(action: onCancel) { Label("Cancel", systemImage: "xmark") }
								.tint(.white)
						}
					}
				}
				.toolbar(showsCancel || model.step == .manualAddress ? .automatic : .hidden, for: .navigationBar)
		}
	}

	@State private var fold: FoldBand?
	@State private var stepsArea = StepsArea()

	private struct StepsArea: Equatable {
		var width: CGFloat = 0
		var leadingInset: CGFloat = 0
		var trailingInset: CGFloat = 0
	}

	private var fullDisplayCentringShift: CGFloat {
		guard fold == nil, !showsDeviceCarousel, model.step != .splash else { return 0 }
		let shift = (stepsArea.trailingInset - stepsArea.leadingInset) / 2
		let column = min(460, stepsArea.width)
		return (stepsArea.width - column) / 2 >= abs(shift) ? shift : 0
	}

	private var showsCancel: Bool {
		model.mode == .addDevice && model.step != .connected && model.step != .manualAddress
	}

	private var steps: some View {
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
			// The steps are designed for an iPhone-width column. Wider windows centre
			// that column over the full-width background, except for the carousel of
			// found devices, which runs edge to edge like it does on iPhone.
			.frame(maxWidth: showsDeviceCarousel || model.step == .splash ? nil : 460)
			// Partly folded like a book, the step moves off the crease to the left of the
			// fold: the side column takes none of that half's width, and the system puts
			// sheets there too, so the whole flow stays on one side.
			.frame(maxWidth: .infinity)
			.padding(.trailing, fold.map { stepsArea.width - $0.lowerBound + 20 } ?? 0)
			// Open flat, the column centres on the whole display rather than beside the side
			// column, as long as nothing in it would sit under that column.
			.offset(x: fullDisplayCentringShift)
			// Directional push: content slides through a fixed background, so moving
			// forward reads as traveling through the flow (and backing up reverses).
			// The background never transitions; it's the continuity anchor.
			.transition(stepTransition)
		}
		.trackingFold($fold)
		.environment(\.carouselEndsAtFold, fold != nil)
		.onGeometryChange(for: StepsArea.self) { proxy in
			StepsArea(
				width: proxy.size.width,
				leadingInset: proxy.safeAreaInsets.leading,
				trailingInset: proxy.safeAreaInsets.trailing
			)
		} action: { stepsArea = $0 }
		.animation(.smooth, value: fold)
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

	private var showsDeviceCarousel: Bool {
		(model.step == .deviceFound || model.step == .signIn) && model.discoveryResults.count > 1
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

extension EnvironmentValues {
	// The device carousel stops at the fold while partly folded, rather than at an edge
	@Entry var carouselEndsAtFold = false
}
