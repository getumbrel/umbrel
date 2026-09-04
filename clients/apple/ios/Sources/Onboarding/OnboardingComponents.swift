import SwiftUI
import UmbrelKit

// Full-width pill button anchored at the bottom of onboarding screens.
// Two variants: `.subtle` (translucent violet fill, the default for
// Continue / Enable access / Sign in) and `.prominent` (solid violet, for Connect).
struct OnboardingButton: View {
	enum Style {
		case subtle
		case prominent
	}

	let title: String
	var style: Style = .subtle
	var tint: Color = Palette.purple
	// Replaces the label with a spinner and ignores taps, for actions whose outcome
	// arrives asynchronously (the Local Network permission dialog).
	var isBusy: Bool = false
	let action: () -> Void

	var body: some View {
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
			.frame(maxWidth: .infinity)
			.padding(.vertical, 18)
			.background(fill, in: .capsule)
			// Solid fills read as lit glass and carry the top rim light; the
			// translucent pills stay bare, their depth coming from the glow
			// showing through from behind.
			.overlay {
				if style == .prominent {
					SolidButtonRim()
				}
			}
		}
		.buttonStyle(.plain)
		.disabled(isBusy)
		.accessibilityIdentifier(style == .subtle ? "onboardingSubtleButton" : "onboardingProminentButton")
	}

	private var fill: Color {
		switch style {
		case .subtle: tint.opacity(0.16)
		case .prominent: tint
		}
	}
}

// A 1pt highlight hugs a solid button's top edge and fades by mid-height.
struct SolidButtonRim: View {
	var body: some View {
		Capsule()
			.strokeBorder(
				LinearGradient(
					colors: [.white.opacity(0.25), .clear],
					startPoint: .top,
					endPoint: UnitPoint(x: 0.5, y: 0.55)
				),
				lineWidth: 1
			)
	}
}

// Maps umbreld's model to the matching bundled hardware render. Unknown and
// offline devices deliberately use generic hardware rather than implying that
// the user owns an Umbrel Home or Pro.
func umbrelRenderName(for model: String?) -> String {
	switch UmbrelDeviceKind(model: model) {
	case .home: "UmbrelHome"
	case .pro: "UmbrelPro"
	case .raspberryPi: "RaspberryPi"
	case .generic: "GenericDevice"
	}
}

struct UmbrelDeviceRender: View {
	let model: String?

	var body: some View {
		let assetName = umbrelRenderName(for: model)
		// Match umbrelOS: the bare Pi mark sits in a device-shaped tile so it has
		// comparable visual weight to the hardware renders.
		if UmbrelDeviceKind(model: model) == .raspberryPi {
			GeometryReader { proxy in
				let size = min(proxy.size.width, proxy.size.height)
				let shape = RoundedRectangle(cornerRadius: size * 27 / 128, style: .continuous)
				ZStack {
					shape.fill(Color(hex: 0x525252).opacity(0.48))
					shape.strokeBorder(
						LinearGradient(
							colors: [.white.opacity(0.33), .clear],
							startPoint: .top,
							endPoint: .center
						),
						lineWidth: 1
					)
					Image(assetName)
						.resizable()
						.scaledToFit()
						.frame(width: size / 2, height: size / 2)
				}
				.frame(width: size, height: size)
				.frame(maxWidth: .infinity, maxHeight: .infinity)
			}
			.aspectRatio(1, contentMode: .fit)
		} else {
			Image(assetName)
				.resizable()
				.scaledToFit()
		}
	}
}

// Staged reveal within a step: the header arrives with the step's push transition,
// then content marked with `.entrance()` fades in a beat later. Opacity only — the
// push transition stays the single source of spatial motion.
private struct Entrance: ViewModifier {
	var delay: Double
	@State private var shown = false

	func body(content: Content) -> some View {
		content
			.opacity(shown ? 1 : 0)
			.onAppear {
				withAnimation(.easeOut(duration: 0.35).delay(delay)) { shown = true }
			}
	}
}

extension View {
	func entrance(_ delay: Double = 0.15) -> some View { modifier(Entrance(delay: delay)) }
}

// Title + subtitle block used at the top of most onboarding screens.
struct OnboardingHeader: View {
	let title: String
	let subtitle: String
	@ScaledMetric(relativeTo: .largeTitle) private var titleSize = 32.0

	var body: some View {
		VStack(spacing: 8) {
			VStack(spacing: 4) {
				ForEach(Array(titleLines.enumerated()), id: \.offset) { index, line in
					Text(line)
						// The 32pt hero size is part of the onboarding design. ScaledMetric
						// preserves it at default while still honoring Dynamic Type.
						.font(.system(size: titleSize, weight: .semibold))
						.foregroundStyle(.white)
						.lineSpacing(4)
						.fixedSize(horizontal: false, vertical: true)
						.accessibilityIdentifier("onboardingTitleLine\(index)")
				}
			}
			Text(subtitle)
				.font(.callout)
				.foregroundStyle(Palette.textMuted)
				.fixedSize(horizontal: false, vertical: true)
		}
		.multilineTextAlignment(.center)
		.frame(maxWidth: 328)
	}

	private var titleLines: [String] {
		title.split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
	}
}

// The alternate route appears only after discovery has produced an outcome, so it
// reads as help for a missing Umbrel rather than a competing first choice.
struct ManualAddressPrompt: View {
	@Environment(OnboardingModel.self) private var model
	var isLeading = false

	var body: some View {
		Button {
			model.showManualAddress()
		} label: {
			(
				Text("Can’t find your Umbrel? ")
					+ Text("Connect by address\u{00A0}\(Image(systemName: "chevron.right"))")
					.fontWeight(.semibold)
			)
			.font(.footnote)
			.foregroundStyle(Palette.textMuted)
			.multilineTextAlignment(isLeading ? .leading : .center)
			.frame(
				maxWidth: isLeading ? nil : .infinity,
				alignment: isLeading ? .leading : .center
			)
		}
		.buttonStyle(.plain)
		.padding(.vertical, 6)
		.contentShape(Rectangle())
	}
}
