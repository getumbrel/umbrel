import SwiftUI
import UmbrelKit

// Visual tokens shared across the main-app tabs.
// Cards and tiles are translucent fills that sit over the user's wallpaper.
enum Theme {
	// umbrelOS accent blue, used for the selected tab, section chevrons and the storage bar.
	static let blue = Color(hex: 0x00A7E9)

	// Card background: rgba(28,28,28,0.32)
	static let card = Color(hex: 0x1C1C1C).opacity(0.32)

	// Tile background inside a card: rgba(255,255,255,0.05)
	static let tile = Color.white.opacity(0.05)

	// Secondary label gray (gray-3): #c7c7cc
	static let gray3 = Color(hex: 0xC7C7CC)

	// Muted label gray (gray): #8e8e93, used in the Profile sheet's section headers and values.
	static let gray = Color(hex: 0x8E8E93)

	// Destructive red (#ff4245), used by the Profile sheet's log out action.
	static let red = Color(hex: 0xFF4245)

	// Standing dot colors for the status rows (green matches the macOS app).
	static let online = Color(hex: 0x34C759)
	static let syncing = Color(hex: 0xFFC800)

	static let contentInset: CGFloat = 20
	static let sectionGap: CGFloat = 32
	static let cardRadius: CGFloat = 24
	static let tileRadius: CGFloat = 16 // outer bento corner

	// Specular rim "glint" for glass surfaces: light catches the upper-left and
	// lower-right corners, fading at the other two.
	static let glint = AngularGradient(
		gradient: Gradient(stops: [
			.init(color: .white.opacity(0.06), location: 0.0),
			.init(color: .white.opacity(0.55), location: 0.125), // lower-right corner
			.init(color: .white.opacity(0.06), location: 0.375), // lower-left corner
			.init(color: .white.opacity(0.55), location: 0.625), // upper-left corner
			.init(color: .white.opacity(0.06), location: 0.875), // upper-right corner
			.init(color: .white.opacity(0.06), location: 1.0),
		]),
		center: .center
	)
}

// Every drawer uses the system cancellation placement so iOS owns the control's
// size, rendering, safe-area position, interaction states, and accessibility.
struct DrawerCloseToolbarItem: ToolbarContent {
	let action: () -> Void

	var body: some ToolbarContent {
		ToolbarItem(placement: .cancellationAction) {
			Button(action: action) {
				Image(systemName: "xmark")
			}
			.tint(.white)
			.accessibilityLabel("Close")
		}
	}
}

// A frosted-glass rounded card: the wallpaper is
// blurred behind it (via FrostBackground) and darkened (tint), with a subtle top-lit rim.
struct SectionCard<Content: View>: View {
	var padding: CGFloat = 8
	@ViewBuilder var content: Content
	@Environment(\.frostWallpaper) private var wallpaper

	private var shape: RoundedRectangle { RoundedRectangle(cornerRadius: Theme.cardRadius, style: .continuous) }

	var body: some View {
		content
			.padding(padding)
			.background {
				FrostBackground(shape: shape, wallpaper: wallpaper)
			}
			.glassGlint(in: shape)
	}
}

// A compact notice shared by tabs for actionable conditions that sit above the
// normal cached content. It uses the same deterministic wallpaper frost as SectionCard;
// live Liquid Glass here creates a second compositor that flickers during tab changes.
// The whole surface is the action when one is supplied.
struct NoticeCard: View {
	let icon: String
	let title: String
	let message: String
	var actionLabel: String? = nil
	var action: (() -> Void)? = nil
	// A close button for an offer the person may not want
	var dismiss: (() -> Void)? = nil
	@Environment(\.frostWallpaper) private var wallpaper

	var body: some View {
		Group {
			if let action {
				Button(action: action) { card }
					.buttonStyle(.plain)
			} else {
				card
			}
		}
		.overlay(alignment: .topTrailing) {
			if let dismiss {
				Button(action: dismiss) {
					Image(systemName: "xmark")
						.font(.system(size: 11, weight: .bold))
						.foregroundStyle(.white.opacity(0.45))
						.frame(width: 32, height: 32)
						.contentShape(Rectangle())
				}
				.buttonStyle(.plain)
				.accessibilityLabel("Dismiss")
			}
		}
	}

	private var card: some View {
		let shape = RoundedRectangle(cornerRadius: Theme.cardRadius, style: .continuous)
		return HStack(spacing: 8) {
			Image(systemName: icon)
				.font(.system(size: 18, weight: .medium))
				.foregroundStyle(.white.opacity(0.8))
				.frame(width: 26)

			VStack(alignment: .leading, spacing: 4) {
				Text(title)
					.font(.footnote.weight(.semibold))
					.foregroundStyle(.white)
					.fixedSize(horizontal: false, vertical: true)
				if !message.isEmpty {
					Text(message)
						.font(.footnote.weight(.medium))
						.foregroundStyle(.white.opacity(0.55))
						.fixedSize(horizontal: false, vertical: true)
				}
			}
			.frame(maxWidth: .infinity, alignment: .leading)

			if let actionLabel, action != nil {
				Text(actionLabel)
					.font(.caption.weight(.semibold))
					.foregroundStyle(.white.opacity(0.75))
					.fixedSize()
			} else if action != nil {
				Image(systemName: "chevron.right")
					.font(.system(size: 13, weight: .semibold))
					.foregroundStyle(.white.opacity(0.4))
			}
		}
		.padding(16)
		.contentShape(shape)
		.background {
			FrostBackground(shape: shape, wallpaper: wallpaper)
		}
		.glassGlint(in: shape)
	}
}

// Home and Library render the same backup issue. Keeping the copy and action
// mapping here prevents one screen from presenting a warning the other cannot
// explain or repair.
struct PhotoBackupNoticeCard: View {
	let notice: MainModel.PhotoBackupNotice
	let setUpTailscale: () -> Void
	var dismissOffer: (() -> Void)? = nil
	let retryStorage: () -> Void
	let retryBackup: () -> Void

	var body: some View {
		NoticeCard(
			icon: notice.icon,
			title: notice.title,
			message: notice.message,
			actionLabel: notice.actionLabel,
			action: action,
			dismiss: notice == .backUpAnywhere ? dismissOffer : nil
		)
	}

	private var action: (() -> Void)? {
		switch notice.action {
		case .setUpTailscale: setUpTailscale
		case .retryStorage: retryStorage
		case .retryBackup: retryBackup
		case nil: nil
		}
	}
}

// A plain-language explanation row shared by the connection and Photo Backup
// information sheets. These sheets use static dark cards rather than wallpaper
// frost or Liquid Glass so presenting them never adds another live compositor.
struct InfoPageRow: View {
	let icon: String
	let title: String
	let message: String

	var body: some View {
		HStack(alignment: .center, spacing: 14) {
			Image(systemName: icon)
				.font(.system(size: 17, weight: .medium))
				.foregroundStyle(.white.opacity(0.9))
				.frame(width: 28, height: 28)
			VStack(alignment: .leading, spacing: 4) {
				Text(title)
					.font(.subheadline.weight(.semibold))
					.foregroundStyle(.white)
				Text(message)
					.font(.footnote)
					.foregroundStyle(Theme.gray)
					.fixedSize(horizontal: false, vertical: true)
			}
			.frame(maxWidth: .infinity, alignment: .leading)
		}
		.padding(16)
	}
}

struct InfoPageDivider: View {
	var body: some View {
		Divider()
			.overlay(Color.white.opacity(0.08))
	}
}

// MARK: - Settings lists

// A gray section header above a rounded #2c2c2e card of rows, optionally with a
// How it works link at the header's trailing edge.
struct SettingsSection<Content: View>: View {
	let title: String
	let learnMore: (() -> Void)?
	@ViewBuilder var content: Content

	init(_ title: String, learnMore: (() -> Void)? = nil, @ViewBuilder content: () -> Content) {
		self.title = title
		self.learnMore = learnMore
		self.content = content()
	}

	var body: some View {
		VStack(alignment: .leading, spacing: 10) {
			HStack(spacing: 8) {
				Text(title)
					.font(.subheadline.weight(.medium))
					.foregroundStyle(Theme.gray)
				if let learnMore {
					Spacer(minLength: 0)
					Button(action: learnMore) {
						HStack(spacing: 4) {
							Text("How it works")
							Image(systemName: "chevron.right")
								.font(.system(size: 10, weight: .semibold))
						}
						.font(.subheadline.weight(.medium))
						.foregroundStyle(.white.opacity(0.65))
						.contentShape(Rectangle())
					}
					.buttonStyle(.plain)
				}
			}
			VStack(spacing: 0) { content }
				.background(Color(hex: 0x2C2C2E), in: RoundedRectangle(cornerRadius: 20, style: .continuous))
		}
		.padding(.vertical, 10)
	}
}

// One row: icon, title, and a trailing accessory (toggle, value, or action).
struct SettingsRow<Trailing: View>: View {
	let icon: String
	let title: String
	@ViewBuilder var trailing: Trailing

	var body: some View {
		HStack(spacing: 4) {
			Image(systemName: icon)
				.font(.system(size: 15))
				.foregroundStyle(.white.opacity(0.9))
				.frame(width: 30)
			Text(title)
				.font(.subheadline.weight(.medium))
				.foregroundStyle(.white.opacity(0.9))
			Spacer(minLength: 8)
			trailing
		}
		.padding(.leading, 8)
		.padding(.trailing, 12)
		.padding(.vertical, 12)
	}
}

struct SettingsDivider: View {
	var body: some View {
		Rectangle()
			.fill(Color.white.opacity(0.06))
			.frame(height: 1)
	}
}

struct SettingsToggle: View {
	let label: String
	@Binding var isOn: Bool
	@Environment(\.brandColor) private var brandColor

	init(_ label: String, isOn: Binding<Bool>) {
		self.label = label
		_isOn = isOn
	}

	var body: some View {
		Toggle(label, isOn: $isOn)
			.labelsHidden()
			.tint(brandColor)
	}
}

// A gray trailing value, optionally with a disclosure chevron.
struct SettingsValue: View {
	let text: String
	var chevron = false

	var body: some View {
		HStack(spacing: 8) {
			Text(text)
			if chevron { Image(systemName: "chevron.right") }
		}
		.font(.subheadline.weight(.medium))
		.foregroundStyle(Theme.gray)
	}
}

// A section header: a bold title (optionally with a chevron) on the left and a
// trailing accessory (e.g. "2 updates", "View all", a status dot + label) on the right.
// With an action the whole row becomes one tap target; the Button, plain style, and
// contentShape live here so call sites can't forget that a mostly-transparent row
// needs an explicit hit area.
struct SectionHeader<Trailing: View>: View {
	let title: String
	var showsChevron = false
	var action: (() -> Void)? = nil
	@ViewBuilder var trailing: Trailing
	@Environment(\.dynamicTypeSize) private var dynamicTypeSize

	var body: some View {
		if let action {
			Button(action: action) {
				row.contentShape(Rectangle())
			}
			.buttonStyle(.plain)
		} else {
			row
		}
	}

	@ViewBuilder
	private var row: some View {
		if dynamicTypeSize.isAccessibilitySize {
			VStack(alignment: .leading, spacing: 8) {
				titleLabel
				trailing
			}
			.frame(maxWidth: .infinity, alignment: .leading)
		} else {
			HStack(spacing: 4) {
				titleLabel
				Spacer(minLength: 8)
				trailing
			}
			.padding(.trailing, 8)
		}
	}

	private var titleLabel: some View {
		HStack(spacing: 4) {
			Text(title)
				.font(.title3.weight(.semibold))
				.foregroundStyle(.white)
			if showsChevron {
				Image(systemName: "chevron.right")
					.font(.system(size: 11, weight: .semibold))
					.foregroundStyle(.white.opacity(0.5))
			}
		}
	}
}

extension SectionHeader where Trailing == EmptyView {
	init(_ title: String, showsChevron: Bool = false, action: (() -> Void)? = nil) {
		self.init(title: title, showsChevron: showsChevron, action: action) { EmptyView() }
	}
}

// The trailing label style used across section headers.
struct TrailingLabel: View {
	let text: String
	var dot: Color? = nil
	var body: some View {
		HStack(spacing: 6) {
			if let dot {
				StatusDot(color: dot)
			}
			Text(text)
				.font(.subheadline.weight(.medium))
				.foregroundStyle(.white.opacity(0.85))
				.opacity(0.8)
		}
	}
}

extension View {
	// iOS 26 Liquid Glass for a small control (header buttons, "+"), falling back to a
	// translucent gray fill on older systems. Reduce Transparency gets an opaque fill.
	func glassControl<S: InsettableShape>(in shape: S) -> some View {
		modifier(AccessibleGlassModifier(shape: shape, interactive: true))
	}

	// Noninteractive glass used for status and media controls.
	func glassSurface<S: InsettableShape>(in shape: S) -> some View {
		modifier(AccessibleGlassModifier(shape: shape, interactive: false))
	}

	// A specular rim "glint" for glass surfaces (buttons, cards): a single static
	// gradient catches the upper-left and lower-right corners without per-frame cost.
	func glassGlint(in shape: some InsettableShape, lineWidth: CGFloat = 1) -> some View {
		overlay {
			shape.strokeBorder(Theme.glint, lineWidth: lineWidth)
		}
	}
}

private struct AccessibleGlassModifier<S: InsettableShape>: ViewModifier {
	let shape: S
	let interactive: Bool
	@Environment(\.accessibilityReduceTransparency) private var reduceTransparency

	@ViewBuilder
	func body(content: Content) -> some View {
		if reduceTransparency {
			if interactive {
				content
					.background(Color(hex: 0x3A3A3C), in: shape)
					.glassGlint(in: shape)
			} else {
				content.background(Color(hex: 0x3A3A3C), in: shape)
			}
		} else if #available(iOS 26.0, *) {
			if interactive {
				content.glassEffect(.regular.interactive(), in: shape).glassGlint(in: shape)
			} else {
				content.glassEffect(.regular, in: shape)
			}
		} else {
			if interactive {
				content
					.background(Color(white: 0.31).opacity(0.16), in: shape)
					.glassGlint(in: shape)
			} else {
				content.background(Color(white: 0.31).opacity(0.16), in: shape)
			}
		}
	}
}

// A material control that becomes opaque when Reduce Transparency is enabled.
struct AccessibleMaterialBackground<S: InsettableShape>: View {
	let shape: S
	@Environment(\.accessibilityReduceTransparency) private var reduceTransparency

	var body: some View {
		if reduceTransparency {
			shape.fill(Color(hex: 0x3A3A3C))
		} else {
			shape
				.fill(.ultraThinMaterial)
				.overlay { shape.fill(Theme.card) }
		}
	}
}

// A small blue pill button (App Store / Enable / Live Usage), with an inset top highlight.
struct PillButton: View {
	let title: String
	var icon: String? = nil
	var isLoading = false
	var action: () -> Void = {}
	@Environment(\.brandColor) private var brandColor

	var body: some View {
		Button(action: action) {
			VStack {
				HStack(spacing: 4) {
					if isLoading {
						ProgressView()
							.controlSize(.mini)
							.tint(.white)
					} else if let icon {
						Image(systemName: icon)
					}
					Text(title)
				}
				.font(.footnote.weight(.semibold))
				.foregroundStyle(.white)
				.padding(.horizontal, 16)
				.frame(minHeight: 30)
				.background(brandColor, in: .capsule)
				.overlay(
					Capsule().strokeBorder(
						LinearGradient(colors: [.white.opacity(0.25), .clear], startPoint: .top, endPoint: .center),
						lineWidth: 1
					)
				)
			}
			.frame(minWidth: 44, minHeight: 44)
			.contentShape(Rectangle())
		}
		.buttonStyle(.plain)
		.disabled(isLoading)
	}
}

// A neutral full-width primary action for focused setup and recovery screens.
// White keeps the action legible across wallpaper themes without competing with
// the surrounding status content.
struct PrimaryActionButton: View {
	let title: String
	var isLoading = false
	var action: () -> Void = {}

	var body: some View {
		Button(action: action) {
			HStack(spacing: 8) {
				if isLoading {
					ProgressView()
						.controlSize(.small)
						.tint(Color(hex: 0x1C1C1E))
				}
				Text(title)
			}
			.font(.callout.weight(.semibold))
			.foregroundStyle(Color(hex: 0x1C1C1E))
			.frame(maxWidth: .infinity, minHeight: 50)
			.background(.white.opacity(0.94), in: Capsule())
		}
		.buttonStyle(.plain)
		.disabled(isLoading)
	}
}

// A centered icon, title, subtitle and call-to-action pill used for the empty Apps
// and unconfigured Library states.
struct EmptyStateCard: View {
	let icon: String
	let title: String
	let subtitle: String
	let buttonTitle: String
	var buttonIcon: String? = nil
	var buttonLoading = false
	var learnMore: (() -> Void)? = nil
	var action: () -> Void = {}

	var body: some View {
		SectionCard {
			VStack(spacing: 14) {
				Image(systemName: icon)
					.font(.system(size: 22))
					.foregroundStyle(.white.opacity(0.8))
				VStack(spacing: 4) {
					Text(title)
						.font(.footnote.weight(.semibold))
						.foregroundStyle(.white)
					Text(subtitle)
						.font(.footnote.weight(.medium))
						.foregroundStyle(.white.opacity(0.5))
						.multilineTextAlignment(.center)
				}
				VStack(spacing: 10) {
					PillButton(
						title: buttonTitle,
						icon: buttonIcon,
						isLoading: buttonLoading,
						action: action
					)
					if let learnMore {
						Button(action: learnMore) {
							HStack(spacing: 4) {
								Text("How Photo Backup works")
								Image(systemName: "chevron.right")
									.font(.system(size: 10, weight: .semibold))
							}
							.font(.footnote.weight(.medium))
							.foregroundStyle(.white.opacity(0.65))
							.frame(minHeight: 44)
							.contentShape(Rectangle())
						}
						.buttonStyle(.plain)
						.accessibilityHint("Explains background uploads, Tailscale, and photo access")
					}
				}
			}
			.frame(maxWidth: .infinity)
			.padding(.top, 28)
			.padding(.bottom, learnMore == nil ? 28 : 4)
			.padding(.horizontal, 8)
		}
	}
}

// A connection/status dot: a solid core inside a translucent halo of the same color,
// matching the macOS app's status badge.
struct StatusDot: View {
	let color: Color
	var body: some View {
		ZStack {
			Circle().fill(color.opacity(0.2)).frame(width: 14, height: 14)
			Circle().fill(color).frame(width: 6, height: 6)
		}
	}
}

// What the app says when a saved Umbrel answers with a new identity. That's expected
// after its certificate is reset or it's restored from a backup (backups leave out the
// certificates), and anyone with access to the Umbrel may have done it. It's also what
// someone pretending to be the Umbrel looks like, so the words ask people to check
// before they reconnect. A factory reset or new storage gives a new id, so Home never
// shows this for them, but the sign-in sheet still can: it only sees the refused
// certificate.
enum IdentityChange {
	static let title = "Can’t confirm this is your Umbrel"
	static let alertTitle = "Can’t Confirm This Is Your Umbrel"
	static let message = "Its security identity changed. That’s expected if it was restored from a backup or its certificate was reset since this iPhone last connected. If neither happened, don’t reconnect. Someone on this network could be pretending to be your Umbrel."
	static let blockedMessage = "Its security identity changed, so this didn’t open. Check Home before reconnecting."
	static let confirmTitle = "Was your Umbrel restored or its certificate reset?"
	static let confirmMessage = "Only reconnect if one of these happened, and do it at home, on your own Wi-Fi. Not sure? Ask whoever manages your Umbrel.\n\nYou’ll sign in again. If photo backup is on, you’ll need to turn it back on."
}

// MARK: - Loading states

// umbrelOS-style loading pulse: a slow opacity oscillation on placeholder shapes
// (the umbrelOS UI uses the same effect via `animate-pulse`).
private struct Pulsing: ViewModifier {
	@State private var dim = false
	@Environment(\.accessibilityReduceMotion) private var reduceMotion

	func body(content: Content) -> some View {
		content
			.opacity(reduceMotion ? 1 : (dim ? 0.45 : 1))
			.onAppear {
				guard !reduceMotion else { return }
				withAnimation(.easeInOut(duration: 0.9).repeatForever(autoreverses: true)) { dim = true }
			}
			.onChange(of: reduceMotion) { _, shouldReduceMotion in
				dim = false
				guard !shouldReduceMotion else { return }
				withAnimation(.easeInOut(duration: 0.9).repeatForever(autoreverses: true)) { dim = true }
			}
	}
}

extension View {
	func pulsing() -> some View { modifier(Pulsing()) }
}

// Crossfades a section from its skeleton to its real content when the first load lands.
// `order` staggers the swap top-to-bottom (~60ms apart) so Home reveals as one
// choreographed cascade instead of five independent pop-ins. Skeletons render at the
// content's exact final size and the swap is a pure in-place crossfade — any movement
// here would read as a second card sliding over the skeleton one.
struct LoadReveal<Content: View, Skeleton: View>: View {
	let loaded: Bool
	var order = 0
	@ViewBuilder var content: Content
	@ViewBuilder var skeleton: Skeleton
	@Environment(\.accessibilityReduceMotion) private var reduceMotion

	var body: some View {
		ZStack {
			if loaded {
				content.transition(.opacity)
			} else {
				skeleton.transition(.opacity)
			}
		}
		.animation(
			reduceMotion ? nil : .easeOut(duration: 0.35).delay(Double(order) * 0.06),
			value: loaded
		)
	}
}

// Pulsing placeholder tiles matching the bento grids the real content renders (same
// tile height and corner treatment), so the reveal swaps in place.
struct SkeletonTiles: View {
	let rows: Int
	let cols: Int

	var body: some View {
		let columns = Array(repeating: GridItem(.flexible(), spacing: 4), count: cols)
		LazyVGrid(columns: columns, spacing: 4) {
			ForEach(0..<(rows * cols), id: \.self) { index in
				Bento.tile(row: index / cols, col: index % cols, rows: rows, cols: cols)
					.fill(Theme.tile)
					.frame(height: 100)
			}
		}
		.pulsing()
	}
}

// Bento-style corner rounding: only the outer corners of a grid are rounded, inner
// gaps stay near-square (2px). Given a tile's position in a rows×cols grid, this
// returns the shape that produces the outer-card silhouette.
enum Bento {
	// The rounded-rect for the tile at (row, col) in a grid of `rows`×`cols`, with the
	// outer corners rounded to `outer` and inner corners to `inner`.
	static func tile(row: Int, col: Int, rows: Int, cols: Int, outer: CGFloat = 16, inner: CGFloat = 2) -> UnevenRoundedRectangle {
		UnevenRoundedRectangle(
			cornerRadii: .init(
				topLeading: row == 0 && col == 0 ? outer : inner,
				bottomLeading: row == rows - 1 && col == 0 ? outer : inner,
				bottomTrailing: row == rows - 1 && col == cols - 1 ? outer : inner,
				topTrailing: row == 0 && col == cols - 1 ? outer : inner
			)
		)
	}
}
