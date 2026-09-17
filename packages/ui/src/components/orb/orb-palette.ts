// The orb's colours, derived from the wallpaper's brand colour so the sphere
// always looks like it was poured from the desktop behind it. Four stops:
// a deep shade for the shaded rim, the brand hue itself, an analogous partner
// the swirl drifts through, and a milky tint for the highlight patches.

export type Rgb = readonly [number, number, number] // 0..1 sRGB

export type OrbPalette = {
	deep: Rgb
	primary: Rgb
	secondary: Rgb
	milk: Rgb
}

type Hsl = {h: number; s: number; l: number} // degrees, 0..100, 0..100

const FALLBACK_HSL: Hsl = {h: 216, s: 80, l: 56}

// "24 90% 50%" — the wallpaper definition format (see umbreld wallpapers.ts)
export function parseBrandHsl(value: string | undefined): Hsl {
	if (!value) return FALLBACK_HSL
	const [h, s, l] = value
		.trim()
		.split(/\s+/)
		.map((part) => Number.parseFloat(part))
	if (![h, s, l].every(Number.isFinite)) return FALLBACK_HSL
	return {h: ((h % 360) + 360) % 360, s: clamp(s, 0, 100), l: clamp(l, 0, 100)}
}

export function hslToRgb({h, s, l}: Hsl): Rgb {
	const sat = s / 100
	const lig = l / 100
	const k = (n: number) => (n + h / 30) % 12
	const a = sat * Math.min(lig, 1 - lig)
	const f = (n: number) => lig - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
	return [f(0), f(8), f(4)]
}

// Wallpapers span greys (the null wallpaper) to fully saturated primaries.
// The orb wants the pastel, glassy range: enough saturation to read as the
// wallpaper's colour, never so much that the swirl turns neon.
export function orbPaletteFromHsl(brandColorHsl: string | undefined): OrbPalette {
	const {h, s} = parseBrandHsl(brandColorHsl)
	const grey = s < 8
	return {
		deep: hslToRgb({h: h + 8, s: grey ? 0 : clamp(s, 35, 60), l: grey ? 30 : 36}),
		primary: hslToRgb({h, s: grey ? 0 : clamp(s, 42, 72), l: 62}),
		secondary: hslToRgb({h: h - 28, s: grey ? 0 : clamp(s, 38, 66), l: grey ? 52 : 58}),
		milk: hslToRgb({h: h + 16, s: grey ? 0 : clamp(s * 0.5, 18, 45), l: 90}),
	}
}

export function rgbCss([r, g, b]: Rgb, alpha = 1) {
	const channel = (v: number) => Math.round(clamp(v, 0, 1) * 255)
	return alpha === 1
		? `rgb(${channel(r)} ${channel(g)} ${channel(b)})`
		: `rgb(${channel(r)} ${channel(g)} ${channel(b)} / ${alpha})`
}

// A still rendition of the same palette for surfaces that can't run the
// shader: the CSS fallback orb, the domain menu's tiny "Everywhere" glyph.
export function orbPaletteCssBackground(palette: OrbPalette) {
	return [
		`radial-gradient(circle at 32% 28%, ${rgbCss(palette.milk, 0.95)} 0%, ${rgbCss(palette.milk, 0)} 38%)`,
		`radial-gradient(circle at 70% 75%, ${rgbCss(palette.secondary)} 0%, ${rgbCss(palette.secondary, 0)} 55%)`,
		`radial-gradient(circle at 50% 50%, ${rgbCss(palette.primary)} 40%, ${rgbCss(palette.deep)} 100%)`,
	].join(', ')
}

function clamp(value: number, min: number, max: number) {
	return Math.min(max, Math.max(min, value))
}
