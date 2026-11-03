import SwiftUI

// The umbrelOS folder icon, recolored to the wallpaper's brand color. It's drawn from the
// same artwork as umbrelOS (folder-icon.tsx and embedded-overlay-icons.tsx): two paper
// inserts behind a brand-colored body with a dark gradient and a bevel, clipped to a
// rounded square, and for the standard folders an embossed glyph on top.
struct FolderIconView: View {
	let path: String // e.g. "/Home/Downloads"
	let brandColor: Color

	var body: some View {
		let glyph = FolderArt.glyphs[(path as NSString).lastPathComponent]
		Canvas { context, size in
			FolderArt.draw(in: context, size: size, brandColor: brandColor, glyph: glyph)
		}
	}
}

private enum FolderArt {
	// The artwork's viewBox, which the drawing is fitted into and centered
	static let size = CGSize(width: 57, height: 50)

	static let clip = Path(roundedRect: CGRect(x: 0.833344, y: 0, width: 56, height: 50), cornerRadius: 10, style: .circular)
	static let insertBack = Path(svgPathData: "M17.0326 6.81456C16.7616 5.22668 17.8377 3.77724 19.436 3.57715L41.1392 0.86014C42.7376 0.660043 44.253 1.78506 44.5239 3.37294L45.8488 11.1373L18.3575 14.579L17.0326 6.81456Z")
	static let insertFront = Path(svgPathData: "M11.5798 9.90146C11.3176 8.31211 12.4022 6.87309 14.0023 6.68733L50.4821 2.45217C52.0821 2.26641 53.5918 3.40424 53.8539 4.9936L54.7352 10.3361L12.461 15.244L11.5798 9.90146Z")
	static let body = Path(svgPathData: "M0.70639 32V15.261C0.70639 9.40584 0.70639 6.47828 2.01666 4.32368C2.7654 3.09245 3.79884 2.05901 5.03007 1.31027C7.18467 0 10.1122 0 15.9674 0C17.4916 0 18.2537 0 18.9574 0.211449C19.3656 0.334078 19.7564 0.508388 20.1204 0.730141C20.7479 1.11251 21.2571 1.67954 22.2755 2.81358L22.7476 3.33928L22.7476 3.3393C24.2151 4.9735 24.9489 5.7906 25.9211 6.22422C26.8933 6.65785 27.9915 6.65785 30.1879 6.65785H44.7064C50.3632 6.65785 53.1917 6.65785 54.949 8.41521C56.7064 10.1726 56.7064 13.001 56.7064 18.6578V32C56.7064 40.4853 56.7064 44.7279 54.0704 47.364C51.4343 50 47.1917 50 38.7064 50H18.7064C10.2211 50 5.97847 50 3.34243 47.364C0.70639 44.7279 0.70639 40.4853 0.70639 32Z")
	static let shade = Gradient(stops: [
		.init(color: .black.opacity(0), location: 0.315),
		.init(color: .black.opacity(0.48), location: 0.965),
	])

	struct Glyph {
		let viewBox: CGSize
		// The emboss offsets and blurs are multiples of this, in the glyph's own units
		let unit: CGFloat
		let path: Path
	}

	// umbrelOS centers the glyph in a box 23% from the left and 28% from the top, 56% of
	// the folder's size, filled with black at 30%
	static let glyphBox = CGRect(x: 13.11, y: 14, width: 31.92, height: 28)

	static let glyphs: [String: Glyph] = [
		"Downloads": Glyph(
			viewBox: CGSize(width: 29, height: 29),
			unit: 0.36169,
			path: Path(svgPathData: "M14.625 2.02148C14.3525 2.02148 14.085 2.02398 13.8225 2.02773L13.0525 2.04898L12.6788 2.06523L11.955 2.10773L11.2638 2.16523C5.2825 2.74523 2.84875 5.17898 2.26875 11.1602L2.21125 11.8515L2.16875 12.5752C2.1625 12.6977 2.15625 12.8227 2.1525 12.949L2.13125 13.719L2.12625 14.1165L2.125 14.5215C2.125 14.794 2.1275 15.0615 2.13125 15.324L2.1525 16.094L2.16875 16.4677L2.21125 17.1915L2.26875 17.8827C2.84875 23.864 5.2825 26.2977 11.2638 26.8777L11.955 26.9352L12.6788 26.9777C12.8012 26.984 12.9262 26.9902 13.0525 26.994L13.8225 27.0152L14.625 27.0215L15.4275 27.0152L16.1975 26.994L16.5712 26.9777L17.295 26.9352L17.9862 26.8777C23.9675 26.2977 26.4013 23.864 26.9813 17.8827L27.0387 17.1915L27.0812 16.4677C27.0875 16.3452 27.0938 16.2202 27.0975 16.094L27.1188 15.324L27.125 14.5215L27.1188 13.719L27.0975 12.949L27.0812 12.5752L27.0387 11.8515L26.9813 11.1602C26.4013 5.17898 23.9675 2.74523 17.9862 2.16523L17.295 2.10773L16.5712 2.06523C16.4467 2.05915 16.3221 2.05374 16.1975 2.04898L15.4275 2.02773L15.03 2.02273L14.625 2.02148ZM14.625 8.27148C14.9312 8.27152 15.2267 8.38393 15.4555 8.58738C15.6843 8.79083 15.8304 9.07117 15.8663 9.37523L15.875 9.52148V14.7569C15.875 15.4013 16.654 15.724 17.1098 15.2685L18.7413 13.6377C18.9565 13.4225 19.2429 13.2932 19.5466 13.2741C19.8504 13.255 20.1507 13.3474 20.3913 13.534L20.5088 13.6377C20.724 13.853 20.8533 14.1393 20.8724 14.4431C20.8915 14.7469 20.7991 15.0472 20.6125 15.2877L20.5088 15.4052L15.5087 20.4052C15.4651 20.449 15.4183 20.4896 15.3688 20.5265L15.2312 20.6152L15.0888 20.6827L14.9575 20.7265L14.8236 20.7534C14.7888 20.7605 14.7534 20.7649 14.7179 20.7667L14.625 20.7715L14.5312 20.7677L14.3737 20.7465L14.235 20.709L14.0962 20.654L13.9738 20.589L13.8588 20.509L13.7413 20.4052L8.74125 15.4052C8.51707 15.1803 8.38691 14.8784 8.37721 14.561C8.36752 14.2436 8.47902 13.9343 8.68906 13.6961C8.8991 13.4579 9.19194 13.3086 9.50809 13.2785C9.82425 13.2484 10.14 13.3397 10.3912 13.534L10.5087 13.6377L12.1402 15.2685C12.596 15.724 13.375 15.4013 13.375 14.7569V9.52148C13.375 9.18996 13.5067 8.87202 13.7411 8.6376C13.9755 8.40318 14.2935 8.27148 14.625 8.27148Z")
		),
		"Documents": Glyph(
			viewBox: CGSize(width: 26, height: 30),
			unit: 0.36169,
			path: Path(svgPathData: "M23.8572 9.54785L16.6777 2.36836C16.5824 2.27314 16.4692 2.19764 16.3447 2.14617C16.2202 2.09469 16.0868 2.06825 15.9521 2.06836H3.64438C3.10034 2.06836 2.57859 2.28448 2.1939 2.66917C1.80921 3.05386 1.59309 3.57561 1.59309 4.11964V26.6837C1.59309 27.2278 1.80921 27.7495 2.1939 28.1342C2.57859 28.5189 3.10034 28.735 3.64438 28.735H22.1059C22.6499 28.735 23.1717 28.5189 23.5564 28.1342C23.9411 27.7495 24.1572 27.2278 24.1572 26.6837V10.2735C24.1573 10.1388 24.1309 10.0053 24.0794 9.88082C24.0279 9.75631 23.9524 9.64317 23.8572 9.54785ZM16.6754 10.2735C16.2759 10.2735 15.9521 9.94962 15.9521 9.55011V6.37886C15.9521 5.73439 16.7312 5.41164 17.187 5.86735L20.3582 9.0386C20.8139 9.4943 20.4912 10.2735 19.8467 10.2735H16.6754Z")
		),
		"Photos": Glyph(
			viewBox: CGSize(width: 30, height: 30),
			unit: 0.36169,
			path: Path(svgPathData: "M10.8757 14.3941C11.485 13.8875 12.0997 13.8875 12.7237 14.4088L12.8677 14.5395L19.5157 21.1875L19.641 21.2981C19.8975 21.497 20.2178 21.5954 20.5418 21.575C20.8657 21.5545 21.1711 21.4166 21.4006 21.1871C21.6302 20.9576 21.7681 20.6522 21.7885 20.3283C21.809 20.0043 21.7105 19.684 21.5117 19.4275L21.401 19.3021L20.0682 17.9683C19.8527 17.7527 19.8525 17.4033 20.0677 17.1875L20.209 17.0608C20.8183 16.5541 21.433 16.5541 22.057 17.0755L22.201 17.2061L28.1908 23.1973C28.3441 23.3506 28.4234 23.5651 28.3882 23.779C28.2004 24.9189 27.6466 25.9705 26.806 26.772C25.8825 27.6524 24.6739 28.1726 23.3997 28.2381L23.125 28.2448H7.12499C5.8022 28.2447 4.52664 27.7531 3.546 26.8653C2.65026 26.0544 2.05897 24.9659 1.86324 23.7804C1.82792 23.5664 1.90721 23.3519 2.06051 23.1985L10.7343 14.5208L10.8757 14.3941ZM23.125 1.57813C24.4933 1.57812 25.8093 2.10404 26.8007 3.04709C27.7922 3.99014 28.3832 5.27818 28.4517 6.64479L28.4583 6.91146V17.9454C28.4583 18.5898 27.6792 18.9126 27.2235 18.457L24.0677 15.3021L23.8677 15.1195C22.193 13.6595 20.0677 13.6568 18.4063 15.0968L18.201 15.2835C17.9748 15.5089 17.6088 15.5087 17.3829 15.2829L14.7343 12.6355L14.5343 12.4528C12.8597 10.9928 10.7343 10.9901 9.07299 12.4301L8.86766 12.6168L3.02649 18.4569C2.57077 18.9125 1.79166 18.5897 1.79166 17.9453V6.91146C1.79166 5.54313 2.31757 4.22715 3.26062 3.23571C4.20367 2.24426 5.49171 1.65321 6.85832 1.58479L7.12499 1.57813H23.125ZM19.1383 8.24479L18.969 8.25412C18.6449 8.29267 18.3462 8.44873 18.1295 8.69274C17.9128 8.93676 17.7931 9.25177 17.7931 9.57812C17.7931 9.90448 17.9128 10.2195 18.1295 10.4635C18.3462 10.7075 18.6449 10.8636 18.969 10.9021L19.125 10.9115L19.2943 10.9021C19.6184 10.8636 19.9171 10.7075 20.1338 10.4635C20.3505 10.2195 20.4702 9.90448 20.4702 9.57812C20.4702 9.25177 20.3505 8.93676 20.1338 8.69274C19.9171 8.44873 19.6184 8.29267 19.2943 8.25412L19.1383 8.24479Z")
		),
		"Videos": Glyph(
			viewBox: CGSize(width: 32, height: 28),
			unit: 0.337163,
			path: Path(svgPathData: "M28.5622 1.91602H3.70385C3.1045 1.91602 2.5297 2.15411 2.1059 2.57791C1.68209 3.00172 1.444 3.57652 1.444 4.17587V24.5145C1.444 25.1139 1.68209 25.6887 2.1059 26.1125C2.5297 26.5363 3.1045 26.7744 3.70385 26.7744H28.5622C29.1616 26.7744 29.7364 26.5363 30.1602 26.1125C30.584 25.6887 30.8221 25.1139 30.8221 24.5145V4.17587C30.8221 3.57652 30.584 3.00172 30.1602 2.57791C29.7364 2.15411 29.1616 1.91602 28.5622 1.91602ZM24.0425 4.85019C24.0425 4.47777 24.3444 4.17587 24.7168 4.17587H27.8879C28.2603 4.17587 28.5622 4.47777 28.5622 4.85019V5.76139C28.5622 6.13381 28.2603 6.43572 27.8879 6.43572H24.7168C24.3444 6.43572 24.0425 6.13381 24.0425 5.76139V4.85019ZM8.22356 23.8402C8.22356 24.2126 7.92165 24.5145 7.54923 24.5145H4.37818C4.00576 24.5145 3.70385 24.2126 3.70385 23.8402V22.929C3.70385 22.5566 4.00576 22.2547 4.37818 22.2547H7.54923C7.92165 22.2547 8.22356 22.5566 8.22356 22.929V23.8402ZM8.22356 5.76139C8.22356 6.13381 7.92165 6.43572 7.54923 6.43572H4.37818C4.00576 6.43572 3.70385 6.13381 3.70385 5.76139V4.85019C3.70385 4.47777 4.00576 4.17587 4.37818 4.17587H7.54923C7.92165 4.17587 8.22356 4.47777 8.22356 4.85019V5.76139ZM15.0031 23.8402C15.0031 24.2126 14.7012 24.5145 14.3288 24.5145H11.1577C10.7853 24.5145 10.4834 24.2126 10.4834 23.8402V22.929C10.4834 22.5566 10.7853 22.2547 11.1577 22.2547H14.3288C14.7012 22.2547 15.0031 22.5566 15.0031 22.929V23.8402ZM15.0031 5.76139C15.0031 6.13381 14.7012 6.43572 14.3288 6.43572H11.1577C10.7853 6.43572 10.4834 6.13381 10.4834 5.76139V4.85019C10.4834 4.47777 10.7853 4.17587 11.1577 4.17587H14.3288C14.7012 4.17587 15.0031 4.47777 15.0031 4.85019V5.76139ZM21.7827 23.8402C21.7827 24.2126 21.4808 24.5145 21.1083 24.5145H17.9373C17.5649 24.5145 17.263 24.2126 17.263 23.8402V22.929C17.263 22.5566 17.5649 22.2547 17.9373 22.2547H21.1083C21.4808 22.2547 21.7827 22.5566 21.7827 22.929V23.8402ZM21.7827 5.76139C21.7827 6.13381 21.4808 6.43572 21.1083 6.43572H17.9373C17.5649 6.43572 17.263 6.13381 17.263 5.76139V4.85019C17.263 4.47777 17.5649 4.17587 17.9373 4.17587H21.1083C21.4808 4.17587 21.7827 4.47777 21.7827 4.85019V5.76139ZM28.5622 23.8402C28.5622 24.2126 28.2603 24.5145 27.8879 24.5145H24.7168C24.3444 24.5145 24.0425 24.2126 24.0425 23.8402V22.929C24.0425 22.5566 24.3444 22.2547 24.7168 22.2547H27.8879C28.2603 22.2547 28.5622 22.5566 28.5622 22.929V23.8402Z")
		),
	]

	static func draw(in context: GraphicsContext, size: CGSize, brandColor: Color, glyph: Glyph?) {
		var context = context
		let scale = min(size.width / Self.size.width, size.height / Self.size.height)
		context.translateBy(x: (size.width - Self.size.width * scale) / 2, y: (size.height - Self.size.height * scale) / 2)
		context.scaleBy(x: scale, y: scale)
		context.clip(to: clip)
		context.fill(insertBack, with: .color(.white.opacity(0.6)))
		context.fill(insertFront, with: .color(.white))
		context.fill(body, with: .color(brandColor))
		context.fill(
			body,
			with: .linearGradient(shade, startPoint: CGPoint(x: 28.7064, y: 0), endPoint: CGPoint(x: 28.7064, y: 50))
		)
		// The bevel: light along the top and left edges, dark along the bottom and right
		innerShadow(body, color: .white.opacity(0.25), x: 1, y: 1, blur: 0.25, in: context)
		innerShadow(body, color: .black.opacity(0.25), x: -1, y: -1, blur: 0.5, in: context)
		if let glyph { draw(glyph, in: context) }
	}

	private static func draw(_ glyph: Glyph, in context: GraphicsContext) {
		let fit = min(glyphBox.width / glyph.viewBox.width, glyphBox.height / glyph.viewBox.height)
		let unit = glyph.unit
		context.drawLayer { layer in
			layer.translateBy(
				x: glyphBox.midX - glyph.viewBox.width * fit / 2,
				y: glyphBox.midY - glyph.viewBox.height * fit / 2
			)
			layer.scaleBy(x: fit, y: fit)
			// Outside the glyph: a faint shadow up and to the left, and a highlight below
			// and to the right
			var outside = layer
			outside.clip(to: glyph.path, options: .inverse)
			shadow(
				glyph.path,
				color: .black.opacity(0.05),
				x: -2 * unit,
				y: -2 * unit,
				blur: unit,
				in: outside
			)
			shadow(
				glyph.path,
				color: .white.opacity(0.32),
				x: unit,
				y: unit,
				blur: unit,
				blendMode: .overlay,
				in: outside
			)
			layer.fill(glyph.path, with: .color(.black.opacity(0.3)))
			innerShadow(
				glyph.path,
				color: .black.opacity(0.29),
				x: unit,
				y: unit,
				blur: unit,
				blendMode: .overlay,
				in: layer
			)
		}
	}

	// Offsets and blurs are in the artwork's units, which the context's transform scales.
	// A shadow's radius is the same standard deviation as an SVG blur.
	private static func shadow(
		_ path: Path,
		color: Color,
		x: CGFloat,
		y: CGFloat,
		blur: CGFloat,
		blendMode: GraphicsContext.BlendMode = .normal,
		options: GraphicsContext.ShadowOptions = .shadowOnly,
		in context: GraphicsContext
	) {
		var context = context
		context.addFilter(.shadow(
			color: color,
			radius: blur,
			x: x,
			y: y,
			blendMode: blendMode,
			options: options
		))
		context.fill(path, with: .color(.black))
	}

	private static func innerShadow(
		_ path: Path,
		color: Color,
		x: CGFloat,
		y: CGFloat,
		blur: CGFloat,
		blendMode: GraphicsContext.BlendMode = .normal,
		in context: GraphicsContext
	) {
		var context = context
		context.clip(to: path)
		shadow(
			path,
			color: color,
			x: x,
			y: y,
			blur: blur,
			blendMode: blendMode,
			options: [.shadowOnly, .invertsAlpha],
			in: context
		)
	}
}

private extension Path {
	// The absolute M, L, H, V, C and Z commands, which is all the folder artwork uses
	init(svgPathData data: String) {
		self.init()
		let tokens = data.matches(of: #/[A-Za-z]|-?(?:\d+\.?\d*|\.\d+)/#).map { String($0.output) }
		var index = 0
		var command = "M"
		var point = CGPoint.zero
		func number() -> CGFloat {
			defer { index += 1 }
			return CGFloat(Double(tokens[index]) ?? 0)
		}
		while index < tokens.count {
			if tokens[index].first?.isLetter == true {
				command = tokens[index]
				index += 1
				if command == "Z" { closeSubpath() }
				continue
			}
			switch command {
			case "M":
				point = CGPoint(x: number(), y: number())
				move(to: point)
				// Further pairs after a move are lines
				command = "L"
			case "L":
				point = CGPoint(x: number(), y: number())
				addLine(to: point)
			case "H":
				point.x = number()
				addLine(to: point)
			case "V":
				point.y = number()
				addLine(to: point)
			case "C":
				let control1 = CGPoint(x: number(), y: number())
				let control2 = CGPoint(x: number(), y: number())
				point = CGPoint(x: number(), y: number())
				addCurve(to: point, control1: control1, control2: control2)
			default:
				assertionFailure("Unsupported SVG path command \(command)")
				return
			}
		}
	}
}
