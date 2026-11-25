import SwiftUI

// The shared onboarding backdrop: black with two blurred violet glows — a strong one
// bleeding up from the bottom-left and a subtle one off the top-right. Screens layer
// their own content and effects, such as the discovery radar, on top.
struct OnboardingBackground: View {
	// Tint of the glows — violet by default, red for the no-device state.
	var tint: Color = Palette.purple
	var secondaryTint: Color = Palette.purpleLight

	// The glows are designed on a 402x874pt iPhone.
	private let designSize = CGSize(width: 402, height: 874)

	var body: some View {
		GeometryReader { proxy in
			let size = proxy.size
			// Each glow keeps its place relative to its own corner, so it stays in view
			// on short or wide windows. It scales with the window's area.
			let scale = (size.width * size.height / (designSize.width * designSize.height)).squareRoot()
			ZStack {
				Color.black
				glow(
					tint,
					radius: 229,
					center: CGPoint(x: 7 * scale, y: size.height + (923 - designSize.height) * scale),
					scale: scale
				)
				glow(
					secondaryTint.opacity(0.2),
					radius: 209,
					center: CGPoint(x: size.width + (430 - designSize.width) * scale, y: 132 * scale),
					scale: scale
				)
			}
			.frame(width: size.width, height: size.height)
		}
		.ignoresSafeArea()
	}

	private func glow(_ color: Color, radius: CGFloat, center: CGPoint, scale: CGFloat) -> some View {
		Circle()
			.fill(color)
			.frame(width: radius * 2 * scale, height: radius * 2 * scale)
			.blur(radius: 170 * scale)
			.position(center)
	}
}
