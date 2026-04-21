/**
 * Samples edge pixels of an icon to determine how to render it in a square container.
 *
 * The goal is to make the icon look like it naturally fills the square. We sample the
 * vertical midpoints of the top and bottom edges — not corners, because many icons have
 * rounded corners or decorative elements that aren't representative of the true edge color.
 * For example, a circular icon has opaque top/bottom midpoints but transparent corners;
 * sampling the midpoints lets us extend the circle's edge color into the square container.
 *
 * Two outcomes:
 *   - Both edge pixels are opaque → average their color for the container background,
 *     render the icon full-bleed. The sampled color visually extends the icon's border
 *     so it appears to fill the entire square.
 *   - Both edge pixels are transparent → the icon "floats" on a transparent background,
 *     so use a solid black container and add padding (padded: true) to keep the icon
 *     from touching the edges.
 *
 * Known limitation: this approach assumes that opaque edge-midpoint pixels represent
 * background/border color, not foreground content. If an icon's foreground content
 * happens to pass through both sample points (e.g. a red "T" on a transparent
 * background — the T's horizontal bar covers the top midpoint and its vertical stroke
 * covers the bottom midpoint), we'll use the content color as the container background.
 * The icon then disappears into its own background, producing a solid-colored square.
 * There's no reliable way to distinguish "edge of a filled background" from "foreground
 * content at the sample point" with pixel sampling alone. This is an inherent tradeoff
 * of the approach — if it becomes a real problem, consider replacing edge-color sampling
 * with a fixed background treatment (e.g. always black + padded).
 *
 * Requires a CORS-clean image (crossOrigin='anonymous' + server CORS headers).
 * If the canvas is tainted by a cross-origin image, getImageData() throws a SecurityError
 * and we fall back to black + padded. This is the expected outcome for most cross-origin
 * icons — see shortcut-icon.tsx for the CORS loading strategy and fallback handling.
 */
export function sampleEdgeColor(img: HTMLImageElement): {bgColor: string; padded: boolean} {
	try {
		const canvas = document.createElement('canvas')
		const size = 64 // small enough to be fast
		canvas.width = size
		canvas.height = size
		const ctx = canvas.getContext('2d', {willReadFrequently: true})
		if (!ctx) return {bgColor: 'black', padded: true}

		ctx.drawImage(img, 0, 0, size, size)

		// Sample vertical midpoints of top and bottom edges
		const topPixel = ctx.getImageData(size / 2, 0, 1, 1).data
		const bottomPixel = ctx.getImageData(size / 2, size - 1, 1, 1).data

		const topAlpha = topPixel[3]
		const bottomAlpha = bottomPixel[3]

		// Both transparent — icon floats, needs padding on a solid background
		if (topAlpha < 10 && bottomAlpha < 10) {
			return {bgColor: 'black', padded: true}
		}

		// Average the opaque pixel(s) to get a color that extends the icon's edge
		let r = 0,
			g = 0,
			b = 0,
			count = 0
		if (topAlpha >= 10) {
			r += topPixel[0]
			g += topPixel[1]
			b += topPixel[2]
			count++
		}
		if (bottomAlpha >= 10) {
			r += bottomPixel[0]
			g += bottomPixel[1]
			b += bottomPixel[2]
			count++
		}

		r = Math.round(r / count)
		g = Math.round(g / count)
		b = Math.round(b / count)

		return {bgColor: `rgb(${r}, ${g}, ${b})`, padded: false}
	} catch {
		// Canvas tainted by cross-origin image (SecurityError) or other failure
		return {bgColor: 'black', padded: true}
	}
}
