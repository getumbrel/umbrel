import SwiftUI
import UIKit

// The user's umbrelOS wallpaper as a full-screen backdrop for the main-app tabs. It
// sits behind the (transparent) scroll content; the frosted cards draw their own
// aligned, blurred copy on top of it (see FrostBackground). The image is pinned to an
// explicit screen size so both the backdrop and the card frost crop identically.
struct WallpaperBackground: View {
	let image: UIImage?
	@Environment(\.wallpaperViewportSize) private var viewportSize

	var body: some View {
		ZStack {
			Color.black

			if let image {
				Image(uiImage: image)
					.resizable()
					.scaledToFill()
					.frame(width: viewportSize.width, height: viewportSize.height)
					.clipped()
			}

			// Legibility: darken the top (status bar / header) and the bottom (dock),
			// keeping the middle brightest so the frosting reads over the wallpaper.
			LinearGradient(
				stops: [
					.init(color: .black.opacity(0.45), location: 0),
					.init(color: .black.opacity(0.10), location: 0.28),
					.init(color: .black.opacity(0.20), location: 0.7),
					.init(color: .black.opacity(0.55), location: 1),
				],
				startPoint: .top,
				endPoint: .bottom
			)
		}
		.ignoresSafeArea()
	}
}

// Each tab is hosted by UIKit in a view with an opaque background, which would hide
// the one wallpaper drawn behind all of them. Placed in a tab's background, this
// clears those backgrounds so the tab is only its content.
struct SeeThroughTab: UIViewRepresentable {
	func makeUIView(context: Context) -> UIView { Probe() }
	func updateUIView(_ view: UIView, context: Context) {}

	private final class Probe: UIView {
		override init(frame: CGRect) {
			super.init(frame: frame)
			isUserInteractionEnabled = false
			backgroundColor = .clear
		}

		@available(*, unavailable)
		required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

		override func didMoveToWindow() {
			super.didMoveToWindow()
			var ancestor = superview
			while let view = ancestor, !(view is UIWindow) {
				view.backgroundColor = .clear
				ancestor = view.superview
			}
		}
	}
}
