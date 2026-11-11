import SwiftUI

// Layouts for regular-width windows, like the inner display of iPhone Duo. Wider
// grids add tiles at their iPhone size instead of stretching them, and two-column
// layouts move their gutter onto the fold while the device is partly folded.
enum WideLayout {
	// About the width a bento tile has on iPhone
	static let tileWidth: CGFloat = 100

	// Wide enough for two iPhone-width columns: the inner display held like a book
	static let twoColumnMinWidth: CGFloat = 700

	// Home's four sections are short cards, so they pair up in narrower windows than
	// other screens: the open iPhone Duo held upright as well as sideways
	static let homeTwoColumnMinWidth: CGFloat = 560

	// The least room above the header. Displays with the status bar at the side have
	// no top safe area, which would leave the header touching the edge of the screen.
	static let minimumTopInset: CGFloat = 14

	// A grid keeps its iPhone column count until the width fits more tiles, then
	// uses an even number of columns so the fold falls between two of them.
	static func columns(for width: CGFloat, iPhone: Int, tileWidth: CGFloat = tileWidth) -> Int {
		let fit = Int(width / tileWidth)
		guard fit > iPhone else { return iPhone }
		return fit - fit % 2
	}
}

extension EnvironmentValues {
	// How far the header and everything below it move down to keep minimumTopInset
	@Entry var topClearance: CGFloat = 0
}

struct TopClearancePadding: ViewModifier {
	@Environment(\.topClearance) private var topClearance

	func body(content: Content) -> some View {
		content.padding(.top, topClearance)
	}
}

// The fold while the device is partly folded, as the horizontal band it covers in
// the measured view's coordinates. Nil while the device is closed or fully open.
typealias FoldBand = ClosedRange<CGFloat>

extension GeometryProxy {
	var activeFold: FoldBand? {
		guard #available(iOS 27.1, *) else { return nil }
		// A vertical division: the hinge running top to bottom
		guard let fold = reservedRegions(kind: .division).first(where: { $0.isActive && $0.frame.height > $0.frame.width })
		else { return nil }
		return (fold.frame.minX - fold.margins.leading)...(fold.frame.maxX + fold.margins.trailing)
	}
}

extension View {
	// Keeps `fold` current with the fold's position over this view
	func trackingFold(_ fold: Binding<FoldBand?>) -> some View {
		onGeometryChange(for: FoldBand?.self) { $0.activeFold } action: { fold.wrappedValue = $0 }
	}
}

// Two columns side by side, each as tall as the taller one. Fully open, the leading
// column takes `leadingFraction` of the width; partly folded, each column takes its
// own side of the fold, the way the system's split views do.
struct FoldColumns: Layout {
	var spacing: CGFloat
	var leadingFraction: CGFloat = 0.5
	var fold: FoldBand?

	func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
		let width = proposal.width ?? 0
		let columns = Self.columns(width: width, spacing: spacing, leadingFraction: leadingFraction, fold: fold)
		let height = proposal.height ?? zip(subviews, columns).map { subview, column in
			subview.sizeThatFits(ProposedViewSize(width: column.width, height: nil)).height
		}.max() ?? 0
		return CGSize(width: width, height: height)
	}

	func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
		let columns = Self.columns(width: bounds.width, spacing: spacing, leadingFraction: leadingFraction, fold: fold)
		for (subview, column) in zip(subviews, columns) {
			subview.place(
				at: CGPoint(x: bounds.minX + column.x, y: bounds.minY),
				proposal: ProposedViewSize(width: column.width, height: bounds.height)
			)
		}
	}

	// Where the two columns go, for content that sizes itself to its column
	static func columns(
		width: CGFloat,
		spacing: CGFloat,
		leadingFraction: CGFloat = 0.5,
		fold: FoldBand?
	) -> [(x: CGFloat, width: CGFloat)] {
		if let fold, fold.lowerBound > spacing, fold.upperBound < width - spacing {
			// Equal columns mirrored around the hinge with the usual gap, for layouts whose
			// halves are a matched set. A side column on one side makes that half narrower,
			// so both take its width and the other half's spare room goes to its outer margin.
			let columnWidth = min(fold.lowerBound - spacing / 2, width - fold.upperBound - spacing / 2)
			return [
				(fold.lowerBound - spacing / 2 - columnWidth, columnWidth),
				(fold.upperBound + spacing / 2, columnWidth),
			]
		}
		let leading = ((width - spacing) * leadingFraction).rounded()
		return [(0, leading), (leading + spacing, width - leading - spacing)]
	}
}

// Rows of equal columns. Partly folded, half the columns sit on each side of the
// fold, so no tile lies across the crease.
struct FoldGrid: Layout {
	var columns: Int
	var spacing: CGFloat
	var fold: FoldBand?

	func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
		let width = proposal.width ?? CGFloat(columns) * WideLayout.tileWidth
		let rows = rowHeights(subviews: subviews, columns: columnFrames(width: width))
		let height = rows.reduce(0, +) + spacing * CGFloat(max(0, rows.count - 1))
		return CGSize(width: width, height: height)
	}

	func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
		let columnFrames = columnFrames(width: bounds.width)
		let rows = rowHeights(subviews: subviews, columns: columnFrames)
		var y = bounds.minY
		for (row, height) in rows.enumerated() {
			for column in 0..<columns {
				let index = row * columns + column
				guard index < subviews.count else { break }
				let frame = columnFrames[column]
				subviews[index].place(
					at: CGPoint(x: bounds.minX + frame.x, y: y),
					proposal: ProposedViewSize(width: frame.width, height: height)
				)
			}
			y += height + spacing
		}
	}

	private func rowHeights(subviews: Subviews, columns columnFrames: [(x: CGFloat, width: CGFloat)]) -> [CGFloat] {
		stride(from: 0, to: subviews.count, by: columns).map { start in
			(start..<min(start + columns, subviews.count)).map { index in
				subviews[index].sizeThatFits(ProposedViewSize(width: columnFrames[index - start].width, height: nil)).height
			}.max() ?? 0
		}
	}

	private func columnFrames(width: CGFloat) -> [(x: CGFloat, width: CGFloat)] {
		if let fold, columns.isMultiple(of: 2), fold.lowerBound > 0, fold.upperBound < width {
			let half = columns / 2
			let leading = Self.columnFrames(count: half, from: 0, to: fold.lowerBound - spacing / 2, spacing: spacing)
			let trailing = Self.columnFrames(count: half, from: fold.upperBound + spacing / 2, to: width, spacing: spacing)
			return leading + trailing
		}
		return Self.columnFrames(count: columns, from: 0, to: width, spacing: spacing)
	}

	private static func columnFrames(count: Int, from start: CGFloat, to end: CGFloat, spacing: CGFloat) -> [(x: CGFloat, width: CGFloat)] {
		let width = max(0, (end - start - spacing * CGFloat(count - 1)) / CGFloat(count))
		return (0..<count).map { (start + CGFloat($0) * (width + spacing), width) }
	}
}
