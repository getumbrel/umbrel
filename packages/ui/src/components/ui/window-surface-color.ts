type Rgb = [number, number, number]

/**
 * The colour a window surface shows along its bottom edge: what its blurred
 * wallpaper image (`.umbrel-window-wallpaper` in index.css) comes to there,
 * under the tint. The recipe is read from the variables the CSS itself uses, so
 * the two can't drift apart. Returns nothing until the image has loaded.
 */
export function sampleWindowSurfaceEdgeColor(image: HTMLImageElement) {
	const style = getComputedStyle(image)
	const number = (name: string) => parseFloat(style.getPropertyValue(name))
	const tint = style.getPropertyValue('--window-background-tint-rgb').trim().split(/\s+/).map(Number)
	const tintOpacity = number('--window-background-tint-opacity')
	const underTint = (color: Rgb) =>
		`rgb(${color.map((channel, i) => Math.round(channel * (1 - tintOpacity) + tint[i] * tintOpacity)).join(' ')})`

	// A surface that has dropped its wallpaper (Increase contrast, the Photos map) is black
	const {clientWidth: width, clientHeight: height, naturalWidth, naturalHeight} = image
	if (!width || !height) return underTint([0, 0, 0])
	if (!naturalWidth || !naturalHeight) return undefined

	// object-fit: cover, then the transform's scale, both about the centre
	const cover = Math.max(width / naturalWidth, height / naturalHeight)
	const zoom = cover * new DOMMatrix(style.transform).a
	// What the blur gathers into the edge: the image across the surface's width,
	// for as far as the blur, which comes before the transform, reaches above and
	// below the edge
	const edge = naturalHeight / 2 + height / 2 / zoom
	const reach = number('--window-background-blur') / cover
	const sourceWidth = Math.min(naturalWidth, Math.ceil(width / zoom))
	const top = Math.max(0, Math.min(naturalHeight - 1, Math.floor(edge - reach)))
	const sourceHeight = Math.max(1, Math.min(naturalHeight, Math.ceil(edge + reach)) - top)

	const canvas = document.createElement('canvas')
	canvas.width = sourceWidth
	canvas.height = sourceHeight
	const context = canvas.getContext('2d')
	if (!context) return undefined
	const left = Math.round((naturalWidth - sourceWidth) / 2)
	context.drawImage(image, left, top, sourceWidth, sourceHeight, 0, 0, sourceWidth, sourceHeight)
	const {data} = context.getImageData(0, 0, sourceWidth, sourceHeight)
	const sum: Rgb = [0, 0, 0]
	for (let i = 0; i < data.length; i += 4) {
		sum[0] += data[i]
		sum[1] += data[i + 1]
		sum[2] += data[i + 2]
	}
	const average = sum.map((channel) => channel / (data.length / 4)) as Rgb

	return underTint(
		filterColor(average, {
			saturation: number('--window-background-saturation') / 100,
			brightness: number('--window-background-brightness') / 100,
		}),
	)
}

/** CSS `saturate()` then `brightness()`, as the filter applies them to a colour */
export function filterColor([r, g, b]: Rgb, {saturation: s, brightness}: {saturation: number; brightness: number}) {
	const saturated = [
		(0.213 + 0.787 * s) * r + (0.715 - 0.715 * s) * g + (0.072 - 0.072 * s) * b,
		(0.213 - 0.213 * s) * r + (0.715 + 0.285 * s) * g + (0.072 - 0.072 * s) * b,
		(0.213 - 0.213 * s) * r + (0.715 - 0.715 * s) * g + (0.072 + 0.928 * s) * b,
	]
	// Each filter hands on a displayable colour
	const clamp = (channel: number) => Math.min(255, Math.max(0, channel))
	return saturated.map((channel) => clamp(clamp(channel) * brightness)) as Rgb
}
