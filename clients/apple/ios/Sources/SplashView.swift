import SwiftUI

// Onboarding step 1: the Umbrel mark centered on the shared onboarding background
// provided by OnboardingFlow. Shows briefly on launch, then
// advances to Welcome. The umbrella is a vector asset carrying the white -> 51%-white
// vertical gradient (the metallic sheen).
struct SplashView: View {
	@Environment(OnboardingModel.self) private var model

	var body: some View {
		Image("UmbrelMark")
			.resizable()
			.scaledToFit()
			.frame(width: 70)
			// The mark centres on the whole display, not beside the status bar column on
			// iPhone Duo: Apple's Duo guidance lets immersive, non-interactive screens
			// span the full width. Top and bottom keep the safe area, as on iPhone.
			.frame(maxWidth: .infinity)
			.ignoresSafeArea(edges: .horizontal)
			.task {
				try? await Task.sleep(for: .seconds(1.3))
				model.advance(to: .welcome)
			}
	}
}
