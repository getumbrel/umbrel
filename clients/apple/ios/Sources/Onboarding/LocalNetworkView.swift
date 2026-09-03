import SwiftUI
import UIKit

// Onboarding step 3. Primes the Local Network permission with a header,
// a radar illustration with a glowing Wi-Fi orb and two floating Umbrel devices, and
// an "Enable access" button that starts discovery (which triggers the iOS prompt).
// The screen owns the permission outcome: it stays put beneath the system dialog
// (the model advances only once access is evident) and flips to an Open Settings
// state on denial. Returning from Settings re-probes: iOS does not relaunch the app
// when this permission flips, so the model restarts the browse and re-reads the verdict.
struct LocalNetworkView: View {
	@Environment(OnboardingModel.self) private var model
	@Environment(\.scenePhase) private var scenePhase
	@Environment(\.openURL) private var openURL

	private var denied: Bool { model.localNetworkPermission == .denied }

	var body: some View {
		VStack(spacing: 0) {
			OnboardingHeader(
				title: denied ? "Allow network access" : "Find your Umbrel",
				subtitle: denied
					? "Umbrel can't see your local network. Allow Local Network access in Settings to find your Umbrel."
					: "Enable local network access to discover Umbrel devices on your Wi-Fi."
			)
			.padding(.top, 90)

			Spacer()

			RadarIllustration()
				.accessibilityHidden(true)
				.entrance()

			Spacer()

			VStack(spacing: 10) {
				if denied {
					OnboardingButton(title: "Open Settings") {
						openURL(URL(string: UIApplication.openSettingsURLString)!)
					}
				} else {
					OnboardingButton(
						title: "Enable access",
						isBusy: model.localNetworkPermission == .waiting
					) {
						model.enableLocalNetworkAndScan()
					}
				}

				if denied {
					ManualAddressPrompt()
				}
			}
			.padding(.horizontal, 31)
			.padding(.bottom, 8)
			.entrance()
		}
		.onChange(of: scenePhase) { _, phase in
			model.scenePhaseChanged(active: phase == .active)
		}
	}
}

// Concentric rings with a glowing Wi-Fi orb at the center and two Umbrel device
// renders floating in the field. Offsets are relative to the radar's center.
struct RadarIllustration: View {
	var body: some View {
		ZStack {
			RadarRings()

			// Umbrel Pro / Home — transparent brand renders shared with the macOS app.
			// Each holds its bearing and floats in place, the way radar targets sit
			// still while the scanner moves; the unequal drift periods keep the two
			// from ever moving in sync.
			Image("UmbrelPro")
				.resizable().scaledToFit()
				.frame(width: 82)
				.drift(amplitude: CGSize(width: 6, height: 10), xPeriod: 7.3, yPeriod: 5.1)
				.offset(x: 140, y: -78)

			Image("UmbrelHome")
				.resizable().scaledToFit()
				.frame(width: 56)
				.drift(amplitude: CGSize(width: 8, height: 9), xPeriod: 6.1, yPeriod: 8.7, phase: 2.4)
				.offset(x: -154, y: 112)

			Image("WifiOrb")
				.resizable().scaledToFit()
				.frame(width: 87)
				.blendMode(.screen)
		}
		.frame(width: 360, height: 360)
	}
}

// A slow ambient wander: sine offsets on each axis with unequal periods, so the
// path loops without visibly repeating (the same trick as umbrelOS's floating
// clouds). Sits still under Reduce Motion.
private struct Drift: ViewModifier {
	let amplitude: CGSize
	let xPeriod: Double
	let yPeriod: Double
	let phase: Double
	@Environment(\.accessibilityReduceMotion) private var reduceMotion

	func body(content: Content) -> some View {
		if reduceMotion {
			content
		} else {
			TimelineView(.animation) { context in
				let t = context.date.timeIntervalSinceReferenceDate + phase
				content.offset(
					x: sin(t * 2 * .pi / xPeriod) * amplitude.width,
					y: sin(t * 2 * .pi / yPeriod) * amplitude.height
				)
			}
		}
	}
}

extension View {
	func drift(amplitude: CGSize, xPeriod: Double, yPeriod: Double, phase: Double = 0) -> some View {
		modifier(Drift(amplitude: amplitude, xPeriod: xPeriod, yPeriod: yPeriod, phase: phase))
	}
}

// Harness for finessing the radar illustration in the Xcode canvas: no model,
// no permission flow, just the visuals with the drift running.
#Preview("Radar Illustration") {
	ZStack {
		OnboardingBackground()
		RadarIllustration()
	}
}
