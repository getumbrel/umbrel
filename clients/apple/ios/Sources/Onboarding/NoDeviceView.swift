import SwiftUI

// Onboarding step 5. The red error state: header, red radar rings
// with a crossed-out umbrella at the center, plus the retry and alternate-address
// routes. (The red background tint is applied by OnboardingFlow.)
struct NoDeviceView: View {
	@Environment(OnboardingModel.self) private var model
	@Environment(\.accessibilityReduceMotion) private var reduceMotion
	// Motion here stays deliberately quiet: the search has stopped, and the screen
	// should read as at rest, not still working. The rings get a faint slow breath
	// so the page doesn't feel frozen, and the umbrella lands once with a small
	// spring as the verdict arrives. Nothing loops conspicuously.
	@State private var breathing = false
	@State private var landed = false

	var body: some View {
		VStack(spacing: 0) {
			VStack(spacing: 10) {
				OnboardingHeader(
					title: "No device found",
					subtitle: "Make sure your phone and Umbrel are on the same Wi-Fi network."
				)
				ManualAddressPrompt()
			}
			.padding(.top, 90)

			Spacer()

			ZStack {
				RadarRings(tint: Palette.error)
					.opacity(breathing ? 1.0 : 0.45)
					.scaleEffect(breathing ? 1.0 : 0.985)
				Image("CrossedUmbrella")
					.resizable().scaledToFit()
					.frame(width: 60)
					.scaleEffect(landed ? 1.0 : 1.3)
					.opacity(landed ? 1.0 : 0)
			}
			.accessibilityHidden(true)
			.entrance()

			Spacer()
			Spacer()

			OnboardingButton(title: "Scan again", style: .prominent, tint: Palette.error) {
				model.scanAgain()
			}
			.padding(.horizontal, 31)
			.padding(.bottom, 8)
			.entrance()
		}
		.onAppear {
			if reduceMotion {
				breathing = true
				landed = true
				return
			}
			withAnimation(.easeInOut(duration: 2.2).repeatForever(autoreverses: true)) {
				breathing = true
			}
			withAnimation(.spring(duration: 0.55, bounce: 0.35).delay(0.3)) {
				landed = true
			}
		}
	}
}

// Harness for finessing the error state in the Xcode canvas: red-tinted background
// as the flow applies it, standalone model, no discovery.
#Preview("No Device") {
	ZStack {
		OnboardingBackground(tint: Palette.error, secondaryTint: Palette.error)
		NoDeviceView()
	}
	.environment(OnboardingModel())
}
