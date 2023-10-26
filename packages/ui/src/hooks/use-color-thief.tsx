import ColorThief, {RGBColor} from 'colorthief'
import {useEffect, useState} from 'react'

const colorThief = new ColorThief()
const colorCount = 3

export function useColorThief(ref: React.RefObject<HTMLImageElement>) {
	const [colors, setColors] = useState<string[] | undefined>()

	useEffect(() => {
		if (!ref.current) return
		const img = ref.current

		if (img.complete) {
			const rgbArr = colorThief.getPalette(img, colorCount)
			setColors(processColors(rgbArr))
		} else {
			img.addEventListener('load', function () {
				const rgbArr = colorThief.getPalette(img, colorCount)
				setColors(processColors(rgbArr))
			})
		}
	}, [ref])

	return colors
}

function processColors(colors: RGBColor[] | null) {
	// TODO: consider pulling out hues and always set saturation to 100% and lightness to 50%
	if (!colors) return undefined
	return colors
		.filter((c) => !isNeutralBright(c) && !isNeutralDark(c))
		.map((c) => {
			const [h, s, l] = rgbToHsl(c[0], c[1], c[2])
			const hslCss = `hsla(${h * 360}, ${s * 80 + 20}%, ${l * 10 + 30}%, 0.8)`
			return hslCss
		})
}

function isNeutralBright(rgb: number[]) {
	if (rgb[0] > 200 && rgb[1] > 200 && rgb[2] > 200) {
		return true
		// return `rgba(${rgb.map((c) => c / 3).join(',')}, 0.5)`
	}
	return false
}

function isNeutralDark(rgb: number[]) {
	if (rgb[0] < 55 && rgb[1] < 55 && rgb[2] < 55) {
		return true
	}
	return false
}

/**
 * Converts an RGB color value to HSL. Conversion formula
 * adapted from http://en.wikipedia.org/wiki/HSL_color_space.
 * Assumes r, g, and b are contained in the set [0, 255] and
 * returns h, s, and l in the set [0, 1].
 *
 * @param   {number}  r       The red color value
 * @param   {number}  g       The green color value
 * @param   {number}  b       The blue color value
 * @return  {Array}           The HSL representation
 */
function rgbToHsl(r: number, g: number, b: number) {
	const {min, max} = Math

	;(r /= 255), (g /= 255), (b /= 255)
	const vmax = max(r, g, b),
		vmin = min(r, g, b)
	let h = 0
	const l = (vmax + vmin) / 2

	if (vmax === vmin) {
		return [0, 0, l] // achromatic
	}

	const d = vmax - vmin
	const s = l > 0.5 ? d / (2 - vmax - vmin) : d / (vmax + vmin)
	if (vmax === r) h = (g - b) / d + (g < b ? 6 : 0)
	if (vmax === g) h = (b - r) / d + 2
	if (vmax === b) h = (r - g) / d + 4
	h /= 6

	return [h, s, l]
}
