import SwiftUI

// Onboarding step 8. Success screen: the connected Umbrel's render,
// "Connected", the device name, and a Continue button that finishes onboarding and
// drops into the main app.
struct ConnectedView: View {
	@Environment(OnboardingModel.self) private var model
	@ScaledMetric(relativeTo: .largeTitle) private var titleSize = 32.0

	var body: some View {
		VStack(spacing: 0) {
			Spacer()

			UmbrelDeviceRender(model: model.selectedDevice?.model, placement: .hero)
				.shadow(color: .black.opacity(0.5), radius: 16, y: 16)
				.accessibilityHidden(true)

			Spacer().frame(height: 31)

			VStack(spacing: 4) {
				Text("Connected")
					.font(.system(size: titleSize, weight: .semibold))
					.foregroundStyle(.white)
				Text(model.selectedDevice?.model ?? "Umbrel")
					.font(.callout)
					.foregroundStyle(Palette.textMuted)
			}
			.entrance()

			Spacer()
			Spacer()

			OnboardingButton(title: "Continue") {
				model.finish()
			}
			.padding(.horizontal, 31)
			.padding(.bottom, 8)
			.entrance()
		}
	}
}
